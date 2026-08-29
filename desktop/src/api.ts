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
  LayoutDetail,
  LayoutSummary,
  Placement,
  RoomDetail,
  RoomSummary,
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
};

/** Sensible starting sizes so a plan can be built before the catalog exists. */
export const PRESETS: {
  label: string;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
}[] = [
  { label: "Bed 140", width_mm: 1400, depth_mm: 1900, height_mm: 500 },
  { label: "Bed 90", width_mm: 900, depth_mm: 1900, height_mm: 500 },
  { label: "Desk", width_mm: 1200, depth_mm: 600, height_mm: 740 },
  { label: "Wardrobe", width_mm: 1000, depth_mm: 600, height_mm: 2000 },
  { label: "Shelf", width_mm: 800, depth_mm: 300, height_mm: 1800 },
  { label: "Chair", width_mm: 450, depth_mm: 450, height_mm: 900 },
  { label: "Drawers", width_mm: 800, depth_mm: 450, height_mm: 700 },
  { label: "Rug", width_mm: 1600, depth_mm: 2300, height_mm: 10 },
];
