// The text of sticky notes, text boxes, and shapes: how it breaks into lines, and how
// large it may be. SVG draws text without breaking it, so the board breaks it here, with
// the widths that a canvas measures in the same font.

import type { TextSize } from "../../shared/board.ts";

/** The font of the board, the same on every item. */
export const BOARD_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, "Hiragino Sans", "Yu Gothic UI", "Meiryo UI", "Hiragino Kaku Gothic ProN", sans-serif';

export const LINE_HEIGHT = 1.3;

export const TEXT_PX: Record<TextSize, number> = { s: 14, m: 20, l: 32, xl: 48 };

/** The space between the box of an item and its text, in board units. */
export const PADDING = { sticky: 14, shape: 10, text: 4 } as const;

/** The width of a text at a size, in board units. */
export type Measure = (text: string, size: number) => number;

// Each CJK character, each run of other characters without spaces, and each run of spaces is
// one token. A line breaks between tokens, and inside a token that is longer than a line.
const CJK = "\\u2E80-\\u9FFF\\uAC00-\\uD7AF\\uF900-\\uFAFF\\uFF00-\\uFFEF";
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, "gu");
const SPACE = /^\s+$/;

// Text widths grow in step with the size, so the board measures every token once, at this size.
const BASE_SIZE = 100;

/** Measures with a canvas in the font of the board, and remembers each width. */
export function canvasMeasure(): Measure {
  const context = document.createElement("canvas").getContext("2d");
  const widths = new Map<string, number>();
  if (context !== null) context.font = `${BASE_SIZE}px ${BOARD_FONT}`;
  return (text, size) => {
    let width = widths.get(text);
    if (width === undefined) {
      // Without a canvas, half a size for each character is a fair guess.
      width = context === null ? text.length * BASE_SIZE * 0.55 : context.measureText(text).width;
      if (widths.size > 20_000) widths.clear();
      widths.set(text, width);
    }
    return (width * size) / BASE_SIZE;
  };
}

/** Breaks text into the lines that fit a width. A line break in the text always starts a new line. */
export function wrapText(text: string, width: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    let lineWidth = 0;
    const push = () => {
      lines.push(line.trimEnd());
      line = "";
      lineWidth = 0;
    };
    // Adds a token that is longer than a line, one character at a time.
    const addByCharacter = (token: string) => {
      for (const char of token) {
        const charWidth = measure(char, size);
        if (line !== "" && lineWidth + charWidth > width) push();
        line += char;
        lineWidth += charWidth;
      }
    };
    for (const token of paragraph.match(TOKEN) ?? []) {
      const tokenWidth = measure(token, size);
      if (lineWidth + tokenWidth <= width) {
        line += token;
        lineWidth += tokenWidth;
        continue;
      }
      if (SPACE.test(token)) {
        // Spaces at the end of a line do not carry over to the next one.
        if (line !== "") push();
        continue;
      }
      if (line !== "") push();
      if (tokenWidth > width) addByCharacter(token);
      else {
        line = token;
        lineWidth = tokenWidth;
      }
    }
    push();
  }
  return lines;
}

export interface FittedText {
  size: number;
  lines: string[];
}

const fits = new Map<string, FittedText>();

/**
 * The largest size from `max` down to `min` at which the text fits the box, and its lines.
 * Text that does not fit at `min` gets `min`, and the box cuts it off.
 */
export function fitText(text: string, width: number, height: number, max: number, min: number, measure: Measure): FittedText {
  const key = `${width}\u0000${height}\u0000${max}\u0000${text}`;
  const known = fits.get(key);
  if (known !== undefined) return known;
  let fitted: FittedText = { size: min, lines: wrapText(text, width, min, measure) };
  for (let size = max; size > min; size = Math.max(min, Math.floor(size * 0.9))) {
    const lines = wrapText(text, width, size, measure);
    if (lines.length * size * LINE_HEIGHT <= height) {
      fitted = { size, lines };
      break;
    }
  }
  if (fits.size > 5_000) fits.clear();
  fits.set(key, fitted);
  return fitted;
}

/** The largest text of a sticky note, which grows with the note. */
export function stickyMaxSize(height: number): number {
  return Math.max(10, Math.min(64, Math.round(height * 0.14)));
}

export const SHAPE_MAX_SIZE = 18;
export const MIN_TEXT_SIZE = 6;

/** The height of a text box that holds the text at a width. */
export function textBoxHeight(text: string, width: number, size: TextSize, measure: Measure): number {
  const px = TEXT_PX[size];
  const lines = wrapText(text, width - PADDING.text * 2, px, measure).length;
  return Math.ceil(Math.max(1, lines) * px * LINE_HEIGHT + PADDING.text * 2);
}
