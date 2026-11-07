import { describe, expect, it } from "vitest";
import { fitText, LINE_HEIGHT, PADDING, TEXT_PX, textBoxHeight, wrapText } from "../src/board/text.ts";

// Each character is half as wide as the size of the text.
const measure = (text: string, size: number) => text.length * size * 0.5;

describe("wrapText", () => {
  it("breaks between words, and drops the spaces at the breaks", () => {
    // At size 10, a line of width 50 holds 10 characters.
    expect(wrapText("hello there world", 50, 10, measure)).toEqual(["hello", "there", "world"]);
    expect(wrapText("hi there", 50, 10, measure)).toEqual(["hi there"]);
  });

  it("breaks Japanese between any two characters", () => {
    expect(wrapText("日本語の文章を折り返す", 25, 10, measure)).toEqual(["日本語の文", "章を折り返", "す"]);
  });

  it("breaks a word that is longer than a line", () => {
    expect(wrapText("abcdefghijkl", 25, 10, measure)).toEqual(["abcde", "fghij", "kl"]);
  });

  it("keeps the line breaks of the text, and empty lines", () => {
    expect(wrapText("one\n\ntwo", 50, 10, measure)).toEqual(["one", "", "two"]);
  });
});

describe("fitText", () => {
  it("takes the largest size at which the text fits", () => {
    const fitted = fitText("short", 100, 100, 40, 6, measure);
    expect(fitted.size).toBe(40);
    const long = fitText("many words that need a smaller size to fit in the box", 100, 100, 40, 6, measure);
    expect(long.size).toBeLessThan(40);
    expect(long.lines.length * long.size * LINE_HEIGHT).toBeLessThanOrEqual(100);
  });

  it("stops at the smallest size", () => {
    expect(fitText("x".repeat(5_000), 50, 20, 40, 6, measure).size).toBe(6);
  });
});

describe("textBoxHeight", () => {
  it("holds every line of the text, with the padding", () => {
    const size = TEXT_PX.m;
    expect(textBoxHeight("", 240, "m", measure)).toBe(Math.ceil(size * LINE_HEIGHT + PADDING.text * 2));
    expect(textBoxHeight("word ".repeat(30), 240, "m", measure)).toBeGreaterThan(size * LINE_HEIGHT * 3);
  });
});
