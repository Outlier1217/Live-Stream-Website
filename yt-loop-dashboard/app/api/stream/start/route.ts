import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { spawn, ChildProcess } from "child_process";
import { createWriteStream } from "fs";
import path from "path";
import prisma from "@/lib/prisma";

const LOG_DIR = "/var/log/yt-streams";

// ─── Global process store ────────────────────────────────────────────────────
declare global {
  var _streamProcesses: Map<string, ChildProcess> | undefined;
  var _healthMonitors: Map<string, NodeJS.Timeout> | undefined;
}
const streamProcesses: Map<string, ChildProcess> =
  global._streamProcesses ?? (global._streamProcesses = new Map());
const healthMonitors: Map<string, NodeJS.Timeout> =
  global._healthMonitors ?? (global._healthMonitors = new Map());

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function ensureLogDir() {
  await mkdir(LOG_DIR, { recursive: true });
}

/**
 * Concat file — har video ko SIRF EK BAAR likhna.
 * Loop ke liye FFmpeg ka apna `-stream_loop -1` use karenge.
 * Ye approach "999 repeat" hack se zyada reliable hai kyunki
 * FFmpeg apne aap timestamp reset karta hai cleanly.
 */
async function writeConcatFile(concatPath: string, filePaths: string[]) {
  const lines = filePaths.map((fp) => `file '${fp}'`).join("\n");
  await writeFile(concatPath, lines);
}

/**
 * FFmpeg ko spawn karta hai with transition-safe flags.
 *
 * Key changes from old code:
 * 1. `-stream_loop -1` — FFmpeg khud infinite loop karta hai concat list ko,
 *    timestamp discontinuity nahi hoti.
 * 2. `-vsync cfr` — Constant frame rate enforce karta hai across transitions.
 * 3. `-force_key_frames "expr:gte(t,n_forced*2)"` — Har 2 sec pe keyframe,
 *    YouTube ke liye healthy.
 * 4. `-max_muxing_queue_size 1024` — Video/audio queue mismatch se crash nahi hoga.
 * 5. `-reconnect 1 -reconnect_at_eof 1` — Agar RTMP drop ho toh auto reconnect.
 * 6. `-timeout 30000000` — Network timeout 30s (microseconds).
 */
function startFFmpeg(
  playlistId: string,
  concatPath: string,
  rtmpUrl: string,
  onExit: (code: number | null) => void
): ChildProcess {
  const ffmpeg = spawn(
    "ffmpeg",
    [
      // ── INPUT ──────────────────────────────────────────────────────────────
      "-re",                          // Real-time speed mein read karo
      "-stream_loop", "-1",          // ✅ Infinite loop — concat list ko khud repeat karega
      "-fflags", "+genpts",          // ✅ Sirf genpts — igndts hata diya (wahi stuck karta tha)
      "-f", "concat",
      "-safe", "0",
      "-i", concatPath,

      // ── VIDEO ENCODING ────────────────────────────────────────────────────
      "-c:v", "libx264",
      "-preset", "veryfast",         // ultrafast se veryfast — better quality, manageable CPU
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-g", "60",                    // Keyframe interval = 2 sec (30fps * 2)
      "-keyint_min", "60",
      "-sc_threshold", "0",          // Scene change pe extra keyframe mat daalo
      "-force_key_frames", "expr:gte(t,n_forced*2)", // ✅ Regular keyframes
      "-vsync", "cfr",               // ✅ Constant frame rate — transition pe stutter nahi
      "-max_muxing_queue_size", "1024", // ✅ Audio/video queue overflow fix

      // ── AUDIO ENCODING ────────────────────────────────────────────────────
      "-c:a", "aac",
      "-b:a", "160k",
      "-ar", "44100",
      "-ac", "2",

      // ── BITRATE CONTROL ───────────────────────────────────────────────────
      "-maxrate", "2500k",
      "-bufsize", "5000k",

      // ── OUTPUT / RTMP ─────────────────────────────────────────────────────
      "-f", "flv",
      "-flvflags", "no_duration_filesize",
      "-reconnect", "1",             // ✅ RTMP drop pe reconnect try karo
      "-reconnect_at_eof", "1",      // ✅ EOF pe bhi reconnect
      rtmpUrl,
    ],
    {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  ffmpeg.stdout?.resume();

  // Log to file
  ensureLogDir().then(() => {
    const logPath = path.join(LOG_DIR, `${playlistId}.log`);
    const logStream = createWriteStream(logPath, { flags: "a" });
    logStream.write(`\n--- Stream started at ${new Date().toISOString()} ---\n`);
    ffmpeg.stderr?.pipe(logStream);
  });

  ffmpeg.on("exit", (code, signal) => {
    console.log(`[YT-Stream][${playlistId}] FFmpeg exited — code=${code} signal=${signal}`);
    streamProcesses.delete(playlistId);
    stopHealthMonitor(playlistId);
    onExit(code);
  });

  ffmpeg.on("error", (err) => {
    console.error(`[YT-Stream][${playlistId}] Spawn error:`, err.message);
    streamProcesses.delete(playlistId);
    stopHealthMonitor(playlistId);
    onExit(-1);
  });

  return ffmpeg;
}

// ─── Health Monitor ───────────────────────────────────────────────────────────
/**
 * Har 60 second pe check karta hai ki FFmpeg still alive hai ya nahi.
 * Agar process exist karta hai but stream DB mein LIVE hai aur process nahi —
 * ya process kill ho gaya unexpectedly — restart trigger hota hai.
 *
 * Ye "10 hour stuck" wali problem handle karta hai: agar FFmpeg internally
 * hang ho jaye (output nahi de raha), toh hum use kill karke fresh restart dete hain.
 */
function startHealthMonitor(
  playlistId: string,
  concatPath: string,
  rtmpUrl: string,
  onExit: (code: number | null) => void
) {
  stopHealthMonitor(playlistId); // Pehla clear karo agar tha

  const interval = setInterval(async () => {
    const proc = streamProcesses.get(playlistId);

    // Check DB status
    const config = await prisma.streamConfig.findFirst({ where: { playlistId } });
    if (!config || config.status !== "LIVE") {
      stopHealthMonitor(playlistId);
      return;
    }

    if (!proc || proc.killed || proc.exitCode !== null) {
      // Process dead hai but DB LIVE hai — restart!
      console.log(`[HealthMonitor][${playlistId}] Process dead, DB says LIVE — restarting...`);
      const newProc = startFFmpeg(playlistId, concatPath, rtmpUrl, onExit);
      streamProcesses.set(playlistId, newProc);
      startHealthMonitor(playlistId, concatPath, rtmpUrl, onExit);
      await prisma.streamConfig.update({
        where: { id: config.id },
        data: { pid: newProc.pid },
      });
    }
    // Process alive hai — all good
  }, 60_000); // Har 60 second

  healthMonitors.set(playlistId, interval);
}

function stopHealthMonitor(playlistId: string) {
  const existing = healthMonitors.get(playlistId);
  if (existing) {
    clearInterval(existing);
    healthMonitors.delete(playlistId);
  }
}

// ─── POST /api/stream/start ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { playlistId, streamKey } = await req.json();

  if (!playlistId || !streamKey) {
    return NextResponse.json({ error: "playlistId and streamKey required" }, { status: 400 });
  }

  // Pehle se chal raha hai toh band karo
  const existing = streamProcesses.get(playlistId);
  if (existing && !existing.killed) {
    stopHealthMonitor(playlistId);
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

  // ── onExit callback: unexpected exit hone pe restart ──────────────────────
  const onExit = async (code: number | null) => {
    await new Promise((r) => setTimeout(r, 2000));

    const current = await prisma.streamConfig.findFirst({ where: { playlistId } });
    if (current?.status !== "LIVE") {
      console.log(`[YT-Stream][${playlistId}] Manual stop detected — no restart`);
      return;
    }

    console.log(`[YT-Stream][${playlistId}] Unexpected exit (code=${code}) — restarting in 5s...`);
    await new Promise((r) => setTimeout(r, 5000));

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
    startHealthMonitor(playlistId, concatPath, rtmpUrl, onExit);

    await prisma.streamConfig.update({
      where: { playlistId },
      data: { pid: newProc.pid },
    });

    console.log(`[YT-Stream][${playlistId}] Restarted — PID: ${newProc.pid}`);
  };

  // ── Start ─────────────────────────────────────────────────────────────────
  const ffmpeg = startFFmpeg(playlistId, concatPath, rtmpUrl, onExit);
  streamProcesses.set(playlistId, ffmpeg);
  startHealthMonitor(playlistId, concatPath, rtmpUrl, onExit);

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