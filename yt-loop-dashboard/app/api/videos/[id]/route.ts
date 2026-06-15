import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { unlink } from "fs/promises";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await unlink(video.filePath);
    if (video.thumbnail) await unlink(video.thumbnail);
  } catch {}

  await prisma.video.delete({ where: { id } });

  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const video = await prisma.video.update({
    where: { id },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.tags !== undefined && { tags: body.tags }),
      ...(body.order !== undefined && { order: body.order }),
    },
  });

  return NextResponse.json(video);
}