import { NextRequest, NextResponse } from "next/server";
import { mkdir } from "fs/promises";
import { createWriteStream } from "fs"; // <-- Yeh naya import add kiya hai
import path from "path";
import prisma from "@/lib/prisma";

const STORAGE_PATH = process.env.STORAGE_PATH || "/var/lib/yt-storage";
const VIDEOS_DIR = path.join(STORAGE_PATH, "videos");
const THUMBS_DIR = path.join(STORAGE_PATH, "thumbnails");

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

  const filename = `${Date.now()}-${file.name.replace(/\s+/g, "_")}`;
  const filepath = path.join(VIDEOS_DIR, filename);
  
  // 🟢 NAYA CODE: Stream use karke memory bachana (For 500MB+ files)
  const writeStream = createWriteStream(filepath);
  const reader = file.stream().getReader();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      writeStream.end();
      break;
    }
    writeStream.write(Buffer.from(value));
  }

  // Thumbnail chhoti hoti hai (1-2 MB), toh usme pehle wala tareeqa chal jayega
  let thumbnailPath: string | null = null;
  if (thumbnail) {
    const thumbFilename = `${Date.now()}-${thumbnail.name.replace(/\s+/g, "_")}`;
    thumbnailPath = path.join(THUMBS_DIR, thumbFilename);
    const thumbArrayBuffer = await thumbnail.arrayBuffer();
    
    const thumbWriteStream = createWriteStream(thumbnailPath);
    thumbWriteStream.write(Buffer.from(thumbArrayBuffer));
    thumbWriteStream.end();
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
      filePath: filepath,
      order: nextOrder,
      playlistId,
    },
  });

  return NextResponse.json(video);
}