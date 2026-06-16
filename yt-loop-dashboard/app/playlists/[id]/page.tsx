"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import Sidebar from "@/app/components/Sidebar";

interface Video {
  id: string;
  title: string;
  description?: string;
  tags: string[];
  thumbnail?: string;
  order: number;
  filePath: string;
}

interface StreamConfig {
  id?: string;
  streamKey: string;
  title: string;
  description: string;
  tags: string;
  monetization: boolean;
  status: string;
}

export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const [playlistName, setPlaylistName] = useState("");
  const [videos, setVideos] = useState<Video[]>([]);
  const [config, setConfig] = useState<StreamConfig>({
    streamKey: "", title: "", description: "", tags: "", monetization: false, status: "OFFLINE",
  });
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [streaming, setStreaming] = useState(false);
  const [activeTab, setActiveTab] = useState<"videos" | "stream">("videos");

  // Upload form state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoDesc, setVideoDesc] = useState("");
  const [videoTags, setVideoTags] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);

  const fetchData = async () => {
    const res = await fetch(`/api/playlists/${id}`);
    const data = await res.json();
    setPlaylistName(data.name);
    setVideos(data.videos || []);
  };

  const fetchConfig = async () => {
    const res = await fetch(`/api/stream/config?playlistId=${id}`);
    if (res.ok) {
      const data = await res.json();
      if (data) {
        setConfig({
          streamKey: data.streamKey || "",
          title: data.title || "",
          description: data.description || "",
          tags: (data.tags || []).join(", "),
          monetization: data.monetization || false,
          status: data.status || "OFFLINE",
        });
        setStreaming(data.status === "LIVE");
      }
    }
  };

  useEffect(() => {
    if (id) { fetchData(); fetchConfig(); }
  }, [id]);

  const uploadVideo = async () => {
    if (!videoFile || !videoTitle.trim()) return alert("Video file and title required");
    setUploading(true);
    setUploadProgress(10);

    const formData = new FormData();
    formData.append("file", videoFile);
    if (thumbFile) formData.append("thumbnail", thumbFile);
    formData.append("playlistId", id);
    formData.append("title", videoTitle);
    formData.append("description", videoDesc);
    formData.append("tags", videoTags);

    setUploadProgress(30);
    const res = await fetch("/api/videos/upload", { method: "POST", body: formData });
    setUploadProgress(90);

    if (res.ok) {
      setVideoFile(null); setThumbFile(null);
      setVideoTitle(""); setVideoDesc(""); setVideoTags("");
      if (fileRef.current) fileRef.current.value = "";
      if (thumbRef.current) thumbRef.current.value = "";
      await fetchData();
    }
    setUploadProgress(100);
    setTimeout(() => { setUploading(false); setUploadProgress(0); }, 500);
  };

  const deleteVideo = async (videoId: string) => {
    if (!confirm("Delete this video?")) return;
    await fetch(`/api/videos/${videoId}`, { method: "DELETE" });
    fetchData();
  };

  const saveConfig = async () => {
    await fetch("/api/stream/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playlistId: id,
        streamKey: config.streamKey,
        title: config.title,
        description: config.description,
        tags: config.tags.split(",").map((t) => t.trim()).filter(Boolean),
        monetization: config.monetization,
      }),
    });
    alert("Stream config saved!");
  };

  const goLive = async () => {
    if (!config.streamKey) return alert("Stream key required!");
    if (videos.length === 0) return alert("Add videos to playlist first!");
    await saveConfig();
    const res = await fetch("/api/stream/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlistId: id, streamKey: config.streamKey }),
    });
    if (res.ok) { setStreaming(true); setConfig((c) => ({ ...c, status: "LIVE" })); }
    else { const e = await res.json(); alert(`Error: ${e.error}`); }
  };

  const goOffline = async () => {
    await fetch("/api/stream/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlistId: id }),
    });
    setStreaming(false);
    setConfig((c) => ({ ...c, status: "OFFLINE" }));
  };

  const inputStyle = {
    background: "var(--bg)", border: "1px solid var(--border)",
    color: "var(--text)", borderRadius: "8px", padding: "10px 12px", width: "100%",
    fontSize: "14px", outline: "none",
  };

  return (
    <div className="flex">
      <Sidebar />
      <main className="ml-64 flex-1 p-8 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">{playlistName}</h1>
            <p className="text-sm" style={{ color: "var(--muted)" }}>{videos.length} videos</p>
          </div>
          {/* Live Status + Button */}
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
              streaming ? "bg-red-900 text-red-300" : "bg-gray-800 text-gray-400"
            }`}>
              <div className={`w-2 h-2 rounded-full ${streaming ? "bg-red-500 animate-pulse" : "bg-gray-500"}`} />
              {streaming ? "LIVE" : "OFFLINE"}
            </div>
            {streaming ? (
              <button onClick={goOffline}
                className="px-4 py-2 rounded-lg font-semibold text-sm transition-opacity hover:opacity-80"
                style={{ background: "#333", color: "var(--text)" }}>
                ⏹ Stop Stream
              </button>
            ) : (
              <button onClick={goLive}
                className="px-4 py-2 rounded-lg font-semibold text-sm transition-opacity hover:opacity-80"
                style={{ background: "var(--accent)" }}>
                🔴 Go Live
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          {(["videos", "stream"] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all"
              style={{
                background: activeTab === tab ? "var(--accent)" : "transparent",
                color: activeTab === tab ? "white" : "var(--muted)",
              }}>
              {tab === "videos" ? "🎬 Videos" : "⚙️ Stream Config"}
            </button>
          ))}
        </div>

        {/* VIDEOS TAB */}
        {activeTab === "videos" && (
          <div>
            {/* Upload Form */}
            <div className="p-5 rounded-xl mb-6"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <h2 className="font-semibold mb-4">Upload Video</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>Video File *</label>
                  <input ref={fileRef} type="file" accept="video/*"
                    onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                    style={{ ...inputStyle, padding: "8px" }} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>Thumbnail (optional)</label>
                  <input ref={thumbRef} type="file" accept="image/*"
                    onChange={(e) => setThumbFile(e.target.files?.[0] || null)}
                    style={{ ...inputStyle, padding: "8px" }} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>Title *</label>
                  <input value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)}
                    placeholder="Video title" style={inputStyle} />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>Tags (comma separated)</label>
                  <input value={videoTags} onChange={(e) => setVideoTags(e.target.value)}
                    placeholder="tag1, tag2, tag3" style={inputStyle} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>Description</label>
                  <textarea value={videoDesc} onChange={(e) => setVideoDesc(e.target.value)}
                    placeholder="Video description" rows={2}
                    style={{ ...inputStyle, resize: "vertical" }} />
                </div>
              </div>

              {uploading && (
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1" style={{ color: "var(--muted)" }}>
                    <span>Uploading...</span><span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg)" }}>
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%`, background: "var(--accent)" }} />
                  </div>
                </div>
              )}

              <button onClick={uploadVideo} disabled={uploading}
                className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: "var(--accent)" }}>
                {uploading ? "Uploading..." : "Upload Video"}
              </button>
            </div>

            {/* Video List */}
            <div className="space-y-2">
              {videos.length === 0 && (
                <div className="text-center py-12 rounded-xl"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <p className="text-4xl mb-2">🎬</p>
                  <p style={{ color: "var(--muted)" }}>No videos yet. Upload one above!</p>
                </div>
              )}
              {videos.map((v, i) => (
                <div key={v.id} className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ background: "var(--bg)", color: "var(--muted)" }}>
                    {i + 1}
                  </div>
                  {v.thumbnail ? (
                    <img src={v.thumbnail} alt={v.title}
                      className="w-16 h-10 object-cover rounded-lg flex-shrink-0" />
                  ) : (
                    <div className="w-16 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "var(--bg)" }}>🎬</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{v.title}</p>
                    {v.tags.length > 0 && (
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {v.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: "var(--bg)", color: "var(--muted)" }}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => deleteVideo(v.id)}
                    className="text-sm px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 flex-shrink-0"
                    style={{ background: "#2a1a1a", color: "#ff6b6b" }}>
                    🗑 Delete
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STREAM CONFIG TAB */}
        {activeTab === "stream" && (
          <div className="p-5 rounded-xl"
            style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <h2 className="font-semibold mb-4">Stream Configuration</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>
                  🔑 YouTube Stream Key *
                </label>
                <input type="password" value={config.streamKey}
                  onChange={(e) => setConfig((c) => ({ ...c, streamKey: e.target.value }))}
                  placeholder="xxxx-xxxx-xxxx-xxxx-xxxx" style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>Stream Title</label>
                <input value={config.title}
                  onChange={(e) => setConfig((c) => ({ ...c, title: e.target.value }))}
                  placeholder="My Live Stream" style={inputStyle} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>Description</label>
                <textarea value={config.description}
                  onChange={(e) => setConfig((c) => ({ ...c, description: e.target.value }))}
                  placeholder="Stream description..." rows={3}
                  style={{ ...inputStyle, resize: "vertical" }} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--muted)" }}>Tags (comma separated)</label>
                <input value={config.tags}
                  onChange={(e) => setConfig((c) => ({ ...c, tags: e.target.value }))}
                  placeholder="lofi, music, chill" style={inputStyle} />
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg"
                style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
                <div>
                  <p className="text-sm font-medium">Monetization</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    Enable ads on this stream
                  </p>
                </div>
                <button onClick={() => setConfig((c) => ({ ...c, monetization: !c.monetization }))}
                  className="relative w-12 h-6 rounded-full transition-colors duration-200"
                  style={{ background: config.monetization ? "var(--accent)" : "var(--border)" }}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                    config.monetization ? "translate-x-7" : "translate-x-1"
                  }`} />
                </button>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={saveConfig}
                  className="px-5 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                  style={{ background: "#1a3a1a", color: "#4ade80" }}>
                  💾 Save Config
                </button>
                {!streaming ? (
                  <button onClick={goLive}
                    className="px-5 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                    style={{ background: "var(--accent)" }}>
                    🔴 Go Live Now
                  </button>
                ) : (
                  <button onClick={goOffline}
                    className="px-5 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                    style={{ background: "#333" }}>
                    ⏹ Stop Stream
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
