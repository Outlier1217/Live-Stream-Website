import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";

const STORAGE_PATH = "/var/lib/yt-storage/videos"; // VPS path

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const playlistId = formData.get("playlistId") as string;
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const tags = (formData.get("tags") as string).split(",");

  await mkdir(STORAGE_PATH, { recursive: true });
  const filename = `${Date.now()}-${file.name}`;
  const filepath = path.join(STORAGE_PATH, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const video = await prisma.video.create({
    data: { title, description, tags, filePath: filepath, playlistId },
  });

  return NextResponse.json(video);
}