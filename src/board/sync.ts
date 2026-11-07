// The connection of the browser to the room of a board.
//
// The browser keeps two things: the board as the room last confirmed it, and its own
// batches that the room has not confirmed yet. It shows the confirmed board with its own
// batches applied on top, so an edit shows at once. When the room sends a batch back, it
// is confirmed and leaves the waiting list. The room applies every batch in one order and
// sends it to everyone, so every browser ends with the same board.
//
// After a lost connection, the browser connects again with a growing wait, takes the
// board anew, and sends its waiting batches again. Every operation names absolute values,
// so a batch that had arrived before the connection broke does no harm the second time.

import { applyOps, sortedItems, type Item, type Op } from "../../shared/board.ts";
import { randomId } from "../../shared/ids.ts";
import {
  CLOSE_BOARD_DELETED,
  EMPTY_PRESENCE,
  type BoardInfo,
  type ClientMessage,
  type Peer,
  type PeerState,
  type Presence,
  type ServerMessage,
} from "../../shared/protocol.ts";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "deleted";

/** The part of the WebSocket of a browser that the connection uses, which the tests replace. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

interface Batch {
  id: string;
  ops: Op[];
  sent: boolean;
}

// A batch waits this long for more operations before it leaves, so a drag of many items is one batch.
const SEND_DELAY_MS = 16;
// Where the pointer is goes out at most this often.
const PRESENCE_INTERVAL_MS = 50;
// The ping that keeps the connection open through proxies that close quiet ones.
const PING_INTERVAL_MS = 25_000;
// The waits before connecting again, the last one repeating.
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];
// A batch larger than this, in characters of JSON, leaves in parts.
const MAX_BATCH_CHARS = 400_000;
const OPEN = 1;

export interface ConnectionEvents {
  /** The board, the people on it, or the state of the connection changed. */
  change: () => void;
  /** The room did not take a batch of this browser, and the edit went back. */
  rejected: (message: string) => void;
}

export class BoardConnection {
  status: ConnectionStatus = "connecting";
  board: BoardInfo | null = null;
  me: Peer | null = null;
  readonly peers = new Map<string, PeerState>();

  readonly #url: string;
  readonly #createSocket: SocketFactory;
  readonly #events: ConnectionEvents;
  #socket: SocketLike | null = null;
  #confirmed = new Map<string, Item>();
  #batches: Batch[] = [];
  #view: Map<string, Item> | null = null;
  #sorted: Item[] | null = null;
  #sendTimer: ReturnType<typeof setTimeout> | null = null;
  #presence: Presence = EMPTY_PRESENCE;
  #presenceSentAt = 0;
  #presenceTimer: ReturnType<typeof setTimeout> | null = null;
  #presenceDirty = false;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #attempts = 0;
  #closed = false;

  constructor(url: string, createSocket: SocketFactory, events: ConnectionEvents) {
    this.#url = url;
    this.#createSocket = createSocket;
    this.#events = events;
    this.#connect();
  }

  /** The board as this browser shows it: the confirmed board with the waiting batches on top. */
  items(): ReadonlyMap<string, Item> {
    if (this.#view === null) {
      const view = new Map(this.#confirmed);
      for (const batch of this.#batches) {
        try {
          applyOps(view, batch.ops);
        } catch {
          // The room will refuse this batch too, and the rejection takes it away.
        }
      }
      this.#view = view;
    }
    return this.#view;
  }

  /** The items in drawing order. */
  sortedItems(): Item[] {
    this.#sorted ??= sortedItems(this.items().values());
    return this.#sorted;
  }

  /** Whether batches of this browser wait for the room. */
  get pending(): boolean {
    return this.#batches.length > 0;
  }

  /** Applies operations here at once, and sends them to the room. */
  submit(ops: readonly Op[]): void {
    if (ops.length === 0) return;
    const last = this.#batches.at(-1);
    if (last !== undefined && !last.sent) last.ops.push(...ops);
    else this.#batches.push({ id: randomId(), ops: [...ops], sent: false });
    this.#invalidate();
    this.#scheduleSend();
    this.#events.change();
  }

  /** Tells the others where this browser points and what it does. */
  setPresence(presence: Presence): void {
    this.#presence = presence;
    this.#presenceDirty = true;
    if (this.#presenceTimer !== null) return;
    const wait = Math.max(0, this.#presenceSentAt + PRESENCE_INTERVAL_MS - Date.now());
    this.#presenceTimer = setTimeout(() => {
      this.#presenceTimer = null;
      this.#sendPresence();
    }, wait);
  }

  close(): void {
    // Edits of the last moments leave before the connection closes.
    if (this.#sendTimer !== null) this.#sendBatches();
    this.#closed = true;
    this.#clearTimers();
    const socket = this.#socket;
    this.#socket = null;
    if (socket !== null) {
      socket.onclose = null;
      socket.close(1000, "The page closed the board.");
    }
  }

  #connect(): void {
    if (this.#closed) return;
    const socket = this.#createSocket(this.#url);
    this.#socket = socket;
    socket.onmessage = (event) => {
      if (typeof event.data !== "string" || event.data === "pong") return;
      this.#receive(JSON.parse(event.data) as ServerMessage);
    };
    socket.onclose = (event) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#clearTimers();
      if (event.code === CLOSE_BOARD_DELETED) {
        this.status = "deleted";
        this.#events.change();
        return;
      }
      this.status = "reconnecting";
      this.#events.change();
      const delay = RECONNECT_DELAYS_MS[Math.min(this.#attempts, RECONNECT_DELAYS_MS.length - 1)] ?? 8_000;
      this.#attempts += 1;
      // A little randomness keeps everyone on a board from connecting at the same moment.
      this.#reconnectTimer = setTimeout(() => this.#connect(), delay * (0.8 + Math.random() * 0.4));
    };
  }

  #receive(message: ServerMessage): void {
    switch (message.type) {
      case "welcome": {
        this.status = "open";
        this.#attempts = 0;
        this.board = message.board;
        this.me = message.you;
        this.peers.clear();
        for (const peer of message.peers) this.peers.set(peer.session, peer);
        this.#confirmed = new Map(message.items.map((item) => [item.id, item]));
        // Every waiting batch goes out again on the new connection.
        for (const batch of this.#batches) batch.sent = false;
        this.#invalidate();
        this.#pingTimer = setInterval(() => this.#socketSend("ping"), PING_INTERVAL_MS);
        this.#sendBatches();
        this.#presenceDirty = true;
        this.#sendPresence();
        break;
      }
      case "ops": {
        try {
          applyOps(this.#confirmed, message.ops);
        } catch {
          // The room applied these operations, so they apply here too.
        }
        if (message.session === this.me?.session) {
          this.#batches = this.#batches.filter((batch) => batch.id !== message.batch);
        }
        this.#invalidate();
        break;
      }
      case "rejected": {
        this.#batches = this.#batches.filter((batch) => batch.id !== message.batch);
        this.#invalidate();
        this.#events.rejected(message.message);
        break;
      }
      case "presence": {
        const peer = this.peers.get(message.session);
        if (peer !== undefined) this.peers.set(message.session, { ...peer, presence: message.presence });
        break;
      }
      case "joined":
        this.peers.set(message.peer.session, message.peer);
        break;
      case "left":
        this.peers.delete(message.session);
        break;
      case "renamed":
        if (this.board !== null) this.board = { ...this.board, name: message.name };
        break;
    }
    this.#events.change();
  }

  #scheduleSend(): void {
    if (this.#sendTimer !== null) return;
    this.#sendTimer = setTimeout(() => {
      this.#sendTimer = null;
      this.#sendBatches();
    }, SEND_DELAY_MS);
  }

  #sendBatches(): void {
    if (this.#socket?.readyState !== OPEN || this.status !== "open") return;
    const batches: Batch[] = [];
    for (const batch of this.#batches) {
      if (batch.sent) {
        batches.push(batch);
        continue;
      }
      // A large batch leaves in parts that each fit in one message.
      for (const part of splitOps(batch.ops)) {
        const piece: Batch = { id: part === batch.ops ? batch.id : randomId(), ops: part, sent: true };
        batches.push(piece);
        this.#socketSend(JSON.stringify({ type: "ops", batch: piece.id, ops: piece.ops } satisfies ClientMessage));
      }
    }
    this.#batches = batches;
  }

  #sendPresence(): void {
    if (!this.#presenceDirty || this.#socket?.readyState !== OPEN || this.status !== "open") return;
    this.#presenceDirty = false;
    this.#presenceSentAt = Date.now();
    this.#socketSend(JSON.stringify({ type: "presence", presence: this.#presence } satisfies ClientMessage));
  }

  #socketSend(text: string): void {
    try {
      this.#socket?.send(text);
    } catch {
      // The connection is closing; its close event connects again.
    }
  }

  #invalidate(): void {
    this.#view = null;
    this.#sorted = null;
  }

  #clearTimers(): void {
    for (const timer of [this.#sendTimer, this.#presenceTimer, this.#reconnectTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    if (this.#pingTimer !== null) clearInterval(this.#pingTimer);
    this.#sendTimer = null;
    this.#presenceTimer = null;
    this.#reconnectTimer = null;
    this.#pingTimer = null;
  }
}

/** Splits operations into parts of at most MAX_BATCH_CHARS characters of JSON, in order. */
export function splitOps(ops: Op[]): Op[][] {
  if (JSON.stringify(ops).length <= MAX_BATCH_CHARS) return [ops];
  const parts: Op[][] = [];
  let part: Op[] = [];
  let chars = 0;
  for (const op of ops) {
    const length = JSON.stringify(op).length + 1;
    if (part.length > 0 && chars + length > MAX_BATCH_CHARS) {
      parts.push(part);
      part = [];
      chars = 0;
    }
    part.push(op);
    chars += length;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}
