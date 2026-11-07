// The BoardRoom of one board. Everyone who opens the board connects to it with a
// WebSocket. It applies the batches of operations in the order in which they arrive,
// sends each one to everyone on the board, and passes on where each person points.
//
// The bucket keeps the board. The room reads it when it wakes up, and writes it back
// SAVE_DELAY_MS after a change, through an alarm. Until then, a journal in the storage of
// the room keeps each batch, so a batch that the room acknowledged survives a restart of
// the room before the save: the room replays the journal over the last save when it
// wakes up. A save empties the journal up to the batches that it includes.

import { DurableObject } from "cloudflare:workers";
import { BoardError, readOps, sortedItems, type Op } from "../shared/board.ts";
import { randomId } from "../shared/ids.ts";
import {
  CLOSE_BAD_MESSAGE,
  CLOSE_BOARD_DELETED,
  EMPTY_PRESENCE,
  peerColor,
  peerName,
  readClientMessage,
  readPresence,
  type IncomingMessage,
  type Peer,
  type PeerState,
  type Presence,
  type ServerMessage,
} from "../shared/protocol.ts";
import type { Env } from "./env.ts";
import { boardKey, boardPrefix, readSnapshot, snapshotJson, type BoardSnapshot } from "./layout.ts";
import { errorFields, log } from "./log.ts";
import { Room } from "./room.ts";
import { DIRECTORY_NAME, ROOM_HEADERS, type RoomRpc } from "./rpc.ts";
import { readStorageConfig } from "./runtime-config.ts";
import { objectStoreFor, type ObjectStore } from "./storage.ts";

/** How long after a change the room saves the board to the bucket. */
const SAVE_DELAY_MS = 2_000;
/** The waits before the room tries a failed save again: the last one repeats until a save succeeds. */
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000];
/** The most files of a deleted board that one alarm deletes, which keeps it within the subrequests of one invocation. */
const DELETE_BATCH = 40;
/** The largest batch in UTF-8 bytes. A row of the storage of a Durable Object holds at most 2 MB. */
const MAX_BATCH_BYTES = 1_900_000;

export class BoardRoom extends DurableObject<Env> implements RoomRpc {
  #room: Room | null = null;
  #boardId: string | null = null;
  #name = "";
  // Where each person points. The room keeps none of it: after a sleep, it starts empty.
  readonly #presence = new Map<string, Presence>();
  // Whether an alarm is set: null after the room wakes up, until it asks the storage.
  #alarmSet: boolean | null = null;
  #saveFailures = 0;
  // Whether the tables exist. A room that deleted its board has none until it is used again.
  #tablesReady = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The browser pings to keep its connection open. The answer needs no wake-up of the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** Accepts the WebSocket of a person whom the Worker let in. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("The room answers WebSocket upgrades only.", { status: 426 });
    }
    const boardId = request.headers.get(ROOM_HEADERS.board) ?? "";
    const email = request.headers.get(ROOM_HEADERS.email) ?? "";
    const name = decodeURIComponent(request.headers.get(ROOM_HEADERS.boardName) ?? "");
    if (boardId === "" || email === "") return new Response("The Worker did not name the board or the person.", { status: 400 });
    this.#claim(boardId);
    if (this.#meta("deleting") !== null) return new Response("The board was deleted.", { status: 410 });
    // The list of boards holds the name, so the name that the Worker passes is the latest.
    this.#name = name;
    const room = await this.#load();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const peer: Peer = { session: randomId(), email, name: peerName(email), color: peerColor(email) };
    server.serializeAttachment(peer);
    send(server, {
      type: "welcome",
      board: { id: boardId, name: this.#name },
      you: peer,
      peers: this.#peers().filter((other) => other.session !== peer.session),
      items: sortedItems(room.items.values()),
      seq: room.seq,
    });
    this.#broadcast({ type: "joined", peer: { ...peer, presence: EMPTY_PRESENCE } }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const peer = ws.deserializeAttachment() as Peer;
    if (typeof message !== "string") {
      ws.close(CLOSE_BAD_MESSAGE, "Messages must be text.");
      return;
    }
    let parsed: IncomingMessage;
    try {
      parsed = readClientMessage(message);
    } catch (error) {
      ws.close(CLOSE_BAD_MESSAGE, closeReason(error));
      return;
    }
    if (parsed.type === "presence") {
      let presence: Presence;
      try {
        presence = readPresence(parsed.presence);
      } catch {
        // Where someone points matters only for a moment, so a presence that the room cannot read is dropped.
        return;
      }
      this.#presence.set(peer.session, presence);
      this.#broadcast({ type: "presence", session: peer.session, presence }, ws);
      return;
    }

    if (new TextEncoder().encode(message).byteLength > MAX_BATCH_BYTES) {
      send(ws, { type: "rejected", batch: parsed.batch, message: `A batch may hold at most ${MAX_BATCH_BYTES} bytes.` });
      return;
    }
    const room = await this.#load();
    let applied: ReturnType<Room["apply"]>;
    try {
      applied = room.apply(readOps(parsed.ops));
    } catch (error) {
      if (!(error instanceof BoardError)) throw error;
      send(ws, { type: "rejected", batch: parsed.batch, message: error.message });
      return;
    }
    if (applied === null) {
      // Nothing changed, as when two people delete the same item, but the sender learns that the batch arrived.
      send(ws, { type: "ops", seq: room.seq, session: peer.session, batch: parsed.batch, ops: [] });
      return;
    }
    // The runtime holds the messages below until the journal has the batch, so nobody sees a
    // batch that a restart could lose.
    this.#sql().exec("INSERT INTO journal (seq, ops) VALUES (?, ?)", applied.seq, JSON.stringify(applied.ops));
    this.#broadcast({ type: "ops", seq: applied.seq, session: peer.session, batch: parsed.batch, ops: applied.ops }, null);
    await this.#scheduleSave(SAVE_DELAY_MS);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.#leave(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.#leave(ws);
  }

  async rename(boardId: string, name: string): Promise<void> {
    this.#claim(boardId);
    if (this.#meta("deleting") !== null) return;
    this.#name = name;
    (await this.#load()).renamed();
    this.#broadcast({ type: "renamed", name }, null);
    await this.#scheduleSave(SAVE_DELAY_MS);
  }

  async destroy(boardId: string): Promise<void> {
    this.#claim(boardId);
    this.#setMeta("deleting", "1");
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_BOARD_DELETED, "The board was deleted.");
      } catch {
        // The connection is closing already.
      }
    }
    this.#sql().exec("DELETE FROM journal");
    this.#room = null;
    this.#presence.clear();
    // The alarm deletes the files of the board, a few at a time.
    await this.ctx.storage.setAlarm(Date.now());
    this.#alarmSet = true;
  }

  async alarm(): Promise<void> {
    this.#alarmSet = false;
    const boardId = this.#boardId ?? this.#meta("board");
    if (boardId === null) return;
    this.#boardId = boardId;
    const deleting = this.#meta("deleting") !== null;
    try {
      if (deleting) await this.#deleteFiles(boardId);
      else await this.#save(boardId);
      this.#saveFailures = 0;
    } catch (error) {
      this.#saveFailures += 1;
      const delay = RETRY_DELAYS_MS[Math.min(this.#saveFailures, RETRY_DELAYS_MS.length) - 1] ?? SAVE_DELAY_MS;
      log("ERROR", deleting ? "The files of a deleted board could not be deleted" : "The board could not be saved to the bucket", null, {
        boardId,
        attempt: this.#saveFailures,
        retryInMs: delay,
        ...errorFields(error),
      });
      await this.#scheduleSave(delay);
    }
  }

  // Writes the board to the bucket, then forgets the batches of the journal that the save includes.
  async #save(boardId: string): Promise<void> {
    const room = await this.#load();
    if (!room.dirty) return;
    const { snapshot, mark } = room.snapshot(boardId, this.#name, new Date().toISOString());
    await this.#store().put(boardKey(boardId), snapshotJson(snapshot), "application/json");
    room.saved(mark);
    this.#sql().exec("DELETE FROM journal WHERE seq <= ?", mark.seq);
    try {
      await this.env.DIRECTORY.getByName(DIRECTORY_NAME).touch(boardId, snapshot.savedAt);
    } catch (error) {
      log("WARN", "The list of boards did not take the time of a change", null, { boardId, ...errorFields(error) });
    }
    // Batches that arrived during the write wait for the next save.
    if (room.dirty) await this.#scheduleSave(SAVE_DELAY_MS);
  }

  // Deletes the files of a deleted board, DELETE_BATCH at a time, then everything that the room stored.
  async #deleteFiles(boardId: string): Promise<void> {
    const store = this.#store();
    const keys = await store.list(boardPrefix(boardId), DELETE_BATCH);
    for (const key of keys) await store.delete(key);
    if (keys.length === DELETE_BATCH) {
      await this.#scheduleSave(1_000);
      return;
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.#tablesReady = false;
    this.#boardId = null;
    this.#name = "";
    this.#alarmSet = false;
    log("INFO", "The files of a deleted board are gone", null, { boardId });
  }

  // Reads the board from the bucket and replays the journal over it, while no other event runs.
  async #load(): Promise<Room> {
    if (this.#room !== null) return this.#room;
    return this.ctx.blockConcurrencyWhile(async () => {
      if (this.#room !== null) return this.#room;
      const boardId = this.#boardId ?? this.#meta("board");
      if (boardId === null) throw new Error("The room does not know its board.");
      const text = await this.#store().getText(boardKey(boardId));
      let snapshot: BoardSnapshot | null = null;
      if (text !== null) {
        const read = readSnapshot(text);
        snapshot = read.snapshot;
        if (read.skipped.length > 0) log("WARN", "Items of the board could not be read and were left out", null, { boardId, problems: read.skipped });
      }
      const journal = this.#sql()
        .exec<{ seq: number; ops: string }>("SELECT seq, ops FROM journal ORDER BY seq")
        .toArray()
        .map((row) => ({ seq: row.seq, ops: JSON.parse(row.ops) as Op[] }));
      const { room, problems } = Room.restore(snapshot, journal);
      if (problems.length > 0) log("WARN", "Batches of the journal could not be replayed", null, { boardId, problems });
      if (this.#name === "" && snapshot !== null) this.#name = snapshot.name;
      this.#room = room;
      return room;
    });
  }

  // Sets the alarm, unless one is set already. A save that waits for an alarm stays as it is.
  async #scheduleSave(delayMs: number): Promise<void> {
    if (this.#alarmSet === true) return;
    const known = this.#alarmSet;
    this.#alarmSet = true;
    if (known === null && (await this.ctx.storage.getAlarm()) !== null) return;
    await this.ctx.storage.setAlarm(Date.now() + delayMs);
  }

  #leave(ws: WebSocket): void {
    const peer = ws.deserializeAttachment() as Peer | null;
    if (peer === null) return;
    this.#presence.delete(peer.session);
    this.#broadcast({ type: "left", session: peer.session }, ws);
  }

  #peers(): PeerState[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      const peer = ws.deserializeAttachment() as Peer | null;
      return peer === null ? [] : [{ ...peer, presence: this.#presence.get(peer.session) ?? EMPTY_PRESENCE }];
    });
  }

  // Sends a message to everyone on the board, except the connection `except` when one is given.
  #broadcast(message: ServerMessage, except: WebSocket | null): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(text);
      } catch {
        // The connection is closing; its close event follows.
      }
    }
  }

  // The room keeps the ID of its board, which the Worker passes with each call, for its alarms.
  #claim(boardId: string): void {
    if (this.#boardId === boardId) return;
    const stored = this.#meta("board");
    if (stored === null) this.#setMeta("board", boardId);
    else if (stored !== boardId) throw new Error(`This room holds the board ${stored}, not ${boardId}.`);
    this.#boardId = boardId;
  }

  #meta(key: string): string | null {
    const rows = this.#sql().exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray();
    return rows[0]?.value ?? null;
  }

  #setMeta(key: string, value: string): void {
    this.#sql().exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
  }

  // The journal of batches since the last save, and what the room knows of its board.
  #sql(): SqlStorage {
    const sql = this.ctx.storage.sql;
    if (!this.#tablesReady) {
      sql.exec("CREATE TABLE IF NOT EXISTS journal (seq INTEGER PRIMARY KEY, ops TEXT NOT NULL)");
      sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      this.#tablesReady = true;
    }
    return sql;
  }

  #store(): ObjectStore {
    return objectStoreFor(readStorageConfig(this.env));
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

// The reason of a close frame holds at most 123 bytes. A longer one ends with an ellipsis of 3 bytes.
function closeReason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
  if (bytes(text) <= 123) return text;
  let reason = text;
  while (bytes(reason) > 120) reason = reason.slice(0, -1);
  return `${reason}…`;
}
