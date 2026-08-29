/**
 * The plan view.
 *
 * SVG user units are millimetres, so nothing has to be scaled by hand; the
 * viewBox does the work. A single flip transform turns the y-up world into
 * y-down screen space, which is why every text label carries a counter-flip
 * (see PlanText) — otherwise numbers would render upside down.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  boundsOf,
  corners,
  findCollisions,
  gapsToWalls,
  isOutsideRoom,
  mmToCm,
  roomPolygon,
  snap,
  type Vec,
} from "../geometry";
import type { Placement, Wall } from "../types";

interface Props {
  walls: Wall[];
  placements: Placement[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x_mm: number, y_mm: number) => void;
  onCommit: (id: string) => void;
}

const path = (poly: Vec[]) =>
  poly.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ") + " Z";

/** Text sits in flipped space, so it needs its own flip to read the right way up. */
function PlanText({
  x,
  y,
  children,
  className = "dim-text",
  anchor = "middle",
}: {
  x: number;
  y: number;
  children: React.ReactNode;
  className?: string;
  anchor?: "start" | "middle" | "end";
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(1 -1)`}>
      <text className={className} textAnchor={anchor} dominantBaseline="middle">
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
}: {
  from: Vec;
  to: Vec;
  label: string;
  offset: number;
  axis: "x" | "y";
}) {
  const tick = 55;
  const a = axis === "x" ? { x: from.x, y: offset } : { x: offset, y: from.y };
  const b = axis === "x" ? { x: to.x, y: offset } : { x: offset, y: to.y };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

  return (
    <g stroke="#8d897d" strokeWidth={6} fill="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      {[a, b].map((p, i) => (
        <line
          key={i}
          x1={p.x - tick}
          y1={p.y - tick}
          x2={p.x + tick}
          y2={p.y + tick}
        />
      ))}
      <g stroke="none">
        <PlanText
          x={axis === "x" ? mid.x : mid.x + 160}
          y={axis === "x" ? mid.y + 150 : mid.y}
        >
          {label}
        </PlanText>
      </g>
    </g>
  );
}

export function FloorPlan({
  walls,
  placements,
  selectedId,
  onSelect,
  onMove,
  onCommit,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const room = useMemo(() => roomPolygon(walls), [walls]);
  const roomBounds = useMemo(() => boundsOf(room), [room]);
  const collisions = useMemo(() => findCollisions(placements), [placements]);

  const clashing = useMemo(() => {
    const ids = new Set<string>();
    collisions.forEach((c) => {
      ids.add(c.a);
      ids.add(c.b);
    });
    return ids;
  }, [collisions]);

  const view = useMemo(() => {
    const margin = 700;
    return {
      x: roomBounds.minX - margin,
      y: roomBounds.minY - margin,
      w: roomBounds.maxX - roomBounds.minX + margin * 2,
      h: roomBounds.maxY - roomBounds.minY + margin * 2,
    };
  }, [roomBounds]);

  /** Screen pixels to plan millimetres, via the SVG's own transform matrix. */
  const toWorld = useCallback((clientX: number, clientY: number): Vec | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(matrix.inverse());
    // Undo the y-flip applied to the drawing group.
    return { x: local.x, y: view.y + view.h - (local.y - view.y) };
  }, [view]);

  const onPointerDown = (event: React.PointerEvent, p: Placement) => {
    if (p.locked) return;
    const world = toWorld(event.clientX, event.clientY);
    if (!world) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id: p.id, dx: world.x - p.x_mm, dy: world.y - p.y_mm };
    setDragging(p.id);
    onSelect(p.id);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const world = toWorld(event.clientX, event.clientY);
    if (!world) return;
    onMove(drag.id, snap(world.x - drag.dx), snap(world.y - drag.dy));
  };

  const endDrag = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    // One PATCH per gesture, not one per pointermove.
    if (drag) onCommit(drag.id);
  };

  const selected = placements.find((p) => p.id === selectedId) ?? null;
  const gaps = selected ? gapsToWalls(selected, roomBounds) : null;

  return (
    <div className="plan">
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        <defs>
          <pattern id="grid" width={100} height={100} patternUnits="userSpaceOnUse">
            <path d="M100 0 L0 0 0 100" fill="none" stroke="var(--vellum-line)" strokeWidth={2} />
          </pattern>
          <pattern id="grid-major" width={1000} height={1000} patternUnits="userSpaceOnUse">
            <rect width={1000} height={1000} fill="url(#grid)" />
            <path d="M1000 0 L0 0 0 1000" fill="none" stroke="#b6b0a2" strokeWidth={4} />
          </pattern>
          <pattern
            id="clash"
            width={90}
            height={90}
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1={0} y1={0} x2={0} y2={90} stroke="var(--sanguine)" strokeWidth={14} />
          </pattern>
        </defs>

        {/* One flip for the whole drawing: world y-up, screen y-down. */}
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
                strokeWidth={100}
                strokeLinejoin="miter"
              />
            </>
          )}

          {placements.map((p) => {
            const poly = corners(p);
            const isSelected = p.id === selectedId;
            const outside = isOutsideRoom(p, room);
            return (
              <g
                key={p.id}
                className={`piece${dragging === p.id ? " dragging" : ""}${p.locked ? " locked" : ""}`}
                onPointerDown={(e) => onPointerDown(e, p)}
              >
                <path
                  d={path(poly)}
                  fill={p.locked ? "#cfcabc" : "#d8d3c6"}
                  stroke={isSelected ? "var(--blueprint)" : outside ? "var(--sanguine)" : "#6f6b60"}
                  strokeWidth={isSelected ? 26 : 14}
                />
                <PlanText x={p.x_mm} y={p.y_mm} className="piece-label">
                  {p.label}
                </PlanText>
              </g>
            );
          })}

          {collisions.map((c, i) => (
            <path
              key={i}
              d={path(c.polygon)}
              fill="url(#clash)"
              stroke="var(--sanguine)"
              strokeWidth={14}
              pointerEvents="none"
            />
          ))}

          {selected && gaps && (
            <g pointerEvents="none">
              <Cotation
                axis="x"
                from={{ x: roomBounds.minX, y: 0 }}
                to={{ x: gaps.box.minX, y: 0 }}
                offset={gaps.box.minY - 320}
                label={`${mmToCm(gaps.left)}`}
              />
              <Cotation
                axis="x"
                from={{ x: gaps.box.maxX, y: 0 }}
                to={{ x: roomBounds.maxX, y: 0 }}
                offset={gaps.box.minY - 320}
                label={`${mmToCm(gaps.right)}`}
              />
              <Cotation
                axis="y"
                from={{ x: 0, y: roomBounds.minY }}
                to={{ x: 0, y: gaps.box.minY }}
                offset={gaps.box.minX - 320}
                label={`${mmToCm(gaps.bottom)}`}
              />
              <Cotation
                axis="y"
                from={{ x: 0, y: gaps.box.maxY }}
                to={{ x: 0, y: roomBounds.maxY }}
                offset={gaps.box.minX - 320}
                label={`${mmToCm(gaps.top)}`}
              />
            </g>
          )}
        </g>
      </svg>

      <div className="plan-legend">
        grid 10 cm · {mmToCm(roomBounds.maxX - roomBounds.minX)} ×{" "}
        {mmToCm(roomBounds.maxY - roomBounds.minY)} cm
        {clashing.size > 0 && ` · ${collisions.length} clash${collisions.length > 1 ? "es" : ""}`}
      </div>
    </div>
  );
}
