import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

import { AGENT_DIR } from "@/lib/agent-env";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/forkscan — same-key territory audit, read-only.
// Reads agent/forkscan_result.json (written by agent/forkscan.cjs, runnable
// from the console exec engine). Never 500: a missing/corrupt result is
// "no scan yet", which is itself the honest answer.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const raw = await readFile(path.join(AGENT_DIR, "forkscan_result.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return NextResponse.json({ ok: true, ...parsed });
  } catch {
    return NextResponse.json({ ok: true, scannedAt: null, accounts: [], forks: [], summary: null });
  }
}
