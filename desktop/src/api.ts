/**
 * API client.
 *
 * Requests go through Tauri's http plugin, which performs them in Rust rather
 * than in the webview. That means no CORS negotiation and no browser origin
 * attached to the call. The allowed hosts are pinned in
 * src-tauri/capabilities/default.json — widen that list, not this file, if the
 * API ever moves.
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  CatalogItem,
  LayoutDetail,
  LayoutSummary,
  Opening,
  Placement,
  RoomDetail,
  RoomSummary,
  WallFeature,
} from "./types";

const BASE_KEY = "roomplanner.base";
const TOKEN_KEY = "roomplanner.token";

export const getBase = () => localStorage.getItem(BASE_KEY) ?? "";
export const getToken = () => localStorage.getItem(TOKEN_KEY) ?? "";

export function saveCredentials(base: string, token: string) {
  localStorage.setItem(BASE_KEY, base.replace(/\/+$/, ""));
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearCredentials() {
  localStorage.removeItem(BASE_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await tauriFetch(`${getBase()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getToken()}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ApiError(response.status, detail || `${response.status}`);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const body = (data: unknown) => JSON.stringify(data);

export const api = {
  health: () => request<{ status: string }>("/health"),

  listRooms: () => request<RoomSummary[]>("/rooms"),

  createRoom: (name: string, ceilingHeightMm: number) =>
    request<RoomSummary>("/rooms", {
      method: "POST",
      body: body({ name, ceiling_height_mm: ceilingHeightMm }),
    }),

  getRoom: (id: string) => request<RoomDetail>(`/rooms/${id}`),

  replaceWalls: (
    roomId: string,
    walls: { x1_mm: number; y1_mm: number; x2_mm: number; y2_mm: number }[],
  ) =>
    request<RoomDetail>(`/rooms/${roomId}/walls`, {
      method: "PUT",
      body: body(walls),
    }),

  listLayouts: (roomId: string) =>
    request<LayoutSummary[]>(`/rooms/${roomId}/layouts`),

  createLayout: (roomId: string, name: string, isDefault = true) =>
    request<LayoutSummary>(`/rooms/${roomId}/layouts`, {
      method: "POST",
      body: body({ name, is_default: isDefault }),
    }),

  getLayout: (id: string) => request<LayoutDetail>(`/layouts/${id}`),

  addPlacement: (layoutId: string, placement: Omit<Placement, "id" | "locked">) =>
    request<Placement>(`/layouts/${layoutId}/placements`, {
      method: "POST",
      body: body(placement),
    }),

  patchPlacement: (id: string, patch: Partial<Placement>) =>
    request<Placement>(`/placements/${id}`, {
      method: "PATCH",
      body: body(patch),
    }),

  deletePlacement: (id: string) =>
    request<void>(`/placements/${id}`, { method: "DELETE" }),

  addOpening: (wallId: string, opening: Omit<Opening, "id" | "wall_id">) =>
    request<Opening>(`/walls/${wallId}/openings`, {
      method: "POST",
      body: body(opening),
    }),

  patchOpening: (id: string, patch: Partial<Opening>) =>
    request<Opening>(`/openings/${id}`, { method: "PATCH", body: body(patch) }),

  deleteOpening: (id: string) =>
    request<void>(`/openings/${id}`, { method: "DELETE" }),

  addFeature: (wallId: string, feature: Omit<WallFeature, "id" | "wall_id">) =>
    request<WallFeature>(`/walls/${wallId}/features`, {
      method: "POST",
      body: body(feature),
    }),

  patchFeature: (id: string, patch: Partial<WallFeature>) =>
    request<WallFeature>(`/features/${id}`, { method: "PATCH", body: body(patch) }),

  deleteFeature: (id: string) =>
    request<void>(`/features/${id}`, { method: "DELETE" }),

  searchCatalog: (q: string, category: string) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (category) params.set("category", category);
    const qs = params.toString();
    return request<CatalogItem[]>(`/catalog/items${qs ? `?${qs}` : ""}`);
  },

  listCatalogCategories: () => request<string[]>("/catalog/categories"),
};

/** Standard French door and window sizes, so a plan can be roughed out fast. */
export const OPENING_PRESETS = {
  door: { kind: "door", width_mm: 830, sill_mm: 0, height_mm: 2040, swing: "in_left" },
  window: { kind: "window", width_mm: 1200, sill_mm: 950, height_mm: 1150, swing: "none" },
  passage: { kind: "passage", width_mm: 900, sill_mm: 0, height_mm: 2040, swing: "none" },
} as const;

/** Typical fittings, so a wall feature can be dropped in without measuring first. */
export const FEATURE_PRESETS = {
  radiator: {
    kind: "radiator",
    label: "Radiator",
    width_mm: 800,
    z_mm: 100,
    height_mm: 600,
    depth_mm: 80,
    clearance_mm: 150,
  },
  socket: {
    kind: "socket",
    label: "Socket",
    width_mm: 80,
    z_mm: 300,
    height_mm: 80,
    depth_mm: 20,
    clearance_mm: 0,
  },
  switch: {
    kind: "switch",
    label: "Switch",
    width_mm: 80,
    z_mm: 1100,
    height_mm: 80,
    depth_mm: 20,
    clearance_mm: 0,
  },
} as const;

/**
 * Sensible starting sizes so a plan can be built before the catalog exists.
 * `category` picks a glyph the same way a catalog item's category does — see
 * glyphs.ts — so a hand-entered bed looks like one too, not just a box.
 */
export const PRESETS: {
  label: string;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  category: string | null;
}[] = [
  { label: "Bed 140", width_mm: 1400, depth_mm: 1900, height_mm: 500, category: "bed" },
  { label: "Bed 90", width_mm: 900, depth_mm: 1900, height_mm: 500, category: "bed" },
  { label: "Desk", width_mm: 1200, depth_mm: 600, height_mm: 740, category: "desk" },
  { label: "Wardrobe", width_mm: 1000, depth_mm: 600, height_mm: 2000, category: "wardrobe" },
  { label: "Shelf", width_mm: 800, depth_mm: 300, height_mm: 1800, category: "bookshelf" },
  { label: "Chair", width_mm: 450, depth_mm: 450, height_mm: 900, category: "chair" },
  { label: "Drawers", width_mm: 800, depth_mm: 450, height_mm: 700, category: "dresser" },
  { label: "Rug", width_mm: 1600, depth_mm: 2300, height_mm: 10, category: null },
];
