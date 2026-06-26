import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { spawn, ChildProcess } from "child_process";
import { createWriteStream } from "fs";
import path from "path";
import prisma from "@/lib/prisma";

const LOG_DIR = "/var/log/yt-streams";

// ✅ Global Map — Next.js restarts ke baad bhi PID track rehta hai
declare global {
  var _streamProcesses: Map<string, ChildProcess> | undefined;
}
const streamProcesses: Map<string, ChildProcess> =
  global._streamProcesses ?? (global._streamProcesses = new Map());

async function ensureLogDir() {
  await mkdir(LOG_DIR, { recursive: true });
}

// ✅ Concat file — 999 loops = effective infinite
async function writeConcatFile(concatPath: string, filePaths: string[]) {
  const REPEAT = 999;
  const lines: string[] = [];
  for (let i = 0; i < REPEAT; i++) {
    for (const fp of filePaths) {
      lines.push(`file '${fp}'`);
    }
  }
  await writeFile(concatPath, lines.join("\n"));
}

function startFFmpeg(
  playlistId: string,
  concatPath: string,
  rtmpUrl: string,
  onExit: (code: number | null) => void
): ChildProcess {
  const ffmpeg = spawn(
    "ffmpeg",
    [
      "-re",
      "-f", "concat",
      "-safe", "0",
      // ✅ NO -stream_loop here — concat file itself has 999 repetitions
      "-i", concatPath,

      // Video
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-g", "60",
      "-keyint_min", "60",
      "-sc_threshold", "0",

      // ✅ KEY FIX: Timestamp regeneration — prevents YouTube disconnect after hours
      "-fflags", "+genpts+igndts",
      "-avoid_negative_ts", "make_zero",

      // Audio
      "-c:a", "aac",
      "-b:a", "160k",
      "-ar", "44100",
      "-ac", "2",

      // Output
      "-f", "flv",
      "-flvflags", "no_duration_filesize",

      rtmpUrl,
    ],
    {
      detached: false, // ✅ NOT detached — we monitor this process
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  // ✅ Drain stdout — warna 64KB buffer full hoga aur process freeze
  ffmpeg.stdout?.resume();

  // Log stderr to file
  ensureLogDir().then(() => {
    const logPath = path.join(LOG_DIR, `${playlistId}.log`);
    const logStream = createWriteStream(logPath, { flags: "a" });
    const ts = new Date().toISOString();
    logStream.write(`\n--- Stream started at ${ts} ---\n`);
    ffmpeg.stderr?.pipe(logStream);
  });

  ffmpeg.on("exit", (code, signal) => {
    console.log(`[YT-Stream][${playlistId}] FFmpeg exited — code=${code} signal=${signal}`);
    streamProcesses.delete(playlistId);
    onExit(code);
  });

  ffmpeg.on("error", (err) => {
    console.error(`[YT-Stream][${playlistId}] Spawn error:`, err.message);
    streamProcesses.delete(playlistId);
    onExit(-1);
  });

  return ffmpeg;
}

export async function POST(req: NextRequest) {
  const { playlistId, streamKey } = await req.json();

  if (!playlistId || !streamKey) {
    return NextResponse.json({ error: "playlistId and streamKey required" }, { status: 400 });
  }

  // Kill existing process if any
  const existing = streamProcesses.get(playlistId);
  if (existing && !existing.killed) {
    existing.kill("SIGTERM");
    streamProcesses.delete(playlistId);
    await new Promise((r) => setTimeout(r, 1500));
  }

  const videos = await prisma.video.findMany({
    where: { playlistId },
    orderBy: { order: "asc" },
  });

  if (!videos.length) {
    return NextResponse.json({ error: "No videos in playlist" }, { status: 400 });
  }

  const concatPath = `/tmp/${playlistId}-concat.txt`;
  await writeConcatFile(concatPath, videos.map((v) => v.filePath));

  const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

  // ✅ Auto-restart on unexpected crash
  const onExit = async (code: number | null) => {
    await new Promise((r) => setTimeout(r, 2000)); // brief delay

    const current = await prisma.streamConfig.findFirst({ where: { playlistId } });

    // Sirf restart karo agar DB mein LIVE hai (user ne stop nahi kiya)
    if (current?.status !== "LIVE") {
      console.log(`[YT-Stream][${playlistId}] Status is ${current?.status} — skipping restart`);
      return;
    }

    console.log(`[YT-Stream][${playlistId}] Unexpected exit (code=${code}) — restarting in 5s...`);
    await new Promise((r) => setTimeout(r, 5000));

    // Fresh video list fetch karo
    const freshVideos = await prisma.video.findMany({
      where: { playlistId },
      orderBy: { order: "asc" },
    });
    if (!freshVideos.length) {
      await prisma.streamConfig.update({
        where: { playlistId },
        data: { status: "OFFLINE", pid: null },
      });
      return;
    }

    await writeConcatFile(concatPath, freshVideos.map((v) => v.filePath));

    const newProc = startFFmpeg(playlistId, concatPath, rtmpUrl, onExit);
    streamProcesses.set(playlistId, newProc);

    await prisma.streamConfig.update({
      where: { playlistId },
      data: { pid: newProc.pid },
    });

    console.log(`[YT-Stream][${playlistId}] Restarted — new PID: ${newProc.pid}`);
  };

  const ffmpeg = startFFmpeg(playlistId, concatPath, rtmpUrl, onExit);
  streamProcesses.set(playlistId, ffmpeg);

  await prisma.streamConfig.upsert({
    where: { playlistId },
    update: { status: "LIVE", pid: ffmpeg.pid, streamKey },
    create: {
      playlistId,
      streamKey,
      title: "",
      tags: [],
      status: "LIVE",
      pid: ffmpeg.pid,
    },
  });

  console.log(`[YT-Stream][${playlistId}] Started — PID: ${ffmpeg.pid}`);
  return NextResponse.json({ status: "started", pid: ffmpeg.pid });
}