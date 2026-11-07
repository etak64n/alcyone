// What floats over the board in screen pixels: the text field of the item being edited,
// the cursors of the others, and who is on the board.

import { useEffect, useRef } from "react";
import { hasText } from "../../shared/board.ts";
import { Avatar } from "../components/Avatar.tsx";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { INK } from "./colors.ts";
import type { Editor } from "./editor.ts";
import { toScreen } from "./geometry.ts";
import { BOARD_FONT, fitText, LINE_HEIGHT, MIN_TEXT_SIZE, PADDING, SHAPE_MAX_SIZE, stickyMaxSize, TEXT_PX, textBoxHeight, wrapText } from "./text.ts";

/**
 * The text field over the item being edited. It has the size of the item in board units,
 * scaled by the zoom, so the text lines up with the item as the board draws it.
 */
export function TextEditor({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const editing = editor.editing;
  const id = editing?.id;

  useEffect(() => {
    const field = ref.current;
    if (field === null) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [id]);

  if (editing === null) return null;
  const item = editor.display().byId.get(editing.id);
  if (item === undefined || !hasText(item)) return null;
  const draft = editing.draft;
  const measure = editor.measure;
  const camera = editor.camera;
  const corner = toScreen(camera, { x: item.x, y: item.y });

  let size: number;
  let height = item.h;
  let paddingTop: number;
  const pad = PADDING[item.type];
  if (item.type === "text") {
    size = TEXT_PX[item.size];
    height = textBoxHeight(draft, item.w, item.size, measure);
    paddingTop = pad;
  } else {
    // A note or a shape fits its text, smaller as it grows, as the board draws it.
    const inset = item.type === "shape" && item.shape !== "rect" ? 0.15 : 0;
    const width = Math.max(1, item.w * (1 - inset * 2) - pad * 2);
    const room = Math.max(1, item.h * (1 - inset * 2) - pad * 2);
    const max = item.type === "sticky" ? stickyMaxSize(item.h) : SHAPE_MAX_SIZE;
    const fitted = fitText(draft === "" ? " " : draft, width, room, max, MIN_TEXT_SIZE, measure);
    size = fitted.size;
    const lines = Math.max(1, wrapText(draft, width, size, measure).length);
    paddingTop = Math.max(pad, (item.h - lines * size * LINE_HEIGHT) / 2);
  }
  const horizontal = item.type === "shape" && item.shape !== "rect" ? item.w * 0.15 + pad : pad;

  return (
    <textarea
      ref={ref}
      aria-label="Text"
      value={draft}
      spellCheck={false}
      onChange={(event) => editor.setDraft(event.target.value)}
      onBlur={() => editor.finishEditing()}
      onKeyDown={(event) => {
        // The keys of the board wait while the text takes the keyboard.
        event.stopPropagation();
        if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
          event.preventDefault();
          editor.finishEditing();
        }
      }}
      className="absolute m-0 resize-none overflow-hidden border-0 bg-transparent outline-none"
      style={{
        left: corner.x,
        top: corner.y,
        width: item.w,
        height,
        transform: `scale(${camera.zoom})`,
        transformOrigin: "0 0",
        padding: `${paddingTop}px ${horizontal}px 0`,
        fontFamily: BOARD_FONT,
        fontSize: size,
        lineHeight: LINE_HEIGHT,
        color: item.type === "text" ? INK[item.color] : "#1f2328",
        textAlign: item.type === "text" ? "left" : "center",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        caretColor: "#1c7ed6",
      }}
    />
  );
}

/** The pointer of each other person, with their name. */
export function Cursors({ editor }: { editor: Editor }) {
  const peers = [...(editor.connection?.peers.values() ?? [])];
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {peers.map((peer) => {
        const cursor = peer.presence.cursor;
        if (cursor === null) return null;
        const point = toScreen(editor.camera, cursor);
        return (
          <div key={peer.session} className="absolute top-0 left-0 transition-transform duration-75 ease-linear" style={{ transform: `translate(${point.x}px, ${point.y}px)` }}>
            <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
              <path d="M1 1 L1 15 L5 11 L8.5 17 L11 15.8 L7.6 10 L13 10 Z" fill={peer.color} stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span className="absolute top-4 left-3 rounded-sm px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-white" style={{ background: peer.color }}>
              {peer.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// More people than this show as a count after the first ones.
const MAX_AVATARS = 5;

/** Who else is on the board: each person once, however many tabs they have open. */
export function People({ editor }: { editor: Editor }) {
  const me = editor.connection?.me ?? null;
  const people = new Map<string, { name: string; color: string }>();
  for (const peer of editor.connection?.peers.values() ?? []) {
    if (peer.email !== me?.email) people.set(peer.email, { name: peer.name, color: peer.color });
  }
  const shown = [...people.entries()].slice(0, MAX_AVATARS);
  const more = people.size - shown.length;
  if (people.size === 0) return null;
  return (
    <div className="flex items-center -space-x-1.5" aria-label="People on this board">
      {shown.map(([email, person]) => (
        <Tooltip key={email} label={`${person.name} (${email})`} side="bottom">
          <span className="rounded-full ring-2 ring-surface">
            <Avatar name={person.name} color={person.color} />
          </span>
        </Tooltip>
      ))}
      {more > 0 && <span className="grid size-7 place-items-center rounded-full bg-surface-subdued text-xs font-bold text-control ring-2 ring-surface">+{more}</span>}
    </div>
  );
}
