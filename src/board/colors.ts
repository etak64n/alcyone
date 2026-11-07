// The colors that the names in the items stand for. The items keep names, not values, so
// that every browser draws a board alike. The board keeps a light paper in both themes,
// so that the colors look the same to everyone, whichever mode their device is in.

import type { FillColor, InkColor, StickyColor } from "../../shared/board.ts";

export const STICKY_FILL: Record<StickyColor, string> = {
  yellow: "#fff1a6",
  orange: "#ffd8a8",
  pink: "#ffc9de",
  violet: "#ded2ff",
  blue: "#cce4ff",
  green: "#cfefc4",
  gray: "#e4e7eb",
  white: "#ffffff",
};

export const INK: Record<InkColor, string> = {
  black: "#1f2328",
  gray: "#6b7280",
  red: "#e03131",
  orange: "#f76707",
  yellow: "#e0a800",
  green: "#2f9e44",
  blue: "#1c7ed6",
  violet: "#7048e8",
};

/** The tint of each ink color that fills a shape. */
export const FILL: Record<Exclude<FillColor, "none">, string> = {
  black: "#dee2e6",
  gray: "#f1f3f5",
  red: "#ffe3e3",
  orange: "#ffe8cc",
  yellow: "#fff3bf",
  green: "#d3f9d8",
  blue: "#d0ebff",
  violet: "#e5dbff",
};

/** The color of what the signed-in person selects. */
export const SELECTION = "#1c7ed6";

/** The paper of the board, and the dots on it. */
export const PAPER = "#f7f7f5";
export const PAPER_DOT = "#d5d7db";

export function fillOf(fill: FillColor): string {
  return fill === "none" ? "none" : FILL[fill];
}
