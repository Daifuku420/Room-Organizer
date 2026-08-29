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
