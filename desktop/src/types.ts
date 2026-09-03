/** Wire types. Everything spatial is millimetres; angles are tenths of a degree. */

export interface RoomSummary {
  id: string;
  name: string;
  ceiling_kind: "flat" | "sloped";
  ceiling_height_mm: number;
  updated_at: string;
}

export interface Wall {
  id: string;
  seq: number;
  x1_mm: number;
  y1_mm: number;
  x2_mm: number;
  y2_mm: number;
  thickness_mm: number;
}

export interface RoomDetail extends RoomSummary {
  walls: Wall[];
  openings: Opening[];
  features: WallFeature[];
}

export interface LayoutSummary {
  id: string;
  room_id: string;
  name: string;
  is_default: boolean;
  updated_at: string;
}

export interface Placement {
  id: string;
  label: string;
  x_mm: number;
  y_mm: number;
  z_mm: number;
  rotation_ddeg: number;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  locked: boolean;
  catalog_item_id: string | null;
}

export interface LayoutDetail extends LayoutSummary {
  placements: Placement[];
}

export type SwingDir =
  | "in_left"
  | "in_right"
  | "out_left"
  | "out_right"
  | "sliding"
  | "none";

export interface Opening {
  id: string;
  wall_id: string;
  kind: "door" | "window" | "passage";
  offset_mm: number;
  width_mm: number;
  sill_mm: number;
  height_mm: number;
  swing: SwingDir;
}

export type FeatureKind = "radiator" | "socket" | "switch" | "vent" | "pipe" | "other";

export interface WallFeature {
  id: string;
  wall_id: string;
  kind: FeatureKind;
  label: string | null;
  offset_mm: number;
  width_mm: number;
  z_mm: number;
  height_mm: number;
  depth_mm: number;
  clearance_mm: number;
}

export interface CatalogItem {
  id: string;
  source: string;
  name: string;
  category: string;
  brand: string | null;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  price_cents: number | null;
  currency: string;
  clearance_front_mm: number;
}

export type Selection =
  | { kind: "placement"; id: string }
  | { kind: "opening"; id: string }
  | { kind: "feature"; id: string }
  | null;
