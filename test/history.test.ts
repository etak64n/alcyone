import { describe, expect, it } from "vitest";
import { applyOps, type Item, type Op, type StickyItem } from "../shared/board.ts";
import { History, inverseOps } from "../src/board/history.ts";

const ID = "aaaaaaaaaaaaaaaa";
const note = (overrides: Partial<StickyItem> = {}): StickyItem => ({ id: ID, type: "sticky", z: 1, x: 0, y: 0, w: 100, h: 100, color: "yellow", text: "", ...overrides });

// Applies ops and their inverse, and answers whether the board came back as it was.
function roundTrip(start: Item[], ops: Op[]): boolean {
  const items = new Map(start.map((item) => [item.id, item]));
  const before = JSON.stringify([...items.values()]);
  const inverse = inverseOps(items, ops);
  applyOps(items, ops);
  applyOps(items, inverse);
  return JSON.stringify([...items.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) === before;
}

describe("inverseOps", () => {
  it("undoes a new item, a replaced one, a patch, and a delete", () => {
    expect(inverseOps(new Map(), [{ op: "put", item: note() }])).toEqual([{ op: "delete", id: ID }]);
    const items = new Map<string, Item>([[ID, note({ text: "before" })]]);
    expect(inverseOps(items, [{ op: "patch", id: ID, set: { text: "after", x: 5 } }])).toEqual([{ op: "patch", id: ID, set: { text: "before", x: 0 } }]);
    expect(inverseOps(items, [{ op: "delete", id: ID }])).toEqual([{ op: "put", item: note({ text: "before" }) }]);
    expect(inverseOps(items, [{ op: "put", item: note({ text: "replaced" }) }])).toEqual([{ op: "put", item: note({ text: "before" }) }]);
  });

  it("undoes several operations on the same item in the reverse order", () => {
    expect(
      roundTrip([note()], [
        { op: "patch", id: ID, set: { x: 10 } },
        { op: "patch", id: ID, set: { x: 20, text: "b" } },
        { op: "delete", id: ID },
        { op: "put", item: note({ color: "blue" }) },
      ]),
    ).toBe(true);
  });
});

describe("History", () => {
  it("undoes and redoes in order, and forgets the redo after a new edit", () => {
    const history = new History();
    const first = { undo: [{ op: "delete" as const, id: "1" }], redo: [{ op: "delete" as const, id: "a" }] };
    const second = { undo: [{ op: "delete" as const, id: "2" }], redo: [{ op: "delete" as const, id: "b" }] };
    history.record(first);
    history.record(second);
    expect(history.popUndo()).toBe(second);
    expect(history.canRedo).toBe(true);
    expect(history.popRedo()).toBe(second);
    history.popUndo();
    history.record({ undo: [{ op: "delete", id: "3" }], redo: [{ op: "delete", id: "c" }] });
    expect(history.canRedo).toBe(false);
  });

  it("forgets the last edit on request", () => {
    const history = new History();
    const entry = { undo: [{ op: "delete" as const, id: "1" }], redo: [{ op: "delete" as const, id: "a" }] };
    history.record(entry);
    history.forget(entry);
    expect(history.canUndo).toBe(false);
  });
});
