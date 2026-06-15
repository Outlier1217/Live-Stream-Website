import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { spawn } from "child_process";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { playlistId, streamKey } = await req.json();

  const videos = await prisma.video.findMany({
    where: { playlistId },
    orderBy: { order: "asc" },
  });

  if (!videos.length) {
    return NextResponse.json({ error: "No videos" }, { status: 400 });
  }

  // Create concat file
  const concatPath = `/tmp/${playlistId}-concat.txt`;
  const concatContent = videos
    .map((v) => `file '${v.filePath}'`)
    .join("\n");
  await writeFile(concatPath, concatContent);

  const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

  // Spawn FFmpeg loop
  const ffmpeg = spawn("ffmpeg", [
    "-re",
    "-stream_loop", "-1",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", "3000k",
    "-maxrate", "3000k",
    "-bufsize", "6000k",
    "-pix_fmt", "yuv420p",
    "-g", "60",
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "44100",
    "-f", "flv",
    rtmpUrl,
  ], { detached: true });

  ffmpeg.stderr.on("data", (d) => console.log(d.toString()));

  await prisma.streamConfig.update({
    where: { playlistId },
    data: { status: "LIVE", pid: ffmpeg.pid },
  });

  return NextResponse.json({ status: "started", pid: ffmpeg.pid });
}