/**
 * Top-down line-art per catalog category, so a placement reads as roughly
 * the item it is rather than always a plain box. Pure, no React/DOM — same
 * spirit as geometry.ts.
 *
 * Each glyph is a list of open polylines in the placement's LOCAL frame:
 * centred at the origin, unrotated, in millimetres. FloorPlan draws the
 * placement's own box separately; a glyph only adds the detail lines inside
 * it, via toWorld() for the placement's actual position and rotation.
 */

import type { Vec } from "./geometry";

export type Glyph = Vec[][];

const rectOutline = (x0: number, y0: number, x1: number, y1: number): Vec[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
  { x: x0, y: y0 },
];

// Every glyph assumes the piece "faces" +y in its local frame — the same
// default a 0deg placement gets — and rotation_ddeg carries it from there,
// same as everything else on the plan.
const GLYPHS: Record<string, (hw: number, hd: number) => Glyph> = {
  bed: (hw, hd) => {
    const pillowTop = hd - hd * 0.06;
    const pillowBottom = hd - hd * 0.32;
    const gap = hw * 0.06;
    return [
      [{ x: -hw, y: hd }, { x: hw, y: hd }], // headboard
      rectOutline(-hw + hw * 0.1, pillowBottom, -gap, pillowTop),
      rectOutline(gap, pillowBottom, hw - hw * 0.1, pillowTop),
    ];
  },

  sofa: (hw, hd) => {
    const armW = hw * 0.22;
    return [
      [{ x: -hw, y: hd - hd * 0.16 }, { x: hw, y: hd - hd * 0.16 }], // backrest
      [{ x: -hw + armW, y: -hd }, { x: -hw + armW, y: hd }], // left arm
      [{ x: hw - armW, y: -hd }, { x: hw - armW, y: hd }], // right arm
    ];
  },

  armchair: (hw, hd) => {
    const armW = hw * 0.3;
    return [
      [{ x: -hw, y: hd - hd * 0.2 }, { x: hw, y: hd - hd * 0.2 }], // backrest
      [{ x: -hw + armW, y: -hd }, { x: -hw + armW, y: hd }], // left arm
      [{ x: hw - armW, y: -hd }, { x: hw - armW, y: hd }], // right arm
    ];
  },

  chair: (hw, hd) => [
    [{ x: -hw, y: hd - hd * 0.18 }, { x: hw, y: hd - hd * 0.18 }], // backrest
  ],

  wardrobe: (hw, hd) => [
    [{ x: 0, y: -hd }, { x: 0, y: hd }], // door seam
    [{ x: -hw * 0.14, y: 0 }, { x: -hw * 0.03, y: 0 }], // left handle
    [{ x: hw * 0.03, y: 0 }, { x: hw * 0.14, y: 0 }], // right handle
  ],

  dresser: (hw, hd) =>
    [-0.32, 0, 0.32].map((k) => [
      { x: -hw, y: hd * k },
      { x: hw, y: hd * k },
    ]), // drawer fronts

  bookshelf: (hw, hd) => [
    [{ x: -hw / 3, y: -hd }, { x: -hw / 3, y: hd }],
    [{ x: hw / 3, y: -hd }, { x: hw / 3, y: hd }],
  ], // side compartments

  nightstand: (hw, hd) => [
    [{ x: -hw * 0.22, y: 0 }, { x: hw * 0.22, y: 0 }], // drawer pull
  ],
};

/** The detail lines for a category, in local mm — empty for an unknown or
 * absent category, which just leaves the plain box FloorPlan already draws. */
export function glyphFor(
  category: string | null,
  width_mm: number,
  depth_mm: number,
): Glyph {
  const draw = category ? GLYPHS[category] : undefined;
  return draw ? draw(width_mm / 2, depth_mm / 2) : [];
}
