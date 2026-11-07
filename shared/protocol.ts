// The messages of the WebSocket of a board, between a browser and the BoardRoom of the
// board. The browser sends batches of operations and where its pointer is; the room
// applies the batches in the order in which they arrive and sends each one to everyone
// on the board, the sender included, which learns that way that its batch arrived.

import { BoardError, ID_PATTERN, MAX_COORDINATE, readItem, readOps, type Item, type Op } from "./board.ts";

/** A point on the board, in board units. */
export interface Point {
  x: number;
  y: number;
}

/** Someone on the board: one browser tab. The same person in two tabs is two peers. */
export interface Peer {
  /** The ID of the connection, new for each one. */
  session: string;
  email: string;
  /** The name that the board shows beside the cursor. */
  name: string;
  /** The color of the cursor and of what the person selects, as #rrggbb. */
  color: string;
}

/** Items that someone moves together, by the distance of the move so far. */
export interface Drag {
  ids: string[];
  dx: number;
  dy: number;
}

/** What someone is doing, which the others see as it happens. The room keeps none of it. */
export interface Presence {
  cursor: Point | null;
  selection: string[];
  /** The items that the person is moving, before they let go. */
  drag: Drag | null;
  /**
   * The items that the person is drawing, resizing, or reshaping, as they look now, before
   * the person lets go and the operations that keep them arrive.
   */
  ghosts: Item[];
}

export interface PeerState extends Peer {
  presence: Presence;
}

export interface BoardInfo {
  id: string;
  name: string;
}

export type ClientMessage =
  | { type: "ops"; batch: string; ops: Op[] }
  | { type: "presence"; presence: Presence };

export type ServerMessage =
  /** The first message on a connection: the board as it is, and who else is on it. */
  | { type: "welcome"; board: BoardInfo; you: Peer; peers: PeerState[]; items: Item[]; seq: number }
  /** A batch that the room applied. seq counts the batches of the board. */
  | { type: "ops"; seq: number; session: string; batch: string; ops: Op[] }
  /** A batch of this connection that the room did not apply, with the reason. */
  | { type: "rejected"; batch: string; message: string }
  | { type: "presence"; session: string; presence: Presence }
  | { type: "joined"; peer: PeerState }
  | { type: "left"; session: string }
  | { type: "renamed"; name: string };

/** The close code of a connection to a board that someone deleted. */
export const CLOSE_BOARD_DELETED = 4404;
/** The close code of a message that the room could not read, which closes the connection. */
export const CLOSE_BAD_MESSAGE = 4400;

/** The largest message that a browser may send, in UTF-16 code units. */
export const MAX_MESSAGE_LENGTH = 1_000_000;
/** The most items that a presence may show as ghosts. */
export const MAX_GHOSTS = 100;
/** The most IDs in a selection or a drag of a presence. */
export const MAX_PRESENCE_IDS = 10_000;
const BATCH_PATTERN = /^[0-9a-z]{1,32}$/;

export const EMPTY_PRESENCE: Presence = { cursor: null, selection: [], drag: null, ghosts: [] };

/** Reads a message from a browser, and throws a BoardError when it is not one. */
export function readClientMessage(text: string): ClientMessage {
  if (text.length > MAX_MESSAGE_LENGTH) throw new BoardError(`A message may hold at most ${MAX_MESSAGE_LENGTH} characters.`);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BoardError("A message must be JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BoardError("A message must be a JSON object.");
  const fields = value as Record<string, unknown>;
  switch (fields["type"]) {
    case "ops": {
      const batch = fields["batch"];
      if (typeof batch !== "string" || !BATCH_PATTERN.test(batch)) throw new BoardError("batch must be 1 to 32 digits and lowercase letters.");
      return { type: "ops", batch, ops: readOps(fields["ops"]) };
    }
    case "presence":
      return { type: "presence", presence: readPresence(fields["presence"]) };
    default:
      throw new BoardError(`A message has an unknown type: ${String(fields["type"])}.`);
  }
}

function readPresence(value: unknown): Presence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BoardError("presence must be an object.");
  const fields = value as Record<string, unknown>;
  const cursor = fields["cursor"] === null ? null : readPoint(fields["cursor"]);
  const selection = readIds(fields["selection"], "presence.selection");
  let drag: Drag | null = null;
  if (fields["drag"] !== null) {
    const raw = fields["drag"];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new BoardError("presence.drag must be an object or null.");
    const dragFields = raw as Record<string, unknown>;
    drag = { ids: readIds(dragFields["ids"], "presence.drag.ids"), dx: readNumber(dragFields["dx"]), dy: readNumber(dragFields["dy"]) };
  }
  const ghosts = fields["ghosts"];
  if (!Array.isArray(ghosts) || ghosts.length > MAX_GHOSTS) throw new BoardError(`presence.ghosts must be a list of at most ${MAX_GHOSTS} items.`);
  return { cursor, selection, drag, ghosts: ghosts.map(readItem) };
}

function readPoint(value: unknown): Point {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BoardError("presence.cursor must be a point or null.");
  const fields = value as Record<string, unknown>;
  return { x: readNumber(fields["x"]), y: readNumber(fields["y"]) };
}

function readNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE * 2) {
    throw new BoardError("A position in a presence must be a finite number.");
  }
  return value;
}

function readIds(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_PRESENCE_IDS || !value.every((item) => typeof item === "string" && ID_PATTERN.test(item))) {
    throw new BoardError(`${name} must be a list of at most ${MAX_PRESENCE_IDS} IDs.`);
  }
  return value as string[];
}

// The colors of the cursors, chosen to read on the light board and apart from each other.
const PEER_COLORS = ["#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5", "#0c8599", "#d6336c", "#5f3dc4", "#e8590c", "#495057"];

/** The color of a person, the same on every board and in every tab. */
export function peerColor(email: string): string {
  let hash = 0;
  for (let index = 0; index < email.length; index += 1) hash = (hash * 31 + email.charCodeAt(index)) >>> 0;
  return PEER_COLORS[hash % PEER_COLORS.length] ?? "#495057";
}

/** The name that the board shows for a person: the part of the email before the @. */
export function peerName(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}
