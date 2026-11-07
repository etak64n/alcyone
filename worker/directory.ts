// The list of boards while the BoardDirectory holds it. The BoardDirectory
// (board-directory.ts) reads it from index.json in the bucket and writes it back after
// each change; this part has no I/O, so the tests run it as it is.

import type { BoardEntry } from "./rpc.ts";

export class Directory {
  readonly #boards = new Map<string, BoardEntry>();

  constructor(entries: readonly BoardEntry[] = []) {
    for (const entry of entries) this.#boards.set(entry.id, { ...entry });
  }

  /** Every board, the one that changed last first. */
  list(): BoardEntry[] {
    return [...this.#boards.values()]
      .map((entry) => ({ ...entry }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? -1 : 1));
  }

  get(id: string): BoardEntry | null {
    const entry = this.#boards.get(id);
    return entry === undefined ? null : { ...entry };
  }

  /** Adds a board. A board with the same ID stays as it is: the ID of a new board is random. */
  create(entry: BoardEntry): boolean {
    if (this.#boards.has(entry.id)) return false;
    this.#boards.set(entry.id, { ...entry });
    return true;
  }

  rename(id: string, name: string): BoardEntry | null {
    const entry = this.#boards.get(id);
    if (entry === undefined) return null;
    entry.name = name;
    return { ...entry };
  }

  remove(id: string): boolean {
    return this.#boards.delete(id);
  }

  /** Notes a change of a board, and answers whether the list changed. A time before the last one changes nothing. */
  touch(id: string, updatedAt: string): boolean {
    const entry = this.#boards.get(id);
    if (entry === undefined || updatedAt <= entry.updatedAt) return false;
    entry.updatedAt = updatedAt;
    return true;
  }
}
