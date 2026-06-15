import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { unlink } from "fs/promises";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const playlist = await prisma.playlist.findUnique({
    where: { id },
    include: { videos: { orderBy: { order: "asc" } } },
  });
  if (!playlist) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(playlist);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const videos = await prisma.video.findMany({ where: { playlistId: id } });
  for (const v of videos) {
    try {
      await unlink(v.filePath);
    } catch {}
  }

  await prisma.video.deleteMany({ where: { playlistId: id } });
  await prisma.playlist.delete({ where: { id } });

  return NextResponse.json({ success: true });
}