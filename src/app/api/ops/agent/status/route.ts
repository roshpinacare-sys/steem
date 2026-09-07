import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { ensureAgentAlive } from "@/lib/agent-keepalive";

export const dynamic = "force-dynamic";

/**
 * Console v4 — local agent status bridge (read-only).
 *
 * The local daemon (agent/agent.cjs, running on the operator's machine) writes
 * agent/agent-status.json every cycle. This endpoint reads that file from the
 * project root and passes the parsed object through — it contains NO secrets
 * (no WIFs, no env values), only feed/window/RC/loop state.
 *
 * Resilience contract (never 500):
 *   - file missing / unreadable / unparseable → { configured: false }, HTTP 200
 *   - file present (old or new schema)        → { configured: true, status }
 *
 * GET /api/ops/agent/status → AgentStatusResponse (see console AgentStatusCard)
 */

const STATUS_PATH = path.join(process.cwd(), "agent", "agent-status.json");

export async function GET() {
  // Sovereign keepalive — the console resurrects its own daemon on every poll.
  ensureAgentAlive();
  try {
    const raw = await readFile(STATUS_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ configured: false });
    }
    // Passthrough — the status file is written by the daemon without secrets.
    return NextResponse.json({ configured: true, status: parsed });
  } catch {
    // ENOENT (not set up yet), EACCES, or invalid JSON → unconfigured, not an error.
    return NextResponse.json({ configured: false });
  }
}
