import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const { playlistId } = await req.json();

  const config = await prisma.streamConfig.findFirst({ where: { playlistId } });
  if (config?.pid) {
    try {
      process.kill(config.pid, "SIGTERM");
    } catch (e) {
      console.log("Process already dead");
    }
  }

  await prisma.streamConfig.update({
    where: { id: config!.id },
    data: { status: "OFFLINE", pid: null },
  });

  return NextResponse.json({ status: "stopped" });
}