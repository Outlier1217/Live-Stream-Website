import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Same Map reference — same Node process mein hai
// Note: ye dynamic import trick hai taaki Map share ho
const getProcessMap = (): Map<string, import("child_process").ChildProcess> => {
  const g = global as typeof global & {
    _streamProcesses?: Map<string, import("child_process").ChildProcess>;
  };
  if (!g._streamProcesses) {
    g._streamProcesses = new Map();
  }
  return g._streamProcesses;
};

export async function POST(req: NextRequest) {
  const { playlistId } = await req.json();

  if (!playlistId) {
    return NextResponse.json({ error: "playlistId required" }, { status: 400 });
  }

  // ✅ DB mein pehle OFFLINE kar do — auto-restart ko rokne ke liye
  const config = await prisma.streamConfig.findFirst({ where: { playlistId } });

  await prisma.streamConfig.update({
    where: { id: config!.id },
    data: { status: "OFFLINE", pid: null },
  });

  // Process kill karo
  const pid = config?.pid;
  if (pid) {
    try {
      // Pehle SIGTERM, phir agar 3 sec mein na mare toh SIGKILL
      process.kill(pid, "SIGTERM");

      setTimeout(() => {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already dead — ignore
        }
      }, 3000);
    } catch {
      console.log(`[Stream ${playlistId}] Process ${pid} already dead`);
    }
  }

  return NextResponse.json({ status: "stopped" });
}