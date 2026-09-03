import { describe, expect, it } from "vitest";
import {
  along,
  boundsOf,
  corners,
  doorSwingPolygon,
  ensureCCW,
  featureClearancePolygon,
  findCollisions,
  findObstructions,
  gapsToWalls,
  intersectConvex,
  isOutsideRoom,
  mmToCm,
  openingEdges,
  pointInPolygon,
  polygonArea,
  projectOntoWall,
  roomPolygon,
  snap,
  wallFrame,
  type Vec,
} from "./geometry";
import type { Opening, Placement, Wall, WallFeature } from "./types";

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    id: "p1",
    label: "Bed",
    x_mm: 0,
    y_mm: 0,
    z_mm: 0,
    rotation_ddeg: 0,
    width_mm: 1000,
    depth_mm: 500,
    height_mm: 600,
    locked: false,
    catalog_item_id: null,
    ...overrides,
  };
}

// A 4m x 3m rectangular room, walls wound counter-clockwise starting at the
// origin — the shape the room editor and roomPolygon() expect.
function rectWalls(w = 4000, h = 3000): Wall[] {
  const pts: [number, number][] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  return pts.map(([x1, y1], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length];
    return { id: `w${i}`, seq: i, x1_mm: x1, y1_mm: y1, x2_mm: x2, y2_mm: y2, thickness_mm: 100 };
  });
}

function opening(overrides: Partial<Opening> = {}): Opening {
  return {
    id: "o1",
    wall_id: "w0",
    kind: "door",
    offset_mm: 500,
    width_mm: 900,
    sill_mm: 0,
    height_mm: 2040,
    swing: "in_left",
    ...overrides,
  };
}

function feature(overrides: Partial<WallFeature> = {}): WallFeature {
  return {
    id: "f1",
    wall_id: "w0",
    kind: "radiator",
    label: "Radiator",
    offset_mm: 1000,
    width_mm: 800,
    z_mm: 100,
    height_mm: 600,
    depth_mm: 80,
    clearance_mm: 150,
    ...overrides,
  };
}

describe("corners", () => {
  it("returns an axis-aligned box centred on the placement when unrotated", () => {
    const c = corners(placement({ x_mm: 100, y_mm: 200, width_mm: 400, depth_mm: 200 }));
    expect(c).toEqual([
      { x: -100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
      { x: -100, y: 300 },
    ]);
  });

  it("rotates about the centre, not the origin", () => {
    const c = corners(
      placement({ x_mm: 0, y_mm: 0, width_mm: 200, depth_mm: 100, rotation_ddeg: 900 }),
    );
    // A 90 degree turn swaps width and depth on the axes.
    for (const p of c) {
      expect(Math.abs(p.x)).toBeCloseTo(50, 5);
      expect(Math.abs(p.y)).toBeCloseTo(100, 5);
    }
  });
});

describe("polygonArea", () => {
  it("computes the area of a simple square", () => {
    const square: Vec[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(square)).toBe(100);
  });

  it("is winding-independent", () => {
    const cw: Vec[] = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(polygonArea(cw)).toBe(100);
  });
});

describe("ensureCCW", () => {
  it("leaves an already-CCW polygon untouched", () => {
    const ccw: Vec[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(ensureCCW(ccw)).toEqual(ccw);
  });

  it("reverses a clockwise polygon", () => {
    const cw: Vec[] = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(ensureCCW(cw)).toEqual([...cw].reverse());
  });
});

describe("intersectConvex", () => {
  it("returns the overlap region of two overlapping squares", () => {
    const a: Vec[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const b: Vec[] = [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ];
    const overlap = intersectConvex(a, b);
    expect(polygonArea(overlap)).toBeCloseTo(25, 5);
  });

  it("returns empty for disjoint squares", () => {
    const a: Vec[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const b: Vec[] = [
      { x: 100, y: 100 },
      { x: 110, y: 100 },
      { x: 110, y: 110 },
      { x: 100, y: 110 },
    ];
    expect(intersectConvex(a, b)).toEqual([]);
  });
});

describe("findCollisions", () => {
  it("flags two overlapping placements", () => {
    const a = placement({ id: "a", x_mm: 0, y_mm: 0, width_mm: 1000, depth_mm: 1000 });
    const b = placement({ id: "b", x_mm: 500, y_mm: 0, width_mm: 1000, depth_mm: 1000 });
    const collisions = findCollisions([a, b]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({ a: "a", b: "b" });
    expect(collisions[0].areaMm2).toBeGreaterThan(0);
  });

  it("ignores placements that don't touch", () => {
    const a = placement({ id: "a", x_mm: 0, y_mm: 0, width_mm: 100, depth_mm: 100 });
    const b = placement({ id: "b", x_mm: 5000, y_mm: 0, width_mm: 100, depth_mm: 100 });
    expect(findCollisions([a, b])).toEqual([]);
  });

  it("ignores a sub-square-centimetre graze", () => {
    // Two 1000x1000 boxes overlapping by a 0.05mm sliver: 50mm² is under the
    // 100mm² threshold that distinguishes "touching" from "colliding".
    const a = placement({ id: "a", x_mm: 0, y_mm: 0, width_mm: 1000, depth_mm: 1000 });
    const b = placement({ id: "b", x_mm: 999.95, y_mm: 0, width_mm: 1000, depth_mm: 1000 });
    expect(findCollisions([a, b])).toEqual([]);
  });
});

describe("roomPolygon", () => {
  it("orders wall start points by seq regardless of input order", () => {
    const walls = rectWalls(4000, 3000);
    const shuffled = [walls[2], walls[0], walls[3], walls[1]];
    expect(roomPolygon(shuffled)).toEqual([
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ]);
  });
});

describe("pointInPolygon", () => {
  const room = roomPolygon(rectWalls(4000, 3000));

  it("is true for a point in the middle of the room", () => {
    expect(pointInPolygon({ x: 2000, y: 1500 }, room)).toBe(true);
  });

  it("is false for a point outside the room", () => {
    expect(pointInPolygon({ x: -100, y: 1500 }, room)).toBe(false);
    expect(pointInPolygon({ x: 2000, y: 5000 }, room)).toBe(false);
  });
});

describe("isOutsideRoom", () => {
  const room = roomPolygon(rectWalls(4000, 3000));

  it("is false for a placement fully inside", () => {
    const p = placement({ x_mm: 2000, y_mm: 1500, width_mm: 500, depth_mm: 500 });
    expect(isOutsideRoom(p, room)).toBe(false);
  });

  it("is true when a corner pokes through a wall", () => {
    const p = placement({ x_mm: 3900, y_mm: 1500, width_mm: 500, depth_mm: 500 });
    expect(isOutsideRoom(p, room)).toBe(true);
  });
});

describe("boundsOf", () => {
  it("returns a default box for no points", () => {
    expect(boundsOf([])).toEqual({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 });
  });

  it("computes the bounding box with optional padding", () => {
    const pts: Vec[] = [
      { x: 10, y: 20 },
      { x: -5, y: 30 },
    ];
    expect(boundsOf(pts)).toEqual({ minX: -5, minY: 20, maxX: 10, maxY: 30 });
    expect(boundsOf(pts, 5)).toEqual({ minX: -10, minY: 15, maxX: 15, maxY: 35 });
  });
});

describe("gapsToWalls", () => {
  it("measures the clear distance from a placement's box to each wall", () => {
    const room = boundsOf(roomPolygon(rectWalls(4000, 3000)));
    const p = placement({ x_mm: 1000, y_mm: 1000, width_mm: 400, depth_mm: 200 });
    // Box spans x:[800,1200] y:[900,1100] inside a 0..4000 x 0..3000 room.
    const gaps = gapsToWalls(p, room);
    expect(gaps.left).toBe(800);
    expect(gaps.right).toBe(2800);
    expect(gaps.bottom).toBe(900);
    expect(gaps.top).toBe(1900);
  });
});

describe("mmToCm / snap", () => {
  it("converts millimetres to whole centimetres", () => {
    expect(mmToCm(1234)).toBe(123);
    expect(mmToCm(1235)).toBe(124);
  });

  it("snaps to the nearest grid step, defaulting to 1cm", () => {
    expect(snap(1234)).toBe(1230);
    expect(snap(1236)).toBe(1240);
    expect(snap(123, 50)).toBe(100);
  });
});

describe("wallFrame", () => {
  it("computes direction, inward normal and length for a horizontal wall", () => {
    const frame = wallFrame({
      id: "w",
      seq: 0,
      x1_mm: 0,
      y1_mm: 0,
      x2_mm: 4000,
      y2_mm: 0,
      thickness_mm: 100,
    });
    expect(frame.length).toBe(4000);
    expect(frame.dir).toEqual({ x: 1, y: 0 });
    // Rightward travel on a CCW loop has the room interior above, i.e. +y.
    // (inward.x lands on -0 here, since it's -dir.y and dir.y is 0.)
    expect(frame.inward.x).toBeCloseTo(0, 9);
    expect(frame.inward.y).toBe(1);
  });

  it("never divides by zero for a degenerate wall", () => {
    const frame = wallFrame({
      id: "w",
      seq: 0,
      x1_mm: 5,
      y1_mm: 5,
      x2_mm: 5,
      y2_mm: 5,
      thickness_mm: 100,
    });
    expect(Number.isFinite(frame.dir.x)).toBe(true);
    expect(Number.isFinite(frame.dir.y)).toBe(true);
  });
});

describe("along / openingEdges", () => {
  const frame = wallFrame({
    id: "w",
    seq: 0,
    x1_mm: 0,
    y1_mm: 0,
    x2_mm: 4000,
    y2_mm: 0,
    thickness_mm: 100,
  });

  it("walks a distance along the wall from its start", () => {
    expect(along(frame, 500)).toEqual({ x: 500, y: 0 });
  });

  it("returns the near and far edge of an opening", () => {
    const [near, far] = openingEdges(frame, opening({ offset_mm: 500, width_mm: 900 }));
    expect(near).toEqual({ x: 500, y: 0 });
    expect(far).toEqual({ x: 1400, y: 0 });
  });
});

describe("doorSwingPolygon", () => {
  const frame = wallFrame({
    id: "w",
    seq: 0,
    x1_mm: 0,
    y1_mm: 0,
    x2_mm: 4000,
    y2_mm: 0,
    thickness_mm: 100,
  });

  it("is empty for a window", () => {
    expect(doorSwingPolygon(frame, opening({ kind: "window" }))).toEqual([]);
  });

  it("is empty for a sliding or fixed door", () => {
    expect(doorSwingPolygon(frame, opening({ swing: "sliding" }))).toEqual([]);
    expect(doorSwingPolygon(frame, opening({ swing: "none" }))).toEqual([]);
  });

  it("sweeps a quarter circle of the door's width", () => {
    const width = 900;
    const sector = doorSwingPolygon(frame, opening({ width_mm: width, swing: "in_left" }));
    expect(sector.length).toBeGreaterThan(3);
    // A 12-segment inscribed polygon slightly underestimates the true
    // quarter-disc area (pi * r^2 / 4), so compare within 1%, not exactly.
    const exact = (Math.PI * width * width) / 4;
    expect(Math.abs(polygonArea(sector) - exact) / exact).toBeLessThan(0.01);
  });

  it("swings from the hinge edge implied by the swing direction", () => {
    const width = 900;
    const approxContains = (poly: Vec[], pt: Vec) =>
      poly.some((p) => Math.abs(p.x - pt.x) < 1e-6 && Math.abs(p.y - pt.y) < 1e-6);
    const [near, far] = openingEdges(frame, opening({ width_mm: width }));
    const leftHinged = doorSwingPolygon(frame, opening({ width_mm: width, swing: "in_left" }));
    const rightHinged = doorSwingPolygon(frame, opening({ width_mm: width, swing: "in_right" }));
    expect(approxContains(leftHinged, near)).toBe(true);
    expect(approxContains(rightHinged, far)).toBe(true);
  });
});

describe("featureClearancePolygon", () => {
  const frame = wallFrame({
    id: "w",
    seq: 0,
    x1_mm: 0,
    y1_mm: 0,
    x2_mm: 4000,
    y2_mm: 0,
    thickness_mm: 100,
  });

  it("is empty when the fitting has no clearance requirement", () => {
    const f = feature({ clearance_mm: 0 });
    expect(featureClearancePolygon(frame, f)).toEqual([]);
  });

  it("spans the fitting's width and its depth plus clearance", () => {
    const f = feature({ offset_mm: 1000, width_mm: 800, depth_mm: 80, clearance_mm: 150 });
    const zone = featureClearancePolygon(frame, f);
    expect(polygonArea(zone)).toBeCloseTo(800 * (80 + 150), 5);
  });
});

describe("findObstructions", () => {
  const frame = wallFrame({
    id: "w0",
    seq: 0,
    x1_mm: 0,
    y1_mm: 0,
    x2_mm: 4000,
    y2_mm: 0,
    thickness_mm: 100,
  });

  it("flags furniture standing in a door's swing", () => {
    const o = opening({ id: "door1", offset_mm: 500, width_mm: 900, swing: "in_left" });
    const sector = doorSwingPolygon(frame, o);
    // Sits right where the swing sector sweeps into the room.
    const blocker = placement({ id: "chair", x_mm: 700, y_mm: 300, width_mm: 400, depth_mm: 400 });
    const clear = placement({ id: "far", x_mm: 3800, y_mm: 2800, width_mm: 200, depth_mm: 200 });

    const out = findObstructions(
      [blocker, clear],
      [{ source: { kind: "opening", id: o.id }, polygon: sector }],
    );

    expect(out).toHaveLength(1);
    expect(out[0].placementId).toBe("chair");
    expect(out[0].source).toEqual({ kind: "opening", id: "door1" });
  });

  it("flags furniture standing in a fitting's clearance zone", () => {
    const f = feature({ id: "rad1", offset_mm: 500, width_mm: 800, depth_mm: 80, clearance_mm: 150 });
    const zone = featureClearancePolygon(frame, f);
    const blocker = placement({ id: "table", x_mm: 800, y_mm: 100, width_mm: 400, depth_mm: 300 });

    const out = findObstructions(
      [blocker],
      [{ source: { kind: "feature", id: f.id }, polygon: zone }],
    );

    expect(out).toHaveLength(1);
    expect(out[0].source).toEqual({ kind: "feature", id: "rad1" });
  });

  it("does not flag furniture clear of every zone", () => {
    const o = opening({ id: "door1" });
    const sector = doorSwingPolygon(frame, o);
    const clear = placement({ id: "far", x_mm: 3800, y_mm: 2800, width_mm: 200, depth_mm: 200 });
    expect(
      findObstructions([clear], [{ source: { kind: "opening", id: o.id }, polygon: sector }]),
    ).toEqual([]);
  });
});

describe("projectOntoWall", () => {
  const frame = wallFrame({
    id: "w",
    seq: 0,
    x1_mm: 0,
    y1_mm: 0,
    x2_mm: 4000,
    y2_mm: 0,
    thickness_mm: 100,
  });

  it("centres the width on the projected point", () => {
    expect(projectOntoWall(frame, { x: 1000, y: 0 }, 900)).toBe(550);
  });

  it("clamps to the wall's start", () => {
    expect(projectOntoWall(frame, { x: -500, y: 0 }, 900)).toBe(0);
  });

  it("clamps so the opening never runs past the wall's end", () => {
    expect(projectOntoWall(frame, { x: 3990, y: 0 }, 900)).toBe(4000 - 900);
  });
});
