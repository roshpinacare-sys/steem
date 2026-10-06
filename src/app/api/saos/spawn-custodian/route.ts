import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";

export const dynamic = "force-dynamic";

/* R216-b: same survival doctrine as spawn-engine — the sandbox reaps ad-hoc
 * tool-session launches; the custodian (:3041, R215 bounded-staleness
 * persistence ≤10min) must live in the SURVIVING next-server process tree.
 * Idempotent + custodian-specific (no parameters, no generic spawn):
 * refuses when :3041 already healthy (single-instance law).
 * Ongoing supervision lives in src/lib/sovereign.ts (v2 watchdog). */

const CUSTODIAN_DIR = "/home/z/my-project/mini-services/saos-custodian";
const HEALTH = "http://localhost:3041/health";

async function healthy() {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function POST() {
  if (await healthy()) {
    return NextResponse.json({ ok: true, verdict: "ALREADY-ALIVE", note: "custodian healthy on :3041 — no spawn (single-instance law)" });
  }
  if (!fs.existsSync(`${CUSTODIAN_DIR}/package.json`)) {
    return NextResponse.json({ ok: false, verdict: "CUSTODIAN-DIR-MISSING" }, { status: 500 });
  }
  const out = fs.openSync(`${CUSTODIAN_DIR}/custodian.log`, "a");
  const child = spawn("bun", ["run", "dev"], { cwd: CUSTODIAN_DIR, detached: true, stdio: ["ignore", out, out], env: process.env });
  child.unref();
  try { fs.writeFileSync(`${CUSTODIAN_DIR}/custodian.pid`, String(child.pid)); } catch { /* best-effort */ }
  await new Promise((r) => setTimeout(r, 5000));
  const alive = await healthy();
  return NextResponse.json({ ok: alive, verdict: alive ? "SPAWNED-AND-HEALTHY" : "SPAWNED-NOT-RESPONDING", pid: child.pid });
}
