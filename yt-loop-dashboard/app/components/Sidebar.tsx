"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Playlist {
  id: string;
  name: string;
  videos: { id: string }[];
}

export default function Sidebar() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const pathname = usePathname();

  const fetchPlaylists = async () => {
    const res = await fetch("/api/playlists");
    const data = await res.json();
    setPlaylists(data);
  };

  useEffect(() => { fetchPlaylists(); }, []);

  const createPlaylist = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    setNewName("");
    setCreating(false);
    fetchPlaylists();
  };

  const deletePlaylist = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (!confirm("Delete this playlist and all its videos?")) return;
    await fetch(`/api/playlists/${id}`, { method: "DELETE" });
    fetchPlaylists();
  };

  return (
    <aside style={{ background: "var(--card)", borderRight: "1px solid var(--border)" }}
      className="w-64 min-h-screen flex flex-col p-4 fixed left-0 top-0 z-10">
      
      {/* Logo */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ background: "var(--accent)" }}>▶</div>
          <span className="font-bold text-lg">YT Loop</span>
        </div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>Live Stream Manager</p>
      </div>

      {/* Home */}
      <Link href="/" className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-4 text-sm transition-all ${
        pathname === "/" ? "text-white" : "hover:opacity-80"
      }`} style={{ background: pathname === "/" ? "var(--accent)" : "transparent" }}>
        🏠 Dashboard
      </Link>

      {/* Create Playlist */}
      <div className="mb-4">
        <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          Playlists
        </p>
        <div className="flex gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createPlaylist()}
            placeholder="New playlist..."
            className="flex-1 text-xs px-2 py-1.5 rounded-lg outline-none"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <button onClick={createPlaylist} disabled={creating}
            className="px-2 py-1.5 rounded-lg text-xs font-bold transition-opacity hover:opacity-80"
            style={{ background: "var(--accent)" }}>
            +
          </button>
        </div>
      </div>

      {/* Playlist List */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {playlists.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: "var(--muted)" }}>
            No playlists yet
          </p>
        )}
        {playlists.map((p) => (
          <div key={p.id} className={`group flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
            pathname === `/playlists/${p.id}` ? "text-white" : "hover:opacity-80"
          }`} style={{ background: pathname === `/playlists/${p.id}` ? "#2a2a2a" : "transparent" }}>
            <Link href={`/playlists/${p.id}`} className="flex-1 truncate">
              <span className="block truncate">{p.name}</span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                {p.videos?.length ?? 0} videos
              </span>
            </Link>
            <button onClick={(e) => deletePlaylist(p.id, e)}
              className="opacity-0 group-hover:opacity-100 text-xs px-1 transition-opacity"
              style={{ color: "var(--muted)" }}>✕</button>
          </div>
        ))}
      </div>
    </aside>
  );
}
