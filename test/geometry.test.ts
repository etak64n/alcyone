import { describe, expect, it } from "vitest";
import type { Item, LineItem, PenItem, ShapeItem, StickyItem } from "../shared/board.ts";
import { fitCamera, fitPen, lineEnds, outlinePoint, resizeBox, toBoard, toScreen, translateItem, zoomAt } from "../src/board/geometry.ts";

const box = (id: string, x: number, y: number): StickyItem => ({ id, type: "sticky", z: 0, x, y, w: 100, h: 100, color: "yellow", text: "" });

describe("camera", () => {
  it("turns screen points into board points and back", () => {
    const camera = { x: -100, y: 50, zoom: 2 };
    const board = toBoard(camera, { x: 40, y: 60 });
    expect(board).toEqual({ x: -80, y: 80 });
    expect(toScreen(camera, board)).toEqual({ x: 40, y: 60 });
  });

  it("keeps the board point under the pointer while it zooms", () => {
    const camera = { x: 10, y: 20, zoom: 1 };
    const screen = { x: 300, y: 200 };
    const before = toBoard(camera, screen);
    const after = toBoard(zoomAt(camera, screen, 3), screen);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAt(camera, screen, 100).zoom).toBe(4);
  });

  it("fits a rectangle in the middle of the view, at most at 100%", () => {
    const camera = fitCamera({ x: 0, y: 0, w: 100, h: 100 }, { width: 1000, height: 800 });
    expect(camera.zoom).toBe(1);
    expect(toScreen(camera, { x: 50, y: 50 })).toEqual({ x: 500, y: 400 });
    expect(fitCamera({ x: 0, y: 0, w: 10_000, h: 100 }, { width: 1000, height: 800 }).zoom).toBeLessThan(0.1 + 1e-9);
  });
});

describe("lines", () => {
  it("draws an end that follows an item on the outline of the item", () => {
    const items = new Map<string, Item>([
      ["aaaaaaaaaaaaaaaa", box("aaaaaaaaaaaaaaaa", 0, 0)],
      ["bbbbbbbbbbbbbbbb", box("bbbbbbbbbbbbbbbb", 300, 0)],
    ]);
    const line: LineItem = { id: "llllllllllllllll", type: "line", z: 1, from: { x: 0, y: 0, item: "aaaaaaaaaaaaaaaa" }, to: { x: 0, y: 0, item: "bbbbbbbbbbbbbbbb" }, stroke: "black", arrow: "end" };
    const ends = lineEnds(line, items);
    expect(ends.from.x).toBeCloseTo(104);
    expect(ends.to.x).toBeCloseTo(296);
    expect(ends.from.y).toBeCloseTo(50);
    // An end whose item went away stays where the line last had it.
    const free = lineEnds({ ...line, to: { x: 400, y: 70, item: "cccccccccccccccc" } }, items);
    expect(free.to).toEqual({ x: 400, y: 70 });
  });

  it("finds the outline of an ellipse and of a diamond", () => {
    const ellipse: ShapeItem = { id: "eeeeeeeeeeeeeeee", type: "shape", z: 0, x: 0, y: 0, w: 200, h: 100, shape: "ellipse", stroke: "black", fill: "none", text: "" };
    expect(outlinePoint(ellipse, { x: 100, y: 1000 }, 0)).toEqual({ x: 100, y: 100 });
    const diamond: ShapeItem = { ...ellipse, shape: "diamond" };
    const point = outlinePoint(diamond, { x: 1000, y: 1000 }, 0);
    // On the edge of the diamond: |dx| / 100 + |dy| / 50 = 1 from the center.
    expect(Math.abs(point.x - 100) / 100 + Math.abs(point.y - 50) / 50).toBeCloseTo(1);
  });

  it("moves the free ends of a line and leaves the ends that follow items", () => {
    const line: LineItem = { id: "llllllllllllllll", type: "line", z: 1, from: { x: 0, y: 0, item: null }, to: { x: 5, y: 5, item: "aaaaaaaaaaaaaaaa" }, stroke: "black", arrow: "none" };
    const moved = translateItem(line, 10, 20) as LineItem;
    expect(moved.from).toEqual({ x: 10, y: 20, item: null });
    expect(moved.to).toBe(line.to);
  });
});

describe("resizeBox", () => {
  it("moves the dragged corner and keeps the opposite one", () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, "nw", 10, 20, false, 8)).toEqual({ x: 10, y: 20, w: 90, h: 30 });
  });

  it("keeps the proportions when asked", () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, "se", 100, 0, true, 8)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it("keeps every side at least as long as the minimum", () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, "se", -500, -500, false, 8)).toEqual({ x: 0, y: 0, w: 8, h: 8 });
  });
});

describe("fitPen", () => {
  it("stretches the points of a stroke to its new box", () => {
    const pen: PenItem = { id: "pppppppppppppppp", type: "pen", z: 0, x: 0, y: 0, w: 10, h: 20, stroke: "black", width: 2, points: [0, 0, 10, 20] };
    expect(fitPen(pen, { x: 5, y: 5, w: 20, h: 10 }).points).toEqual([0, 0, 20, 10]);
  });
});
