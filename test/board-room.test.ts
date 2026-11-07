import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Item, StickyItem } from "../shared/board.ts";
import { CLOSE_BAD_MESSAGE, CLOSE_BOARD_DELETED, EMPTY_PRESENCE, type ClientMessage } from "../shared/protocol.ts";
import { BoardRoom } from "../worker/board-room.ts";
import type { Env } from "../worker/env.ts";
import { assetKey, boardKey } from "../worker/layout.ts";
import { ROOM_HEADERS, type DirectoryRpc } from "../worker/rpc.ts";
import { MemoryBucket } from "./support/bucket.ts";
import { FakeSocket, FakeState, installWorkersGlobals } from "./support/durable-objects.ts";

const BOARD = "board00000000001";
const NOTE = "aaaaaaaaaaaaaaaa";
const note = (overrides: Partial<StickyItem> = {}): StickyItem => ({ id: NOTE, type: "sticky", z: 1, x: 0, y: 0, w: 200, h: 200, color: "yellow", text: "", ...overrides });

let restoreGlobals: () => void;
beforeAll(() => {
  restoreGlobals = installWorkersGlobals();
});
afterAll(() => restoreGlobals());

interface Setup {
  state: FakeState;
  bucket: MemoryBucket;
  touches: { id: string; updatedAt: string }[];
  room: BoardRoom;
  env: Env;
}

function setup(previous?: { state: FakeState; bucket: MemoryBucket }): Setup {
  // A new FakeState over the old database stands for the same room after a restart.
  const state = previous === undefined ? new FakeState() : new FakeState(previous.state.database);
  const bucket = previous?.bucket ?? new MemoryBucket();
  const touches: { id: string; updatedAt: string }[] = [];
  const directory: Partial<DirectoryRpc> = {
    touch: async (id, updatedAt) => {
      touches.push({ id, updatedAt });
    },
  };
  const env = {
    STORAGE_TYPE: "local-r2",
    LOCAL_BUCKET: bucket,
    DIRECTORY: { getByName: () => directory },
  } as unknown as Env;
  const room = new BoardRoom(state as unknown as DurableObjectState, env);
  return { state, bucket, touches, room, env };
}

async function connect(room: BoardRoom, state: FakeState, email: string, name = "Plan"): Promise<FakeSocket> {
  const before = state.sockets.length;
  const response = await room.fetch(
    new Request("https://boards.example.com/api/boards/x/socket", {
      headers: { upgrade: "websocket", [ROOM_HEADERS.board]: BOARD, [ROOM_HEADERS.email]: email, [ROOM_HEADERS.boardName]: encodeURIComponent(name) },
    }),
  );
  expect(response.status).toBe(101);
  const socket = state.sockets[before];
  if (socket === undefined) throw new Error("The room accepted no WebSocket.");
  return socket;
}

async function send(room: BoardRoom, socket: FakeSocket, message: ClientMessage): Promise<void> {
  await room.webSocketMessage(socket as unknown as WebSocket, JSON.stringify(message));
}

describe("BoardRoom", () => {
  it("welcomes a person with the board and the people on it, and tells the others", async () => {
    const { room, state } = setup();
    const ada = await connect(room, state, "ada@example.com", "Plan & ideas");
    const bob = await connect(room, state, "bob@example.com");
    const welcome = bob.last("welcome");
    expect(welcome).toMatchObject({ board: { id: BOARD, name: "Plan" }, you: { email: "bob@example.com", name: "bob" }, items: [], seq: 0 });
    expect((welcome?.["peers"] as { email: string }[]).map((peer) => peer.email)).toEqual(["ada@example.com"]);
    expect(ada.last("welcome")).toMatchObject({ board: { name: "Plan & ideas" } });
    expect(ada.last("joined")).toMatchObject({ peer: { email: "bob@example.com", presence: EMPTY_PRESENCE } });
  });

  it("applies a batch, sends it to everyone with its number, and keeps it in the journal", async () => {
    const { room, state } = setup();
    const ada = await connect(room, state, "ada@example.com");
    const bob = await connect(room, state, "bob@example.com");
    await send(room, ada, { type: "ops", batch: "b1", ops: [{ op: "put", item: note() }] });
    const expected = { type: "ops", seq: 1, batch: "b1", ops: [{ op: "put", item: note() }] };
    expect(ada.last("ops")).toMatchObject(expected);
    expect(bob.last("ops")).toMatchObject(expected);
    expect(state.database.prepare("SELECT seq FROM journal").all()).toEqual([{ seq: 1 }]);
    expect(state.alarm).not.toBeNull();
  });

  it("tells only the sender of a batch that the board does not take, and changes nothing", async () => {
    const { room, state } = setup();
    const ada = await connect(room, state, "ada@example.com");
    const bob = await connect(room, state, "bob@example.com");
    await send(room, ada, { type: "ops", batch: "b1", ops: [{ op: "put", item: { ...note(), w: 0 } }] });
    expect(ada.last("rejected")).toMatchObject({ batch: "b1" });
    expect(bob.messages("ops")).toHaveLength(0);
    expect(state.database.prepare("SELECT seq FROM journal").all()).toEqual([]);
  });

  it("acknowledges a batch that changes nothing, to its sender alone", async () => {
    const { room, state } = setup();
    const ada = await connect(room, state, "ada@example.com");
    const bob = await connect(room, state, "bob@example.com");
    await send(room, ada, { type: "ops", batch: "b2", ops: [{ op: "delete", id: NOTE }] });
    expect(ada.last("ops")).toMatchObject({ batch: "b2", ops: [], seq: 0 });
    expect(bob.messages("ops")).toHaveLength(0);
  });

  it("passes on where a person points to the others", async () => {
    const { room, state } = setup();
    const ada = await connect(room, state, "ada@example.com");
    const bob = await connect(room, state, "bob@example.com");
    const presence = { ...EMPTY_PRESENCE, cursor: { x: 10, y: 20 } };
    await send(room, ada, { type: "presence", presence });
    expect(bob.last("presence")).toMatchObject({ presence });
    expect(ada.messages("presence")).toHaveLength(0);
    // A person who joins later sees it in the welcome.
    const carol = await connect(room, state, "carol@example.com");
    const peers = carol.last("welcome")?.["peers"] as { email: string; presence: unknown }[];
    expect(peers.find((peer) => peer.email === "ada@example.com")?.presence).toEqual(presence);
  });

  it("closes a connection that sends something other than a message", async () => {
    const { room, state } = setup();
    const ada = await connect(room, state, "ada@example.com");
    await room.webSocketMessage(ada as unknown as WebSocket, "{nonsense");
    expect(ada.closed?.code).toBe(CLOSE_BAD_MESSAGE);
  });

  it("tells the others when a person leaves", async () => {
    const { room, state } = setup();
    const ada = await connect(room, state, "ada@example.com");
    const bob = await connect(room, state, "bob@example.com");
    ada.close();
    await room.webSocketClose(ada as unknown as WebSocket);
    const session = (ada.last("welcome")?.["you"] as { session: string }).session;
    expect(bob.last("left")).toEqual({ type: "left", session });
  });

  it("saves the board to the bucket, empties the journal, and tells the list of boards", async () => {
    const { room, state, bucket, touches } = setup();
    const ada = await connect(room, state, "ada@example.com");
    await send(room, ada, { type: "ops", batch: "b1", ops: [{ op: "put", item: note({ text: "kept" }) }] });
    await room.alarm();
    const saved = bucket.json<{ name: string; seq: number; items: Item[] }>(boardKey(BOARD));
    expect(saved).toMatchObject({ name: "Plan", seq: 1, items: [note({ text: "kept" })] });
    expect(state.database.prepare("SELECT seq FROM journal").all()).toEqual([]);
    expect(touches).toHaveLength(1);
  });

  it("keeps a batch that the save does not reach, and tries a failed save again", async () => {
    const { room, state, bucket } = setup();
    const ada = await connect(room, state, "ada@example.com");
    await send(room, ada, { type: "ops", batch: "b1", ops: [{ op: "put", item: note() }] });
    bucket.failing.add(boardKey(BOARD));
    state.alarm = null;
    await room.alarm();
    // The journal still has the batch, and an alarm waits to try again.
    expect(state.database.prepare("SELECT seq FROM journal").all()).toEqual([{ seq: 1 }]);
    expect(state.alarm).not.toBeNull();
    bucket.failing.clear();
    await room.alarm();
    expect(bucket.json<{ seq: number }>(boardKey(BOARD)).seq).toBe(1);
  });

  it("rebuilds the board after a restart from the last save and the journal", async () => {
    const first = setup();
    const ada = await connect(first.room, first.state, "ada@example.com");
    await send(first.room, ada, { type: "ops", batch: "b1", ops: [{ op: "put", item: note({ text: "saved" }) }] });
    await first.room.alarm();
    await send(first.room, ada, { type: "ops", batch: "b2", ops: [{ op: "patch", id: NOTE, set: { text: "in the journal" } }] });

    // The room restarts before it saves the second batch.
    const second = setup({ state: first.state, bucket: first.bucket });
    const bob = await connect(second.room, second.state, "bob@example.com");
    expect(bob.last("welcome")).toMatchObject({ seq: 2, items: [note({ text: "in the journal" })] });
  });

  it("tells everyone the new name, and writes it with the next save", async () => {
    const { room, state, bucket } = setup();
    const ada = await connect(room, state, "ada@example.com");
    await room.rename(BOARD, "Roadmap");
    expect(ada.last("renamed")).toEqual({ type: "renamed", name: "Roadmap" });
    await room.alarm();
    expect(bucket.json<{ name: string }>(boardKey(BOARD)).name).toBe("Roadmap");
  });

  it("closes a deleted board for everyone, deletes its files, and then everything it stored", async () => {
    const { room, state, bucket } = setup();
    const ada = await connect(room, state, "ada@example.com");
    await send(room, ada, { type: "ops", batch: "b1", ops: [{ op: "put", item: note() }] });
    await room.alarm();
    for (let index = 0; index < 45; index += 1) await bucket.put(assetKey(BOARD, `image${String(index).padStart(11, "0")}`), "png", {});
    await bucket.put("boards/board00000000002/board.json", "{}", {});

    await room.destroy(BOARD);
    expect(ada.closed?.code).toBe(CLOSE_BOARD_DELETED);
    // The files go a few at a time, one alarm after another.
    await room.alarm();
    expect([...bucket.objects.keys()].filter((key) => key.startsWith(`boards/${BOARD}/`)).length).toBeGreaterThan(0);
    await room.alarm();
    expect([...bucket.objects.keys()]).toEqual(["boards/board00000000002/board.json"]);
    expect(state.tables()).toEqual([]);
    expect(state.alarm).toBeNull();

    const late = await room.fetch(
      new Request("https://boards.example.com/", { headers: { upgrade: "websocket", [ROOM_HEADERS.board]: BOARD, [ROOM_HEADERS.email]: "bob@example.com" } }),
    );
    // A room without any record of a board starts empty, but the Worker never sends anyone to a deleted board.
    expect(late.status).toBe(101);
  });

  it("refuses a connection to a board that is being deleted", async () => {
    const { room, state } = setup();
    await connect(room, state, "ada@example.com");
    await room.destroy(BOARD);
    const response = await room.fetch(
      new Request("https://boards.example.com/", { headers: { upgrade: "websocket", [ROOM_HEADERS.board]: BOARD, [ROOM_HEADERS.email]: "bob@example.com" } }),
    );
    expect(response.status).toBe(410);
  });
});
