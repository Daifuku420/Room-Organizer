import { mmToCm } from "../geometry";
import type { Opening, Placement, SwingDir, Wall } from "../types";

const ROTATIONS = [0, 900, 1800, 2700];

const SWINGS: { value: SwingDir; label: string }[] = [
  { value: "in_left", label: "Opens in, hinge left" },
  { value: "in_right", label: "Opens in, hinge right" },
  { value: "out_left", label: "Opens out, hinge left" },
  { value: "out_right", label: "Opens out, hinge right" },
  { value: "sliding", label: "Sliding" },
];

function CmInput({
  id,
  label,
  mm,
  onChange,
  onCommit,
}: {
  id: string;
  label: string;
  mm: number;
  onChange: (mm: number) => void;
  onCommit: () => void;
}) {
  return (
    <div>
      <label htmlFor={id}>{label} cm</label>
      <input
        id={id}
        type="number"
        value={mmToCm(mm)}
        onChange={(e) => onChange(Number(e.target.value) * 10)}
        onBlur={onCommit}
      />
    </div>
  );
}

export function PlacementInspector({
  placement,
  clashes,
  blocksDoor,
  onChange,
  onCommit,
  onDelete,
}: {
  placement: Placement;
  clashes: number;
  blocksDoor: boolean;
  onChange: (patch: Partial<Placement>) => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <div className="field">
        <label htmlFor="label">Name</label>
        <input
          id="label"
          value={placement.label}
          onChange={(e) => onChange({ label: e.target.value })}
          onBlur={onCommit}
        />
      </div>

      <div className="field field-row">
        <CmInput
          id="w"
          label="Width"
          mm={placement.width_mm}
          onChange={(mm) => onChange({ width_mm: mm })}
          onCommit={onCommit}
        />
        <CmInput
          id="d"
          label="Depth"
          mm={placement.depth_mm}
          onChange={(mm) => onChange({ depth_mm: mm })}
          onCommit={onCommit}
        />
      </div>

      <div className="field">
        <CmInput
          id="h"
          label="Height"
          mm={placement.height_mm}
          onChange={(mm) => onChange({ height_mm: mm })}
          onCommit={onCommit}
        />
      </div>

      <div className="field">
        <label htmlFor="rot">Rotation</label>
        <select
          id="rot"
          value={placement.rotation_ddeg}
          onChange={(e) => {
            onChange({ rotation_ddeg: Number(e.target.value) });
            queueMicrotask(onCommit);
          }}
        >
          {ROTATIONS.map((r) => (
            <option key={r} value={r}>
              {r / 10}°
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Position</label>
        <p className="hint" style={{ fontFamily: "var(--font-data)" }}>
          x {mmToCm(placement.x_mm)} · y {mmToCm(placement.y_mm)} cm
        </p>
      </div>

      {clashes > 0 && (
        <p className="error">
          Overlaps {clashes} other {clashes === 1 ? "piece" : "pieces"}. The hatched
          area on the plan is the part that does not fit.
        </p>
      )}

      {blocksDoor && (
        <p className="error">
          Stands where a door needs to open. Move it clear of the swing, or change
          the door to slide.
        </p>
      )}

      <button
        onClick={() => {
          onChange({ locked: !placement.locked });
          queueMicrotask(onCommit);
        }}
      >
        {placement.locked ? "Unlock" : "Lock in place"}
      </button>

      <button className="danger" onClick={onDelete}>
        Remove from plan
      </button>
    </>
  );
}

export function OpeningInspector({
  opening,
  walls,
  blockedBy,
  onChange,
  onCommit,
  onDelete,
}: {
  opening: Opening;
  walls: Wall[];
  blockedBy: number;
  onChange: (patch: Partial<Opening>) => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  const isDoor = opening.kind === "door";

  return (
    <>
      <div className="field">
        <label htmlFor="wall">On wall</label>
        <select
          id="wall"
          value={opening.wall_id}
          onChange={(e) => {
            onChange({ wall_id: e.target.value, offset_mm: 0 });
            queueMicrotask(onCommit);
          }}
        >
          {walls.map((w) => (
            <option key={w.id} value={w.id}>
              Wall {w.seq + 1} · {mmToCm(Math.hypot(w.x2_mm - w.x1_mm, w.y2_mm - w.y1_mm))} cm
            </option>
          ))}
        </select>
      </div>

      <div className="field field-row">
        <CmInput
          id="off"
          label="From corner"
          mm={opening.offset_mm}
          onChange={(mm) => onChange({ offset_mm: Math.max(0, mm) })}
          onCommit={onCommit}
        />
        <CmInput
          id="ow"
          label="Width"
          mm={opening.width_mm}
          onChange={(mm) => onChange({ width_mm: Math.max(100, mm) })}
          onCommit={onCommit}
        />
      </div>

      <div className="field field-row">
        <CmInput
          id="sill"
          label="Sill"
          mm={opening.sill_mm}
          onChange={(mm) => onChange({ sill_mm: Math.max(0, mm) })}
          onCommit={onCommit}
        />
        <CmInput
          id="oh"
          label="Height"
          mm={opening.height_mm}
          onChange={(mm) => onChange({ height_mm: Math.max(100, mm) })}
          onCommit={onCommit}
        />
      </div>

      {isDoor && (
        <div className="field">
          <label htmlFor="swing">Swing</label>
          <select
            id="swing"
            value={opening.swing}
            onChange={(e) => {
              onChange({ swing: e.target.value as SwingDir });
              queueMicrotask(onCommit);
            }}
          >
            {SWINGS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {blockedBy > 0 && (
        <p className="error">
          {blockedBy === 1 ? "A piece" : `${blockedBy} pieces`} stand in this door's
          swing. The hatched area shows the overlap.
        </p>
      )}

      <button className="danger" onClick={onDelete}>
        Remove {opening.kind}
      </button>
    </>
  );
}
