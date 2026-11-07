// Undo and redo of the edits of this browser. An edit keeps the operations that undo it,
// made from the items as they were before it. Undo puts back what this person changed,
// even after others changed the board since: the last change of an item wins.

import type { Item, Op } from "../../shared/board.ts";

export interface HistoryEntry {
  undo: Op[];
  redo: Op[];
}

// The most edits that undo reaches back to.
const MAX_ENTRIES = 200;

/** The operations that undo `ops`, applied to `items` as they are before the operations. */
export function inverseOps(items: ReadonlyMap<string, Item>, ops: readonly Op[]): Op[] {
  // The items as the operations change them, one after another.
  const changed = new Map<string, Item | null>();
  const current = (id: string): Item | undefined => (changed.has(id) ? (changed.get(id) ?? undefined) : items.get(id));
  const inverse: Op[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "put": {
        const before = current(op.item.id);
        inverse.push(before === undefined ? { op: "delete", id: op.item.id } : { op: "put", item: before });
        changed.set(op.item.id, op.item);
        break;
      }
      case "patch": {
        const before = current(op.id);
        if (before === undefined) break;
        const fields = before as unknown as Record<string, unknown>;
        const old: Record<string, unknown> = {};
        for (const key of Object.keys(op.set)) old[key] = fields[key];
        inverse.push({ op: "patch", id: op.id, set: old });
        changed.set(op.id, { ...before, ...op.set } as Item);
        break;
      }
      case "delete": {
        const before = current(op.id);
        if (before === undefined) break;
        inverse.push({ op: "put", item: before });
        changed.set(op.id, null);
        break;
      }
    }
  }
  return inverse.reverse();
}

export class History {
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];

  record(entry: HistoryEntry): void {
    if (entry.redo.length === 0) return;
    this.#undo.push(entry);
    if (this.#undo.length > MAX_ENTRIES) this.#undo.shift();
    this.#redo = [];
  }

  /** Takes back the last edit, for undo. */
  popUndo(): HistoryEntry | null {
    const entry = this.#undo.pop() ?? null;
    if (entry !== null) this.#redo.push(entry);
    return entry;
  }

  /** Takes the last undone edit, for redo. */
  popRedo(): HistoryEntry | null {
    const entry = this.#redo.pop() ?? null;
    if (entry !== null) this.#undo.push(entry);
    return entry;
  }

  /** Forgets the last edit if it is this one, such as the creation of a text box left empty. */
  forget(entry: HistoryEntry): void {
    if (this.#undo.at(-1) === entry) this.#undo.pop();
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }
}
