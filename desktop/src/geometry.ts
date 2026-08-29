/**
 * Plan geometry. Pure functions, no React, no DOM — this is the part worth
 * unit-testing later.
 *
 * Coordinates are millimetres with y pointing up (mathematical, not screen).
 * The SVG layer does the flip so that nothing here has to think about it.
 */

import type { Placement, Wall } from "./types";

export interface Vec {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EPSILON = 1e-9;

/** Footprint corners of a placement, in order, rotated about its centre. */
export function corners(p: Placement): Vec[] {
  const rad = ((p.rotation_ddeg / 10) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = p.width_mm / 2;
  const hd = p.depth_mm / 2;

  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map(({ x, y }) => ({
    x: p.x_mm + x * cos - y * sin,
    y: p.y_mm + x * sin + y * cos,
  }));
}

export function polygonArea(poly: Vec[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Sutherland–Hodgman: clip `subject` against `clip`. Both must be convex and
 * wound counter-clockwise. Returns the intersection polygon, empty if none.
 *
 * A boolean "do these overlap" would be cheaper, but the actual polygon is
 * what lets the plan hatch the overlapping region instead of just flagging it.
 */
export function intersectConvex(subject: Vec[], clip: Vec[]): Vec[] {
  let output = subject;

  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: Vec) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -EPSILON;

    const input = output;
    output = [];

    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);

      if (curIn !== prevIn) {
        const denom =
          (b.x - a.x) * (prev.y - cur.y) - (b.y - a.y) * (prev.x - cur.x);
        if (Math.abs(denom) > EPSILON) {
          const t =
            ((b.x - a.x) * (prev.y - a.y) - (b.y - a.y) * (prev.x - a.x)) / denom;
          output.push({
            x: prev.x + t * (cur.x - prev.x),
            y: prev.y + t * (cur.y - prev.y),
          });
        }
      }
      if (curIn) output.push(cur);
    }
  }

  return output;
}

/** Counter-clockwise winding, so the clipper's half-plane test holds. */
export function ensureCCW(poly: Vec[]): Vec[] {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += (b.x - a.x) * (b.y + a.y);
  }
  return sum > 0 ? [...poly].reverse() : poly;
}

export interface Collision {
  a: string;
  b: string;
  polygon: Vec[];
  areaMm2: number;
}

/** Every overlapping pair, with the region they share. O(n²) is fine at n < 100. */
export function findCollisions(placements: Placement[]): Collision[] {
  const shapes = placements.map((p) => ({ id: p.id, poly: ensureCCW(corners(p)) }));
  const out: Collision[] = [];

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const poly = intersectConvex(shapes[i].poly, shapes[j].poly);
      if (poly.length < 3) continue;
      const areaMm2 = polygonArea(poly);
      // Under a square centimetre is two things touching, not colliding.
      if (areaMm2 < 100) continue;
      out.push({ a: shapes[i].id, b: shapes[j].id, polygon: poly, areaMm2 });
    }
  }
  return out;
}

export function roomPolygon(walls: Wall[]): Vec[] {
  return [...walls]
    .sort((a, b) => a.seq - b.seq)
    .map((w) => ({ x: w.x1_mm, y: w.y1_mm }));
}

export function pointInPolygon(pt: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const straddles = a.y > pt.y !== b.y > pt.y;
    if (straddles && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when any corner of the placement pokes outside the room shell. */
export function isOutsideRoom(p: Placement, room: Vec[]): boolean {
  if (room.length < 3) return false;
  return corners(p).some((c) => !pointInPolygon(c, room));
}

export function boundsOf(points: Vec[], pad = 0): Bounds {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs) - pad,
    minY: Math.min(...ys) - pad,
    maxX: Math.max(...xs) + pad,
    maxY: Math.max(...ys) + pad,
  };
}

/**
 * Gaps from a placement's axis-aligned extent to the room's extent, in mm.
 * Approximate for rotated pieces, which is what a dimension string on a plan
 * shows anyway: the clear distance to the wall, not the diagonal.
 */
export interface Gaps {
  left: number;
  right: number;
  bottom: number;
  top: number;
  box: Bounds;
}

export function gapsToWalls(p: Placement, room: Bounds): Gaps {
  const box = boundsOf(corners(p));
  return {
    left: Math.round(box.minX - room.minX),
    right: Math.round(room.maxX - box.maxX),
    bottom: Math.round(box.minY - room.minY),
    top: Math.round(room.maxY - box.maxY),
    box,
  };
}

export const mmToCm = (mm: number) => Math.round(mm / 10);
export const snap = (mm: number, grid = 10) => Math.round(mm / grid) * grid;
