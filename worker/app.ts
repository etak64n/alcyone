// HTTP API of alcyone, served under /api, and the pages of the browser app.
//
// createApp() takes Cloudflare Access, the bucket, the Durable Objects, the clock, and ID
// generation as dependencies, so tests can replace them.
//
// Everyone who signs in sees every board, opens it, and edits it with the others on it.
// The person who created a board renames and deletes it, and admins rename and delete
// every board. Deleting a board deletes its files from the bucket too.

import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import {
  ASSET_CONTENT_TYPES,
  ASSET_MAX_BYTES,
  BOARD_NAME_MAX_LENGTH,
  type ApiErrorBody,
  type AssetResponse,
  type BoardResponse,
  type BoardSummary,
  type ListBoardsResponse,
  type MeResponse,
} from "../shared/api.ts";
import { ID_PATTERN } from "../shared/board.ts";
import { peerName } from "../shared/protocol.ts";
import { AccessDeniedError, isLocalhost, verifyAccessToken } from "./access.ts";
import type { Env } from "./env.ts";
import { badRequest, forbidden, HttpError, notFound, readJsonObject, readString } from "./http.ts";
import { assetKey } from "./layout.ts";
import { errorFields, log } from "./log.ts";
import { ROOM_HEADERS, type BoardEntry, type DirectoryRpc, type RoomRpc } from "./rpc.ts";
import { ConfigurationError, readRuntimeConfig, type RuntimeConfig } from "./runtime-config.ts";
import { ASSET_HEADERS, pageHeaders } from "./security-headers.ts";
import { StorageError, type ObjectStore } from "./storage.ts";

export interface AppDependencies {
  /** Signing keys of the Access team that protects the deployment. */
  keySetFor: (teamDomain: string) => JWTVerifyGetKey;
  objectStoreFor: (config: RuntimeConfig) => ObjectStore;
  directoryFor: (env: Env) => DirectoryRpc;
  roomFor: (env: Env, boardId: string) => RoomRpc;
  now: () => Date;
  /** Returns a new ID for a board or an image. */
  newId: () => string;
}

/** The signed-in person who sent the request. */
interface Viewer {
  email: string;
  isAdmin: boolean;
}

interface AppEnv {
  Bindings: Env;
  Variables: { requestId: string; config: RuntimeConfig; viewer: Viewer };
}

// Access serves this path on every domain that it protects. It ends the session of the person.
const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";
const NAME_RULE = { min: 1, max: BOARD_NAME_MAX_LENGTH, trim: true };

export function createApp(deps: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Every API request needs complete configuration and a signed-in person.
  app.use("/api/*", async (c, next) => {
    c.set("requestId", c.req.header("cf-ray") ?? crypto.randomUUID());
    const config = readRuntimeConfig(c.env);
    c.set("config", config);
    let email: string;
    if (config.authMode === "local-development") {
      if (!isLocalhost(new URL(c.req.url))) {
        throw new HttpError(403, "forbidden", "Local development mode answers requests to localhost only.");
      }
      if (config.localUserEmail === null) throw new ConfigurationError(["LOCAL_USER_EMAIL is not set."]);
      email = config.localUserEmail;
    } else {
      if (config.access === null) throw new ConfigurationError(["ACCESS_TEAM_DOMAIN and ACCESS_AUD are not set."]);
      email = await verifyAccessToken(c.req.header("cf-access-jwt-assertion"), config.access, deps.keySetFor(config.access.teamDomain));
    }
    c.set("viewer", { email, isAdmin: config.admins.has(email) });
    await next();
    // Answers of the API change with every edit, so no cache keeps them. An image sets its
    // own Cache-Control. The answers of a room, such as the one to a WebSocket upgrade,
    // have headers that cannot change, and no cache keeps them either.
    if (c.res.status === 101 || c.res.headers.has("cache-control")) return;
    try {
      c.res.headers.set("Cache-Control", "no-store");
    } catch {
      // The headers of an answer of a room cannot change.
    }
  });

  app.get("/api/me", (c) => {
    const viewer = c.get("viewer");
    const logoutUrl = c.get("config").authMode === "cloudflare-access" ? ACCESS_LOGOUT_PATH : null;
    return c.json<MeResponse>({ me: { email: viewer.email, name: peerName(viewer.email), isAdmin: viewer.isAdmin, logoutUrl } });
  });

  app.get("/api/boards", async (c) => {
    const viewer = c.get("viewer");
    const boards = await deps.directoryFor(c.env).list();
    return c.json<ListBoardsResponse>({ boards: boards.map((entry) => summary(entry, viewer)) });
  });

  app.post("/api/boards", async (c) => {
    const body = await readJsonObject(c.req.raw, ["name"]);
    const name = readString(body, "name", NAME_RULE);
    const at = deps.now().toISOString();
    const viewer = c.get("viewer");
    const entry: BoardEntry = { id: deps.newId(), name, createdAt: at, createdBy: viewer.email, updatedAt: at };
    await deps.directoryFor(c.env).create(entry);
    return c.json<BoardResponse>({ board: summary(entry, viewer) }, 201);
  });

  app.get("/api/boards/:id", async (c) => {
    const entry = await findBoard(deps.directoryFor(c.env), c.req.param("id"));
    return c.json<BoardResponse>({ board: summary(entry, c.get("viewer")) });
  });

  app.patch("/api/boards/:id", async (c) => {
    const directory = deps.directoryFor(c.env);
    const entry = await findBoard(directory, c.req.param("id"));
    const viewer = c.get("viewer");
    requireManage(entry, viewer);
    const body = await readJsonObject(c.req.raw, ["name"]);
    const name = readString(body, "name", NAME_RULE);
    const renamed = await directory.rename(entry.id, name);
    if (renamed === null) throw notFound("The board does not exist.");
    // The list already has the new name. The people on the board see it at their next visit
    // if the room does not hear of it now.
    try {
      await deps.roomFor(c.env, entry.id).rename(entry.id, name);
    } catch (error) {
      log("WARN", "The people on a board did not hear of its new name", c.get("requestId"), { boardId: entry.id, ...errorFields(error) });
    }
    return c.json<BoardResponse>({ board: summary(renamed, viewer) });
  });

  // The room closes the board for everyone and deletes its files first, then the board
  // leaves the list. A delete that stopped halfway can run again.
  app.delete("/api/boards/:id", async (c) => {
    const directory = deps.directoryFor(c.env);
    const entry = await findBoard(directory, c.req.param("id"));
    requireManage(entry, c.get("viewer"));
    await deps.roomFor(c.env, entry.id).destroy(entry.id);
    await directory.remove(entry.id);
    return c.body(null, 204);
  });

  // The WebSocket of a board. The Worker checks the person and the board, and the room of
  // the board takes the connection.
  app.get("/api/boards/:id/socket", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      throw new HttpError(426, "upgrade_required", "This address takes WebSocket upgrades only.");
    }
    // A page of another site must not open a board in the name of the person who visits it.
    const origin = c.req.header("origin") ?? "";
    const host = new URL(c.req.url).host;
    const fromLocalPage = c.get("config").authMode === "local-development" && URL.canParse(origin) && isLocalhost(new URL(origin));
    if (!fromLocalPage && (!URL.canParse(origin) || new URL(origin).host !== host)) {
      throw forbidden("The WebSocket of a board opens only from the pages of alcyone.");
    }
    const entry = await findBoard(deps.directoryFor(c.env), c.req.param("id"));
    const headers = new Headers(c.req.raw.headers);
    headers.set(ROOM_HEADERS.board, entry.id);
    headers.set(ROOM_HEADERS.boardName, encodeURIComponent(entry.name));
    headers.set(ROOM_HEADERS.email, c.get("viewer").email);
    return deps.roomFor(c.env, entry.id).fetch(new Request(c.req.raw, { headers }));
  });

  // An image for a board. The browser adds the item that shows it once the image is in the bucket.
  app.post("/api/boards/:id/assets", async (c) => {
    const entry = await findBoard(deps.directoryFor(c.env), c.req.param("id"));
    const contentType = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!isAssetType(contentType)) throw badRequest(`An image must be one of ${ASSET_CONTENT_TYPES.join(", ")}.`);
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > ASSET_MAX_BYTES) throw tooLarge();
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) throw badRequest("The image is empty.");
    if (body.byteLength > ASSET_MAX_BYTES) throw tooLarge();
    const id = deps.newId();
    await deps.objectStoreFor(c.get("config")).put(assetKey(entry.id, id), body, contentType);
    return c.json<AssetResponse>({ asset: { id, contentType, size: body.byteLength } }, 201);
  });

  app.get("/api/boards/:id/assets/:assetId", async (c) => {
    const entry = await findBoard(deps.directoryFor(c.env), c.req.param("id"));
    const assetId = c.req.param("assetId");
    if (!ID_PATTERN.test(assetId)) throw notFound("The image does not exist.");
    const object = await deps.objectStoreFor(c.get("config")).getObject(assetKey(entry.id, assetId));
    if (object === null) throw notFound("The image does not exist.");
    const headers = new Headers(ASSET_HEADERS);
    headers.set("Content-Type", isAssetType(object.contentType) ? object.contentType : "application/octet-stream");
    if (object.size >= 0) headers.set("Content-Length", String(object.size));
    return new Response(object.body, { headers });
  });

  // Pages of the browser app. A deployment runs the Worker for every request but the
  // built files under /assets/ (cloudflare.config.ts), so that each page leaves with
  // the security headers of security-headers.ts. Pages hold no data; the API checks the
  // Access token of every request for data.
  app.all("*", async (c) => {
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return c.notFound();
    const page = await c.env.ASSETS.fetch(c.req.raw);
    const response = new Response(page.body, page);
    for (const [name, value] of Object.entries(pageHeaders(c.req.url))) response.headers.set(name, value);
    return response;
  });

  app.notFound((c) => c.json<ApiErrorBody>(errorBody("not_found", "No API endpoint matches this request."), 404, { "Cache-Control": "no-store" }));

  app.onError((error, c) => {
    const requestId: string | undefined = c.get("requestId");
    const noStore = { "Cache-Control": "no-store" };
    if (error instanceof HttpError) {
      return c.json<ApiErrorBody>(errorBody(error.code, error.message), error.status, noStore);
    }
    if (error instanceof AccessDeniedError) {
      return c.json<ApiErrorBody>(errorBody("unauthorized", error.message), 401, noStore);
    }
    if (error instanceof StorageError) {
      log("ERROR", "A storage request failed", requestId ?? null, errorFields(error));
      return c.json<ApiErrorBody>(errorBody("storage_error", error.message), 502, noStore);
    }
    if (error instanceof ConfigurationError) {
      log("ERROR", "The Worker configuration is incomplete", requestId ?? null, { problems: error.problems });
      return c.json<ApiErrorBody>(
        errorBody("misconfigured", "The Worker configuration is incomplete. The Worker logs list the problems."),
        500,
        noStore,
      );
    }
    log("ERROR", "A request failed", requestId ?? null, { method: c.req.method, path: c.req.path, ...errorFields(error) });
    return c.json<ApiErrorBody>(errorBody("internal_error", "The request failed. The Worker logs have the details."), 500, noStore);
  });

  return app;
}

async function findBoard(directory: DirectoryRpc, id: string): Promise<BoardEntry> {
  if (!ID_PATTERN.test(id)) throw notFound("The board does not exist.");
  const entry = await directory.get(id);
  if (entry === null) throw notFound("The board does not exist.");
  return entry;
}

function requireManage(entry: BoardEntry, viewer: Viewer): void {
  if (entry.createdBy !== viewer.email && !viewer.isAdmin) {
    throw forbidden("Only the person who created the board and admins may rename or delete it.");
  }
}

function summary(entry: BoardEntry, viewer: Viewer): BoardSummary {
  return { ...entry, canManage: entry.createdBy === viewer.email || viewer.isAdmin };
}

function isAssetType(value: string): value is (typeof ASSET_CONTENT_TYPES)[number] {
  return (ASSET_CONTENT_TYPES as readonly string[]).includes(value);
}

function tooLarge(): HttpError {
  return new HttpError(413, "too_large", `An image may be at most ${ASSET_MAX_BYTES / 1024 / 1024} MB.`);
}

function errorBody(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}
