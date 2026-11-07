import { describe, expect, it } from "vitest";
import { BoardError } from "../shared/board.ts";
import { EMPTY_PRESENCE, MAX_MESSAGE_LENGTH, peerColor, peerName, readClientMessage } from "../shared/protocol.ts";

describe("readClientMessage", () => {
  it("reads a batch of operations", () => {
    const message = readClientMessage(JSON.stringify({ type: "ops", batch: "b1", ops: [{ op: "delete", id: "aaaaaaaaaaaaaaaa" }] }));
    expect(message).toEqual({ type: "ops", batch: "b1", ops: [{ op: "delete", id: "aaaaaaaaaaaaaaaa" }] });
  });

  it("reads a presence", () => {
    const presence = { cursor: { x: 1, y: 2 }, selection: ["aaaaaaaaaaaaaaaa"], drag: { ids: ["aaaaaaaaaaaaaaaa"], dx: 3, dy: 4 }, ghosts: [] };
    expect(readClientMessage(JSON.stringify({ type: "presence", presence }))).toEqual({ type: "presence", presence });
    expect(readClientMessage(JSON.stringify({ type: "presence", presence: EMPTY_PRESENCE }))).toEqual({ type: "presence", presence: EMPTY_PRESENCE });
  });

  it("refuses what is not a message", () => {
    expect(() => readClientMessage("not json")).toThrow(BoardError);
    expect(() => readClientMessage(JSON.stringify({ type: "shout" }))).toThrow(/unknown type/);
    expect(() => readClientMessage(JSON.stringify({ type: "ops", batch: "B!", ops: [] }))).toThrow(/batch/);
    expect(() => readClientMessage(JSON.stringify({ type: "presence", presence: { ...EMPTY_PRESENCE, selection: ["x"] } }))).toThrow(/IDs/);
    expect(() => readClientMessage("x".repeat(MAX_MESSAGE_LENGTH + 1))).toThrow(/at most/);
  });
});

describe("people", () => {
  it("names a person by the part of the email before the @", () => {
    expect(peerName("ada.lovelace@example.com")).toBe("ada.lovelace");
  });

  it("gives a person the same color every time", () => {
    expect(peerColor("ada@example.com")).toBe(peerColor("ada@example.com"));
    expect(peerColor("ada@example.com")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
