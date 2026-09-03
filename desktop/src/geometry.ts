/**
 * Plan geometry. Pure functions, no React, no DOM — this is the part worth
 * unit-testing later.
 *
 * Coordinates are millimetres with y pointing up (mathematical, not screen).
 * The SVG layer does the flip so that nothing here has to think about it.
 */

import type { Opening, Placement, Wall, WallFeature } from "./types";

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

/**
 * Maps a point in a placement's local frame — centred on the piece, unrotated
 * — into room (world) coordinates. Glyphs are authored in this local frame so
 * they don't have to know their own rotation; corners() is just the special
 * case of transforming its four box corners.
 */
export function fromLocal(p: Placement, local: Vec): Vec {
  const rad = ((p.rotation_ddeg / 10) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: p.x_mm + local.x * cos - local.y * sin,
    y: p.y_mm + local.x * sin + local.y * cos,
  };
}

/** Footprint corners of a placement, in order, rotated about its centre. */
export function corners(p: Placement): Vec[] {
  const hw = p.width_mm / 2;
  const hd = p.depth_mm / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((local) => fromLocal(p, local));
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

// --- openings ---------------------------------------------------------------


/**
 * Wall geometry in the form the plan needs it: a unit direction, a length, and
 * the inward normal.
 *
 * The inward normal assumes the wall loop is wound counter-clockwise, which is
 * what ensureCCW guarantees and what the room editor writes. On a CCW loop the
 * interior is always to the left of the direction of travel, so rotating the
 * direction a quarter turn left points into the room.
 */
export interface WallFrame {
  start: Vec;
  dir: Vec;
  inward: Vec;
  length: number;
}

export function wallFrame(wall: Wall): WallFrame {
  const dx = wall.x2_mm - wall.x1_mm;
  const dy = wall.y2_mm - wall.y1_mm;
  const length = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / length, y: dy / length };
  return {
    start: { x: wall.x1_mm, y: wall.y1_mm },
    dir,
    inward: { x: -dir.y, y: dir.x },
    length,
  };
}

export const along = (frame: WallFrame, distance: number): Vec => ({
  x: frame.start.x + frame.dir.x * distance,
  y: frame.start.y + frame.dir.y * distance,
});

/** The two points where an opening meets the wall line. */
export function openingEdges(frame: WallFrame, opening: Opening): [Vec, Vec] {
  return [along(frame, opening.offset_mm), along(frame, opening.offset_mm + opening.width_mm)];
}

/**
 * The floor area a door leaf sweeps: a quarter-disc from the hinge.
 *
 * A circular sector of 90 degrees is convex, which matters — it means the same
 * polygon clipper used for furniture collisions works here unchanged.
 */
export function doorSwingPolygon(frame: WallFrame, opening: Opening, steps = 12): Vec[] {
  if (opening.kind !== "door") return [];
  if (opening.swing === "sliding" || opening.swing === "none") return [];

  const [near, far] = openingEdges(frame, opening);
  const hingeAtStart = opening.swing.endsWith("_left");
  const opensInward = opening.swing.startsWith("in_");

  const hinge = hingeAtStart ? near : far;
  const leaf = hingeAtStart ? frame.dir : { x: -frame.dir.x, y: -frame.dir.y };
  const side = opensInward
    ? frame.inward
    : { x: -frame.inward.x, y: -frame.inward.y };

  const radius = opening.width_mm;
  const from = Math.atan2(leaf.y, leaf.x);
  let sweep = Math.atan2(side.y, side.x) - from;
  // Take the short way round, so the sector is the quarter turn, not three of them.
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;

  const arc: Vec[] = [hinge];
  for (let i = 0; i <= steps; i++) {
    const angle = from + (sweep * i) / steps;
    arc.push({
      x: hinge.x + radius * Math.cos(angle),
      y: hinge.y + radius * Math.sin(angle),
    });
  }
  return ensureCCW(arc);
}

/**
 * The floor area in front of a fitting that must stay clear — its own
 * footprint plus the extra clearance beyond it (e.g. a radiator needs room
 * to convect, a vent needs room to breathe). Zero clearance means nothing to
 * flag, which is the default for sockets and switches.
 */
export function featureClearancePolygon(frame: WallFrame, feature: WallFeature): Vec[] {
  if (feature.clearance_mm <= 0) return [];
  const a = along(frame, feature.offset_mm);
  const b = along(frame, feature.offset_mm + feature.width_mm);
  const depth = feature.depth_mm + feature.clearance_mm;
  const proj = { x: frame.inward.x * depth, y: frame.inward.y * depth };
  return ensureCCW([
    a,
    b,
    { x: b.x + proj.x, y: b.y + proj.y },
    { x: a.x + proj.x, y: a.y + proj.y },
  ]);
}

export type ObstructionSource =
  | { kind: "opening"; id: string }
  | { kind: "feature"; id: string };

export interface Obstruction {
  placementId: string;
  source: ObstructionSource;
  polygon: Vec[];
  areaMm2: number;
}

/** Furniture standing where a door needs to open, or inside a fitting's clearance. */
export function findObstructions(
  placements: Placement[],
  zones: { source: ObstructionSource; polygon: Vec[] }[],
): Obstruction[] {
  const out: Obstruction[] = [];
  for (const p of placements) {
    const footprint = ensureCCW(corners(p));
    for (const zone of zones) {
      if (zone.polygon.length < 3) continue;
      const overlap = intersectConvex(footprint, zone.polygon);
      if (overlap.length < 3) continue;
      const areaMm2 = polygonArea(overlap);
      if (areaMm2 < 100) continue;
      out.push({
        placementId: p.id,
        source: zone.source,
        polygon: overlap,
        areaMm2,
      });
    }
  }
  return out;
}

/** Where along its wall an opening should sit, given a point on the plan. */
export function projectOntoWall(frame: WallFrame, point: Vec, width: number): number {
  const dx = point.x - frame.start.x;
  const dy = point.y - frame.start.y;
  const distance = dx * frame.dir.x + dy * frame.dir.y;
  return Math.max(0, Math.min(frame.length - width, distance - width / 2));
}
