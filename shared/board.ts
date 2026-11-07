// The contents of a board, and the operations that change them. The browser app and the
// Worker share this file: the browser makes operations, and the Worker checks each one
// before it applies it, since it cannot trust what a browser sends.
//
// A board is a set of items. Each item has a z order; a larger z draws over a smaller
// one. Every operation names absolute values, never differences, so applying the same
// operation twice leaves the board as applying it once: a browser that lost its
// connection sends again what it does not know to have arrived.

/** IDs of boards, items, and images: 16 digits and lowercase letters. */
export const ID_PATTERN = /^[0-9a-z]{16}$/;

export const STICKY_COLORS = ["yellow", "orange", "pink", "violet", "blue", "green", "gray", "white"] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

/** The colors of text, lines, the outlines of shapes, and pen strokes. */
export const INK_COLORS = ["black", "gray", "red", "orange", "yellow", "green", "blue", "violet"] as const;
export type InkColor = (typeof INK_COLORS)[number];

/** The fill of a shape: none, or a light tint of an ink color. */
export const FILL_COLORS = ["none", ...INK_COLORS] as const;
export type FillColor = (typeof FILL_COLORS)[number];

export const TEXT_SIZES = ["s", "m", "l", "xl"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const SHAPE_KINDS = ["rect", "ellipse", "diamond"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Where a line draws arrowheads. */
export const ARROW_KINDS = ["none", "end", "both"] as const;
export type ArrowKind = (typeof ARROW_KINDS)[number];

export const PEN_WIDTHS = [2, 4, 8] as const;

/** The most items that one board holds. */
export const MAX_ITEMS = 10_000;
/** The longest text of an item, in UTF-16 code units. */
export const MAX_TEXT_LENGTH = 10_000;
/** The most numbers in the points of a pen stroke: two for each point. */
export const MAX_PEN_NUMBERS = 10_000;
/** The farthest that anything may be from the origin of a board, in board units. */
export const MAX_COORDINATE = 10_000_000;
/** The largest width or height of an item, in board units. */
export const MAX_SIZE = 100_000;
/** The smallest width or height of an item, in board units. */
export const MIN_SIZE = 1;
/** The most operations in one batch. */
export const MAX_OPS_PER_BATCH = 2_000;

/** An end of a line: a point on the board, or an item that the end follows. */
export interface Endpoint {
  x: number;
  y: number;
  /** The item that the end is attached to, or null for a free end. The point is where it was last. */
  item: string | null;
}

interface ItemBase {
  id: string;
  z: number;
}

/** An item with a box: x and y are its top left corner. */
interface BoxFields {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StickyItem extends ItemBase, BoxFields {
  type: "sticky";
  color: StickyColor;
  text: string;
}

export interface TextItem extends ItemBase, BoxFields {
  type: "text";
  color: InkColor;
  size: TextSize;
  text: string;
}

export interface ShapeItem extends ItemBase, BoxFields {
  type: "shape";
  shape: ShapeKind;
  stroke: InkColor;
  fill: FillColor;
  text: string;
}

export interface LineItem extends ItemBase {
  type: "line";
  from: Endpoint;
  to: Endpoint;
  stroke: InkColor;
  arrow: ArrowKind;
}

export interface PenItem extends ItemBase, BoxFields {
  type: "pen";
  stroke: InkColor;
  width: number;
  /** x0, y0, x1, y1, ... relative to the top left corner of the item. */
  points: number[];
}

export interface ImageItem extends ItemBase, BoxFields {
  type: "image";
  /** The ID of the image file, which the board keeps in the bucket. */
  asset: string;
}

export type Item = StickyItem | TextItem | ShapeItem | LineItem | PenItem | ImageItem;
export type ItemType = Item["type"];
export type BoxItem = Exclude<Item, LineItem>;

export type Op =
  /** Adds an item, or replaces the item with the same ID. */
  | { op: "put"; item: Item }
  /** Sets some fields of an item. A patch of an item that no longer exists does nothing. */
  | { op: "patch"; id: string; set: Record<string, unknown> }
  /** Removes an item. Removing an item that no longer exists does nothing. */
  | { op: "delete"; id: string };

/** An operation that a board cannot take, with the reason. */
export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardError";
  }
}

export function isBoxItem(item: Item): item is BoxItem {
  return item.type !== "line";
}

/** Whether an item holds text that people edit in place. */
export function hasText(item: Item): item is StickyItem | TextItem | ShapeItem {
  return item.type === "sticky" || item.type === "text" || item.type === "shape";
}

type Fields = Record<string, unknown>;
type FieldReader = (value: unknown, name: string) => unknown;

const coordinate: FieldReader = (value, name) => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new BoardError(`${name} must be a number from -${MAX_COORDINATE} to ${MAX_COORDINATE}.`);
  }
  return value;
};

const size: FieldReader = (value, name) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < MIN_SIZE || value > MAX_SIZE) {
    throw new BoardError(`${name} must be a number from ${MIN_SIZE} to ${MAX_SIZE}.`);
  }
  return value;
};

const order: FieldReader = (value, name) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BoardError(`${name} must be a number.`);
  return value;
};

const text: FieldReader = (value, name) => {
  if (typeof value !== "string" || value.length > MAX_TEXT_LENGTH) {
    throw new BoardError(`${name} must be a string of at most ${MAX_TEXT_LENGTH} characters.`);
  }
  return value;
};

function oneOf(values: readonly (string | number)[]): FieldReader {
  return (value, name) => {
    if (!values.includes(value as string | number)) throw new BoardError(`${name} must be one of ${values.join(", ")}.`);
    return value;
  };
}

const id: FieldReader = (value, name) => {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new BoardError(`${name} must be an ID.`);
  return value;
};

const endpoint: FieldReader = (value, name) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BoardError(`${name} must be an object.`);
  const fields = value as Fields;
  checkKeys(fields, ["x", "y", "item"], name);
  const item = fields["item"];
  if (item !== null) id(item, `${name}.item`);
  return { x: coordinate(fields["x"], `${name}.x`), y: coordinate(fields["y"], `${name}.y`), item };
};

const points: FieldReader = (value, name) => {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_PEN_NUMBERS || value.length % 2 !== 0) {
    throw new BoardError(`${name} must be a list of 2 to ${MAX_PEN_NUMBERS} numbers, two for each point.`);
  }
  for (const number of value) coordinate(number, name);
  return value;
};

const BOX: Record<string, FieldReader> = { z: order, x: coordinate, y: coordinate, w: size, h: size };

/** How to read each field of each type of item, the ID and the type left out. */
const SCHEMAS: Record<ItemType, Record<string, FieldReader>> = {
  sticky: { ...BOX, color: oneOf(STICKY_COLORS), text },
  text: { ...BOX, color: oneOf(INK_COLORS), size: oneOf(TEXT_SIZES), text },
  shape: { ...BOX, shape: oneOf(SHAPE_KINDS), stroke: oneOf(INK_COLORS), fill: oneOf(FILL_COLORS), text },
  line: { z: order, from: endpoint, to: endpoint, stroke: oneOf(INK_COLORS), arrow: oneOf(ARROW_KINDS) },
  pen: { ...BOX, stroke: oneOf(INK_COLORS), width: oneOf(PEN_WIDTHS), points },
  image: { ...BOX, asset: id },
};

function checkKeys(fields: Fields, allowed: readonly string[], name: string): void {
  const unknown = Object.keys(fields).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new BoardError(`${name} has unknown fields: ${unknown.join(", ")}.`);
}

function isItemType(value: unknown): value is ItemType {
  return typeof value === "string" && value in SCHEMAS;
}

/** Reads a complete item, and throws a BoardError that names the first field that is wrong. */
export function readItem(value: unknown): Item {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BoardError("An item must be an object.");
  const fields = value as Fields;
  const type = fields["type"];
  if (!isItemType(type)) throw new BoardError(`An item has an unknown type: ${String(type)}.`);
  const schema = SCHEMAS[type];
  checkKeys(fields, ["id", "type", ...Object.keys(schema)], `The ${type} item`);
  const item: Fields = { id: id(fields["id"], "item.id"), type };
  for (const [name, read] of Object.entries(schema)) {
    if (!(name in fields)) throw new BoardError(`The ${type} item has no ${name}.`);
    item[name] = read(fields[name], `${type}.${name}`);
  }
  return item as unknown as Item;
}

/** Reads the fields of a patch of an item of the given type. */
export function readPatch(type: ItemType, value: unknown): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BoardError("The fields of a patch must be an object.");
  const fields = value as Fields;
  const schema = SCHEMAS[type];
  checkKeys(fields, Object.keys(schema), `A patch of a ${type} item`);
  const set: Fields = {};
  for (const [name, raw] of Object.entries(fields)) {
    const read = schema[name];
    if (read !== undefined) set[name] = read(raw, `${type}.${name}`);
  }
  return set;
}

/**
 * Reads a batch of operations from what a browser sent. It checks the form of each
 * operation; applyOps checks the fields of a patch against the item that it changes.
 */
export function readOps(value: unknown): Op[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_OPS_PER_BATCH) {
    throw new BoardError(`A batch must hold 1 to ${MAX_OPS_PER_BATCH} operations.`);
  }
  return value.map((raw): Op => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new BoardError("An operation must be an object.");
    const fields = raw as Fields;
    switch (fields["op"]) {
      case "put":
        checkKeys(fields, ["op", "item"], "A put");
        return { op: "put", item: readItem(fields["item"]) };
      case "patch": {
        checkKeys(fields, ["op", "id", "set"], "A patch");
        const set = fields["set"];
        if (typeof set !== "object" || set === null || Array.isArray(set)) throw new BoardError("The fields of a patch must be an object.");
        return { op: "patch", id: id(fields["id"], "patch.id") as string, set: set as Fields };
      }
      case "delete":
        checkKeys(fields, ["op", "id"], "A delete");
        return { op: "delete", id: id(fields["id"], "delete.id") as string };
      default:
        throw new BoardError(`An operation has an unknown kind: ${String(fields["op"])}.`);
    }
  });
}

/**
 * Applies operations to the items of a board, in order, and returns the ones that changed
 * something, with each patch reduced to the fields that it may set. It checks every
 * operation before it changes anything, so a batch with a wrong operation changes nothing.
 */
export function applyOps(items: Map<string, Item>, ops: readonly Op[]): Op[] {
  // Check against a copy of the entries that the batch touches, then commit them.
  const touched = new Map<string, Item | null>();
  const current = (key: string): Item | undefined => {
    if (touched.has(key)) return touched.get(key) ?? undefined;
    return items.get(key);
  };
  let count = items.size;
  const effective: Op[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "put": {
        const item = readItem(op.item);
        if (current(item.id) === undefined) count += 1;
        if (count > MAX_ITEMS) throw new BoardError(`A board holds at most ${MAX_ITEMS} items.`);
        touched.set(item.id, item);
        effective.push({ op: "put", item });
        break;
      }
      case "patch": {
        const item = current(op.id);
        if (item === undefined) break;
        const set = readPatch(item.type, op.set);
        if (Object.keys(set).length === 0) break;
        touched.set(op.id, { ...item, ...set } as Item);
        effective.push({ op: "patch", id: op.id, set });
        break;
      }
      case "delete": {
        if (current(op.id) === undefined) break;
        count -= 1;
        touched.set(op.id, null);
        effective.push({ op: "delete", id: op.id });
        break;
      }
    }
  }
  for (const [key, item] of touched) {
    if (item === null) items.delete(key);
    else items.set(key, item);
  }
  return effective;
}

/** The items in drawing order: the lowest z first, and the ID for items with the same z. */
export function sortedItems(items: Iterable<Item>): Item[] {
  return [...items].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
