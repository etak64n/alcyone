// The items of one board while its BoardRoom holds it, and the count of the batches that
// changed them. The BoardRoom (board-room.ts) adds the WebSockets, the journal, and the
// saves to the bucket around it; this part has no I/O, so the tests run it as it is.

import { applyOps, sortedItems, type Item, type Op } from "../shared/board.ts";
import type { BoardSnapshot } from "./layout.ts";

/** A batch that the room applied after its last save, which the journal keeps until the next one. */
export interface JournalEntry {
  seq: number;
  ops: Op[];
}

/** What a save includes, which the room marks as saved once the bucket has it. */
export interface SaveMark {
  seq: number;
  nameVersion: number;
}

export class Room {
  readonly items = new Map<string, Item>();
  #seq = 0;
  #savedSeq = 0;
  #nameVersion = 0;
  #savedNameVersion = 0;

  /**
   * Rebuilds the board from its last save and the batches after it. A batch of the journal
   * that the board no longer takes is left out and named in `problems`.
   */
  static restore(snapshot: BoardSnapshot | null, journal: readonly JournalEntry[]): { room: Room; problems: string[] } {
    const room = new Room();
    const problems: string[] = [];
    if (snapshot !== null) {
      for (const item of snapshot.items) room.items.set(item.id, item);
      room.#seq = snapshot.seq;
      room.#savedSeq = snapshot.seq;
    }
    for (const entry of journal) {
      // The save already includes this batch.
      if (entry.seq <= room.#seq) continue;
      try {
        applyOps(room.items, entry.ops);
      } catch (error) {
        problems.push(`Batch ${entry.seq}: ${error instanceof Error ? error.message : String(error)}`);
      }
      room.#seq = entry.seq;
    }
    return { room, problems };
  }

  /** The number of batches that changed the board. */
  get seq(): number {
    return this.#seq;
  }

  /** Whether the board changed since its last save. */
  get dirty(): boolean {
    return this.#seq > this.#savedSeq || this.#nameVersion > this.#savedNameVersion;
  }

  /**
   * Applies a batch, and returns the operations that changed something with the new
   * number of the batch, or null when nothing changed. Throws a BoardError, and changes
   * nothing, when an operation is wrong.
   */
  apply(ops: readonly Op[]): JournalEntry | null {
    const effective = applyOps(this.items, ops);
    if (effective.length === 0) return null;
    this.#seq += 1;
    return { seq: this.#seq, ops: effective };
  }

  /** Notes a new name, which the next save writes. */
  renamed(): void {
    this.#nameVersion += 1;
  }

  /** The board as the next save writes it, and the mark to pass to saved() once the bucket has it. */
  snapshot(id: string, name: string, savedAt: string): { snapshot: BoardSnapshot; mark: SaveMark } {
    return {
      snapshot: { format: "alcyone.board", version: 1, id, name, seq: this.#seq, savedAt, items: sortedItems(this.items.values()) },
      mark: { seq: this.#seq, nameVersion: this.#nameVersion },
    };
  }

  saved(mark: SaveMark): void {
    this.#savedSeq = Math.max(this.#savedSeq, mark.seq);
    this.#savedNameVersion = Math.max(this.#savedNameVersion, mark.nameVersion);
  }
}
