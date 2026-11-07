// Where alcyone keeps everything in the bucket, and the form of each file. The bucket is
// the only place that keeps the boards: the Durable Objects hold a board while people
// edit it, and read it back from the bucket when they wake up.
//
//   index.json                         the list of boards
//   boards/<board>/board.json          the items of a board
//   boards/<board>/assets/<image>      the images of a board
//
// Each file is JSON that a person can read, so the boards stay usable without alcyone.

import { ID_PATTERN, readItem, type Item } from "../shared/board.ts";
import type { BoardEntry } from "./rpc.ts";

export const INDEX_KEY = "index.json";

export function boardPrefix(boardId: string): string {
  return `boards/${boardId}/`;
}

export function boardKey(boardId: string): string {
  return `${boardPrefix(boardId)}board.json`;
}

export function assetKey(boardId: string, assetId: string): string {
  return `${boardPrefix(boardId)}assets/${assetId}`;
}

/** The items of a board as the bucket keeps them. */
export interface BoardSnapshot {
  format: "alcyone.board";
  version: 1;
  id: string;
  name: string;
  /** The number of batches of operations that the items include. */
  seq: number;
  savedAt: string;
  items: Item[];
}

/** The list of boards as the bucket keeps it. */
interface IndexFile {
  format: "alcyone.index";
  version: 1;
  boards: BoardEntry[];
}

/** A file in the bucket that alcyone cannot read. */
export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LayoutError";
  }
}

export function snapshotJson(snapshot: BoardSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Reads board.json. An item that alcyone cannot read is left out, and named in `skipped`,
 * so that one damaged item does not lock everyone out of the board.
 */
export function readSnapshot(text: string): { snapshot: BoardSnapshot; skipped: string[] } {
  const value = parseObject(text, "board.json");
  if (value["format"] !== "alcyone.board" || value["version"] !== 1) {
    throw new LayoutError(`board.json is not a board of version 1 of alcyone: format ${String(value["format"])}, version ${String(value["version"])}.`);
  }
  const id = value["id"];
  const name = value["name"];
  const seq = value["seq"];
  const savedAt = value["savedAt"];
  const items = value["items"];
  if (typeof id !== "string" || !ID_PATTERN.test(id) || typeof name !== "string" || typeof savedAt !== "string"
    || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0 || !Array.isArray(items)) {
    throw new LayoutError("board.json lacks the ID, the name, the sequence number, the time of the save, or the items.");
  }
  const read: Item[] = [];
  const skipped: string[] = [];
  for (const raw of items) {
    try {
      read.push(readItem(raw));
    } catch (error) {
      skipped.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { snapshot: { format: "alcyone.board", version: 1, id, name, seq, savedAt, items: read }, skipped };
}

export function indexJson(boards: readonly BoardEntry[]): string {
  const file: IndexFile = { format: "alcyone.index", version: 1, boards: [...boards] };
  return JSON.stringify(file, null, 2);
}

export function readIndex(text: string): BoardEntry[] {
  const value = parseObject(text, "index.json");
  if (value["format"] !== "alcyone.index" || value["version"] !== 1 || !Array.isArray(value["boards"])) {
    throw new LayoutError("index.json is not a list of boards of version 1 of alcyone.");
  }
  return value["boards"].map((raw, position): BoardEntry => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new LayoutError(`Board ${position + 1} of index.json is not an object.`);
    const fields = raw as Record<string, unknown>;
    const entry = {
      id: fields["id"],
      name: fields["name"],
      createdAt: fields["createdAt"],
      createdBy: fields["createdBy"],
      updatedAt: fields["updatedAt"],
    };
    if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id) || typeof entry.name !== "string" || typeof entry.createdAt !== "string"
      || typeof entry.createdBy !== "string" || typeof entry.updatedAt !== "string") {
      throw new LayoutError(`Board ${position + 1} of index.json lacks a field or has one of the wrong type.`);
    }
    return entry as BoardEntry;
  });
}

function parseObject(text: string, file: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LayoutError(`${file} is not JSON.`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new LayoutError(`${file} is not a JSON object.`);
  return value as Record<string, unknown>;
}
