import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * GET /api/ops/agent/log → { ok, size, mtime, lines } — the daemon's own log
 * tail (agent/agent.log, last 120 lines). Full transparency of what the
 * sovereign daemon actually did, straight in the console.
 */

const LOG_PATH = path.join(process.cwd(), "agent", "agent.log");

export async function GET() {
  try {
    const [raw, st] = await Promise.all([readFile(LOG_PATH, "utf8"), stat(LOG_PATH)]);
    const lines = raw.split("\n").filter((l) => l.trim().length > 0).slice(-120);
    return NextResponse.json({
      ok: true,
      mtime: st.mtime.toISOString(),
      lines,
    });
  } catch {
    return NextResponse.json({ ok: true, lines: [], mtime: null });
  }
}
