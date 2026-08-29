import { useState } from "react";
import { api, saveCredentials } from "../api";

export function Setup({ onReady }: { onReady: () => void }) {
  const [base, setBase] = useState("https://api.paul-padovani-thomas.com");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const connect = async () => {
    setChecking(true);
    setError("");
    saveCredentials(base, token);
    try {
      await api.listRooms();
      onReady();
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("401")
          ? "The server rejected that token. Check you pasted the one from the bootstrap call."
          : `Could not reach the server. ${e instanceof Error ? e.message : ""}`,
      );
      setChecking(false);
    }
  };

  return (
    <div className="centred">
      <div className="card">
        <h1>Connect</h1>
        <p className="hint">
          Point this app at your server and paste the device token you were given
          when you bootstrapped it.
        </p>

        <div className="field">
          <label htmlFor="base">Server address</label>
          <input id="base" value={base} onChange={(e) => setBase(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="token">Device token</label>
          <input
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="paste here"
            spellCheck={false}
          />
        </div>

        {error && <p className="error">{error}</p>}

        <button
          className="primary"
          onClick={connect}
          disabled={checking || !token.trim()}
          style={{ width: "100%", marginTop: 8 }}
        >
          {checking ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
