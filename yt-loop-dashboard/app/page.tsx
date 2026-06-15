"use client";
import { useState } from "react";

export default function StreamControl({ playlistId }: { playlistId: string }) {
  const [status, setStatus] = useState("OFFLINE");
  const [streamKey, setStreamKey] = useState("");

  const goLive = async () => {
    const res = await fetch("/api/stream/start", {
      method: "POST",
      body: JSON.stringify({ playlistId, streamKey }),
    });
    if (res.ok) setStatus("LIVE");
  };

  const goOffline = async () => {
    await fetch("/api/stream/stop", {
      method: "POST",
      body: JSON.stringify({ playlistId }),
    });
    setStatus("OFFLINE");
  };

  return (
    <div className="p-4 border rounded-lg">
      <input
        placeholder="YouTube Stream Key"
        value={streamKey}
        onChange={(e) => setStreamKey(e.target.value)}
        className="border p-2 w-full mb-2"
      />
      {status === "OFFLINE" ? (
        <button onClick={goLive} className="bg-red-600 text-white px-4 py-2 rounded">
          Go Live
        </button>
      ) : (
        <button onClick={goOffline} className="bg-gray-700 text-white px-4 py-2 rounded">
          Stop Stream
        </button>
      )}
    </div>
  );
}