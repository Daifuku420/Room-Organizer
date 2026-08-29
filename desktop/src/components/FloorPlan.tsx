/**
 * The plan view.
 *
 * SVG user units are millimetres, so nothing has to be scaled by hand; the
 * viewBox does the work. A single flip transform turns the y-up world into
 * y-down screen space, which is why every text label carries a counter-flip
 * (see PlanText) — otherwise numbers would render upside down.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  boundsOf,
  corners,
  doorSwingPolygon,
  findCollisions,
  findObstructions,
  gapsToWalls,
  isOutsideRoom,
  mmToCm,
  openingEdges,
  projectOntoWall,
  roomPolygon,
  snap,
  wallFrame,
  type Vec,
} from "../geometry";
import type { Opening, Placement, Selection, Wall } from "../types";

interface Props {
  walls: Wall[];
  openings: Opening[];
  placements: Placement[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onMove: (id: string, x_mm: number, y_mm: number) => void;
  onSlide: (id: string, offset_mm: number) => void;
  onCommit: (selection: Selection) => void;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_SPAN_MM = 600;
const MAX_SPAN_MM = 60_000;
const WALL_MM = 100;

const path = (poly: Vec[]) =>
  poly.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ") + " Z";

/** Text sits in flipped space, so it needs its own flip to read the right way up. */
function PlanText({
  x,
  y,
  children,
  className = "dim-text",
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(1 -1)`}>
      <text className={className} textAnchor="middle" dominantBaseline="middle">
        {children}
      </text>
    </g>
  );
}

/** A dimension string in the architectural idiom: 45-degree ticks, not arrows. */
function Cotation({
  from,
  to,
  label,
  offset,
  axis,
  scale,
}: {
  from: Vec;
  to: Vec;
  label: string;
  offset: number;
  axis: "x" | "y";
  scale: number;
}) {
  const tick = 8 * scale;
  const a = axis === "x" ? { x: from.x, y: offset } : { x: offset, y: from.y };
  const b = axis === "x" ? { x: to.x, y: offset } : { x: offset, y: to.y };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  return (
    <g stroke="#8d897d" strokeWidth={scale} fill="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      {[a, b].map((p, i) => (
        <line key={i} x1={p.x - tick} y1={p.y - tick} x2={p.x + tick} y2={p.y + tick} />
      ))}
      <g stroke="none">
        <PlanText
          x={axis === "x" ? mid.x : mid.x + 26 * scale}
          y={axis === "x" ? mid.y + 24 * scale : mid.y}
        >
          {label}
        </PlanText>
      </g>
    </g>
  );
}

export function FloorPlan({
  walls,
  openings,
  placements,
  selection,
  onSelect,
  onMove,
  onSlide,
  onCommit,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ selection: Selection; dx: number; dy: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);

  const room = useMemo(() => roomPolygon(walls), [walls]);
  const roomBounds = useMemo(() => boundsOf(room), [room]);
  const frames = useMemo(
    () => new Map(walls.map((w) => [w.id, wallFrame(w)] as const)),
    [walls],
  );

  const swings = useMemo(
    () =>
      openings.flatMap((o) => {
        const frame = frames.get(o.wall_id);
        if (!frame) return [];
        const polygon = doorSwingPolygon(frame, o);
        return polygon.length ? [{ openingId: o.id, polygon }] : [];
      }),
    [openings, frames],
  );

  const collisions = useMemo(() => findCollisions(placements), [placements]);
  const obstructions = useMemo(
    () => findObstructions(placements, swings),
    [placements, swings],
  );

  /**
   * Fit the room to the element's real aspect ratio rather than leaning on
   * preserveAspectRatio, so that zoom and pan can work in the same units the
   * plan is drawn in.
   */
  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    const margin = 800;
    const w = roomBounds.maxX - roomBounds.minX + margin * 2;
    const h = roomBounds.maxY - roomBounds.minY + margin * 2;
    const aspect = box.width / box.height;

    const span = w / h > aspect ? { w, h: w / aspect } : { w: h * aspect, h };
    setView({
      x: (roomBounds.minX + roomBounds.maxX) / 2 - span.w / 2,
      y: (roomBounds.minY + roomBounds.maxY) / 2 - span.h / 2,
      ...span,
    });
  }, [roomBounds]);

  useLayoutEffect(fit, [fit]);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  /** Screen pixels to plan millimetres, undoing the drawing group's y-flip. */
  const toWorld = useCallback(
    (clientX: number, clientY: number): Vec | null => {
      const svg = svgRef.current;
      if (!svg || !view) return null;
      const box = svg.getBoundingClientRect();
      const fx = (clientX - box.left) / box.width;
      const fy = (clientY - box.top) / box.height;
      return { x: view.x + fx * view.w, y: view.y + view.h - fy * view.h };
    },
    [view],
  );

  // Wheel zoom has to be a non-passive listener, otherwise the browser scrolls
  // the page out from under us before preventDefault can run.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((current) => {
        if (!current) return current;
        const factor = Math.exp(event.deltaY * 0.0012);
        const w = Math.min(MAX_SPAN_MM, Math.max(MIN_SPAN_MM, current.w * factor));
        const applied = w / current.w;

        // Keep the point under the cursor pinned while the span changes.
        const box = svg.getBoundingClientRect();
        const fx = (event.clientX - box.left) / box.width;
        const fy = (event.clientY - box.top) / box.height;
        const anchorX = current.x + fx * current.w;
        const anchorY = current.y + current.h - fy * current.h;
        const h = current.h * applied;

        return { w, h, x: anchorX - fx * w, y: anchorY - (1 - fy) * h };
      });
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const startDrag = (
    event: React.PointerEvent,
    next: Selection,
    anchor: { x: number; y: number },
  ) => {
    event.stopPropagation();
    const world = toWorld(event.clientX, event.clientY);
    if (!world || !next) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { selection: next, dx: world.x - anchor.x, dy: world.y - anchor.y };
    setDragging(next.id);
    onSelect(next);
  };

  const onPointerDownBackground = (event: React.PointerEvent) => {
    if (!view) return;
    onSelect(null);
    svgRef.current?.setPointerCapture(event.pointerId);
    panRef.current = { x: event.clientX, y: event.clientY, view };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag?.selection) {
      const world = toWorld(event.clientX, event.clientY);
      if (!world) return;

      if (drag.selection.kind === "placement") {
        onMove(drag.selection.id, snap(world.x - drag.dx), snap(world.y - drag.dy));
      } else {
        // An opening cannot leave its wall, so the pointer is projected onto
        // the wall line and clamped to the span the opening can occupy.
        const opening = openings.find((o) => o.id === drag.selection!.id);
        const frame = opening && frames.get(opening.wall_id);
        if (opening && frame) {
          onSlide(opening.id, snap(projectOntoWall(frame, world, opening.width_mm)));
        }
      }
      return;
    }

    const pan = panRef.current;
    if (pan && svgRef.current) {
      const box = svgRef.current.getBoundingClientRect();
      const dx = ((event.clientX - pan.x) / box.width) * pan.view.w;
      const dy = ((event.clientY - pan.y) / box.height) * pan.view.h;
      setView({ ...pan.view, x: pan.view.x - dx, y: pan.view.y + dy });
    }
  };

  const endPointer = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    panRef.current = null;
    setDragging(null);
    // One PATCH per gesture, not one per pointermove.
    if (drag) onCommit(drag.selection);
  };

  const selected =
    selection?.kind === "placement"
      ? (placements.find((p) => p.id === selection.id) ?? null)
      : null;
  const gaps = selected ? gapsToWalls(selected, roomBounds) : null;

  // Linework should keep a constant apparent weight as the plan zooms.
  const scale = view ? view.w / 900 : 5;

  /** The rectangle an opening punches through the wall, used as a mask hole. */
  const gapQuad = (opening: Opening): Vec[] | null => {
    const frame = frames.get(opening.wall_id);
    if (!frame) return null;
    const [a, b] = openingEdges(frame, opening);
    const n = { x: frame.inward.x * WALL_MM, y: frame.inward.y * WALL_MM };
    return [
      { x: a.x + n.x, y: a.y + n.y },
      { x: b.x + n.x, y: b.y + n.y },
      { x: b.x - n.x, y: b.y - n.y },
      { x: a.x - n.x, y: a.y - n.y },
    ];
  };

  return (
    <div className="plan">
      <svg
        ref={svgRef}
        viewBox={view ? `${view.x} ${view.y} ${view.w} ${view.h}` : "0 0 100 100"}
        preserveAspectRatio="none"
        onPointerDown={onPointerDownBackground}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <defs>
          <pattern id="grid" width={100} height={100} patternUnits="userSpaceOnUse">
            <path
              d="M100 0 L0 0 0 100"
              fill="none"
              stroke="var(--vellum-line)"
              strokeWidth={0.4 * scale}
            />
          </pattern>
          <pattern id="grid-major" width={1000} height={1000} patternUnits="userSpaceOnUse">
            <rect width={1000} height={1000} fill="url(#grid)" />
            <path d="M1000 0 L0 0 0 1000" fill="none" stroke="#b6b0a2" strokeWidth={0.9 * scale} />
          </pattern>
          <pattern
            id="clash"
            width={18 * scale}
            height={18 * scale}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1={0}
              y1={0}
              x2={0}
              y2={18 * scale}
              stroke="var(--sanguine)"
              strokeWidth={2.6 * scale}
            />
          </pattern>

          {/* Openings are cut out of the poché rather than drawn over it, so
              the wall reads as genuinely interrupted on both faces. */}
          {view && (
            <mask
              id="wall-gaps"
              maskUnits="userSpaceOnUse"
              x={view.x - view.w}
              y={view.y - view.h}
              width={view.w * 3}
              height={view.h * 3}
            >
              <rect
                x={view.x - view.w}
                y={view.y - view.h}
                width={view.w * 3}
                height={view.h * 3}
                fill="white"
              />
              {openings.map((o) => {
                const quad = gapQuad(o);
                return quad ? <path key={o.id} d={path(quad)} fill="black" /> : null;
              })}
            </mask>
          )}
        </defs>

        {view && (
          <g transform={`translate(0 ${2 * view.y + view.h}) scale(1 -1)`}>
            <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#grid-major)" />

            {room.length >= 3 && (
              <>
                <path d={path(room)} fill="#efece5" stroke="none" />
                {/* Poché: walls read as solid mass, the way a plan draws them. */}
                <path
                  d={path(room)}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={WALL_MM}
                  strokeLinejoin="miter"
                  mask="url(#wall-gaps)"
                />
              </>
            )}

            {openings.map((o) => {
              const frame = frames.get(o.wall_id);
              if (!frame) return null;
              const [a, b] = openingEdges(frame, o);
              const isSelected = selection?.kind === "opening" && selection.id === o.id;
              const stroke = isSelected ? "var(--blueprint)" : "var(--ink)";
              const sector = doorSwingPolygon(frame, o);

              return (
                <g
                  key={o.id}
                  className="opening"
                  onPointerDown={(e) => startDrag(e, { kind: "opening", id: o.id }, a)}
                >
                  {/* Generous invisible grab target: the drawn lines are hairlines. */}
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="transparent"
                    strokeWidth={WALL_MM * 2.5}
                  />

                  {o.kind === "window" ? (
                    // Glass: a pair of lines across the reveal.
                    [-0.3, 0.3].map((k) => (
                      <line
                        key={k}
                        x1={a.x + frame.inward.x * WALL_MM * k}
                        y1={a.y + frame.inward.y * WALL_MM * k}
                        x2={b.x + frame.inward.x * WALL_MM * k}
                        y2={b.y + frame.inward.y * WALL_MM * k}
                        stroke={stroke}
                        strokeWidth={2 * scale}
                      />
                    ))
                  ) : (
                    <line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={stroke}
                      strokeWidth={2 * scale}
                      strokeDasharray={o.kind === "passage" ? `${12 * scale} ${8 * scale}` : undefined}
                    />
                  )}

                  {sector.length > 2 && (
                    <path
                      d={path(sector)}
                      fill={isSelected ? "#3c7ea118" : "#00000008"}
                      stroke={stroke}
                      strokeWidth={1.6 * scale}
                    />
                  )}
                </g>
              );
            })}

            {placements.map((p) => {
              const isSelected = selection?.kind === "placement" && selection.id === p.id;
              const outside = isOutsideRoom(p, room);
              return (
                <g
                  key={p.id}
                  className={`piece${dragging === p.id ? " dragging" : ""}${p.locked ? " locked" : ""}`}
                  onPointerDown={(e) =>
                    !p.locked &&
                    startDrag(e, { kind: "placement", id: p.id }, { x: p.x_mm, y: p.y_mm })
                  }
                >
                  <path
                    d={path(corners(p))}
                    fill={p.locked ? "#cfcabc" : "#d8d3c6"}
                    stroke={isSelected ? "var(--blueprint)" : outside ? "var(--sanguine)" : "#6f6b60"}
                    strokeWidth={(isSelected ? 4 : 2.2) * scale}
                  />
                  <PlanText x={p.x_mm} y={p.y_mm} className="piece-label">
                    {p.label}
                  </PlanText>
                </g>
              );
            })}

            {[...collisions.map((c) => c.polygon), ...obstructions.map((o) => o.polygon)].map(
              (poly, i) => (
                <path
                  key={i}
                  d={path(poly)}
                  fill="url(#clash)"
                  stroke="var(--sanguine)"
                  strokeWidth={2.2 * scale}
                  pointerEvents="none"
                />
              ),
            )}

            {selected && gaps && (
              <g pointerEvents="none">
                <Cotation
                  axis="x"
                  scale={scale}
                  from={{ x: roomBounds.minX, y: 0 }}
                  to={{ x: gaps.box.minX, y: 0 }}
                  offset={gaps.box.minY - 50 * scale}
                  label={`${mmToCm(gaps.left)}`}
                />
                <Cotation
                  axis="x"
                  scale={scale}
                  from={{ x: gaps.box.maxX, y: 0 }}
                  to={{ x: roomBounds.maxX, y: 0 }}
                  offset={gaps.box.minY - 50 * scale}
                  label={`${mmToCm(gaps.right)}`}
                />
                <Cotation
                  axis="y"
                  scale={scale}
                  from={{ x: 0, y: roomBounds.minY }}
                  to={{ x: 0, y: gaps.box.minY }}
                  offset={gaps.box.minX - 50 * scale}
                  label={`${mmToCm(gaps.bottom)}`}
                />
                <Cotation
                  axis="y"
                  scale={scale}
                  from={{ x: 0, y: gaps.box.maxY }}
                  to={{ x: 0, y: roomBounds.maxY }}
                  offset={gaps.box.minX - 50 * scale}
                  label={`${mmToCm(gaps.top)}`}
                />
              </g>
            )}
          </g>
        )}
      </svg>

      <button className="plan-fit" onClick={fit}>
        Fit to room
      </button>

      <div className="plan-legend">
        grid 10 cm · room {mmToCm(roomBounds.maxX - roomBounds.minX)} ×{" "}
        {mmToCm(roomBounds.maxY - roomBounds.minY)} cm · scroll to zoom, drag the background to pan
        {collisions.length > 0 &&
          ` · ${collisions.length} clash${collisions.length > 1 ? "es" : ""}`}
        {obstructions.length > 0 && ` · ${obstructions.length} blocking a door`}
      </div>
    </div>
  );
}
