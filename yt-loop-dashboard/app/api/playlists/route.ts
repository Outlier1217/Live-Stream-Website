import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  const playlists = await prisma.playlist.findMany({
    include: { videos: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(playlists);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const playlist = await prisma.playlist.create({ data: { name } });
  return NextResponse.json(playlist);
}