import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import prisma from "@/lib/prisma";

const STORAGE_PATH = process.env.STORAGE_PATH || "/var/lib/yt-storage";
const VIDEOS_DIR = path.join(STORAGE_PATH, "videos");
const THUMBS_DIR = path.join(STORAGE_PATH, "thumbnails");

function convertToStreamReady(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", inputPath,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "18",
      "-vf", "fps=30",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ]);

    ffmpeg.stderr.on("data", () => {}); // suppress logs
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
  });
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const file = formData.get("file") as File | null;
  const thumbnail = formData.get("thumbnail") as File | null;
  const playlistId = formData.get("playlistId") as string;
  const title = formData.get("title") as string;
  const description = (formData.get("description") as string) || "";
  const tagsRaw = (formData.get("tags") as string) || "";
  const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);

  if (!file || !playlistId || !title) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  await mkdir(VIDEOS_DIR, { recursive: true });
  await mkdir(THUMBS_DIR, { recursive: true });

  // Save original file temporarily
  const tempFilename = `temp-${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
  const tempPath = path.join(VIDEOS_DIR, tempFilename);
  const videoBuffer = Buffer.from(await file.arrayBuffer());
  await writeFile(tempPath, videoBuffer);

  // Convert to stream-ready CFR h264/aac with faststart
  const finalFilename = `${Date.now()}-converted-${file.name.replace(/\s+/g, "_").replace(/\.[^.]+$/, "")}.mp4`;
  const finalPath = path.join(VIDEOS_DIR, finalFilename);

  try {
    await convertToStreamReady(tempPath, finalPath);
    await unlink(tempPath); // delete temp file
  } catch (err) {
    // fallback: use original if conversion fails
    await writeFile(finalPath, videoBuffer);
    if (existsSync(tempPath)) await unlink(tempPath);
  }

  // Handle thumbnail
  let thumbnailPath: string | null = null;
  if (thumbnail) {
    const thumbFilename = `${Date.now()}-${thumbnail.name.replace(/\s+/g, "_")}`;
    thumbnailPath = path.join(THUMBS_DIR, thumbFilename);
    const thumbBuffer = Buffer.from(await thumbnail.arrayBuffer());
    await writeFile(thumbnailPath, thumbBuffer);
  }

  const lastVideo = await prisma.video.findFirst({
    where: { playlistId },
    orderBy: { order: "desc" },
  });
  const nextOrder = (lastVideo?.order ?? -1) + 1;

  const video = await prisma.video.create({
    data: {
      title, description, tags,
      thumbnail: thumbnailPath,
      filePath: finalPath,
      order: nextOrder,
      playlistId,
    },
  });

  return NextResponse.json(video);
}