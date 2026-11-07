import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Op, StickyItem } from "../shared/board.ts";
import { CLOSE_BOARD_DELETED, EMPTY_PRESENCE, type Peer, type ServerMessage } from "../shared/protocol.ts";
import { BoardConnection, splitOps } from "../src/board/sync.ts";
import { socketFactory, type ClientSocket } from "./support/client-socket.ts";

const NOTE = "aaaaaaaaaaaaaaaa";
const note = (overrides: Partial<StickyItem> = {}): StickyItem => ({ id: NOTE, type: "sticky", z: 1, x: 0, y: 0, w: 200, h: 200, color: "yellow", text: "", ...overrides });
const ME: Peer = { session: "session000000001", email: "ada@example.com", name: "ada", color: "#e03131" };
const welcome = (items = [note()]): ServerMessage => ({ type: "welcome", board: { id: "board00000000001", name: "Plan" }, you: ME, peers: [], items, seq: 1 });

function connect() {
  const factory = socketFactory();
  const changes = vi.fn();
  const rejected = vi.fn();
  const connection = new BoardConnection("wss://boards.example.com/api/boards/x/socket", factory.create, { change: changes, rejected });
  const socket = () => factory.sockets.at(-1) as ClientSocket;
  return { connection, factory, socket, changes, rejected };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("BoardConnection", () => {
  it("shows an edit at once, sends it as a batch, and forgets it when the room confirms it", () => {
    const { connection, socket } = connect();
    socket().receive(welcome());
    connection.submit([{ op: "patch", id: NOTE, set: { text: "mine" } }]);
    expect(connection.items().get(NOTE)).toMatchObject({ text: "mine" });
    expect(connection.pending).toBe(true);
    vi.advanceTimersByTime(20);
    const sent = socket().messages("ops");
    expect(sent).toHaveLength(1);
    socket().receive({ type: "ops", seq: 2, session: ME.session, batch: sent[0]?.["batch"] as string, ops: sent[0]?.["ops"] as Op[] });
    expect(connection.pending).toBe(false);
    expect(connection.items().get(NOTE)).toMatchObject({ text: "mine" });
  });

  it("puts edits of the same moment in one batch", () => {
    const { connection, socket } = connect();
    socket().receive(welcome());
    connection.submit([{ op: "patch", id: NOTE, set: { x: 1 } }]);
    connection.submit([{ op: "patch", id: NOTE, set: { y: 2 } }]);
    vi.advanceTimersByTime(20);
    expect(socket().messages("ops")).toHaveLength(1);
    expect(socket().messages("ops")[0]?.["ops"]).toHaveLength(2);
  });

  it("ends with the order of the room when two people change the same item", () => {
    const { connection, socket } = connect();
    socket().receive(welcome());
    connection.submit([{ op: "patch", id: NOTE, set: { color: "blue" } }]);
    vi.advanceTimersByTime(20);
    const batch = socket().messages("ops")[0]?.["batch"] as string;
    // Another person's change reaches the room first: this browser still shows its own on top.
    socket().receive({ type: "ops", seq: 2, session: "session000000002", batch: "other", ops: [{ op: "patch", id: NOTE, set: { color: "green" } }] });
    expect(connection.items().get(NOTE)).toMatchObject({ color: "blue" });
    // The room applies this browser's batch after it, so blue wins everywhere.
    socket().receive({ type: "ops", seq: 3, session: ME.session, batch, ops: [{ op: "patch", id: NOTE, set: { color: "blue" } }] });
    expect(connection.items().get(NOTE)).toMatchObject({ color: "blue" });
    expect(connection.pending).toBe(false);
  });

  it("takes back an edit that the room refuses, and says why", () => {
    const { connection, socket, rejected } = connect();
    socket().receive(welcome());
    connection.submit([{ op: "patch", id: NOTE, set: { text: "x" } }]);
    vi.advanceTimersByTime(20);
    const batch = socket().messages("ops")[0]?.["batch"] as string;
    socket().receive({ type: "rejected", batch, message: "No." });
    expect(connection.items().get(NOTE)).toMatchObject({ text: "" });
    expect(rejected).toHaveBeenCalledWith("No.");
  });

  it("connects again after a lost connection and sends the edits that wait", () => {
    const { connection, factory, socket } = connect();
    socket().receive(welcome());
    connection.submit([{ op: "patch", id: NOTE, set: { text: "kept" } }]);
    vi.advanceTimersByTime(20);
    socket().drop();
    expect(connection.status).toBe("reconnecting");
    // An edit while the connection is down waits too.
    connection.submit([{ op: "patch", id: NOTE, set: { x: 5 } }]);
    vi.advanceTimersByTime(1_000);
    expect(factory.sockets).toHaveLength(2);
    socket().receive(welcome());
    expect(connection.status).toBe("open");
    const resent = socket().messages("ops").flatMap((message) => message["ops"] as Op[]);
    expect(resent).toEqual([
      { op: "patch", id: NOTE, set: { text: "kept" } },
      { op: "patch", id: NOTE, set: { x: 5 } },
    ]);
    expect(connection.items().get(NOTE)).toMatchObject({ text: "kept", x: 5 });
  });

  it("stops when the board is deleted", () => {
    const { connection, factory, socket } = connect();
    socket().receive(welcome());
    socket().drop(CLOSE_BOARD_DELETED);
    vi.advanceTimersByTime(30_000);
    expect(connection.status).toBe("deleted");
    expect(factory.sockets).toHaveLength(1);
  });

  it("keeps the others and what they do", () => {
    const { connection, socket } = connect();
    socket().receive(welcome());
    const bob = { session: "session000000002", email: "bob@example.com", name: "bob", color: "#1971c2", presence: EMPTY_PRESENCE };
    socket().receive({ type: "joined", peer: bob });
    socket().receive({ type: "presence", session: bob.session, presence: { ...EMPTY_PRESENCE, cursor: { x: 3, y: 4 } } });
    expect(connection.peers.get(bob.session)?.presence.cursor).toEqual({ x: 3, y: 4 });
    socket().receive({ type: "renamed", name: "Roadmap" });
    expect(connection.board?.name).toBe("Roadmap");
    socket().receive({ type: "left", session: bob.session });
    expect(connection.peers.size).toBe(0);
  });

  it("sends where the pointer is at most every 50 ms, with the latest position", () => {
    const { connection, socket } = connect();
    socket().receive(welcome());
    const before = socket().messages("presence").length;
    for (let x = 0; x < 10; x += 1) connection.setPresence({ ...EMPTY_PRESENCE, cursor: { x, y: 0 } });
    vi.advanceTimersByTime(60);
    const sent = socket().messages("presence").slice(before);
    expect(sent.length).toBeLessThanOrEqual(2);
    expect((sent.at(-1)?.["presence"] as { cursor: { x: number } }).cursor.x).toBe(9);
  });

  it("sends the edits that wait when the page closes the board", () => {
    const { connection, socket } = connect();
    socket().receive(welcome());
    connection.submit([{ op: "patch", id: NOTE, set: { text: "last words" } }]);
    connection.close();
    expect(socket().messages("ops")).toHaveLength(1);
  });
});

describe("splitOps", () => {
  it("splits a large batch in order", () => {
    const big = Array.from({ length: 300 }, (_, index): Op => ({ op: "put", item: note({ id: index.toString(36).padStart(16, "0"), text: "x".repeat(3_000) }) }));
    const parts = splitOps(big);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat()).toEqual(big);
  });
});
