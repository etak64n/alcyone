// The look of the selection, or of the next item of the tool in use, over the top of a
// board: colors, sizes, arrowheads, and the order and removal of the selected items.

import { BringToFront, Copy, Minus, MoveHorizontal, MoveRight, SendToBack, Trash2 } from "lucide-react";
import {
  ARROW_KINDS,
  FILL_COLORS,
  INK_COLORS,
  PEN_WIDTHS,
  STICKY_COLORS,
  TEXT_SIZES,
  type ArrowKind,
  type Item,
  type TextSize,
} from "../../shared/board.ts";
import type { ReactNode } from "react";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { cn } from "../lib/utils.ts";
import { FILL, INK, STICKY_FILL } from "./colors.ts";
import type { Editor, Styles } from "./editor.ts";

type Part = "sticky" | "ink" | "fill" | "size" | "arrow" | "width";

const SIZE_LABELS: Record<TextSize, string> = { s: "S", m: "M", l: "L", xl: "XL" };
const ARROW_LABELS: Record<ArrowKind, string> = { none: "No arrowheads", end: "Arrowhead at the end", both: "Arrowheads at both ends" };
const ARROW_ICONS = { none: Minus, end: MoveRight, both: MoveHorizontal } as const;

/** The parts of the look that the selected items have, or the item that the tool makes. */
function partsOf(items: Item[], tool: Editor["tool"]): Set<Part> {
  const parts = new Set<Part>();
  const types = items.length > 0 ? items.map((item) => item.type) : toolTypes(tool);
  for (const type of types) {
    if (type === "sticky") parts.add("sticky");
    if (type === "text") parts.add("ink").add("size");
    if (type === "shape") parts.add("ink").add("fill");
    if (type === "line") parts.add("ink").add("arrow");
    if (type === "pen") parts.add("ink").add("width");
  }
  return parts;
}

function toolTypes(tool: Editor["tool"]): Item["type"][] {
  if (tool === "sticky" || tool === "text" || tool === "line" || tool === "pen") return [tool];
  if (tool === "rect" || tool === "ellipse" || tool === "diamond") return ["shape"];
  return [];
}

// The value that every selected item shares, or the style of the next item when they differ.
function shared<T>(items: Item[], read: (item: Item) => T | undefined, fallback: T): T {
  const values = new Set(items.map(read).filter((value) => value !== undefined));
  return values.size === 1 ? ([...values][0] as T) : fallback;
}

export function StyleBar({ editor }: { editor: Editor }) {
  const items = editor.selectedItems();
  const parts = partsOf(items, editor.tool);
  if (parts.size === 0 && items.length === 0) return null;
  const styles = editor.styles;
  const set = (change: Partial<Styles>) => editor.setStyle(change);

  const sticky = shared(items, (item) => (item.type === "sticky" ? item.color : undefined), styles.sticky);
  const ink = shared(
    items,
    (item) => (item.type === "text" ? item.color : item.type === "shape" || item.type === "line" || item.type === "pen" ? item.stroke : undefined),
    styles.ink,
  );
  const fill = shared(items, (item) => (item.type === "shape" ? item.fill : undefined), styles.fill);
  const size = shared(items, (item) => (item.type === "text" ? item.size : undefined), styles.textSize);
  const arrow = shared(items, (item) => (item.type === "line" ? item.arrow : undefined), styles.arrow);
  const width = shared(items, (item) => (item.type === "pen" ? item.width : undefined), styles.penWidth);

  return (
    <div className="board-panel absolute top-3 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto p-1" role="toolbar" aria-label="Style">
      {parts.has("sticky") && (
        <Group label="Note color">
          {STICKY_COLORS.map((color) => (
            <Swatch key={color} label={color} color={STICKY_FILL[color]} selected={sticky === color} onClick={() => set({ sticky: color })} />
          ))}
        </Group>
      )}
      {parts.has("ink") && (
        <Group label="Color">
          {INK_COLORS.map((color) => (
            <Swatch key={color} label={color} color={INK[color]} selected={ink === color} onClick={() => set({ ink: color })} />
          ))}
        </Group>
      )}
      {parts.has("fill") && (
        <Group label="Fill">
          {FILL_COLORS.map((color) => (
            <Swatch key={color} label={color === "none" ? "No fill" : `${color} fill`} color={color === "none" ? null : FILL[color]} selected={fill === color} onClick={() => set({ fill: color })} />
          ))}
        </Group>
      )}
      {parts.has("size") && (
        <Group label="Text size">
          {TEXT_SIZES.map((value) => (
            <TextButton key={value} selected={size === value} onClick={() => set({ textSize: value })}>
              {SIZE_LABELS[value]}
            </TextButton>
          ))}
        </Group>
      )}
      {parts.has("arrow") && (
        <Group label="Arrowheads">
          {ARROW_KINDS.map((value) => {
            const Icon = ARROW_ICONS[value];
            return (
              <Tooltip key={value} label={ARROW_LABELS[value]} side="bottom">
                <button type="button" aria-label={ARROW_LABELS[value]} aria-pressed={arrow === value} onClick={() => set({ arrow: value })} className={choiceClass(arrow === value)}>
                  <Icon aria-hidden="true" />
                </button>
              </Tooltip>
            );
          })}
        </Group>
      )}
      {parts.has("width") && (
        <Group label="Pen width">
          {PEN_WIDTHS.map((value) => (
            <button key={value} type="button" aria-label={`Width ${value}`} aria-pressed={width === value} onClick={() => set({ penWidth: value })} className={choiceClass(width === value)}>
              <span className="rounded-full bg-current" style={{ width: value + 2, height: value + 2 }} />
            </button>
          ))}
        </Group>
      )}
      {items.length > 0 && (
        <Group label="Arrange">
          <Action label="Bring to front" onClick={() => editor.bringToFront()}>
            <BringToFront aria-hidden="true" />
          </Action>
          <Action label="Send to back" onClick={() => editor.sendToBack()}>
            <SendToBack aria-hidden="true" />
          </Action>
          <Action label="Duplicate" shortcut="⌘D" onClick={() => editor.duplicateSelection()}>
            <Copy aria-hidden="true" />
          </Action>
          <Action label="Delete" shortcut="⌫" onClick={() => editor.deleteSelection()}>
            <Trash2 aria-hidden="true" />
          </Action>
        </Group>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center gap-0.5 border-r border-hairline pr-1 last:border-r-0 last:pr-0">
      {children}
    </div>
  );
}

function choiceClass(selected: boolean): string {
  return cn(
    "grid size-8 cursor-pointer place-items-center rounded-sm text-control transition-colors duration-150 hover:bg-surface-hover [&_svg]:size-4",
    selected && "bg-accent-subtle text-accent hover:bg-accent-subtle",
  );
}

function Swatch({ label, color, selected, onClick }: { label: string; color: string | null; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} aria-pressed={selected} onClick={onClick} className={choiceClass(selected)}>
      <span
        className="relative block size-[18px] overflow-hidden rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]"
        style={{ background: color ?? "#ffffff" }}
      >
        {color === null && <span className="absolute top-1/2 left-[-2px] h-[1.5px] w-[22px] -rotate-45 bg-[#e03131]" />}
      </span>
    </button>
  );
}

function TextButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={cn(choiceClass(selected), "w-auto min-w-8 px-1 text-xs font-bold")}>
      {children}
    </button>
  );
}

function Action({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="bottom">
      <button type="button" aria-label={label} onClick={onClick} className={choiceClass(false)}>
        {children}
      </button>
    </Tooltip>
  );
}
