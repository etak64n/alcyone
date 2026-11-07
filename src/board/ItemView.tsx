// How each kind of item looks, in SVG, in board units. Each item draws again only when it
// changes: an item that someone edits is a new object, and the others stay the same.

import { memo } from "react";
import type { ImageItem, Item, LineItem, PenItem, ShapeItem, StickyItem, TextItem } from "../../shared/board.ts";
import type { Point } from "../../shared/protocol.ts";
import { assetUrl } from "../api.ts";
import { fillOf, INK, STICKY_FILL } from "./colors.ts";
import { BOARD_FONT, fitText, LINE_HEIGHT, MIN_TEXT_SIZE, PADDING, SHAPE_MAX_SIZE, stickyMaxSize, TEXT_PX, wrapText, type Measure } from "./text.ts";

const TEXT_COLOR = "#1f2328";
const SHAPE_STROKE_WIDTH = 2;
const LINE_WIDTH = 2;
const ARROW_LENGTH = 14;
const ARROW_HALF_WIDTH = 6;

export interface ItemViewProps {
  item: Item;
  boardId: string;
  measure: Measure;
  /** The text is being edited over the item, so the item leaves its text out. */
  editing: boolean;
  /** The ends of a line, where the board draws them. Zero for other items. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const ItemView = memo(function ItemView(props: ItemViewProps) {
  const { item } = props;
  switch (item.type) {
    case "sticky":
      return <Sticky item={item} measure={props.measure} editing={props.editing} />;
    case "text":
      return <TextBox item={item} measure={props.measure} editing={props.editing} />;
    case "shape":
      return <Shape item={item} measure={props.measure} editing={props.editing} />;
    case "line":
      return <Line item={item} from={{ x: props.x1, y: props.y1 }} to={{ x: props.x2, y: props.y2 }} />;
    case "pen":
      return <Pen item={item} />;
    case "image":
      return <Picture item={item} boardId={props.boardId} />;
  }
});

function Sticky({ item, measure, editing }: { item: StickyItem; measure: Measure; editing: boolean }) {
  const pad = PADDING.sticky;
  return (
    <g data-item={item.id}>
      <rect x={item.x} y={item.y + 3} width={item.w} height={item.h} rx={3} fill="rgb(0 0 0 / 0.08)" />
      <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={3} fill={STICKY_FILL[item.color]} stroke={item.color === "white" ? "#d0d4da" : "none"} />
      {!editing && (
        <CenteredText
          id={item.id}
          text={item.text}
          box={{ x: item.x + pad, y: item.y + pad, w: item.w - pad * 2, h: item.h - pad * 2 }}
          max={stickyMaxSize(item.h)}
          color={TEXT_COLOR}
          measure={measure}
        />
      )}
    </g>
  );
}

function TextBox({ item, measure, editing }: { item: TextItem; measure: Measure; editing: boolean }) {
  if (editing || item.text === "") return <g data-item={item.id} />;
  const size = TEXT_PX[item.size];
  const pad = PADDING.text;
  const lines = wrapText(item.text, item.w - pad * 2, size, measure);
  return (
    <g data-item={item.id}>
      <Lines lines={lines} x={item.x + pad} top={item.y + pad} size={size} color={INK[item.color]} anchor="start" />
    </g>
  );
}

function Shape({ item, measure, editing }: { item: ShapeItem; measure: Measure; editing: boolean }) {
  const pad = PADDING.shape;
  const stroke = INK[item.stroke];
  const fill = fillOf(item.fill);
  const common = { stroke, strokeWidth: SHAPE_STROKE_WIDTH, fill: fill === "none" ? "transparent" : fill, strokeLinejoin: "round" as const };
  let outline;
  if (item.shape === "ellipse") {
    outline = <ellipse cx={item.x + item.w / 2} cy={item.y + item.h / 2} rx={item.w / 2} ry={item.h / 2} {...common} />;
  } else if (item.shape === "diamond") {
    const cx = item.x + item.w / 2;
    const cy = item.y + item.h / 2;
    outline = <polygon points={`${cx},${item.y} ${item.x + item.w},${cy} ${cx},${item.y + item.h} ${item.x},${cy}`} {...common} />;
  } else {
    outline = <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={4} {...common} />;
  }
  // Text inside an ellipse or a diamond keeps to the middle part, where it fits.
  const inset = item.shape === "rect" ? 0 : 0.15;
  return (
    <g data-item={item.id}>
      {outline}
      {!editing && (
        <CenteredText
          id={item.id}
          text={item.text}
          box={{
            x: item.x + pad + item.w * inset,
            y: item.y + pad + item.h * inset,
            w: Math.max(1, item.w * (1 - inset * 2) - pad * 2),
            h: Math.max(1, item.h * (1 - inset * 2) - pad * 2),
          }}
          max={SHAPE_MAX_SIZE}
          color={TEXT_COLOR}
          measure={measure}
        />
      )}
    </g>
  );
}

function Line({ item, from, to }: { item: LineItem; from: Point; to: Point }) {
  const stroke = INK[item.stroke];
  // The line stops at the base of an arrowhead, so its square end does not show past the tip.
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const shorten = (tip: Point, base: Point, has: boolean): Point => {
    if (!has || length <= ARROW_LENGTH) return tip;
    const t = (ARROW_LENGTH * 0.8) / length;
    return { x: tip.x + (base.x - tip.x) * t, y: tip.y + (base.y - tip.y) * t };
  };
  const start = shorten(from, to, item.arrow === "both");
  const end = shorten(to, from, item.arrow !== "none");
  return (
    <g data-item={item.id}>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={stroke} strokeWidth={LINE_WIDTH} strokeLinecap="round" />
      {item.arrow !== "none" && <polygon points={arrowhead(from, to)} fill={stroke} />}
      {item.arrow === "both" && <polygon points={arrowhead(to, from)} fill={stroke} />}
    </g>
  );
}

// A triangle with its tip at `tip`, pointing away from `tail`.
function arrowhead(tail: Point, tip: Point): string {
  const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
  const back = { x: tip.x - Math.cos(angle) * ARROW_LENGTH, y: tip.y - Math.sin(angle) * ARROW_LENGTH };
  const side = { x: -Math.sin(angle) * ARROW_HALF_WIDTH, y: Math.cos(angle) * ARROW_HALF_WIDTH };
  return `${tip.x},${tip.y} ${back.x + side.x},${back.y + side.y} ${back.x - side.x},${back.y - side.y}`;
}

function Pen({ item }: { item: PenItem }) {
  const stroke = INK[item.stroke];
  if (item.points.length === 2) {
    return (
      <g data-item={item.id}>
        <circle cx={item.x + (item.points[0] ?? 0)} cy={item.y + (item.points[1] ?? 0)} r={item.width / 2} fill={stroke} />
      </g>
    );
  }
  return (
    <g data-item={item.id} transform={`translate(${item.x} ${item.y})`}>
      <path d={smoothPath(item.points)} fill="none" stroke={stroke} strokeWidth={item.width} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** A smooth path through the points: a curve through the middle of each segment, with each point as its control. */
export function smoothPath(points: readonly number[]): string {
  const count = points.length / 2;
  const at = (index: number) => ({ x: points[index * 2] ?? 0, y: points[index * 2 + 1] ?? 0 });
  const first = at(0);
  if (count < 3) {
    const last = at(count - 1);
    return `M${first.x} ${first.y}L${last.x} ${last.y}`;
  }
  let path = `M${first.x} ${first.y}`;
  for (let index = 1; index < count - 1; index += 1) {
    const point = at(index);
    const next = at(index + 1);
    path += `Q${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  }
  const last = at(count - 1);
  return `${path}L${last.x} ${last.y}`;
}

function Picture({ item, boardId }: { item: ImageItem; boardId: string }) {
  return (
    <g data-item={item.id}>
      <rect x={item.x} y={item.y} width={item.w} height={item.h} fill="#eceef1" />
      <image href={assetUrl(boardId, item.asset)} x={item.x} y={item.y} width={item.w} height={item.h} preserveAspectRatio="none" />
    </g>
  );
}

/** Text in the middle of a box, as large as fits up to `max`. */
function CenteredText(props: { id: string; text: string; box: { x: number; y: number; w: number; h: number }; max: number; color: string; measure: Measure }) {
  const { id, text, box, max, color, measure } = props;
  if (text === "") return null;
  const { size, lines } = fitText(text, box.w, box.h, max, MIN_TEXT_SIZE, measure);
  const height = lines.length * size * LINE_HEIGHT;
  const top = box.y + Math.max(0, (box.h - height) / 2);
  // Text that does not fit even at the smallest size stops at the edge of the box.
  const overflows = height > box.h;
  return (
    <>
      {overflows && (
        <clipPath id={`clip-${id}`}>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} />
        </clipPath>
      )}
      <g clipPath={overflows ? `url(#clip-${id})` : undefined}>
        <Lines lines={lines} x={box.x + box.w / 2} top={top} size={size} color={color} anchor="middle" />
      </g>
    </>
  );
}

function Lines({ lines, x, top, size, color, anchor }: { lines: string[]; x: number; top: number; size: number; color: string; anchor: "start" | "middle" }) {
  const height = size * LINE_HEIGHT;
  // The baseline of a line sits at about 0.8 of the size below the top of its text, centered in the line height.
  const baseline = (height - size) / 2 + size * 0.8;
  return (
    <text fontFamily={BOARD_FONT} fontSize={size} fill={color} textAnchor={anchor} style={{ whiteSpace: "pre" }}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} y={top + index * height + baseline}>
          {line === "" ? " " : line}
        </tspan>
      ))}
    </text>
  );
}
