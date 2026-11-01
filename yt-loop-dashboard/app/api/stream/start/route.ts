import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { execFile, spawn, ChildProcess } from "child_process";
import { createWriteStream } from "fs";
import path from "path";
import { promisify } from "util";
import prisma from "@/lib/prisma";

const LOG_DIR = "/var/log/yt-streams";
const execFileAsync = promisify(execFile);

type StreamMode =
  | { copy: true }
  | { copy: false; reason: string };

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  time_base?: string;
  codec_tag_string?: string;
  sample_aspect_ratio?: string;
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  field_order?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  extradata?: string;
};

type ProbeResult = {
  streams?: ProbeStream[];
  frames?: Array<{
    key_frame?: number;
    best_effort_timestamp_time?: string;
    pkt_pts_time?: string;
    pkt_dts_time?: string;
  }>;
  format?: { duration?: string; start_time?: string };
};

function parseRational(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return undefined;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isFinite(numerator) || denominator <= 0) return undefined;
  return numerator / denominator;
}

function canonicalRational(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return undefined;
  let numerator = Number(match[1]);
  let denominator = Number(match[2]);
  if (
    !Number.isSafeInteger(numerator) || numerator <= 0 ||
    !Number.isSafeInteger(denominator) || denominator <= 0
  ) {
    return undefined;
  }
  let left = numerator;
  let right = denominator;
  while (right !== 0) {
    [left, right] = [right, left % right];
  }
  const divisor = left || 1;
  numerator /= divisor;
  denominator /= divisor;
  return `${numerator}/${denominator}`;
}

async function runFFprobe(args: string[]): Promise<ProbeResult> {
  const { stdout } = await execFileAsync("ffprobe", args, {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout) as ProbeResult;
}

async function inspectVideo(filePath: string): Promise<string> {
  const metadata = await runFFprobe([
    "-v", "error",
    "-show_streams",
    "-show_format",
    "-show_data",
    "-of", "json",
    filePath,
  ]);
  const streams = metadata.streams ?? [];
  if (streams.length !== 2) {
    throw new Error("expected exactly one video and one audio stream with no additional streams");
  }

  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  if (videoStreams.length !== 1 || audioStreams.length !== 1) {
    throw new Error("expected exactly one usable video stream and one usable audio stream");
  }

  const video = videoStreams[0];
  const audio = audioStreams[0];
  const avgFrameRate = parseRational(video.avg_frame_rate);
  const nominalFrameRate = parseRational(video.r_frame_rate);
  const videoTimeBase = canonicalRational(video.time_base);
  const audioTimeBase = canonicalRational(audio.time_base);
  const sampleRate = Number(audio.sample_rate);

  if (
    video.codec_name !== "h264" ||
    !video.profile ||
    typeof video.level !== "number" || !Number.isInteger(video.level) || video.level <= 0 ||
    typeof video.width !== "number" || !Number.isInteger(video.width) || video.width <= 0 || video.width % 2 !== 0 ||
    typeof video.height !== "number" || !Number.isInteger(video.height) || video.height <= 0 || video.height % 2 !== 0 ||
    video.pix_fmt !== "yuv420p" ||
    !avgFrameRate || !nominalFrameRate ||
    avgFrameRate < 24 || avgFrameRate > 60 ||
    avgFrameRate !== nominalFrameRate ||
    !videoTimeBase || !audioTimeBase ||
    !video.extradata || !audio.extradata ||
    audio.codec_name !== "aac" ||
    audio.profile !== "LC" ||
    (sampleRate !== 44_100 && sampleRate !== 48_000) ||
    audio.channels !== 2 ||
    audio.channel_layout !== "stereo"
  ) {
    throw new Error("stream codec, profile, dimensions, pixel format, timing, or audio layout is unsupported");
  }

  const keyframes = await runFFprobe([
    "-v", "error",
    "-select_streams", "v:0",
    "-skip_frame", "nokey",
    "-show_frames",
    "-show_entries", "frame=key_frame,best_effort_timestamp_time,pkt_pts_time,pkt_dts_time",
    "-of", "json",
    filePath,
  ]);
  const times = (keyframes.frames ?? [])
    .filter((frame) => frame.key_frame === 1)
    .map((frame) => Number(
      frame.best_effort_timestamp_time ?? frame.pkt_pts_time ?? frame.pkt_dts_time
    ))
    .filter(Number.isFinite);
  times.sort((left, right) => left - right);
  const duration = Number(metadata.format?.duration);
  const startTime = Number(metadata.format?.start_time);

  if (
    times.length < 3 ||
    !Number.isFinite(duration) || duration <= 0 ||
    !Number.isFinite(startTime)
  ) {
    throw new Error("keyframe interval could not be verified reliably");
  }

  const firstKeyframeOffset = times[0] - startTime;
  const finalKeyframeGap = duration - (times[times.length - 1] - startTime);
  if (
    Math.abs(firstKeyframeOffset) > 0.2 ||
    finalKeyframeGap < -0.2 ||
    finalKeyframeGap > 2.2
  ) {
    throw new Error("keyframes do not cover the video with a suitable interval");
  }

  for (let index = 1; index < times.length; index += 1) {
    const interval = times[index] - times[index - 1];
    if (interval < 1.8 || interval > 2.2) {
      throw new Error("keyframe interval is not approximately two seconds");
    }
  }

  return JSON.stringify({
    video: {
      codec: video.codec_name,
      profile: video.profile,
      level: video.level,
      width: video.width,
      height: video.height,
      pixelFormat: video.pix_fmt,
      averageFrameRate: canonicalRational(video.avg_frame_rate),
      nominalFrameRate: canonicalRational(video.r_frame_rate),
      timeBase: videoTimeBase,
      codecTag: video.codec_tag_string,
      sampleAspectRatio: video.sample_aspect_ratio,
      colorRange: video.color_range,
      colorSpace: video.color_space,
      colorTransfer: video.color_transfer,
      colorPrimaries: video.color_primaries,
      fieldOrder: video.field_order,
      extradata: video.extradata,
    },
    audio: {
      codec: audio.codec_name,
      profile: audio.profile,
      sampleRate,
      channels: audio.channels,
      channelLayout: audio.channel_layout,
      timeBase: audioTimeBase,
      codecTag: audio.codec_tag_string,
      extradata: audio.extradata,
    },
  });
}

async function selectStreamMode(filePaths: string[]): Promise<StreamMode> {
  let expectedSignature: string | undefined;
  let failureReason: string | undefined;
  for (const filePath of filePaths) {
    try {
      const signature = await inspectVideo(filePath);
      if (!expectedSignature) {
        expectedSignature = signature;
      } else if (signature !== expectedSignature && !failureReason) {
        failureReason = `incompatible stream parameters in ${filePath}`;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown ffprobe error";
      if (!failureReason) {
        failureReason = `cannot safely copy ${filePath}: ${reason}`;
      }
    }
  }
  if (failureReason) return { copy: false, reason: failureReason };
  return expectedSignature
    ? { copy: true }
    : { copy: false, reason: "playlist has no files to probe" };
}

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

/** Spawn FFmpeg with the selected, prevalidated playlist mode. */
function startFFmpeg(
  playlistId: string,
  concatPath: string,
  rtmpUrl: string,
  mode: StreamMode,
  onExit: (code: number | null) => void
): ChildProcess {
  console.log(mode.copy
    ? `[YT-Stream][${playlistId}] COPY MODE selected`
    : `[YT-Stream][${playlistId}] TRANSCODE MODE selected: ${mode.reason}`);

  const args = [
    // ── INPUT ──────────────────────────────────────────────────────────────
    "-re",                          // Real-time speed mein read karo
    "-stream_loop", "-1",          // ✅ Infinite loop — concat list ko khud repeat karega
    "-fflags", "+genpts",          // ✅ Sirf genpts — igndts hata diya (wahi stuck karta tha)
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
  ];

  if (mode.copy) {
    args.push(
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-c:v", "copy",
      "-c:a", "copy",
      "-max_muxing_queue_size", "1024"
    );
  } else {
    args.push(
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

      // ── AUDIO ENCODING ───────────────────────────────────────────────────
      "-c:a", "aac",
      "-b:a", "160k",
      "-ar", "44100",
      "-ac", "2",

      // ── BITRATE CONTROL ──────────────────────────────────────────────────
      "-maxrate", "2500k",
      "-bufsize", "5000k"
    );
  }

  args.push(
    // ── OUTPUT / RTMP ───────────────────────────────────────────────────────
    "-f", "flv",
    "-flvflags", "no_duration_filesize",
    "-reconnect", "1",             // ✅ RTMP drop pe reconnect try karo
    "-reconnect_at_eof", "1",      // ✅ EOF pe bhi reconnect
    rtmpUrl
  );

  const ffmpeg = spawn("ffmpeg", args, {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

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
    if (streamProcesses.get(playlistId) === ffmpeg) {
      streamProcesses.delete(playlistId);
      stopHealthMonitor(playlistId);
    }
    onExit(code);
  });

  ffmpeg.on("error", (err) => {
    console.error(`[YT-Stream][${playlistId}] Spawn error:`, err.message);
    if (streamProcesses.get(playlistId) === ffmpeg) {
      streamProcesses.delete(playlistId);
      stopHealthMonitor(playlistId);
    }
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
  let restarting = false;

  const interval = setInterval(async () => {
    if (restarting) return;
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
      if (streamProcesses.get(playlistId) !== proc) return;
      restarting = true;
      try {
        const freshVideos = await prisma.video.findMany({
          where: { playlistId },
          orderBy: { order: "asc" },
        });
        if (!freshVideos.length) {
          stopHealthMonitor(playlistId);
          await prisma.streamConfig.update({
            where: { id: config.id },
            data: { status: "OFFLINE", pid: null },
          });
          return;
        }

        const filePaths = freshVideos.map((video) => video.filePath);
        await writeConcatFile(concatPath, filePaths);
        const mode = await selectStreamMode(filePaths);
        if (streamProcesses.get(playlistId) !== proc) return;

        const newProc = startFFmpeg(playlistId, concatPath, rtmpUrl, mode, onExit);
        streamProcesses.set(playlistId, newProc);
        startHealthMonitor(playlistId, concatPath, rtmpUrl, onExit);
        await prisma.streamConfig.update({
          where: { id: config.id },
          data: { pid: newProc.pid },
        });
      } catch (error) {
        console.error(`[HealthMonitor][${playlistId}] Restart failed:`, error);
      } finally {
        restarting = false;
      }
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
  const filePaths = videos.map((video) => video.filePath);
  await writeConcatFile(concatPath, filePaths);
  const mode = await selectStreamMode(filePaths);

  const processStartedDuringProbe = streamProcesses.get(playlistId);
  if (processStartedDuringProbe) {
    stopHealthMonitor(playlistId);
    if (!processStartedDuringProbe.killed && processStartedDuringProbe.exitCode === null) {
      processStartedDuringProbe.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (streamProcesses.get(playlistId) === processStartedDuringProbe) {
      streamProcesses.delete(playlistId);
    }
  }

  const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

  // ── onExit callback: unexpected exit hone pe restart ──────────────────────
  const onExit = async (code: number | null) => {
    await new Promise((r) => setTimeout(r, 2000));

    const current = await prisma.streamConfig.findFirst({ where: { playlistId } });
    if (current?.status !== "LIVE") {
      console.log(`[YT-Stream][${playlistId}] Manual stop detected — no restart`);
      return;
    }

    const activeProcess = streamProcesses.get(playlistId);
    if (activeProcess && !activeProcess.killed && activeProcess.exitCode === null) {
      console.log(`[YT-Stream][${playlistId}] Restart already active — skipping duplicate`);
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

    const freshFilePaths = freshVideos.map((video) => video.filePath);
    await writeConcatFile(concatPath, freshFilePaths);
    const freshMode = await selectStreamMode(freshFilePaths);

    const currentProcess = streamProcesses.get(playlistId);
    if (currentProcess && !currentProcess.killed && currentProcess.exitCode === null) {
      console.log(`[YT-Stream][${playlistId}] Restart already active — skipping duplicate`);
      return;
    }

    const newProc = startFFmpeg(playlistId, concatPath, rtmpUrl, freshMode, onExit);
    streamProcesses.set(playlistId, newProc);
    startHealthMonitor(playlistId, concatPath, rtmpUrl, onExit);

    await prisma.streamConfig.update({
      where: { playlistId },
      data: { pid: newProc.pid },
    });

    console.log(`[YT-Stream][${playlistId}] Restarted — PID: ${newProc.pid}`);
  };

  // ── Start ─────────────────────────────────────────────────────────────────
  const ffmpeg = startFFmpeg(playlistId, concatPath, rtmpUrl, mode, onExit);
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