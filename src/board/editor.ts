// The state of a board page and what each action of the person does to it: the tool,
// the part of the board on the screen, the selection, the text being written, and the
// pointer while it drags. The React components draw this state and pass the events of
// the pointer and the keyboard here; this part decides what they mean.

import {
  hasText,
  isBoxItem,
  MIN_SIZE,
  type ArrowKind,
  type BoxItem,
  type Endpoint,
  type FillColor,
  type InkColor,
  type Item,
  type LineItem,
  type Op,
  type PenItem,
  type ShapeKind,
  type StickyColor,
  type TextItem,
  type TextSize,
} from "../../shared/board.ts";
import { randomId } from "../../shared/ids.ts";
import { EMPTY_PRESENCE, type Point, type Presence } from "../../shared/protocol.ts";
import {
  boundsOf,
  boxOf,
  distance,
  fitCamera,
  fitPen,
  HANDLES,
  intersects,
  lineEnds,
  normalizeRect,
  resizeBox,
  round,
  toBoard,
  toScreen,
  translateItem,
  unionOf,
  zoomAt,
  type Camera,
  type Handle,
  type Rect,
} from "./geometry.ts";
import { History, inverseOps, type HistoryEntry } from "./history.ts";
import { BoardConnection, type SocketFactory } from "./sync.ts";
import { textBoxHeight, type Measure } from "./text.ts";

export type Tool = "select" | "hand" | "sticky" | "text" | "rect" | "ellipse" | "diamond" | "line" | "pen";

/** The look of the next item of each kind, which follows the last choice. */
export interface Styles {
  sticky: StickyColor;
  ink: InkColor;
  fill: FillColor;
  textSize: TextSize;
  penWidth: number;
  arrow: ArrowKind;
}

export interface PointerInput {
  pointerId: number;
  /** The position in the board view, in CSS pixels from its top left corner. */
  screen: Point;
  button: number;
  pointerType: string;
  shiftKey: boolean;
}

export interface Editing {
  id: string;
  draft: string;
  original: string;
  /** The edit that created the item, when the item is new: an empty new text box goes away with it. */
  created: HistoryEntry | null;
}

type Interaction =
  | { kind: "pan"; pointerId: number; origin: Point; camera: Camera }
  | { kind: "press"; pointerId: number; origin: Point; screen: Point; id: string; shift: boolean; wasSelected: boolean }
  | { kind: "move"; pointerId: number; origin: Point; ids: string[]; dx: number; dy: number }
  | { kind: "marquee"; pointerId: number; origin: Point; current: Point; base: string[] }
  | { kind: "resize"; pointerId: number; origin: Point; handle: Handle; original: BoxItem; current: BoxItem }
  | { kind: "endpoint"; pointerId: number; end: "from" | "to"; current: LineItem }
  | { kind: "shape"; pointerId: number; origin: Point; current: Point; shape: ShapeKind }
  | { kind: "line"; pointerId: number; origin: Point; current: Point; fromItem: string | null; toItem: string | null }
  | { kind: "draw"; pointerId: number; points: number[] };

/** What the board shows now: the items with every drag of everyone applied. */
export interface Display {
  items: Item[];
  byId: ReadonlyMap<string, Item>;
}

export interface EditorEvents {
  error: (message: string) => void;
  uploadImage: (file: File) => Promise<string>;
}

const STICKY_SIZE = 200;
const TEXT_WIDTH = 240;
const SHAPE_SIZE = { w: 160, h: 100 };
const DRAG_THRESHOLD_PX = 3;
const HANDLE_HIT_PX = 9;
const HIT_PX = 6;
const NUDGE = 1;
const NUDGE_FAR = 10;
const TEXT_SAVE_DELAY_MS = 400;
const PASTE_OFFSET = 24;
/** The longest side of an image that a board adds, in CSS pixels at the zoom of the moment. */
const IMAGE_MAX_PX = 480;
const CLIPBOARD_KIND = "alcyone/items";

export const DEFAULT_STYLES: Styles = { sticky: "yellow", ink: "black", fill: "none", textSize: "m", penWidth: 4, arrow: "end" };

export class Editor {
  readonly boardId: string;
  readonly measure: Measure;
  readonly history = new History();
  connection: BoardConnection | null = null;
  tool: Tool = "select";
  camera: Camera = { x: 0, y: 0, zoom: 1 };
  viewport = { width: 0, height: 0 };
  selection: ReadonlySet<string> = new Set();
  editing: Editing | null = null;
  interaction: Interaction | null = null;
  styles: Styles = { ...DEFAULT_STYLES };
  /** Where the pointer is on the board, or null when it is outside. */
  cursor: Point | null = null;
  /** Whether the space bar is down, which pans with the pointer. */
  spaceDown = false;

  readonly #events: EditorEvents;
  readonly #createSocket: SocketFactory;
  readonly #socketUrl: string;
  readonly #listeners = new Set<() => void>();
  #version = 0;
  #placed = false;
  #textTimer: ReturnType<typeof setTimeout> | null = null;
  #cameraTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #touches = new Map<number, Point>();
  #pinch: { distance: number; middle: Point; camera: Camera } | null = null;
  #display: Display | null = null;

  constructor(options: { boardId: string; socketUrl: string; createSocket: SocketFactory; measure: Measure; events: EditorEvents }) {
    this.boardId = options.boardId;
    this.measure = options.measure;
    this.#socketUrl = options.socketUrl;
    this.#createSocket = options.createSocket;
    this.#events = options.events;
    const saved = readSavedCamera(this.boardId);
    if (saved !== null) {
      this.camera = saved;
      this.#placed = true;
    }
  }

  // --- Lifecycle and change notification -------------------------------------------------

  /** Connects to the board. The page calls it when it shows the board, and stop() when it leaves. */
  start(): void {
    if (this.connection !== null) return;
    this.connection = new BoardConnection(this.#socketUrl, this.#createSocket, {
      change: () => this.#changed(),
      rejected: (message) => this.#events.error(`The board did not take an edit: ${message}`),
    });
  }

  stop(): void {
    this.#finishEditing();
    this.connection?.close();
    this.connection = null;
    if (this.#textTimer !== null) clearTimeout(this.#textTimer);
    if (this.#cameraTimer !== null) clearTimeout(this.#cameraTimer);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getVersion = (): number => this.#version;

  #changed(): void {
    this.#display = null;
    // The first board that arrives decides where the view starts, unless this browser kept one.
    if (!this.#placed && this.connection?.status === "open" && this.viewport.width > 0) {
      this.#placed = true;
      this.zoomToFit(false);
    }
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }

  // --- What the board shows ------------------------------------------------------------------

  /** The items as this browser has them: confirmed, with its own edits on top. */
  items(): ReadonlyMap<string, Item> {
    return this.connection?.items() ?? new Map();
  }

  /** The items as the board shows them, with the drags of this person and of the others. */
  display(): Display {
    if (this.#display !== null) return this.#display;
    const base = this.connection?.sortedItems() ?? [];
    const overrides = new Map<string, Item>();
    const extra: Item[] = [];
    const current = this.items();
    // What the others are doing, as their presence says.
    for (const peer of this.connection?.peers.values() ?? []) {
      const { drag, ghosts } = peer.presence;
      if (drag !== null) {
        for (const id of drag.ids) {
          const item = current.get(id);
          if (item !== undefined) overrides.set(id, translateItem(item, drag.dx, drag.dy));
        }
      }
      for (const ghost of ghosts) {
        if (current.has(ghost.id)) overrides.set(ghost.id, ghost);
        else extra.push(ghost);
      }
    }
    // What this person is doing.
    const interaction = this.interaction;
    if (interaction?.kind === "move") {
      for (const id of interaction.ids) {
        const item = current.get(id);
        if (item !== undefined) overrides.set(id, translateItem(item, interaction.dx, interaction.dy));
      }
    } else if (interaction?.kind === "resize") {
      overrides.set(interaction.current.id, interaction.current);
    } else if (interaction?.kind === "endpoint") {
      overrides.set(interaction.current.id, interaction.current);
    }
    const ghost = this.#creationGhost();
    if (ghost !== null) extra.push(ghost);

    let items = base;
    let byId = current;
    if (overrides.size > 0 || extra.length > 0) {
      items = base.map((item) => overrides.get(item.id) ?? item).concat(extra);
      byId = new Map(items.map((item) => [item.id, item]));
    }
    this.#display = { items, byId };
    return this.#display;
  }

  /** The selected items that still exist. */
  selectedItems(): Item[] {
    const items = this.items();
    return [...this.selection].flatMap((id) => {
      const item = items.get(id);
      return item === undefined ? [] : [item];
    });
  }

  /** The rectangle that the pointer drags to select, in board units. */
  marquee(): Rect | null {
    return this.interaction?.kind === "marquee" ? normalizeRect(this.interaction.origin, this.interaction.current) : null;
  }

  // --- Tools, styles, and the view -------------------------------------------------------------

  setTool(tool: Tool): void {
    this.#finishEditing();
    this.tool = tool;
    if (tool !== "select") this.#select([]);
    this.#changed();
  }

  setViewport(width: number, height: number): void {
    this.viewport = { width, height };
    this.#changed();
  }

  setCamera(camera: Camera): void {
    this.camera = camera;
    this.#placed = true;
    if (this.#cameraTimer !== null) clearTimeout(this.#cameraTimer);
    this.#cameraTimer = setTimeout(() => saveCamera(this.boardId, this.camera), 500);
    this.#changed();
  }

  zoomBy(factor: number, screen?: Point): void {
    const at = screen ?? { x: this.viewport.width / 2, y: this.viewport.height / 2 };
    this.setCamera(zoomAt(this.camera, at, this.camera.zoom * factor));
  }

  zoomTo(zoom: number): void {
    this.setCamera(zoomAt(this.camera, { x: this.viewport.width / 2, y: this.viewport.height / 2 }, zoom));
  }

  /** Shows every item, or the origin of an empty board. */
  zoomToFit(remember = true): void {
    const display = this.display();
    const bounds = unionOf(display.items.map((item) => boundsOf(item, display.byId)));
    const camera =
      bounds === null
        ? { x: -this.viewport.width / 2, y: -this.viewport.height / 2, zoom: 1 }
        : fitCamera(bounds, this.viewport);
    if (remember) this.setCamera(camera);
    else this.camera = camera;
  }

  /** Changes the look of the next items, and of the selected items that have that part. */
  setStyle(change: Partial<Styles>): void {
    this.styles = { ...this.styles, ...change };
    const ops: Op[] = [];
    for (const item of this.selectedItems()) {
      const set: Record<string, unknown> = {};
      if (change.sticky !== undefined && item.type === "sticky") set["color"] = change.sticky;
      if (change.ink !== undefined) {
        if (item.type === "text") set["color"] = change.ink;
        if (item.type === "shape" || item.type === "line" || item.type === "pen") set["stroke"] = change.ink;
      }
      if (change.fill !== undefined && item.type === "shape") set["fill"] = change.fill;
      if (change.textSize !== undefined && item.type === "text") {
        set["size"] = change.textSize;
        set["h"] = textBoxHeight(item.text, item.w, change.textSize, this.measure);
      }
      if (change.penWidth !== undefined && item.type === "pen") set["width"] = change.penWidth;
      if (change.arrow !== undefined && item.type === "line") set["arrow"] = change.arrow;
      if (Object.keys(set).length > 0) ops.push({ op: "patch", id: item.id, set });
    }
    if (ops.length > 0) this.#commit(ops);
    else this.#changed();
  }

  // --- Editing the board ----------------------------------------------------------------------

  /** Applies operations, sends them, and keeps them for undo. */
  #commit(ops: Op[]): HistoryEntry | null {
    const connection = this.connection;
    if (connection === null || ops.length === 0) return null;
    const entry: HistoryEntry = { undo: inverseOps(connection.items(), ops), redo: ops };
    this.history.record(entry);
    connection.submit(ops);
    return entry;
  }

  undo(): void {
    this.#finishEditing();
    const entry = this.history.popUndo();
    if (entry !== null) this.connection?.submit(entry.undo);
    this.#pruneSelection();
    this.#changed();
  }

  redo(): void {
    this.#finishEditing();
    const entry = this.history.popRedo();
    if (entry !== null) this.connection?.submit(entry.redo);
    this.#pruneSelection();
    this.#changed();
  }

  deleteSelection(): void {
    const items = this.selectedItems();
    if (items.length === 0) return;
    this.#commit(this.#deleteOps(new Set(items.map((item) => item.id))));
    this.#select([]);
  }

  // Deletes items, and frees the ends of the lines that follow them, where they are now.
  #deleteOps(ids: ReadonlySet<string>): Op[] {
    const items = this.items();
    const ops: Op[] = [];
    for (const item of items.values()) {
      if (item.type !== "line" || ids.has(item.id)) continue;
      const fromGone = item.from.item !== null && ids.has(item.from.item);
      const toGone = item.to.item !== null && ids.has(item.to.item);
      if (!fromGone && !toGone) continue;
      const ends = lineEnds(item, items);
      const set: Record<string, unknown> = {};
      if (fromGone) set["from"] = { x: round(ends.from.x), y: round(ends.from.y), item: null };
      if (toGone) set["to"] = { x: round(ends.to.x), y: round(ends.to.y), item: null };
      ops.push({ op: "patch", id: item.id, set });
    }
    for (const id of ids) ops.push({ op: "delete", id });
    return ops;
  }

  duplicateSelection(): void {
    this.#pasteItems(this.#withDrawnEnds(this.selectedItems()), { x: PASTE_OFFSET, y: PASTE_OFFSET });
  }

  selectAll(): void {
    this.#select([...this.items().keys()]);
  }

  bringToFront(): void {
    const top = this.#topZ();
    const selected = this.#inDrawingOrder(this.selectedItems());
    this.#commit(selected.map((item, index) => ({ op: "patch", id: item.id, set: { z: top + 1 + index } })));
  }

  sendToBack(): void {
    const sorted = this.connection?.sortedItems() ?? [];
    const bottom = sorted[0]?.z ?? 0;
    const selected = this.#inDrawingOrder(this.selectedItems());
    this.#commit(selected.map((item, index) => ({ op: "patch", id: item.id, set: { z: bottom - selected.length + index } })));
  }

  nudge(dx: number, dy: number): void {
    const ops = this.selectedItems().flatMap((item) => this.#moveOps(item, dx, dy));
    this.#commit(ops);
  }

  #moveOps(item: Item, dx: number, dy: number): Op[] {
    const moved = translateItem(item, dx, dy);
    if (isBoxItem(moved)) return [{ op: "patch", id: item.id, set: { x: moved.x, y: moved.y } }];
    if (moved.type === "line" && (item.type === "line") && (moved.from !== item.from || moved.to !== item.to)) {
      return [{ op: "patch", id: item.id, set: { from: moved.from, to: moved.to } }];
    }
    return [];
  }

  #topZ(): number {
    return this.connection?.sortedItems().at(-1)?.z ?? 0;
  }

  #inDrawingOrder(items: Item[]): Item[] {
    return [...items].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
  }

  #select(ids: readonly string[]): void {
    this.selection = new Set(ids);
    this.#sendPresence();
  }

  #pruneSelection(): void {
    const items = this.items();
    if ([...this.selection].some((id) => !items.has(id))) this.#select([...this.selection].filter((id) => items.has(id)));
  }

  // --- Text -------------------------------------------------------------------------------------

  startEditing(id: string, created: HistoryEntry | null = null): void {
    const item = this.items().get(id);
    if (item === undefined || !hasText(item)) return;
    this.#finishEditing();
    this.editing = { id, draft: item.text, original: item.text, created };
    this.#select([id]);
    this.#changed();
  }

  /** Takes what the person typed. The board gets it a moment later, so that each key is not an edit of its own. */
  setDraft(text: string): void {
    if (this.editing === null) return;
    this.editing = { ...this.editing, draft: text };
    if (this.#textTimer !== null) clearTimeout(this.#textTimer);
    this.#textTimer = setTimeout(() => {
      this.#textTimer = null;
      this.#saveDraft();
    }, TEXT_SAVE_DELAY_MS);
    this.#changed();
  }

  finishEditing(): void {
    this.#finishEditing();
    this.#changed();
  }

  // Sends the text of the item being edited, without an entry for undo: the whole edit gets one when it ends.
  #saveDraft(): void {
    const editing = this.editing;
    const connection = this.connection;
    if (editing === null || connection === null) return;
    const item = connection.items().get(editing.id);
    if (item === undefined || !hasText(item) || item.text === editing.draft) return;
    connection.submit([{ op: "patch", id: item.id, set: this.#textFields(item, editing.draft) }]);
  }

  #finishEditing(): void {
    const editing = this.editing;
    if (editing === null) return;
    if (this.#textTimer !== null) clearTimeout(this.#textTimer);
    this.#textTimer = null;
    this.editing = null;
    const connection = this.connection;
    const item = connection?.items().get(editing.id);
    if (connection === null || item === undefined || !hasText(item)) return;
    // A new text box that stays empty goes away, and so does its creation from the undo history.
    if (item.type === "text" && editing.draft.trim() === "") {
      connection.submit([{ op: "delete", id: item.id }]);
      if (editing.created !== null) this.history.forget(editing.created);
      this.#select([...this.selection].filter((id) => id !== item.id));
      return;
    }
    if (item.text !== editing.draft) connection.submit([{ op: "patch", id: item.id, set: this.#textFields(item, editing.draft) }]);
    if (editing.draft === editing.original) return;
    const before = { ...item, text: editing.original } as Item;
    const fields = this.#textFields(item, editing.draft);
    this.history.record({
      undo: [{ op: "patch", id: item.id, set: this.#textFields(before as typeof item, editing.original) }],
      redo: [{ op: "patch", id: item.id, set: fields }],
    });
  }

  // The fields that change with the text: a text box grows or shrinks to hold it.
  #textFields(item: Item, text: string): Record<string, unknown> {
    if (item.type === "text") return { text, h: textBoxHeight(text, item.w, item.size, this.measure) };
    return { text };
  }

  // --- Creating items ---------------------------------------------------------------------------

  #createSticky(at: Point): void {
    const item: Item = {
      id: randomId(),
      type: "sticky",
      z: this.#topZ() + 1,
      x: round(at.x - STICKY_SIZE / 2),
      y: round(at.y - STICKY_SIZE / 2),
      w: STICKY_SIZE,
      h: STICKY_SIZE,
      color: this.styles.sticky,
      text: "",
    };
    const entry = this.#commit([{ op: "put", item }]);
    this.tool = "select";
    this.startEditing(item.id, entry);
  }

  #createText(at: Point, text = ""): void {
    const size = this.styles.textSize;
    const item: TextItem = {
      id: randomId(),
      type: "text",
      z: this.#topZ() + 1,
      x: round(at.x),
      y: round(at.y - textBoxHeight("", TEXT_WIDTH, size, this.measure) / 2),
      w: TEXT_WIDTH,
      h: textBoxHeight(text, TEXT_WIDTH, size, this.measure),
      color: this.styles.ink,
      size,
      text,
    };
    const entry = this.#commit([{ op: "put", item }]);
    this.tool = "select";
    if (text === "") this.startEditing(item.id, entry);
    else this.#select([item.id]);
  }

  #creationGhost(): Item | null {
    const interaction = this.interaction;
    if (interaction?.kind === "shape") {
      const rect = this.#shapeRect(interaction.origin, interaction.current);
      return {
        id: "0000000000ghost0",
        type: "shape",
        z: this.#topZ() + 1,
        ...rect,
        shape: interaction.shape,
        stroke: this.styles.ink,
        fill: this.styles.fill,
        text: "",
      };
    }
    if (interaction?.kind === "line") return this.#lineFrom(interaction);
    if (interaction?.kind === "draw") return this.#penFrom(interaction.points, "0000000000ghost0");
    return null;
  }

  // A drag of less than a few pixels places a shape of the default size.
  #shapeRect(origin: Point, current: Point): Rect {
    if (distance(origin, current) * this.camera.zoom < DRAG_THRESHOLD_PX) {
      return { x: round(origin.x - SHAPE_SIZE.w / 2), y: round(origin.y - SHAPE_SIZE.h / 2), ...SHAPE_SIZE };
    }
    const rect = normalizeRect(origin, current);
    return { x: round(rect.x), y: round(rect.y), w: round(Math.max(MIN_SIZE, rect.w)), h: round(Math.max(MIN_SIZE, rect.h)) };
  }

  #lineFrom(interaction: Extract<Interaction, { kind: "line" }>, id = "0000000000ghost0"): LineItem {
    const end = (point: Point, item: string | null): Endpoint => ({ x: round(point.x), y: round(point.y), item });
    return {
      id,
      type: "line",
      z: this.#topZ() + 1,
      from: end(interaction.origin, interaction.fromItem),
      to: end(interaction.current, interaction.toItem),
      stroke: this.styles.ink,
      arrow: this.styles.arrow,
    };
  }

  #penFrom(points: number[], id: string): PenItem | null {
    if (points.length < 2) return null;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let index = 0; index < points.length; index += 2) {
      const x = points[index] ?? 0;
      const y = points[index + 1] ?? 0;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    return {
      id,
      type: "pen",
      z: this.#topZ() + 1,
      x: round(left),
      y: round(top),
      w: round(Math.max(MIN_SIZE, right - left)),
      h: round(Math.max(MIN_SIZE, bottom - top)),
      stroke: this.styles.ink,
      width: this.styles.penWidth,
      points: points.map((value, index) => round(value - (index % 2 === 0 ? left : top))),
    };
  }

  // --- Pointer ----------------------------------------------------------------------------------

  pointerDown(input: PointerInput): void {
    if (input.pointerType === "touch") {
      this.#touches.set(input.pointerId, input.screen);
      if (this.#touches.size === 2) {
        // A second finger turns whatever the first one did into a pinch.
        this.interaction = null;
        this.#startPinch();
        this.#changed();
        return;
      }
      if (this.#touches.size > 2) return;
    }
    const point = toBoard(this.camera, input.screen);
    if (this.editing !== null) this.#finishEditing();

    if (input.button === 1 || this.tool === "hand" || this.spaceDown) {
      this.interaction = { kind: "pan", pointerId: input.pointerId, origin: input.screen, camera: this.camera };
      this.#changed();
      return;
    }
    if (input.button !== 0) return;

    switch (this.tool) {
      case "select":
        this.#pressSelect(input, point);
        break;
      case "sticky":
        this.#createSticky(point);
        break;
      case "text":
        this.#createText(point);
        break;
      case "rect":
      case "ellipse":
      case "diamond":
        this.interaction = { kind: "shape", pointerId: input.pointerId, origin: point, current: point, shape: this.tool };
        break;
      case "line": {
        const from = this.itemAt(point, { boxesOnly: true });
        this.interaction = { kind: "line", pointerId: input.pointerId, origin: point, current: point, fromItem: from?.id ?? null, toItem: null };
        break;
      }
      case "pen":
        this.interaction = { kind: "draw", pointerId: input.pointerId, points: [round(point.x), round(point.y)] };
        break;
    }
    this.#sendPresence();
    this.#changed();
  }

  #pressSelect(input: PointerInput, point: Point): void {
    const handle = this.#handleAt(input.screen);
    if (handle !== null) {
      this.interaction = { ...handle, pointerId: input.pointerId };
      return;
    }
    const item = this.itemAt(point);
    if (item === null && input.pointerType === "touch") {
      // One finger on the paper moves the board, as on a map. A stylus or a mouse selects.
      this.interaction = { kind: "pan", pointerId: input.pointerId, origin: input.screen, camera: this.camera };
      this.#select([]);
      return;
    }
    if (item === null) {
      const base = input.shiftKey ? [...this.selection] : [];
      this.#select(base);
      this.interaction = { kind: "marquee", pointerId: input.pointerId, origin: point, current: point, base };
      return;
    }
    const wasSelected = this.selection.has(item.id);
    if (!wasSelected) this.#select(input.shiftKey ? [...this.selection, item.id] : [item.id]);
    this.interaction = { kind: "press", pointerId: input.pointerId, origin: point, screen: input.screen, id: item.id, shift: input.shiftKey, wasSelected };
  }

  // The corner of the one selected box, or the end of the one selected line, under the pointer.
  #handleAt(screen: Point): Interaction | null {
    const selected = this.selectedItems();
    const item = selected.length === 1 ? selected[0] : undefined;
    if (item === undefined) return null;
    const near = (point: Point) => distance(toScreen(this.camera, point), screen) <= HANDLE_HIT_PX;
    if (item.type === "line") {
      const ends = lineEnds(item, this.items());
      if (near(ends.to)) return { kind: "endpoint", pointerId: 0, end: "to", current: item };
      if (near(ends.from)) return { kind: "endpoint", pointerId: 0, end: "from", current: item };
      return null;
    }
    for (const handle of HANDLES) {
      if (near(handlePoint(boxOf(item), handle))) {
        return { kind: "resize", pointerId: 0, origin: toBoard(this.camera, screen), handle, original: item, current: item };
      }
    }
    return null;
  }

  pointerMove(input: PointerInput): void {
    if (this.#touches.has(input.pointerId)) {
      this.#touches.set(input.pointerId, input.screen);
      if (this.#pinch !== null) {
        this.#movePinch();
        return;
      }
    }
    const point = toBoard(this.camera, input.screen);
    this.cursor = point;
    const interaction = this.interaction;
    if (interaction === null) {
      this.#sendPresence();
      return;
    }
    if (interaction.pointerId !== input.pointerId) return;
    switch (interaction.kind) {
      case "pan": {
        const camera = interaction.camera;
        this.setCamera({
          ...camera,
          x: camera.x - (input.screen.x - interaction.origin.x) / camera.zoom,
          y: camera.y - (input.screen.y - interaction.origin.y) / camera.zoom,
        });
        return;
      }
      case "press": {
        if (distance(input.screen, interaction.screen) < DRAG_THRESHOLD_PX) return;
        const ids = [...this.selection];
        this.interaction = { kind: "move", pointerId: interaction.pointerId, origin: interaction.origin, ids, dx: 0, dy: 0 };
        this.pointerMove(input);
        return;
      }
      case "move":
        this.interaction = { ...interaction, dx: round(point.x - interaction.origin.x), dy: round(point.y - interaction.origin.y) };
        break;
      case "marquee": {
        const rect = normalizeRect(interaction.origin, point);
        const display = this.display();
        const current = this.items();
        const inside = display.items
          .filter((item) => current.has(item.id) && intersects(boundsOf(item, display.byId), rect))
          .map((item) => item.id);
        this.interaction = { ...interaction, current: point };
        this.selection = new Set([...interaction.base, ...inside]);
        break;
      }
      case "resize":
        this.interaction = { ...interaction, current: this.#resized(interaction, point, input.shiftKey) };
        break;
      case "endpoint": {
        const target = this.itemAt(point, { boxesOnly: true, exclude: interaction.current.id });
        const end: Endpoint = { x: round(point.x), y: round(point.y), item: target?.id ?? null };
        this.interaction = { ...interaction, current: { ...interaction.current, [interaction.end]: end } };
        break;
      }
      case "shape":
        this.interaction = { ...interaction, current: point };
        break;
      case "line": {
        const target = this.itemAt(point, { boxesOnly: true });
        this.interaction = { ...interaction, current: point, toItem: target !== null && target.id !== interaction.fromItem ? target.id : null };
        break;
      }
      case "draw": {
        const points = interaction.points;
        const last = { x: points.at(-2) ?? point.x, y: points.at(-1) ?? point.y };
        // Points closer than a pixel or two on the screen add nothing to the stroke.
        if (distance(last, point) * this.camera.zoom >= 2) {
          this.interaction = { ...interaction, points: [...points, round(point.x), round(point.y)] };
        }
        break;
      }
    }
    this.#sendPresence();
    this.#changed();
  }

  #resized(interaction: Extract<Interaction, { kind: "resize" }>, point: Point, free: boolean): BoxItem {
    const original = interaction.original;
    // Notes and images keep their proportions, unless Shift is down.
    const keepRatio = (original.type === "sticky" || original.type === "image") !== free;
    const rect = resizeBox(boxOf(original), interaction.handle, point.x - interaction.origin.x, point.y - interaction.origin.y, keepRatio, 8);
    switch (original.type) {
      case "pen":
        return fitPen(original, rect);
      case "text":
        // A text box takes the width, and its text decides the height.
        return { ...original, x: rect.x, w: rect.w, h: textBoxHeight(original.text, rect.w, original.size, this.measure) };
      default:
        return { ...original, ...rect };
    }
  }

  pointerUp(input: PointerInput): void {
    if (this.#touches.has(input.pointerId)) {
      this.#touches.delete(input.pointerId);
      if (this.#pinch !== null) {
        if (this.#touches.size < 2) this.#pinch = null;
        return;
      }
    }
    const interaction = this.interaction;
    if (interaction === null || interaction.pointerId !== input.pointerId) return;
    this.interaction = null;
    switch (interaction.kind) {
      case "press":
        // A click on a selected item selects it alone, and with Shift, leaves it out.
        if (interaction.wasSelected) {
          if (interaction.shift) this.#select([...this.selection].filter((id) => id !== interaction.id));
          else if (this.selection.size > 1) this.#select([interaction.id]);
        }
        break;
      case "move": {
        if (interaction.dx === 0 && interaction.dy === 0) break;
        const items = this.items();
        const ops = interaction.ids.flatMap((id) => {
          const item = items.get(id);
          return item === undefined ? [] : this.#moveOps(item, interaction.dx, interaction.dy);
        });
        this.#commit(ops);
        break;
      }
      case "resize": {
        const { current, original } = interaction;
        if (current === original) break;
        const set: Record<string, unknown> = { x: current.x, y: current.y, w: current.w, h: current.h };
        if (current.type === "pen") set["points"] = current.points;
        this.#commit([{ op: "patch", id: current.id, set }]);
        break;
      }
      case "endpoint":
        this.#commit([{ op: "patch", id: interaction.current.id, set: { [interaction.end]: interaction.current[interaction.end] } }]);
        break;
      case "shape": {
        const rect = this.#shapeRect(interaction.origin, interaction.current);
        const item: Item = { id: randomId(), type: "shape", z: this.#topZ() + 1, ...rect, shape: interaction.shape, stroke: this.styles.ink, fill: this.styles.fill, text: "" };
        this.#commit([{ op: "put", item }]);
        this.tool = "select";
        this.#select([item.id]);
        break;
      }
      case "line": {
        if (distance(interaction.origin, interaction.current) * this.camera.zoom < DRAG_THRESHOLD_PX * 2) break;
        const item = this.#lineFrom(interaction, randomId());
        this.#commit([{ op: "put", item }]);
        this.tool = "select";
        this.#select([item.id]);
        break;
      }
      case "draw": {
        const item = this.#penFrom(interaction.points, randomId());
        if (item !== null) this.#commit([{ op: "put", item }]);
        break;
      }
      case "pan":
      case "marquee":
        break;
    }
    this.#sendPresence();
    this.#changed();
  }

  /** The pointer left the board, or the browser took it away. */
  pointerCancel(input: PointerInput): void {
    this.#touches.delete(input.pointerId);
    if (this.#touches.size < 2) this.#pinch = null;
    this.interaction = null;
    this.cursor = null;
    this.#sendPresence();
    this.#changed();
  }

  pointerLeave(): void {
    if (this.interaction !== null) return;
    this.cursor = null;
    this.#sendPresence();
  }

  doubleClick(screen: Point): void {
    const item = this.itemAt(toBoard(this.camera, screen));
    if (item !== null && hasText(item)) this.startEditing(item.id);
  }

  /** A turn of the wheel scrolls the board; with Ctrl or Cmd, or a pinch on a trackpad, it zooms. */
  wheel(input: { screen: Point; deltaX: number; deltaY: number; zoom: boolean }): void {
    if (input.zoom) {
      const delta = Math.max(-50, Math.min(50, input.deltaY));
      this.setCamera(zoomAt(this.camera, input.screen, this.camera.zoom * Math.exp(-delta * 0.01)));
      return;
    }
    this.setCamera({ ...this.camera, x: this.camera.x + input.deltaX / this.camera.zoom, y: this.camera.y + input.deltaY / this.camera.zoom });
  }

  #startPinch(): void {
    const [a, b] = [...this.#touches.values()];
    if (a === undefined || b === undefined) return;
    this.#pinch = { distance: Math.max(1, distance(a, b)), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, camera: this.camera };
  }

  #movePinch(): void {
    const pinch = this.#pinch;
    const [a, b] = [...this.#touches.values()];
    if (pinch === null || a === undefined || b === undefined) return;
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const zoomed = zoomAt(pinch.camera, pinch.middle, (pinch.camera.zoom * distance(a, b)) / pinch.distance);
    this.setCamera({ ...zoomed, x: zoomed.x - (middle.x - pinch.middle.x) / zoomed.zoom, y: zoomed.y - (middle.y - pinch.middle.y) / zoomed.zoom });
  }

  /** The topmost item under a board point, or null. */
  itemAt(point: Point, options: { boxesOnly?: boolean; exclude?: string } = {}): Item | null {
    const display = this.display();
    const current = this.items();
    const tolerance = HIT_PX / this.camera.zoom;
    for (let index = display.items.length - 1; index >= 0; index -= 1) {
      const item = display.items[index];
      // Items that someone is still drawing are not on the board yet.
      if (item === undefined || item.id === options.exclude || !current.has(item.id)) continue;
      if (item.type === "line") {
        if (options.boxesOnly === true) continue;
        const ends = lineEnds(item, display.byId);
        if (segmentDistance(point, ends.from, ends.to) <= tolerance) return item;
        continue;
      }
      if (item.type === "pen" && options.boxesOnly !== true) {
        if (penDistance(point, item) <= tolerance + item.width / 2) return item;
        continue;
      }
      if (insideBox(item, point, tolerance)) return item;
    }
    return null;
  }

  // --- Keyboard and clipboard -------------------------------------------------------------------

  /** Handles a key on the board, and answers whether it did something with it. */
  keyDown(event: { key: string; code: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; repeat: boolean }): boolean {
    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (event.code === "Space" && !command) {
      this.spaceDown = true;
      this.#changed();
      return true;
    }
    if (command) {
      if (key === "z" && !event.shiftKey) this.undo();
      else if ((key === "z" && event.shiftKey) || key === "y") this.redo();
      else if (key === "a") this.selectAll();
      else if (key === "d") this.duplicateSelection();
      else if (key === "=" || key === "+") this.zoomBy(1.25);
      else if (key === "-") this.zoomBy(0.8);
      else if (key === "0") this.zoomTo(1);
      else return false;
      this.#changed();
      return true;
    }
    if (event.altKey) return false;
    switch (key) {
      case "delete":
      case "backspace":
        this.deleteSelection();
        break;
      case "escape":
        this.interaction = null;
        if (this.tool !== "select") this.tool = "select";
        else this.#select([]);
        break;
      case "enter": {
        const [only] = this.selectedItems();
        if (this.selection.size !== 1 || only === undefined || !hasText(only)) return false;
        this.startEditing(only.id);
        break;
      }
      case "arrowleft":
      case "arrowright":
      case "arrowup":
      case "arrowdown": {
        if (this.selection.size === 0) return false;
        const step = event.shiftKey ? NUDGE_FAR : NUDGE;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        this.nudge(dx, dy);
        break;
      }
      case "!":
        this.zoomToFit();
        break;
      case ")":
        this.zoomTo(1);
        break;
      default: {
        if (event.shiftKey && event.code === "Digit1") {
          this.zoomToFit();
          break;
        }
        const tool = TOOL_KEYS[key];
        if (tool === undefined || event.repeat) return false;
        this.setTool(tool);
        return true;
      }
    }
    this.#changed();
    return true;
  }

  keyUp(event: { code: string }): void {
    if (event.code === "Space" && this.spaceDown) {
      this.spaceDown = false;
      this.#changed();
    }
  }

  /** The text that a copy puts on the clipboard: the selected items, which a paste in any board reads. */
  copySelection(): string | null {
    const items = this.#withDrawnEnds(this.selectedItems());
    if (items.length === 0) return null;
    return JSON.stringify({ kind: CLIPBOARD_KIND, items });
  }

  // Lines with the points of their ends where the board draws them, so that a copy of a line
  // whose item stays behind starts where the line was.
  #withDrawnEnds(items: Item[]): Item[] {
    const all = this.items();
    return items.map((item) => {
      if (item.type !== "line") return item;
      const ends = lineEnds(item, all);
      return {
        ...item,
        from: { ...item.from, x: round(ends.from.x), y: round(ends.from.y) },
        to: { ...item.to, x: round(ends.to.x), y: round(ends.to.y) },
      };
    });
  }

  cutSelection(): string | null {
    const text = this.copySelection();
    if (text !== null) this.deleteSelection();
    return text;
  }

  /** Pastes what a copy put on the clipboard, or adds plain text as a text box. */
  pasteText(text: string): void {
    let items: Item[] | null = null;
    try {
      const value = JSON.parse(text) as { kind?: unknown; items?: unknown };
      if (value.kind === CLIPBOARD_KIND && Array.isArray(value.items)) items = value.items as Item[];
    } catch {
      items = null;
    }
    if (items === null) {
      if (text.trim() !== "") this.#createText(this.#placementPoint(), text);
      this.#changed();
      return;
    }
    // The copies land around the pointer, or a little off the originals when the pointer is away.
    const bounds = unionOf(items.map((item) => boundsOf(item, new Map(items.map((each) => [each.id, each])))));
    const at = this.cursor ?? this.#placementPoint();
    const offset = bounds === null ? { x: PASTE_OFFSET, y: PASTE_OFFSET } : { x: at.x - (bounds.x + bounds.w / 2), y: at.y - (bounds.y + bounds.h / 2) };
    this.#pasteItems(items, offset);
  }

  // Adds copies of items with new IDs. A line that followed a copied item follows its copy.
  #pasteItems(items: readonly Item[], offset: Point): void {
    if (items.length === 0) return;
    const ids = new Map(items.map((item) => [item.id, randomId()]));
    const top = this.#topZ();
    const copies = this.#inDrawingOrder([...items]).map((item, index): Item => {
      const id = ids.get(item.id) ?? randomId();
      if (item.type !== "line") {
        const moved = translateItem(item, round(offset.x), round(offset.y));
        return { ...moved, id, z: top + 1 + index };
      }
      const end = (endpoint: Endpoint): Endpoint => {
        const follows = endpoint.item === null ? undefined : ids.get(endpoint.item);
        return { x: round(endpoint.x + offset.x), y: round(endpoint.y + offset.y), item: follows ?? null };
      };
      return { ...item, id, z: top + 1 + index, from: end(item.from), to: end(item.to) };
    });
    this.#commit(copies.map((item) => ({ op: "put", item })));
    this.#select(copies.map((item) => item.id));
    this.#changed();
  }

  /** Uploads images, and adds each one to the board where it was dropped, or in the middle of the view. */
  async addImages(files: readonly File[], screen?: Point): Promise<void> {
    let at = screen === undefined ? this.#placementPoint() : toBoard(this.camera, screen);
    for (const file of files) {
      try {
        const [asset, size] = await Promise.all([this.#events.uploadImage(file), imageSize(file)]);
        const scale = Math.min(1, IMAGE_MAX_PX / this.camera.zoom / Math.max(size.width, size.height));
        const w = round(Math.max(MIN_SIZE, size.width * scale));
        const h = round(Math.max(MIN_SIZE, size.height * scale));
        const item: Item = { id: randomId(), type: "image", z: this.#topZ() + 1, x: round(at.x - w / 2), y: round(at.y - h / 2), w, h, asset };
        this.#commit([{ op: "put", item }]);
        this.#select([item.id]);
        at = { x: at.x + PASTE_OFFSET, y: at.y + PASTE_OFFSET };
      } catch (error) {
        this.#events.error(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.#changed();
  }

  #placementPoint(): Point {
    return toBoard(this.camera, { x: this.viewport.width / 2, y: this.viewport.height / 2 });
  }

  // --- Presence ---------------------------------------------------------------------------------

  #sendPresence(): void {
    const connection = this.connection;
    if (connection === null) return;
    connection.setPresence(this.presence());
  }

  /** What the others see of this person now. */
  presence(): Presence {
    const interaction = this.interaction;
    const ghosts: Item[] = [];
    if (interaction?.kind === "resize") ghosts.push(interaction.current);
    if (interaction?.kind === "endpoint") ghosts.push(interaction.current);
    const ghost = this.#creationGhost();
    if (ghost !== null) ghosts.push({ ...ghost, id: `${this.connection?.me?.session.slice(0, 10) ?? "0000000000"}ghost0` });
    return {
      ...EMPTY_PRESENCE,
      cursor: this.cursor === null ? null : { x: round(this.cursor.x), y: round(this.cursor.y) },
      selection: [...this.selection],
      drag: interaction?.kind === "move" ? { ids: interaction.ids, dx: interaction.dx, dy: interaction.dy } : null,
      ghosts,
    };
  }
}

const TOOL_KEYS: Record<string, Tool> = { v: "select", h: "hand", n: "sticky", t: "text", r: "rect", o: "ellipse", d: "diamond", l: "line", p: "pen" };

export function handlePoint(rect: Rect, handle: Handle): Point {
  return {
    x: handle === "nw" || handle === "sw" ? rect.x : rect.x + rect.w,
    y: handle === "nw" || handle === "ne" ? rect.y : rect.y + rect.h,
  };
}

function insideBox(item: BoxItem, point: Point, tolerance: number): boolean {
  const a = item.w / 2 + tolerance;
  const b = item.h / 2 + tolerance;
  const dx = point.x - (item.x + item.w / 2);
  const dy = point.y - (item.y + item.h / 2);
  if (item.type === "shape" && item.shape === "ellipse") return (dx / a) ** 2 + (dy / b) ** 2 <= 1;
  if (item.type === "shape" && item.shape === "diamond") return Math.abs(dx) / a + Math.abs(dy) / b <= 1;
  return Math.abs(dx) <= a && Math.abs(dy) <= b;
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function penDistance(point: Point, item: PenItem): number {
  const points = item.points;
  let best = Infinity;
  for (let index = 0; index + 3 < points.length; index += 2) {
    const a = { x: item.x + (points[index] ?? 0), y: item.y + (points[index + 1] ?? 0) };
    const b = { x: item.x + (points[index + 2] ?? 0), y: item.y + (points[index + 3] ?? 0) };
    best = Math.min(best, segmentDistance(point, a, b));
  }
  if (points.length === 2) best = distance(point, { x: item.x + (points[0] ?? 0), y: item.y + (points[1] ?? 0) });
  return best;
}

async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function cameraKey(boardId: string): string {
  return `alcyone.camera.${boardId}`;
}

// Each board opens where this browser last left it.
function readSavedCamera(boardId: string): Camera | null {
  try {
    const value = JSON.parse(localStorage.getItem(cameraKey(boardId)) ?? "null") as unknown;
    if (typeof value !== "object" || value === null) return null;
    const { x, y, zoom } = value as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return null;
    return { x, y, zoom };
  } catch {
    return null;
  }
}

function saveCamera(boardId: string, camera: Camera): void {
  try {
    localStorage.setItem(cameraKey(boardId), JSON.stringify(camera));
  } catch {
    // A browser that keeps nothing opens the board at its fit again.
  }
}
