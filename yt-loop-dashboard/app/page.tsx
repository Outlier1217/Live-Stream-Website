import Sidebar from "./components/Sidebar";

export default function Home() {
  return (
    <div className="flex">
      <Sidebar />
      <main className="ml-64 flex-1 p-8">
        <h1 className="text-3xl font-bold mb-2">Welcome to YT Loop Dashboard</h1>
        <p style={{ color: "var(--muted)" }} className="mb-8">
          Create playlists, add videos, and stream them on loop to YouTube.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: "📋", title: "Create Playlist", desc: "Add a new playlist from the sidebar" },
            { icon: "🎬", title: "Add Videos", desc: "Upload videos to your playlist" },
            { icon: "🔴", title: "Go Live", desc: "Stream your playlist on loop to YouTube" },
          ].map((card) => (
            <div key={card.title} className="p-6 rounded-xl"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="text-3xl mb-3">{card.icon}</div>
              <h3 className="font-semibold mb-1">{card.title}</h3>
              <p className="text-sm" style={{ color: "var(--muted)" }}>{card.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
