import { describe, expect, it } from "vitest";
import { applyOps, BoardError, MAX_ITEMS, readItem, readOps, sortedItems, type Item, type StickyItem } from "../shared/board.ts";

const sticky = (id: string, overrides: Partial<StickyItem> = {}): StickyItem => ({
  id,
  type: "sticky",
  z: 1,
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  color: "yellow",
  text: "",
  ...overrides,
});

const ID_A = "aaaaaaaaaaaaaaaa";
const ID_B = "bbbbbbbbbbbbbbbb";

describe("readItem", () => {
  it("reads every kind of item", () => {
    const items: Item[] = [
      sticky(ID_A, { text: "Plan" }),
      { id: ID_B, type: "text", z: 2, x: 1, y: 2, w: 240, h: 34, color: "blue", size: "m", text: "日本語" },
      { id: "cccccccccccccccc", type: "shape", z: 3, x: 0, y: 0, w: 160, h: 100, shape: "diamond", stroke: "black", fill: "none", text: "" },
      { id: "dddddddddddddddd", type: "line", z: 4, from: { x: 0, y: 0, item: ID_A }, to: { x: 10, y: 10, item: null }, stroke: "red", arrow: "end" },
      { id: "eeeeeeeeeeeeeeee", type: "pen", z: 5, x: 0, y: 0, w: 10, h: 10, stroke: "green", width: 4, points: [0, 0, 10, 10] },
      { id: "ffffffffffffffff", type: "image", z: 6, x: 0, y: 0, w: 300, h: 200, asset: "0123456789abcdef" },
    ];
    for (const item of items) expect(readItem(structuredClone(item))).toEqual(item);
  });

  it("refuses unknown fields, missing fields, and values out of range", () => {
    expect(() => readItem({ ...sticky(ID_A), extra: 1 })).toThrow(/unknown fields: extra/);
    const { color: _color, ...withoutColor } = sticky(ID_A);
    expect(() => readItem(withoutColor)).toThrow(/has no color/);
    expect(() => readItem(sticky(ID_A, { w: 0 }))).toThrow(/sticky.w must be a number/);
    expect(() => readItem(sticky(ID_A, { x: Number.NaN }))).toThrow(BoardError);
    expect(() => readItem(sticky("NOT-AN-ID-AT-ALL"))).toThrow(/must be an ID/);
    expect(() => readItem({ ...sticky(ID_A), color: "purple" })).toThrow(/must be one of/);
    expect(() => readItem({ id: ID_A, type: "pen", z: 0, x: 0, y: 0, w: 1, h: 1, stroke: "black", width: 4, points: [1, 2, 3] })).toThrow(/two for each point/);
    expect(() => readItem({ id: ID_A, type: "widget" })).toThrow(/unknown type/);
  });
});

describe("readOps", () => {
  it("reads puts, patches, and deletes", () => {
    const ops = readOps([{ op: "put", item: sticky(ID_A) }, { op: "patch", id: ID_A, set: { text: "x" } }, { op: "delete", id: ID_B }]);
    expect(ops.map((op) => op.op)).toEqual(["put", "patch", "delete"]);
  });

  it("refuses an empty batch and unknown operations", () => {
    expect(() => readOps([])).toThrow(/1 to/);
    expect(() => readOps([{ op: "move", id: ID_A }])).toThrow(/unknown kind/);
  });
});

describe("applyOps", () => {
  it("adds, changes, and removes items, and returns what changed", () => {
    const items = new Map<string, Item>();
    const effective = applyOps(items, [
      { op: "put", item: sticky(ID_A) },
      { op: "patch", id: ID_A, set: { text: "Hello", x: 10 } },
      { op: "patch", id: ID_B, set: { text: "nobody" } },
      { op: "delete", id: ID_B },
    ]);
    expect(items.get(ID_A)).toMatchObject({ text: "Hello", x: 10 });
    // The patch and the delete of an item that does not exist do nothing.
    expect(effective.map((op) => op.op)).toEqual(["put", "patch"]);
  });

  it("changes nothing when one operation of the batch is wrong", () => {
    const items = new Map<string, Item>([[ID_A, sticky(ID_A, { text: "before" })]]);
    expect(() =>
      applyOps(items, [
        { op: "patch", id: ID_A, set: { text: "after" } },
        { op: "patch", id: ID_A, set: { color: "purple" } },
      ]),
    ).toThrow(BoardError);
    expect(items.get(ID_A)).toMatchObject({ text: "before" });
  });

  it("checks a patch against the fields of the kind of the item", () => {
    const items = new Map<string, Item>([[ID_A, sticky(ID_A)]]);
    expect(() => applyOps(items, [{ op: "patch", id: ID_A, set: { stroke: "red" } }])).toThrow(/unknown fields: stroke/);
  });

  it("gives the same board when the same operations arrive twice", () => {
    const ops = [{ op: "put" as const, item: sticky(ID_A) }, { op: "patch" as const, id: ID_A, set: { x: 50 } }, { op: "delete" as const, id: ID_B }];
    const once = new Map<string, Item>();
    applyOps(once, ops);
    const twice = new Map<string, Item>();
    applyOps(twice, ops);
    applyOps(twice, ops);
    expect([...twice.values()]).toEqual([...once.values()]);
  });

  it("refuses more items than a board holds", () => {
    const items = new Map<string, Item>();
    for (let index = 0; index < MAX_ITEMS; index += 1) {
      const id = index.toString(36).padStart(16, "0");
      items.set(id, sticky(id));
    }
    expect(() => applyOps(items, [{ op: "put", item: sticky("zzzzzzzzzzzzzzzz") }])).toThrow(/at most/);
    // Replacing an item that exists is fine.
    const first = items.keys().next().value as string;
    expect(() => applyOps(items, [{ op: "put", item: sticky(first, { text: "again" }) }])).not.toThrow();
  });
});

describe("sortedItems", () => {
  it("orders by z, then by ID", () => {
    const sorted = sortedItems([sticky(ID_B, { z: 1 }), sticky(ID_A, { z: 1 }), sticky("cccccccccccccccc", { z: 0 })]);
    expect(sorted.map((item) => item.id)).toEqual(["cccccccccccccccc", ID_A, ID_B]);
  });
});
