// The tools along the left side of a board, and the buttons for undo, redo, and the zoom.

import {
  Circle,
  Diamond,
  Hand,
  ImagePlus,
  Maximize,
  Minus,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Plus,
  Redo2,
  Square,
  StickyNote,
  Type,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useRef } from "react";
import { ASSET_CONTENT_TYPES } from "../../shared/api.ts";
import { Tooltip } from "../components/ui/tooltip.tsx";
import { cn } from "../lib/utils.ts";
import type { Editor, Tool } from "./editor.ts";

const TOOLS: { tool: Tool; label: string; shortcut: string; icon: LucideIcon }[] = [
  { tool: "select", label: "Select", shortcut: "V", icon: MousePointer2 },
  { tool: "hand", label: "Hand", shortcut: "H", icon: Hand },
  { tool: "sticky", label: "Sticky note", shortcut: "N", icon: StickyNote },
  { tool: "text", label: "Text", shortcut: "T", icon: Type },
  { tool: "rect", label: "Rectangle", shortcut: "R", icon: Square },
  { tool: "ellipse", label: "Ellipse", shortcut: "O", icon: Circle },
  { tool: "diamond", label: "Diamond", shortcut: "D", icon: Diamond },
  { tool: "line", label: "Line", shortcut: "L", icon: MoveUpRight },
  { tool: "pen", label: "Pen", shortcut: "P", icon: Pencil },
];

const iconButton =
  "grid size-9 cursor-pointer place-items-center rounded-sm text-control transition-colors duration-150 hover:bg-surface-hover disabled:cursor-default disabled:text-placeholder disabled:hover:bg-transparent [&_svg]:size-[18px]";

export function Toolbar({ editor }: { editor: Editor }) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="board-panel absolute top-1/2 left-3 grid -translate-y-1/2 gap-0.5 p-1" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {TOOLS.map(({ tool, label, shortcut, icon: Icon }) => (
        <Tooltip key={tool} label={label} shortcut={shortcut}>
          <button
            type="button"
            aria-label={label}
            aria-pressed={editor.tool === tool}
            onClick={() => editor.setTool(tool)}
            className={cn(iconButton, editor.tool === tool && "bg-accent-subtle text-accent hover:bg-accent-subtle")}
          >
            <Icon aria-hidden="true" />
          </button>
        </Tooltip>
      ))}
      <div className="mx-1 my-0.5 h-px bg-hairline" />
      <Tooltip label="Image">
        <button type="button" aria-label="Image" onClick={() => fileInput.current?.click()} className={iconButton}>
          <ImagePlus aria-hidden="true" />
        </button>
      </Tooltip>
      <input
        ref={fileInput}
        type="file"
        accept={ASSET_CONTENT_TYPES.join(",")}
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) void editor.addImages(files);
        }}
      />
    </div>
  );
}

export function HistoryControls({ editor }: { editor: Editor }) {
  return (
    <div className="board-panel absolute bottom-3 left-3 flex gap-0.5 p-1">
      <Tooltip label="Undo" shortcut="⌘Z" side="top">
        <button type="button" aria-label="Undo" className={iconButton} disabled={!editor.history.canUndo} onClick={() => editor.undo()}>
          <Undo2 aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip label="Redo" shortcut="⇧⌘Z" side="top">
        <button type="button" aria-label="Redo" className={iconButton} disabled={!editor.history.canRedo} onClick={() => editor.redo()}>
          <Redo2 aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}

export function ZoomControls({ editor }: { editor: Editor }) {
  return (
    <div className="board-panel absolute right-3 bottom-3 flex items-center gap-0.5 p-1">
      <Tooltip label="Zoom out" shortcut="⌘−" side="top">
        <button type="button" aria-label="Zoom out" className={iconButton} onClick={() => editor.zoomBy(0.8)}>
          <Minus aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip label="Zoom to 100%" shortcut="⌘0" side="top">
        <button type="button" className="h-9 min-w-14 cursor-pointer rounded-sm px-1 text-xs font-semibold text-control tabular-nums hover:bg-surface-hover" onClick={() => editor.zoomTo(1)}>
          {Math.round(editor.camera.zoom * 100)}%
        </button>
      </Tooltip>
      <Tooltip label="Zoom in" shortcut="⌘+" side="top">
        <button type="button" aria-label="Zoom in" className={iconButton} onClick={() => editor.zoomBy(1.25)}>
          <Plus aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip label="Fit the board" shortcut="⇧1" side="top">
        <button type="button" aria-label="Fit the board" className={iconButton} onClick={() => editor.zoomToFit()}>
          <Maximize aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  );
}
