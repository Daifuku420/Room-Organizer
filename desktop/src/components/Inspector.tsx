import { mmToCm } from "../geometry";
import type { Placement } from "../types";

interface Props {
  placement: Placement | null;
  clashes: number;
  onChange: (patch: Partial<Placement>) => void;
  onCommit: () => void;
  onDelete: () => void;
}

const ROTATIONS = [0, 900, 1800, 2700];

export function Inspector({ placement, clashes, onChange, onCommit, onDelete }: Props) {
  if (!placement) {
    return (
      <aside className="panel panel--right">
        <h2>Selection</h2>
        <p className="hint">
          Pick something on the plan to see its measurements, or add a piece from
          the left.
        </p>
      </aside>
    );
  }

  const cmField = (
    key: "width_mm" | "depth_mm" | "height_mm",
    label: string,
  ) => (
    <div>
      <label htmlFor={key}>{label} cm</label>
      <input
        id={key}
        type="number"
        value={mmToCm(placement[key])}
        onChange={(e) => onChange({ [key]: Number(e.target.value) * 10 })}
        onBlur={onCommit}
      />
    </div>
  );

  return (
    <aside className="panel panel--right">
      <h2>Selection</h2>

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
        {cmField("width_mm", "Width")}
        {cmField("depth_mm", "Depth")}
      </div>

      <div className="field">{cmField("height_mm", "Height")}</div>

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
    </aside>
  );
}
