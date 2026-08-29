import { useEffect, useState } from "react";
import { api } from "../api";
import type { RoomSummary } from "../types";

export function RoomList({ onOpen }: { onOpen: (roomId: string) => void }) {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [name, setName] = useState("Bedroom");
  const [widthCm, setWidthCm] = useState(360);
  const [lengthCm, setLengthCm] = useState(420);
  const [heightCm, setHeightCm] = useState(250);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listRooms().then(setRooms).catch(() => setError("Could not load rooms."));
  }, []);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const room = await api.createRoom(name, heightCm * 10);
      const w = widthCm * 10;
      const l = lengthCm * 10;
      // A rectangle to start with. The phone scanner will replace this loop
      // wholesale once it can measure the real shell.
      await api.replaceWalls(room.id, [
        { x1_mm: 0, y1_mm: 0, x2_mm: w, y2_mm: 0 },
        { x1_mm: w, y1_mm: 0, x2_mm: w, y2_mm: l },
        { x1_mm: w, y1_mm: l, x2_mm: 0, y2_mm: l },
        { x1_mm: 0, y1_mm: l, x2_mm: 0, y2_mm: 0 },
      ]);
      await api.createLayout(room.id, "Current", true);
      onOpen(room.id);
    } catch (e) {
      setError(`Could not create the room. ${e instanceof Error ? e.message : ""}`);
      setBusy(false);
    }
  };

  return (
    <div className="centred">
      <div className="card">
        <h1>Rooms</h1>

        {rooms.length > 0 && (
          <div className="rooms">
            {rooms.map((r) => (
              <button key={r.id} className="chip" onClick={() => onOpen(r.id)}>
                {r.name}
              </button>
            ))}
          </div>
        )}

        <p className="hint">
          Measure the room with a tape for now — corner to corner along the floor.
          You can correct any of it later.
        </p>

        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field field-row">
          <div>
            <label htmlFor="w">Width cm</label>
            <input
              id="w"
              type="number"
              value={widthCm}
              onChange={(e) => setWidthCm(Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="l">Length cm</label>
            <input
              id="l"
              type="number"
              value={lengthCm}
              onChange={(e) => setLengthCm(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="h">Ceiling cm</label>
          <input
            id="h"
            type="number"
            value={heightCm}
            onChange={(e) => setHeightCm(Number(e.target.value))}
          />
        </div>

        {error && <p className="error">{error}</p>}

        <button
          className="primary"
          onClick={create}
          disabled={busy || widthCm < 50 || lengthCm < 50}
          style={{ width: "100%", marginTop: 8 }}
        >
          {busy ? "Creating…" : "Create room"}
        </button>
      </div>
    </div>
  );
}
