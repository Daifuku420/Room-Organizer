import { useCallback, useEffect, useMemo, useState } from "react";
import { PRESETS, api } from "../api";
import { findCollisions } from "../geometry";
import type { LayoutDetail, Placement, RoomDetail } from "../types";
import { FloorPlan } from "./FloorPlan";
import { Inspector } from "./Inspector";

export function Editor({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [layout, setLayout] = useState<LayoutDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const detail = await api.getRoom(roomId);
        setRoom(detail);
        const layouts = await api.listLayouts(roomId);
        const chosen = layouts[0] ?? (await api.createLayout(roomId, "Current", true));
        setLayout(await api.getLayout(chosen.id));
      } catch (e) {
        setError(`Could not open this room. ${e instanceof Error ? e.message : ""}`);
      }
    })();
  }, [roomId]);

  const placements = layout?.placements ?? [];
  const selected = placements.find((p) => p.id === selectedId) ?? null;

  const collisions = useMemo(() => findCollisions(placements), [placements]);
  const clashingIds = useMemo(() => {
    const ids = new Set<string>();
    collisions.forEach((c) => {
      ids.add(c.a);
      ids.add(c.b);
    });
    return ids;
  }, [collisions]);

  /** Local edits stay local until commit, so dragging never waits on the network. */
  const patchLocal = useCallback((id: string, patch: Partial<Placement>) => {
    setLayout((current) =>
      current
        ? {
            ...current,
            placements: current.placements.map((p) =>
              p.id === id ? { ...p, ...patch } : p,
            ),
          }
        : current,
    );
  }, []);

  const commit = useCallback(
    async (id: string) => {
      const piece = layout?.placements.find((p) => p.id === id);
      if (!piece) return;
      try {
        await api.patchPlacement(id, {
          label: piece.label,
          x_mm: piece.x_mm,
          y_mm: piece.y_mm,
          rotation_ddeg: piece.rotation_ddeg,
          width_mm: piece.width_mm,
          depth_mm: piece.depth_mm,
          height_mm: piece.height_mm,
          locked: piece.locked,
        });
      } catch (e) {
        setError(`That change did not save. ${e instanceof Error ? e.message : ""}`);
      }
    },
    [layout],
  );

  const addPreset = async (preset: (typeof PRESETS)[number]) => {
    if (!layout || !room) return;
    try {
      const created = await api.addPlacement(layout.id, {
        label: preset.label,
        x_mm: 1000,
        y_mm: 1000,
        z_mm: 0,
        rotation_ddeg: 0,
        width_mm: preset.width_mm,
        depth_mm: preset.depth_mm,
        height_mm: preset.height_mm,
        catalog_item_id: null,
      });
      setLayout({ ...layout, placements: [...layout.placements, created] });
      setSelectedId(created.id);
    } catch (e) {
      setError(`Could not add that. ${e instanceof Error ? e.message : ""}`);
    }
  };

  const remove = async () => {
    if (!layout || !selectedId) return;
    await api.deletePlacement(selectedId);
    setLayout({
      ...layout,
      placements: layout.placements.filter((p) => p.id !== selectedId),
    });
    setSelectedId(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Delete" && selectedId) void remove();
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error && !room) {
    return (
      <div className="centred">
        <div className="card">
          <h1>Room</h1>
          <p className="error">{error}</p>
          <button onClick={onBack} style={{ marginTop: 12 }}>
            Back to rooms
          </button>
        </div>
      </div>
    );
  }

  if (!room || !layout) {
    return (
      <div className="centred">
        <p className="hint">Loading the plan…</p>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <button onClick={onBack}>Rooms</button>
        <h1>{room.name}</h1>
        <span className="spacer" />
        {error && <span className="hint">{error}</span>}
      </header>

      <div className="workspace">
        <aside className="panel panel--left">
          <h2>In the room</h2>
          {placements.length === 0 && (
            <p className="hint">Nothing placed yet. Add a piece below.</p>
          )}
          {placements.map((p) => (
            <button
              key={p.id}
              className={`object${clashingIds.has(p.id) ? " clashing" : ""}`}
              aria-pressed={p.id === selectedId}
              onClick={() => setSelectedId(p.id)}
            >
              <span className="name">{p.label}</span>
              <span className="dims">
                {Math.round(p.width_mm / 10)}×{Math.round(p.depth_mm / 10)}
              </span>
            </button>
          ))}

          <h2 style={{ marginTop: 10 }}>Add</h2>
          {PRESETS.map((preset) => (
            <button key={preset.label} className="chip" onClick={() => addPreset(preset)}>
              {preset.label}
              <span className="dims">
                {" "}
                {preset.width_mm / 10}×{preset.depth_mm / 10}
              </span>
            </button>
          ))}
        </aside>

        <FloorPlan
          walls={room.walls}
          placements={placements}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMove={(id, x_mm, y_mm) => patchLocal(id, { x_mm, y_mm })}
          onCommit={commit}
        />

        <Inspector
          placement={selected}
          clashes={collisions.filter((c) => c.a === selectedId || c.b === selectedId).length}
          onChange={(patch) => selectedId && patchLocal(selectedId, patch)}
          onCommit={() => selectedId && void commit(selectedId)}
          onDelete={remove}
        />
      </div>
    </div>
  );
}
