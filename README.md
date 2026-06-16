# YT Loop Dashboard

A self-hosted YouTube live stream manager that lets you create playlists, upload videos, and stream them on an infinite loop to YouTube — all from a clean web dashboard.

## What It Does

- Create and manage multiple playlists
- Upload videos directly to your VPS storage
- Configure stream settings (title, description, tags, stream key, monetization)
- Start and stop YouTube live streams with one click
- Streams videos in a continuous loop using FFmpeg copy mode (near-zero CPU usage)

## Tech Stack

- **Frontend & Backend** — Next.js 15 (App Router) with TypeScript
- **Database** — PostgreSQL via Neon (managed cloud Postgres)
- **Video Storage** — Local VPS filesystem (`/var/lib/yt-storage`)
- **Stream Engine** — FFmpeg with RTMP push to YouTube
- **Process Manager** — PM2
- **Package Manager** — pnpm

## Prerequisites

Make sure the following are installed on your VPS:

- Node.js 18+
- pnpm
- PM2
- FFmpeg
- Git

```bash
apt update && apt install -y ffmpeg git
npm install -g pnpm pm2
```

## Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL="your_neon_postgres_connection_string"
STORAGE_PATH="/var/lib/yt-storage"
```

## Database Setup

This project uses Prisma ORM with Neon PostgreSQL.

```bash
pnpm prisma generate
pnpm prisma db push
```

## Running in Production (VPS)

**Clone and install:**

```bash
git clone https://github.com/Outlier1217/Live-Stream-Website.git
cd Live-Stream-Website/yt-loop-dashboard
pnpm install
```

**Create your `.env` file** with the variables listed above.

**Create storage directories:**

```bash
mkdir -p /var/lib/yt-storage/videos
mkdir -p /var/lib/yt-storage/thumbnails
```

**Build and start:**

```bash
pnpm build
pm2 start "pnpm start" --name yt-dashboard
pm2 save
```

The dashboard will be available at `http://YOUR_VPS_IP:3020`

## Updating After Code Changes

```bash
cd ~/Live-Stream-Website
git pull
cd yt-loop-dashboard
pnpm install
pnpm build
pm2 restart yt-dashboard
```

## How to Use

1. Open the dashboard in your browser
2. Create a playlist from the sidebar
3. Open the playlist and upload your videos
4. Go to the **Stream Config** tab and enter your YouTube stream key, title, description, and tags
5. Click **Go Live** — FFmpeg will start streaming your playlist on loop to YouTube
6. Click **Stop Stream** whenever you want to end the broadcast

## Getting Your YouTube Stream Key

1. Go to [YouTube Studio](https://studio.youtube.com)
2. Click **Go Live** in the top right
3. Select **Stream** tab
4. Copy the stream key and paste it into the dashboard

## FFmpeg Streaming

Videos are streamed using FFmpeg in **copy mode** — meaning the video and audio are passed directly to YouTube without re-encoding. This results in near-zero CPU usage during streaming.

Requirements for copy mode to work correctly:
- Video codec must be **H.264**
- Audio codec must be **AAC**

If your source videos use a different codec, convert them first:

```bash
ffmpeg -i input.mp4 -c:v libx264 -c:a aac -preset fast output.mp4
```

## Project Structure

yt-loop-dashboard/

├── app/

│   ├── api/

│   │   ├── playlists/          # Playlist CRUD

│   │   ├── videos/             # Video upload and delete

│   │   └── stream/             # Stream start, stop, config

│   ├── components/

│   │   └── Sidebar.tsx         # Navigation sidebar

│   ├── playlists/[id]/         # Playlist detail page

│   └── page.tsx                # Dashboard home

├── lib/

│   └── prisma.ts               # Prisma client

├── prisma/

│   └── schema.prisma           # Database schema

└── .env                        # Environment variables

## Database Schema

**Playlist** — stores playlist name and creation date

**Video** — stores video metadata (title, description, tags, thumbnail path, file path, order) linked to a playlist

**StreamConfig** — stores stream settings (stream key, title, description, tags, monetization toggle, live status, FFmpeg PID) linked to a playlist

## Notes

- The dashboard has no authentication by default. Make sure your VPS firewall restricts access to trusted IPs if needed, or add an auth layer before exposing it publicly.
- FFmpeg processes are tracked by PID in the database. If the server restarts while a stream is active, you will need to manually start the stream again from the dashboard.
- All uploaded videos are stored locally on the VPS. Make sure you have sufficient disk space before uploading large files.

## License

Private repository — all rights reserved.
