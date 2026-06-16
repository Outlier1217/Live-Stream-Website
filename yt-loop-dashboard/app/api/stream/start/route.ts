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
    return NextResponse.json({ error: "No videos in playlist" }, { status: 400 });
  }

  const concatPath = `/tmp/${playlistId}-concat.txt`;
  const concatContent = videos
    .map((v: { filePath: string }) => `file '${v.filePath}'`)
    .join("\n");
  await writeFile(concatPath, concatContent);

  const rtmpUrl = `rtmp://a.rtmp.youtube.com/live2/${streamKey}`;

  const ffmpeg = spawn("ffmpeg", [
    "-re",
    "-stream_loop", "-1",
    "-f", "concat",
    "-safe", "0",
    "-i", concatPath,
    "-c:v", "copy",
    "-c:a", "copy",
    "-f", "flv",
    "-flvflags", "no_duration_filesize",
    rtmpUrl,
  ], { detached: true, stdio: "ignore" });

  ffmpeg.unref();

  await prisma.streamConfig.upsert({
    where: { playlistId },
    update: { status: "LIVE", pid: ffmpeg.pid },
    create: {
      playlistId, streamKey, title: "", tags: [],
      status: "LIVE", pid: ffmpeg.pid,
    },
  });

  return NextResponse.json({ status: "started", pid: ffmpeg.pid });
}
