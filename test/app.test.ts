import { beforeAll, describe, expect, it } from "vitest";
import type { BoardResponse, ListBoardsResponse, MeResponse } from "../shared/api.ts";
import { createApp } from "../worker/app.ts";
import { Directory } from "../worker/directory.ts";
import type { Env } from "../worker/env.ts";
import { assetKey } from "../worker/layout.ts";
import { ROOM_HEADERS, type BoardEntry, type DirectoryRpc, type RoomRpc } from "../worker/rpc.ts";
import { R2BucketStore } from "../worker/storage.ts";
import { ADMIN_EMAIL, AUD, createAccessKeys, TEAM_DOMAIN, VIEWER_EMAIL, type AccessKeys } from "./support/access.ts";
import { MemoryBucket } from "./support/bucket.ts";

const ORIGIN = "https://boards.example.com";
const S3_BINDINGS = {
  STORAGE_TYPE: "s3",
  S3_ENDPOINT: "https://s3.example.com",
  S3_REGION: "auto",
  S3_BUCKET: "alcyone-test",
  S3_URL_STYLE: "path",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};
const OTHER_EMAIL = "other@example.com";

interface RoomCall {
  method: "fetch" | "rename" | "destroy";
  boardId: string;
  headers?: Headers;
  name?: string;
}

function setup(access: AccessKeys, envOverrides: Partial<Env> = {}) {
  const directory = new Directory();
  const directoryRpc: DirectoryRpc = {
    list: async () => directory.list(),
    get: async (id) => directory.get(id),
    create: async (entry) => {
      directory.create(entry);
    },
    rename: async (id, name) => directory.rename(id, name),
    remove: async (id) => directory.remove(id),
    touch: async (id, updatedAt) => {
      directory.touch(id, updatedAt);
    },
  };
  const roomCalls: RoomCall[] = [];
  const roomFor = (_env: Env, boardId: string): RoomRpc => ({
    fetch: async (request) => {
      roomCalls.push({ method: "fetch", boardId, headers: request.headers });
      // Node.js has no WebSockets of the Workers runtime, so the room answers with plain text here.
      return new Response("room", { status: 200 });
    },
    rename: async (id, name) => {
      roomCalls.push({ method: "rename", boardId: id, name });
    },
    destroy: async (id) => {
      roomCalls.push({ method: "destroy", boardId: id });
    },
  });
  const bucket = new MemoryBucket();
  let ids = 0;
  let tick = 0;
  const app = createApp({
    keySetFor: () => access.keySet,
    objectStoreFor: () => new R2BucketStore(bucket),
    directoryFor: () => directoryRpc,
    roomFor,
    now: () => new Date(Date.UTC(2026, 10, 8, 0, 0, (tick += 1))),
    newId: () => `id${String((ids += 1)).padStart(14, "0")}`,
  });
  const env: Env = {
    ASSETS: { fetch: async () => new Response("<!doctype html><title>alcyone</title>", { headers: { "content-type": "text/html" } }) },
    ROOMS: {} as Env["ROOMS"],
    DIRECTORY: {} as Env["DIRECTORY"],
    AUTH_MODE: "cloudflare-access",
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUD,
    ADMIN_EMAILS: JSON.stringify([ADMIN_EMAIL]),
    // The bindings of a bucket, which objectStoreFor above replaces with one in memory.
    ...S3_BINDINGS,
    ...envOverrides,
  };
  const request = async (path: string, init: RequestInit = {}, email: string | null = VIEWER_EMAIL) => {
    const headers = new Headers(init.headers);
    if (email !== null) headers.set("cf-access-jwt-assertion", await access.sign({ email }));
    return app.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env);
  };
  return { app, env, request, directory, roomCalls, bucket };
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let access: AccessKeys;
beforeAll(async () => {
  access = await createAccessKeys();
});

describe("sign-in", () => {
  it("refuses a request without an Access token", async () => {
    const { request } = setup(access);
    const response = await request("/api/me", {}, null);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("names the signed-in person", async () => {
    const { request } = setup(access);
    const response = await request("/api/me");
    expect(response.status).toBe(200);
    expect(((await response.json()) as MeResponse).me).toEqual({ email: VIEWER_EMAIL, name: "viewer", isAdmin: false, logoutUrl: "/cdn-cgi/access/logout" });
  });

  it("signs in the development email on localhost only, in local development", async () => {
    const { app, env } = setup(access, { AUTH_MODE: "local-development", LOCAL_USER_EMAIL: "dev@example.com" });
    const local = await app.fetch(new Request("http://localhost:5173/api/me"), env);
    expect(((await local.json()) as MeResponse).me).toMatchObject({ email: "dev@example.com", logoutUrl: null });
    const remote = await app.fetch(new Request(`${ORIGIN}/api/me`), env);
    expect(remote.status).toBe(403);
  });

  it("stops every request when the configuration is incomplete", async () => {
    const { request } = setup(access, { S3_ENDPOINT: undefined, S3_SECRET_ACCESS_KEY: undefined });
    const response = await request("/api/boards");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "misconfigured" } });
  });
});

describe("boards", () => {
  it("creates a board and lists it, with who may change it", async () => {
    const { request } = setup(access);
    const created = await request("/api/boards", json({ name: "  Plan  " }));
    expect(created.status).toBe(201);
    const { board } = (await created.json()) as BoardResponse;
    expect(board).toMatchObject({ name: "Plan", createdBy: VIEWER_EMAIL, canManage: true });

    const mine = (await (await request("/api/boards")).json()) as ListBoardsResponse;
    expect(mine.boards.map((each) => each.id)).toEqual([board.id]);
    const theirs = (await (await request("/api/boards", {}, OTHER_EMAIL)).json()) as ListBoardsResponse;
    expect(theirs.boards[0]?.canManage).toBe(false);
    const admin = (await (await request("/api/boards", {}, ADMIN_EMAIL)).json()) as ListBoardsResponse;
    expect(admin.boards[0]?.canManage).toBe(true);
  });

  it("refuses a name that is empty or too long, and unknown fields", async () => {
    const { request } = setup(access);
    expect((await request("/api/boards", json({ name: "   " }))).status).toBe(400);
    expect((await request("/api/boards", json({ name: "x".repeat(101) }))).status).toBe(400);
    expect((await request("/api/boards", json({ name: "Plan", color: "red" }))).status).toBe(400);
  });

  it("lets the creator and admins rename a board, and tells its room", async () => {
    const { request, roomCalls } = setup(access);
    const { board } = (await (await request("/api/boards", json({ name: "Plan" }))).json()) as BoardResponse;
    const rename = (email: string) => request(`/api/boards/${board.id}`, { ...json({ name: "Roadmap" }), method: "PATCH" }, email);
    expect((await rename(OTHER_EMAIL)).status).toBe(403);
    expect((await rename(ADMIN_EMAIL)).status).toBe(200);
    const renamed = (await (await rename(VIEWER_EMAIL)).json()) as BoardResponse;
    expect(renamed.board.name).toBe("Roadmap");
    expect(roomCalls.filter((call) => call.method === "rename")).toHaveLength(2);
  });

  it("deletes a board through its room first, then from the list", async () => {
    const { request, roomCalls, directory } = setup(access);
    const { board } = (await (await request("/api/boards", json({ name: "Plan" }))).json()) as BoardResponse;
    expect((await request(`/api/boards/${board.id}`, { method: "DELETE" }, OTHER_EMAIL)).status).toBe(403);
    const deleted = await request(`/api/boards/${board.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect(roomCalls).toEqual([{ method: "destroy", boardId: board.id }]);
    expect(directory.get(board.id)).toBeNull();
    expect((await request(`/api/boards/${board.id}`)).status).toBe(404);
  });

  it("answers 404 for a board that does not exist and for an ID of another form", async () => {
    const { request } = setup(access);
    expect((await request("/api/boards/zzzzzzzzzzzzzzzz")).status).toBe(404);
    expect((await request("/api/boards/..%2F..")).status).toBe(404);
    expect((await request("/api/nothing")).status).toBe(404);
  });
});

describe("the WebSocket of a board", () => {
  async function created(setupResult: ReturnType<typeof setup>): Promise<BoardEntry> {
    const response = await setupResult.request("/api/boards", json({ name: "Plan & more" }));
    return ((await response.json()) as BoardResponse).board;
  }

  it("passes the connection to the room with the board and the person", async () => {
    const context = setup(access);
    const board = await created(context);
    const response = await context.request(`/api/boards/${board.id}/socket`, { headers: { upgrade: "websocket", origin: ORIGIN } });
    expect(response.status).toBe(200);
    const call = context.roomCalls[0];
    expect(call?.headers?.get(ROOM_HEADERS.board)).toBe(board.id);
    expect(call?.headers?.get(ROOM_HEADERS.email)).toBe(VIEWER_EMAIL);
    expect(decodeURIComponent(call?.headers?.get(ROOM_HEADERS.boardName) ?? "")).toBe("Plan & more");
  });

  it("refuses a request without an upgrade, and one from the page of another site", async () => {
    const context = setup(access);
    const board = await created(context);
    expect((await context.request(`/api/boards/${board.id}/socket`, { headers: { origin: ORIGIN } })).status).toBe(426);
    expect((await context.request(`/api/boards/${board.id}/socket`, { headers: { upgrade: "websocket", origin: "https://evil.example" } })).status).toBe(403);
    expect((await context.request(`/api/boards/${board.id}/socket`, { headers: { upgrade: "websocket" } })).status).toBe(403);
    expect(context.roomCalls).toHaveLength(0);
  });
});

describe("images", () => {
  it("keeps an image in the bucket and returns it with headers that keep it inert", async () => {
    const context = setup(access);
    const { board } = (await (await context.request("/api/boards", json({ name: "Plan" }))).json()) as BoardResponse;
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const uploaded = await context.request(`/api/boards/${board.id}/assets`, { method: "POST", headers: { "content-type": "image/png" }, body: bytes });
    expect(uploaded.status).toBe(201);
    const { asset } = (await uploaded.json()) as { asset: { id: string; size: number } };
    expect(asset.size).toBe(bytes.byteLength);
    expect(context.bucket.objects.has(assetKey(board.id, asset.id))).toBe(true);

    const read = await context.request(`/api/boards/${board.id}/assets/${asset.id}`);
    expect(read.status).toBe(200);
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(read.headers.get("content-security-policy")).toContain("sandbox");
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("refuses kinds of files that are not images it takes, and empty ones", async () => {
    const context = setup(access);
    const { board } = (await (await context.request("/api/boards", json({ name: "Plan" }))).json()) as BoardResponse;
    const upload = (type: string, body: BodyInit) => context.request(`/api/boards/${board.id}/assets`, { method: "POST", headers: { "content-type": type }, body });
    expect((await upload("image/svg+xml", "<svg/>")).status).toBe(400);
    expect((await upload("text/html", "<p>")).status).toBe(400);
    expect((await upload("image/png", new Uint8Array())).status).toBe(400);
  });

  it("answers 404 for an image that does not exist", async () => {
    const context = setup(access);
    const { board } = (await (await context.request("/api/boards", json({ name: "Plan" }))).json()) as BoardResponse;
    expect((await context.request(`/api/boards/${board.id}/assets/0000000000000000`)).status).toBe(404);
  });
});

describe("pages", () => {
  it("returns the pages of the app with the security headers", async () => {
    const { request } = setup(access);
    const page = await request("/boards/id00000000000001", {}, null);
    expect(page.status).toBe(200);
    const policy = page.headers.get("content-security-policy") ?? "";
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("connect-src 'self' wss://boards.example.com");
    expect(policy).toContain("frame-ancestors 'none'");
  });
});
