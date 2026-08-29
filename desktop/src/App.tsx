import { useState } from "react";
import { getToken } from "./api";
import { Editor } from "./components/Editor";
import { RoomList } from "./components/RoomList";
import { Setup } from "./components/Setup";

export default function App() {
  const [connected, setConnected] = useState(Boolean(getToken()));
  const [roomId, setRoomId] = useState<string | null>(null);

  if (!connected) return <Setup onReady={() => setConnected(true)} />;
  if (!roomId) return <RoomList onOpen={setRoomId} />;
  return <Editor roomId={roomId} onBack={() => setRoomId(null)} />;
}
