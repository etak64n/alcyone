import { describe, expect, it } from "vitest";
import { BoardError, type StickyItem } from "../shared/board.ts";
import { Directory } from "../worker/directory.ts";
import { indexJson, readIndex, readSnapshot, snapshotJson, type BoardSnapshot } from "../worker/layout.ts";
import { Room } from "../worker/room.ts";

const ID = "aaaaaaaaaaaaaaaa";
const BOARD = "board00000000001";
const note = (overrides: Partial<StickyItem> = {}): StickyItem => ({ id: ID, type: "sticky", z: 1, x: 0, y: 0, w: 200, h: 200, color: "yellow", text: "", ...overrides });

describe("Room", () => {
  it("counts the batches that change the board, and skips the ones that do not", () => {
    const room = new Room();
    expect(room.apply([{ op: "put", item: note() }])).toEqual({ seq: 1, ops: [{ op: "put", item: note() }] });
    expect(room.apply([{ op: "delete", id: "bbbbbbbbbbbbbbbb" }])).toBeNull();
    expect(room.seq).toBe(1);
  });

  it("changes nothing for a wrong batch", () => {
    const room = new Room();
    expect(() => room.apply([{ op: "put", item: { ...note(), w: -1 } }])).toThrow(BoardError);
    expect(room.seq).toBe(0);
    expect(room.items.size).toBe(0);
  });

  it("is dirty until a save that includes every batch", () => {
    const room = new Room();
    room.apply([{ op: "put", item: note() }]);
    const first = room.snapshot(BOARD, "Plan", "2026-11-08T00:00:00.000Z");
    room.apply([{ op: "patch", id: ID, set: { text: "later" } }]);
    room.saved(first.mark);
    expect(room.dirty).toBe(true);
    room.saved(room.snapshot(BOARD, "Plan", "2026-11-08T00:00:01.000Z").mark);
    expect(room.dirty).toBe(false);
    room.renamed();
    expect(room.dirty).toBe(true);
  });

  it("rebuilds the board from a save and the batches after it", () => {
    const room = new Room();
    room.apply([{ op: "put", item: note({ text: "saved" }) }]);
    const { snapshot } = room.snapshot(BOARD, "Plan", "2026-11-08T00:00:00.000Z");
    const { room: restored, problems } = Room.restore(snapshot, [
      // Already in the save.
      { seq: 1, ops: [{ op: "put", item: note({ text: "old" }) }] },
      { seq: 2, ops: [{ op: "patch", id: ID, set: { text: "after the save" } }] },
      // A batch that the board no longer takes is left out.
      { seq: 3, ops: [{ op: "patch", id: ID, set: { color: "purple" } }] },
    ]);
    expect(restored.items.get(ID)).toMatchObject({ text: "after the save", color: "yellow" });
    expect(restored.seq).toBe(3);
    expect(restored.dirty).toBe(true);
    expect(problems).toHaveLength(1);
  });
});

describe("board.json and index.json", () => {
  it("reads back what alcyone writes", () => {
    const snapshot: BoardSnapshot = { format: "alcyone.board", version: 1, id: BOARD, name: "Plan", seq: 4, savedAt: "2026-11-08T00:00:00.000Z", items: [note()] };
    expect(readSnapshot(snapshotJson(snapshot))).toEqual({ snapshot, skipped: [] });
    const entries = [{ id: BOARD, name: "Plan", createdAt: "a", createdBy: "ada@example.com", updatedAt: "b" }];
    expect(readIndex(indexJson(entries))).toEqual(entries);
  });

  it("leaves out an item that it cannot read, and keeps the others", () => {
    const text = JSON.stringify({ format: "alcyone.board", version: 1, id: BOARD, name: "Plan", seq: 1, savedAt: "x", items: [note(), { id: "bbbbbbbbbbbbbbbb", type: "rocket" }] });
    const { snapshot, skipped } = readSnapshot(text);
    expect(snapshot.items).toHaveLength(1);
    expect(skipped[0]).toMatch(/unknown type/);
  });

  it("refuses a file of another kind", () => {
    expect(() => readSnapshot(JSON.stringify({ format: "something.else" }))).toThrow(/version 1/);
    expect(() => readIndex("[]")).toThrow(/not a JSON object/);
  });
});

describe("Directory", () => {
  const entry = (id: string, updatedAt: string) => ({ id, name: id, createdAt: "2026-11-01T00:00:00.000Z", createdBy: "ada@example.com", updatedAt });

  it("lists the board that changed last first", () => {
    const directory = new Directory([entry("b", "2026-11-02"), entry("a", "2026-11-03")]);
    expect(directory.list().map((board) => board.id)).toEqual(["a", "b"]);
    expect(directory.touch("b", "2026-11-04")).toBe(true);
    expect(directory.list().map((board) => board.id)).toEqual(["b", "a"]);
    // A change that is older than the last one changes nothing.
    expect(directory.touch("b", "2026-11-01")).toBe(false);
  });

  it("creates, renames, and removes boards", () => {
    const directory = new Directory();
    expect(directory.create(entry("a", "1"))).toBe(true);
    expect(directory.create(entry("a", "1"))).toBe(false);
    expect(directory.rename("a", "Roadmap")?.name).toBe("Roadmap");
    expect(directory.rename("missing", "x")).toBeNull();
    expect(directory.remove("a")).toBe(true);
    expect(directory.get("a")).toBeNull();
  });
});
