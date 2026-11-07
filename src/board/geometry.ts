// Positions on the board and on the screen, the boxes of items, and the ends of lines.
// The board has its own units: at a zoom of 1, one unit is one CSS pixel.

import { isBoxItem, type BoxItem, type Endpoint, type Item, type LineItem, type PenItem } from "../../shared/board.ts";
import type { Point } from "../../shared/protocol.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The part of the board that the screen shows: the board point at the top left corner, and the zoom. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export type Handle = "nw" | "ne" | "sw" | "se";
export const HANDLES: readonly Handle[] = ["nw", "ne", "sw", "se"];

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function toBoard(camera: Camera, screen: Point): Point {
  return { x: screen.x / camera.zoom + camera.x, y: screen.y / camera.zoom + camera.y };
}

export function toScreen(camera: Camera, board: Point): Point {
  return { x: (board.x - camera.x) * camera.zoom, y: (board.y - camera.y) * camera.zoom };
}

/** Zooms so that the board point under the screen point stays under it. */
export function zoomAt(camera: Camera, screen: Point, zoom: number): Camera {
  const anchor = toBoard(camera, screen);
  const next = clampZoom(zoom);
  return { zoom: next, x: anchor.x - screen.x / next, y: anchor.y - screen.y / next };
}

/** The camera that shows the whole rectangle in a viewport, with a margin, at most at a zoom of 1. */
export function fitCamera(rect: Rect, viewport: { width: number; height: number }, margin = 64): Camera {
  const width = Math.max(1, viewport.width - margin * 2);
  const height = Math.max(1, viewport.height - margin * 2);
  const zoom = clampZoom(Math.min(1, width / rect.w, height / rect.h));
  return {
    zoom,
    x: rect.x + rect.w / 2 - viewport.width / 2 / zoom,
    y: rect.y + rect.h / 2 - viewport.height / 2 / zoom,
  };
}

export function boxOf(item: BoxItem): Rect {
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

export function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The item that an end of a line follows, when it still exists and has a box. */
export function attachedItem(end: Endpoint, items: ReadonlyMap<string, Item>): BoxItem | null {
  if (end.item === null) return null;
  const item = items.get(end.item);
  return item !== undefined && isBoxItem(item) ? item : null;
}

/**
 * Where the two ends of a line are drawn. An end that follows an item sits on the outline of
 * the item, where a straight line toward the other end leaves it.
 */
export function lineEnds(line: LineItem, items: ReadonlyMap<string, Item>): { from: Point; to: Point } {
  const fromItem = attachedItem(line.from, items);
  const toItem = attachedItem(line.to, items);
  const fromAim = fromItem === null ? { x: line.from.x, y: line.from.y } : centerOf(boxOf(fromItem));
  const toAim = toItem === null ? { x: line.to.x, y: line.to.y } : centerOf(boxOf(toItem));
  return {
    from: fromItem === null ? fromAim : outlinePoint(fromItem, toAim),
    to: toItem === null ? toAim : outlinePoint(toItem, fromAim),
  };
}

/** The point where a ray from the center of an item toward `toward` leaves the item, a small gap outside it. */
export function outlinePoint(item: BoxItem, toward: Point, gap = 4): Point {
  const box = boxOf(item);
  const center = centerOf(box);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return center;
  const a = box.w / 2;
  const b = box.h / 2;
  let t: number;
  if (item.type === "shape" && item.shape === "ellipse") {
    t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  } else if (item.type === "shape" && item.shape === "diamond") {
    t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  } else {
    t = Math.min(dx === 0 ? Infinity : a / Math.abs(dx), dy === 0 ? Infinity : b / Math.abs(dy));
  }
  const length = Math.hypot(dx, dy);
  const extra = gap / length;
  return { x: center.x + dx * (t + extra), y: center.y + dy * (t + extra) };
}

/** The box that holds an item on the board. */
export function boundsOf(item: Item, items: ReadonlyMap<string, Item>): Rect {
  if (isBoxItem(item)) return boxOf(item);
  const { from, to } = lineEnds(item, items);
  return normalizeRect(from, to);
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function unionOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Moves an item. A line moves its free ends; an end that follows an item stays with it. */
export function translateItem(item: Item, dx: number, dy: number): Item {
  if (isBoxItem(item)) return { ...item, x: round(item.x + dx), y: round(item.y + dy) };
  const move = (end: Endpoint): Endpoint => (end.item === null ? { x: round(end.x + dx), y: round(end.y + dy), item: null } : end);
  return { ...item, from: move(item.from), to: move(item.to) };
}

/**
 * Resizes a box by dragging one of its corners by (dx, dy), with the opposite corner in
 * place. With keepRatio, the box keeps its proportions. No side gets shorter than `min`.
 */
export function resizeBox(rect: Rect, handle: Handle, dx: number, dy: number, keepRatio: boolean, min: number): Rect {
  const left = handle === "nw" || handle === "sw";
  const top = handle === "nw" || handle === "ne";
  let w = rect.w + (left ? -dx : dx);
  let h = rect.h + (top ? -dy : dy);
  if (keepRatio) {
    const scale = Math.max(w / rect.w, h / rect.h, min / rect.w, min / rect.h);
    w = rect.w * scale;
    h = rect.h * scale;
  } else {
    w = Math.max(min, w);
    h = Math.max(min, h);
  }
  return { x: round(left ? rect.x + rect.w - w : rect.x), y: round(top ? rect.y + rect.h - h : rect.y), w: round(w), h: round(h) };
}

/** A pen stroke in a new box, with its points stretched to fill it. */
export function fitPen(item: PenItem, rect: Rect): PenItem {
  const sx = rect.w / item.w;
  const sy = rect.h / item.h;
  return { ...item, ...rect, points: item.points.map((value, index) => round(value * (index % 2 === 0 ? sx : sy))) };
}

/** Rounds a position to a hundredth of a unit, which keeps the operations short. */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
