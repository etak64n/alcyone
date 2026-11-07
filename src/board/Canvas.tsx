// The board itself: an SVG that draws the items in board units, moved and scaled by the
// camera, with the selection over them. It passes the pointer, the wheel, and dropped
// files to the editor, which decides what they do.

import { useEffect, useRef, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { isBoxItem, type Item } from "../../shared/board.ts";
import type { Point } from "../../shared/protocol.ts";
import { PAPER, PAPER_DOT, SELECTION } from "./colors.ts";
import { handlePoint, type Editor } from "./editor.ts";
import { boundsOf, HANDLES, lineEnds, unionOf, type Rect } from "./geometry.ts";
import { ItemView } from "./ItemView.tsx";

// Dots on the paper, this far apart in board units. Below MIN_DOT_ZOOM they would only blur.
const DOT_SPACING = 24;
const MIN_DOT_ZOOM = 0.4;

export function Canvas({ editor }: { editor: Editor }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { camera, viewport } = editor;
  const display = editor.display();
  const editingId = editor.editing?.id ?? null;

  // The editor learns the size of the board view, and of every change of it.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const observer = new ResizeObserver(() => {
      const rect = svg.getBoundingClientRect();
      editor.setViewport(rect.width, rect.height);
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, [editor]);

  // The wheel needs a listener that may cancel its default, which scrolls or zooms the page.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : 1;
      editor.wheel({
        screen: screenPoint(svg, event),
        deltaX: event.deltaX * scale,
        deltaY: event.deltaY * scale,
        // A pinch on a trackpad arrives as a wheel with Ctrl.
        zoom: event.ctrlKey || event.metaKey,
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [editor]);

  function input(event: ReactPointerEvent<SVGSVGElement>) {
    return {
      pointerId: event.pointerId,
      screen: screenPoint(event.currentTarget, event),
      button: event.button,
      pointerType: event.pointerType,
      shiftKey: event.shiftKey,
    };
  }

  function onDrop(event: DragEvent<SVGSVGElement>) {
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    void editor.addImages(files, screenPoint(event.currentTarget, event));
  }

  const interaction = editor.interaction;
  const grabbing = interaction?.kind === "pan";
  const cursor = grabbing ? "grabbing" : editor.tool === "hand" || editor.spaceDown ? "grab" : editor.tool === "select" ? "default" : "crosshair";
  const zoom = camera.zoom;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 size-full touch-none select-none"
      style={{ cursor, background: PAPER }}
      onPointerDown={(event) => {
        // The board keeps the focus where it is: the text field of a note that this press
        // creates must not lose it to the board, and a drag selects no text of the page.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        editor.pointerDown(input(event));
      }}
      onPointerMove={(event) => editor.pointerMove(input(event))}
      onPointerUp={(event) => editor.pointerUp(input(event))}
      onPointerCancel={(event) => editor.pointerCancel(input(event))}
      onPointerLeave={() => editor.pointerLeave()}
      onDoubleClick={(event) => editor.doubleClick(screenPoint(event.currentTarget, event))}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(event) => event.preventDefault()}
      data-testid="board"
    >
      <defs>
        <pattern id="paper-dots" width={DOT_SPACING} height={DOT_SPACING} patternUnits="userSpaceOnUse">
          <circle cx={1.5} cy={1.5} r={1.5} fill={PAPER_DOT} />
        </pattern>
      </defs>
      <g transform={`scale(${zoom}) translate(${-camera.x} ${-camera.y})`}>
        {zoom >= MIN_DOT_ZOOM && (
          <rect x={camera.x} y={camera.y} width={viewport.width / zoom} height={viewport.height / zoom} fill="url(#paper-dots)" />
        )}
        {display.items.map((item) => {
          const ends = item.type === "line" ? lineEnds(item, display.byId) : null;
          return (
            <ItemView
              key={item.id}
              item={item}
              boardId={editor.boardId}
              measure={editor.measure}
              editing={item.id === editingId}
              x1={ends?.from.x ?? 0}
              y1={ends?.from.y ?? 0}
              x2={ends?.to.x ?? 0}
              y2={ends?.to.y ?? 0}
            />
          );
        })}
        <PeerSelections editor={editor} />
        <Selection editor={editor} />
      </g>
    </svg>
  );
}

/** The outlines of what the others select, each in the color of the person. */
function PeerSelections({ editor }: { editor: Editor }) {
  const display = editor.display();
  const outlines: { key: string; rect: Rect; color: string }[] = [];
  for (const peer of editor.connection?.peers.values() ?? []) {
    for (const id of peer.presence.selection) {
      const item = display.byId.get(id);
      if (item !== undefined) outlines.push({ key: `${peer.session}-${id}`, rect: boundsOf(item, display.byId), color: peer.color });
    }
  }
  return (
    <g pointerEvents="none">
      {outlines.map(({ key, rect, color }) => (
        <rect key={key} x={rect.x - 2} y={rect.y - 2} width={rect.w + 4} height={rect.h + 4} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ))}
    </g>
  );
}

/** The selection of this person: outlines, the handles of a lone item, the rectangle of a drag, and the item that a line will join. */
function Selection({ editor }: { editor: Editor }) {
  const display = editor.display();
  const zoom = editor.camera.zoom;
  const selected = [...editor.selection].flatMap((id) => {
    const item = display.byId.get(id);
    return item === undefined ? [] : [item];
  });
  const interaction = editor.interaction;
  const handleSize = 8 / zoom;
  const lone: Item | undefined = selected.length === 1 ? selected[0] : undefined;
  const rects = selected.map((item) => ({ id: item.id, rect: boundsOf(item, display.byId), line: item.type === "line" }));
  const group = selected.length > 1 ? unionOf(rects.map(({ rect }) => rect)) : null;
  const marquee = editor.marquee();
  const showHandles = interaction === null || interaction.kind === "resize" || interaction.kind === "endpoint";

  // The item under the end of a line being drawn or moved, which the line will follow.
  let target: string | null = null;
  if (interaction?.kind === "line") target = interaction.toItem;
  if (interaction?.kind === "endpoint") target = interaction.current[interaction.end].item;
  const targetItem = target === null ? undefined : display.byId.get(target);

  return (
    <g pointerEvents="none">
      {rects
        .filter(({ line }) => !line)
        .map(({ id, rect }) => (
          <rect key={id} x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke={SELECTION} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
      {group !== null && (
        <rect x={group.x - 4 / zoom} y={group.y - 4 / zoom} width={group.w + 8 / zoom} height={group.h + 8 / zoom} fill="none" stroke={SELECTION} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      )}
      {showHandles && lone !== undefined && isBoxItem(lone) &&
        HANDLES.map((handle) => {
          const point = handlePoint(boundsOf(lone, display.byId), handle);
          return (
            <rect
              key={handle}
              x={point.x - handleSize / 2}
              y={point.y - handleSize / 2}
              width={handleSize}
              height={handleSize}
              rx={1.5 / zoom}
              fill="#ffffff"
              stroke={SELECTION}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      {showHandles && lone !== undefined && lone.type === "line" &&
        Object.values(lineEnds(lone, display.byId)).map((point: Point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r={handleSize * 0.6} fill="#ffffff" stroke={SELECTION} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
      {targetItem !== undefined && isBoxItem(targetItem) && (
        <rect
          x={targetItem.x - 3 / zoom}
          y={targetItem.y - 3 / zoom}
          width={targetItem.w + 6 / zoom}
          height={targetItem.h + 6 / zoom}
          rx={3 / zoom}
          fill="none"
          stroke={SELECTION}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {marquee !== null && (
        <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="rgb(28 126 214 / 0.08)" stroke={SELECTION} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      )}
    </g>
  );
}

function screenPoint(element: Element, event: { clientX: number; clientY: number }): Point {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
