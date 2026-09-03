import { useCallback, useEffect, useMemo, useState } from "react";
import { FEATURE_PRESETS, OPENING_PRESETS, PRESETS, api } from "../api";
import {
  doorSwingPolygon,
  featureClearancePolygon,
  findCollisions,
  findObstructions,
  wallFrame,
} from "../geometry";
import type {
  CatalogItem,
  LayoutDetail,
  Opening,
  Placement,
  RoomDetail,
  Selection,
  WallFeature,
} from "../types";
import { CatalogPanel } from "./Catalog";
import { FloorPlan } from "./FloorPlan";
import { FeatureInspector, OpeningInspector, PlacementInspector } from "./Inspector";

export function Editor({ roomId, onBack }: { roomId: string; onBack: () => void }) {
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [layout, setLayout] = useState<LayoutDetail | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
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

  const placements = useMemo(() => layout?.placements ?? [], [layout]);
  const openings = useMemo(() => room?.openings ?? [], [room]);
  const features = useMemo(() => room?.features ?? [], [room]);
  const walls = useMemo(() => room?.walls ?? [], [room]);

  const collisions = useMemo(() => findCollisions(placements), [placements]);

  const obstructions = useMemo(() => {
    const frames = new Map(walls.map((w) => [w.id, wallFrame(w)] as const));
    const swings = openings.flatMap((o) => {
      const frame = frames.get(o.wall_id);
      if (!frame) return [];
      const polygon = doorSwingPolygon(frame, o);
      return polygon.length
        ? [{ source: { kind: "opening" as const, id: o.id }, polygon }]
        : [];
    });
    const clearances = features.flatMap((f) => {
      const frame = frames.get(f.wall_id);
      if (!frame) return [];
      const polygon = featureClearancePolygon(frame, f);
      return polygon.length
        ? [{ source: { kind: "feature" as const, id: f.id }, polygon }]
        : [];
    });
    return findObstructions(placements, [...swings, ...clearances]);
  }, [placements, openings, features, walls]);

  const clashingIds = useMemo(() => {
    const ids = new Set<string>();
    collisions.forEach((c) => {
      ids.add(c.a);
      ids.add(c.b);
    });
    obstructions.forEach((o) => ids.add(o.placementId));
    return ids;
  }, [collisions, obstructions]);

  /** Local edits stay local until commit, so dragging never waits on the network. */
  const patchPlacementLocal = useCallback((id: string, patch: Partial<Placement>) => {
    setLayout((current) =>
      current
        ? {
            ...current,
            placements: current.placements.map((p) => (p.id === id ? { ...p, ...patch } : p)),
          }
        : current,
    );
  }, []);

  const patchOpeningLocal = useCallback((id: string, patch: Partial<Opening>) => {
    setRoom((current) =>
      current
        ? {
            ...current,
            openings: current.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          }
        : current,
    );
  }, []);

  const patchFeatureLocal = useCallback((id: string, patch: Partial<WallFeature>) => {
    setRoom((current) =>
      current
        ? {
            ...current,
            features: current.features.map((f) => (f.id === id ? { ...f, ...patch } : f)),
          }
        : current,
    );
  }, []);

  const commit = useCallback(
    async (target: Selection) => {
      if (!target) return;
      try {
        if (target.kind === "placement") {
          const piece = placements.find((p) => p.id === target.id);
          if (!piece) return;
          const { id: _id, catalog_item_id: _c, ...fields } = piece;
          await api.patchPlacement(target.id, fields);
        } else if (target.kind === "opening") {
          const opening = openings.find((o) => o.id === target.id);
          if (!opening) return;
          const { id: _id, kind: _k, ...fields } = opening;
          await api.patchOpening(target.id, fields);
        } else {
          const feature = features.find((f) => f.id === target.id);
          if (!feature) return;
          const { id: _id, kind: _k, ...fields } = feature;
          await api.patchFeature(target.id, fields);
        }
        setError("");
      } catch (e) {
        setError(`That change did not save. ${e instanceof Error ? e.message : ""}`);
      }
    },
    [placements, openings, features],
  );

  const addPreset = async (preset: (typeof PRESETS)[number]) => {
    if (!layout) return;
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
        category: preset.category,
      });
      setLayout({ ...layout, placements: [...layout.placements, created] });
      setSelection({ kind: "placement", id: created.id });
      setError("");
    } catch (e) {
      setError(`Could not add that. ${e instanceof Error ? e.message : ""}`);
    }
  };

  const addFromCatalog = async (item: CatalogItem) => {
    if (!layout) return;
    try {
      // Dimensions are copied onto the placement, not looked up live each
      // time — a plan must not reshape itself because a vendor revised a
      // product page later.
      const created = await api.addPlacement(layout.id, {
        label: item.name,
        x_mm: 1000,
        y_mm: 1000,
        z_mm: 0,
        rotation_ddeg: 0,
        width_mm: item.width_mm,
        depth_mm: item.depth_mm,
        height_mm: item.height_mm,
        catalog_item_id: item.id,
        category: item.category,
      });
      setLayout({ ...layout, placements: [...layout.placements, created] });
      setSelection({ kind: "placement", id: created.id });
      setError("");
    } catch (e) {
      setError(`Could not add that. ${e instanceof Error ? e.message : ""}`);
    }
  };

  const addOpening = async (kind: keyof typeof OPENING_PRESETS) => {
    if (!room || walls.length === 0) return;
    // Drop it on the wall the current selection sits on, else the first wall.
    const wallId =
      selection?.kind === "opening"
        ? (openings.find((o) => o.id === selection.id)?.wall_id ?? walls[0].id)
        : walls[0].id;
    const wall = walls.find((w) => w.id === wallId)!;
    const length = Math.hypot(wall.x2_mm - wall.x1_mm, wall.y2_mm - wall.y1_mm);
    const preset = OPENING_PRESETS[kind];

    try {
      const created = await api.addOpening(wallId, {
        ...preset,
        offset_mm: Math.max(0, Math.round((length - preset.width_mm) / 2)),
      });
      setRoom({ ...room, openings: [...room.openings, created] });
      setSelection({ kind: "opening", id: created.id });
      setError("");
    } catch (e) {
      setError(`Could not add that. ${e instanceof Error ? e.message : ""}`);
    }
  };

  const addFeature = async (kind: keyof typeof FEATURE_PRESETS) => {
    if (!room || walls.length === 0) return;
    const wallId =
      selection?.kind === "feature"
        ? (features.find((f) => f.id === selection.id)?.wall_id ?? walls[0].id)
        : walls[0].id;
    const wall = walls.find((w) => w.id === wallId)!;
    const length = Math.hypot(wall.x2_mm - wall.x1_mm, wall.y2_mm - wall.y1_mm);
    const preset = FEATURE_PRESETS[kind];

    try {
      const created = await api.addFeature(wallId, {
        ...preset,
        offset_mm: Math.max(0, Math.round((length - preset.width_mm) / 2)),
      });
      setRoom({ ...room, features: [...room.features, created] });
      setSelection({ kind: "feature", id: created.id });
      setError("");
    } catch (e) {
      setError(`Could not add that. ${e instanceof Error ? e.message : ""}`);
    }
  };

  const remove = useCallback(async () => {
    if (!selection) return;
    try {
      if (selection.kind === "placement" && layout) {
        await api.deletePlacement(selection.id);
        setLayout({
          ...layout,
          placements: layout.placements.filter((p) => p.id !== selection.id),
        });
      } else if (selection.kind === "opening" && room) {
        await api.deleteOpening(selection.id);
        setRoom({ ...room, openings: room.openings.filter((o) => o.id !== selection.id) });
      } else if (selection.kind === "feature" && room) {
        await api.deleteFeature(selection.id);
        setRoom({ ...room, features: room.features.filter((f) => f.id !== selection.id) });
      }
      setSelection(null);
    } catch (e) {
      setError(`Could not remove that. ${e instanceof Error ? e.message : ""}`);
    }
  }, [selection, layout, room]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName;
      if (typing === "INPUT" || typing === "SELECT") return;
      if (e.key === "Delete") void remove();
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [remove]);

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

  const selectedPlacement =
    selection?.kind === "placement"
      ? (placements.find((p) => p.id === selection.id) ?? null)
      : null;
  const selectedOpening =
    selection?.kind === "opening"
      ? (openings.find((o) => o.id === selection.id) ?? null)
      : null;
  const selectedFeature =
    selection?.kind === "feature"
      ? (features.find((f) => f.id === selection.id) ?? null)
      : null;

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
          {placements.length === 0 && <p className="hint">Nothing placed yet.</p>}
          {placements.map((p) => (
            <button
              key={p.id}
              className={`object${clashingIds.has(p.id) ? " clashing" : ""}`}
              aria-pressed={selection?.kind === "placement" && selection.id === p.id}
              onClick={() => setSelection({ kind: "placement", id: p.id })}
            >
              <span className="name">{p.label}</span>
              <span className="dims">
                {Math.round(p.width_mm / 10)}×{Math.round(p.depth_mm / 10)}
              </span>
            </button>
          ))}

          <h2 style={{ marginTop: 10 }}>Doors and windows</h2>
          {openings.map((o) => {
            const wall = walls.find((w) => w.id === o.wall_id);
            return (
              <button
                key={o.id}
                className="object"
                aria-pressed={selection?.kind === "opening" && selection.id === o.id}
                onClick={() => setSelection({ kind: "opening", id: o.id })}
              >
                <span className="name" style={{ textTransform: "capitalize" }}>
                  {o.kind}
                </span>
                <span className="dims">
                  wall {(wall?.seq ?? 0) + 1} · {Math.round(o.width_mm / 10)}
                </span>
              </button>
            );
          })}
          <div className="field-row" style={{ marginTop: 2 }}>
            <button onClick={() => addOpening("door")}>Add door</button>
            <button onClick={() => addOpening("window")}>Add window</button>
          </div>

          <h2 style={{ marginTop: 10 }}>Wall fittings</h2>
          {features.map((f) => {
            const wall = walls.find((w) => w.id === f.wall_id);
            return (
              <button
                key={f.id}
                className="object"
                aria-pressed={selection?.kind === "feature" && selection.id === f.id}
                onClick={() => setSelection({ kind: "feature", id: f.id })}
              >
                <span className="name" style={{ textTransform: "capitalize" }}>
                  {f.label || f.kind}
                </span>
                <span className="dims">
                  wall {(wall?.seq ?? 0) + 1} · {Math.round(f.width_mm / 10)}
                </span>
              </button>
            );
          })}
          <div className="field-row" style={{ marginTop: 2 }}>
            <button onClick={() => addFeature("radiator")}>Add radiator</button>
            <button onClick={() => addFeature("socket")}>Add socket</button>
          </div>
          <button onClick={() => addFeature("switch")}>Add switch</button>

          <h2 style={{ marginTop: 10 }}>Catalogue</h2>
          <CatalogPanel onAdd={addFromCatalog} />

          <h2 style={{ marginTop: 10 }}>Hand-entered</h2>
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
          walls={walls}
          openings={openings}
          features={features}
          placements={placements}
          selection={selection}
          onSelect={setSelection}
          onMove={(id, x_mm, y_mm) => patchPlacementLocal(id, { x_mm, y_mm })}
          onSlide={(id, offset_mm) => patchOpeningLocal(id, { offset_mm })}
          onSlideFeature={(id, offset_mm) => patchFeatureLocal(id, { offset_mm })}
          onCommit={commit}
        />

        <aside className="panel panel--right">
          <h2>Selection</h2>
          {!selection && (
            <p className="hint">
              Pick something on the plan to see its measurements, or add a piece
              from the left.
            </p>
          )}
          {selectedPlacement && (
            <PlacementInspector
              placement={selectedPlacement}
              clashes={
                collisions.filter(
                  (c) => c.a === selectedPlacement.id || c.b === selectedPlacement.id,
                ).length
              }
              blocks={obstructions.filter((o) => o.placementId === selectedPlacement.id)}
              onChange={(patch) => patchPlacementLocal(selectedPlacement.id, patch)}
              onCommit={() => void commit(selection)}
              onDelete={remove}
            />
          )}
          {selectedOpening && (
            <OpeningInspector
              opening={selectedOpening}
              walls={walls}
              blockedBy={
                obstructions.filter(
                  (o) => o.source.kind === "opening" && o.source.id === selectedOpening.id,
                ).length
              }
              onChange={(patch) => patchOpeningLocal(selectedOpening.id, patch)}
              onCommit={() => void commit(selection)}
              onDelete={remove}
            />
          )}
          {selectedFeature && (
            <FeatureInspector
              feature={selectedFeature}
              walls={walls}
              blockedBy={
                obstructions.filter(
                  (o) => o.source.kind === "feature" && o.source.id === selectedFeature.id,
                ).length
              }
              onChange={(patch) => patchFeatureLocal(selectedFeature.id, patch)}
              onCommit={() => void commit(selection)}
              onDelete={remove}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
