import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const playlistId = searchParams.get("playlistId");
  if (!playlistId) return NextResponse.json(null);

  const config = await prisma.streamConfig.findUnique({ where: { playlistId } });
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { playlistId, streamKey, title, description, tags, monetization } = body;

  const config = await prisma.streamConfig.upsert({
    where: { playlistId },
    update: { streamKey, title, description, tags, monetization },
    create: { playlistId, streamKey, title, description, tags, monetization },
  });
  return NextResponse.json(config);
}
