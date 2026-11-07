import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Item, LineItem, Op, StickyItem } from "../shared/board.ts";
import type { Peer } from "../shared/protocol.ts";
import { Editor, type PointerInput } from "../src/board/editor.ts";
import { socketFactory, type ClientSocket } from "./support/client-socket.ts";

const ME: Peer = { session: "session000000001", email: "ada@example.com", name: "ada", color: "#e03131" };
const NOTE_A = "aaaaaaaaaaaaaaaa";
const NOTE_B = "bbbbbbbbbbbbbbbb";
const LINE = "llllllllllllllll";
const note = (id: string, overrides: Partial<StickyItem> = {}): StickyItem => ({ id, type: "sticky", z: 1, x: 0, y: 0, w: 100, h: 100, color: "yellow", text: "", ...overrides });
const line: LineItem = { id: LINE, type: "line", z: 3, from: { x: 100, y: 50, item: NOTE_A }, to: { x: 300, y: 50, item: NOTE_B }, stroke: "black", arrow: "end" };

// Each character is half as wide as the size of the text.
const measure = (text: string, size: number) => text.length * size * 0.5;

function open(items: Item[] = []) {
  const factory = socketFactory();
  const errors: string[] = [];
  const editor = new Editor({
    boardId: "board00000000001",
    socketUrl: "wss://boards.example.com/api/boards/board00000000001/socket",
    createSocket: factory.create,
    measure,
    events: { error: (message) => errors.push(message), uploadImage: async () => "0123456789abcdef" },
  });
  editor.setViewport(1000, 800);
  editor.start();
  const socket = factory.sockets[0] as ClientSocket;
  socket.receive({ type: "welcome", board: { id: "board00000000001", name: "Plan" }, you: ME, peers: [], items, seq: 1 });
  // A camera with the board origin at the top left and a zoom of 1, so that screen and board points match.
  editor.setCamera({ x: 0, y: 0, zoom: 1 });
  const sentOps = (): Op[] => {
    vi.advanceTimersByTime(20);
    return socket.messages("ops").flatMap((message) => message["ops"] as Op[]);
  };
  return { editor, socket, sentOps, errors };
}

const pointer = (x: number, y: number, overrides: Partial<PointerInput> = {}): PointerInput => ({
  pointerId: 1,
  screen: { x, y },
  button: 0,
  pointerType: "mouse",
  shiftKey: false,
  ...overrides,
});

function drag(editor: Editor, from: [number, number], to: [number, number], overrides: Partial<PointerInput> = {}): void {
  editor.pointerDown(pointer(from[0], from[1], overrides));
  editor.pointerMove(pointer((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, overrides));
  editor.pointerMove(pointer(to[0], to[1], overrides));
  editor.pointerUp(pointer(to[0], to[1], overrides));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Editor", () => {
  it("places a note where the pointer goes down, and writes its text", () => {
    const { editor, sentOps } = open();
    editor.setTool("sticky");
    editor.pointerDown(pointer(300, 300));
    expect(editor.editing).not.toBeNull();
    expect(editor.tool).toBe("select");
    const [put] = sentOps();
    expect(put).toMatchObject({ op: "put", item: { type: "sticky", x: 200, y: 200, w: 200, h: 200 } });
    editor.setDraft("Hello");
    vi.advanceTimersByTime(500);
    editor.finishEditing();
    const id = (put as { item: Item }).item.id;
    expect(editor.items().get(id)).toMatchObject({ text: "Hello" });
    // One undo takes back the text, the next one the note.
    editor.undo();
    expect(editor.items().get(id)).toMatchObject({ text: "" });
    editor.undo();
    expect(editor.items().has(id)).toBe(false);
  });

  it("drops a new text box that stays empty, and its creation from the undo history", () => {
    const { editor } = open();
    editor.setTool("text");
    editor.pointerDown(pointer(100, 100));
    const id = editor.editing?.id ?? "";
    expect(editor.items().has(id)).toBe(true);
    editor.finishEditing();
    expect(editor.items().has(id)).toBe(false);
    expect(editor.history.canUndo).toBe(false);
  });

  it("grows a text box with its text", () => {
    const { editor } = open();
    editor.setTool("text");
    editor.pointerDown(pointer(0, 0));
    const id = editor.editing?.id ?? "";
    const height = editor.items().get(id)?.type === "text" ? (editor.items().get(id) as { h: number }).h : 0;
    editor.setDraft("word ".repeat(40));
    editor.finishEditing();
    expect((editor.items().get(id) as { h: number }).h).toBeGreaterThan(height);
  });

  it("selects an item with a click and moves it with a drag", () => {
    const { editor, sentOps } = open([note(NOTE_A, { x: 0, y: 0 })]);
    drag(editor, [50, 50], [150, 90]);
    expect([...editor.selection]).toEqual([NOTE_A]);
    expect(sentOps()).toContainEqual({ op: "patch", id: NOTE_A, set: { x: 100, y: 40 } });
    editor.undo();
    expect(editor.items().get(NOTE_A)).toMatchObject({ x: 0, y: 0 });
    editor.redo();
    expect(editor.items().get(NOTE_A)).toMatchObject({ x: 100, y: 40 });
  });

  it("shows a drag to the others before it ends", () => {
    const { editor, socket } = open([note(NOTE_A)]);
    editor.pointerDown(pointer(50, 50));
    editor.pointerMove(pointer(90, 50));
    vi.advanceTimersByTime(60);
    const presence = socket.messages("presence").at(-1)?.["presence"] as { drag: unknown };
    expect(presence.drag).toEqual({ ids: [NOTE_A], dx: 40, dy: 0 });
  });

  it("selects with a rectangle the items that it touches", () => {
    const { editor } = open([note(NOTE_A, { x: 0, y: 0 }), note(NOTE_B, { x: 400, y: 0 })]);
    drag(editor, [150, -50], [450, 50]);
    expect([...editor.selection]).toEqual([NOTE_B]);
  });

  it("frees the ends of the lines that followed a deleted item, where they were drawn", () => {
    const { editor, sentOps } = open([note(NOTE_A, { x: 0, y: 0 }), note(NOTE_B, { x: 300, y: 0 }), line]);
    editor.pointerDown(pointer(350, 50));
    editor.pointerUp(pointer(350, 50));
    editor.deleteSelection();
    const ops = sentOps();
    expect(ops.at(-1)).toEqual({ op: "delete", id: NOTE_B });
    const patch = ops.find((op) => op.op === "patch" && op.id === LINE) as { set: { to: { item: string | null; x: number } } } | undefined;
    expect(patch?.set.to.item).toBeNull();
    // The end stays on the left side of the note that went away, a small gap outside it.
    expect(patch?.set.to.x).toBeCloseTo(296, 0);
  });

  it("duplicates items, and the copy of a line follows the copies of its items", () => {
    const { editor } = open([note(NOTE_A, { x: 0, y: 0 }), note(NOTE_B, { x: 300, y: 0 }), line]);
    editor.selectAll();
    editor.duplicateSelection();
    const copies = [...editor.selection].map((id) => editor.items().get(id) as Item);
    expect(copies).toHaveLength(3);
    const copiedLine = copies.find((item) => item.type === "line") as LineItem;
    const copiedIds = new Set(copies.map((item) => item.id));
    expect(copiedIds.has(copiedLine.from.item ?? "")).toBe(true);
    expect(copiedIds.has(copiedLine.to.item ?? "")).toBe(true);
    expect(copiedIds.has(NOTE_A)).toBe(false);
  });

  it("draws a line that joins the items at its ends", () => {
    const { editor } = open([note(NOTE_A, { x: 0, y: 0 }), note(NOTE_B, { x: 300, y: 0 })]);
    editor.setTool("line");
    drag(editor, [50, 50], [350, 50]);
    const [id] = [...editor.selection];
    expect(editor.items().get(id ?? "")).toMatchObject({ type: "line", from: { item: NOTE_A }, to: { item: NOTE_B }, arrow: "end" });
  });

  it("resizes a note from a corner and keeps it square", () => {
    const { editor } = open([note(NOTE_A, { x: 0, y: 0, w: 100, h: 100 })]);
    editor.pointerDown(pointer(50, 50));
    editor.pointerUp(pointer(50, 50));
    drag(editor, [100, 100], [160, 130]);
    expect(editor.items().get(NOTE_A)).toMatchObject({ x: 0, y: 0, w: 160, h: 160 });
  });

  it("draws with the pen, and stays on the pen", () => {
    const { editor } = open();
    editor.setTool("pen");
    editor.pointerDown(pointer(10, 10));
    for (let x = 20; x <= 100; x += 10) editor.pointerMove(pointer(x, 10 + x / 2));
    editor.pointerUp(pointer(100, 60));
    const pens = [...editor.items().values()].filter((item) => item.type === "pen");
    expect(pens).toHaveLength(1);
    expect(pens[0]).toMatchObject({ x: 10, y: 10, w: 90, h: 50 });
    expect(editor.tool).toBe("pen");
  });

  it("changes the color of the selection and of the next note", () => {
    const { editor } = open([note(NOTE_A)]);
    editor.selectAll();
    editor.setStyle({ sticky: "pink" });
    expect(editor.items().get(NOTE_A)).toMatchObject({ color: "pink" });
    expect(editor.styles.sticky).toBe("pink");
  });

  it("pastes what it copied, around the pointer", () => {
    const { editor } = open([note(NOTE_A, { x: 0, y: 0 })]);
    editor.selectAll();
    const copied = editor.copySelection() ?? "";
    editor.pointerMove(pointer(500, 500));
    editor.pasteText(copied);
    const [pasted] = [...editor.selection];
    expect(pasted).not.toBe(NOTE_A);
    expect(editor.items().get(pasted ?? "")).toMatchObject({ x: 450, y: 450 });
  });

  it("pastes plain text as a text box", () => {
    const { editor } = open();
    editor.pasteText("Some words");
    const [id] = [...editor.selection];
    expect(editor.items().get(id ?? "")).toMatchObject({ type: "text", text: "Some words" });
  });

  it("answers the keys of the board", () => {
    const { editor } = open([note(NOTE_A)]);
    const key = (key: string, extra: Partial<{ code: string; shiftKey: boolean; metaKey: boolean }> = {}) =>
      editor.keyDown({ key, code: extra.code ?? "", shiftKey: extra.shiftKey ?? false, metaKey: extra.metaKey ?? false, ctrlKey: false, altKey: false, repeat: false });
    expect(key("n")).toBe(true);
    expect(editor.tool).toBe("sticky");
    expect(key("Escape")).toBe(true);
    expect(editor.tool).toBe("select");
    key("a", { metaKey: true });
    expect(editor.selection.size).toBe(1);
    key("ArrowRight", { shiftKey: true });
    expect(editor.items().get(NOTE_A)).toMatchObject({ x: 10 });
    key("z", { metaKey: true });
    expect(editor.items().get(NOTE_A)).toMatchObject({ x: 0 });
    key("Backspace");
    expect(editor.items().has(NOTE_A)).toBe(false);
    expect(key("q")).toBe(false);
  });

  it("zooms around the pointer, within the limits", () => {
    const { editor } = open();
    editor.wheel({ screen: { x: 200, y: 100 }, deltaX: 0, deltaY: -50, zoom: true });
    expect(editor.camera.zoom).toBeGreaterThan(1);
    // The board point under the pointer stays under it.
    expect(editor.camera.x + 200 / editor.camera.zoom).toBeCloseTo(200);
    for (let index = 0; index < 100; index += 1) editor.wheel({ screen: { x: 0, y: 0 }, deltaX: 0, deltaY: 50, zoom: true });
    expect(editor.camera.zoom).toBeCloseTo(0.1);
  });
});
