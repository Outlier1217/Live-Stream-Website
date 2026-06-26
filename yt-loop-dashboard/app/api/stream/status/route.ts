import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const playlistId = searchParams.get("playlistId");

  if (!playlistId) {
    return NextResponse.json({ error: "playlistId required" }, { status: 400 });
  }

  const config = await prisma.streamConfig.findFirst({ where: { playlistId } });
  if (!config) {
    return NextResponse.json({ status: "OFFLINE", pid: null });
  }

  // ✅ PID alive hai ya nahi — verify karo
  let pidAlive = false;
  if (config.pid) {
    try {
      // kill -0 = process existence check, koi signal nahi bhejta
      process.kill(config.pid, 0);
      pidAlive = true;
    } catch {
      pidAlive = false;
    }
  }

  // DB aur reality mein mismatch — fix karo
  if (config.status === "LIVE" && !pidAlive) {
    await prisma.streamConfig.update({
      where: { id: config.id },
      data: { status: "OFFLINE", pid: null },
    });
    return NextResponse.json({ status: "OFFLINE", pid: null, corrected: true });
  }

  return NextResponse.json({
    status: config.status,
    pid: config.pid,
    pidAlive,
  });
}