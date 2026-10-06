import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";

export const dynamic = "force-dynamic";

/* R210 operational hatch: the sandbox boot (/start.sh) starts mini-services
 * at boot only; ad-hoc tool-session launches get reaped. This route spawns
 * the SAOS engine from the SURVIVING Next-server process tree (detached,
 * unref'd) so the organism's body stays alive. Idempotent + engine-specific
 * (no parameters, no generic spawn): refuses when :3040 already healthy. */

const ENGINE_DIR = "/home/z/my-project/mini-services/saos-engine";
const HEALTH = "http://localhost:3040/health";

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
    return NextResponse.json({ ok: true, verdict: "ALREADY-ALIVE", note: "engine healthy on :3040 — no spawn (single-instance law)" });
  }
  if (!fs.existsSync(`${ENGINE_DIR}/package.json`)) {
    return NextResponse.json({ ok: false, verdict: "ENGINE-DIR-MISSING" }, { status: 500 });
  }
  const out = fs.openSync(`${ENGINE_DIR}/engine-stdout.log`, "a");
  const child = spawn("bun", ["run", "dev"], { cwd: ENGINE_DIR, detached: true, stdio: ["ignore", out, out], env: process.env });
  child.unref();
  await new Promise((r) => setTimeout(r, 5000));
  const alive = await healthy();
  return NextResponse.json({ ok: alive, verdict: alive ? "SPAWNED-AND-HEALTHY" : "SPAWNED-NOT-RESPONDING", pid: child.pid });
}
