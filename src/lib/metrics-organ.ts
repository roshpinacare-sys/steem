import { spawn } from "child_process";
import fs from "fs";

/* R218-a: metrics organ connector (:3042). Survival doctrine identical to
 * spawn-custodian (R216-b): the sandbox reaps ad-hoc launches; organs live in
 * the SURVIVING next-server process tree. Demand-heal: callers of the read API
 * resurrect the organ only when someone actually needs the data.
 * Single-instance law: refuse to spawn when :3042 already healthy. */

export const METRICS_DIR = "/home/z/my-project/mini-services/saos-metrics";
const HEALTH = "http://127.0.0.1:3042/health";
const SNAPSHOT = "http://127.0.0.1:3042/snapshot";

export async function metricsHealthy(): Promise<boolean> {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

function spawnMetrics(): number | null {
  if (!fs.existsSync(`${METRICS_DIR}/index.ts`)) return null;
  fs.mkdirSync(`${METRICS_DIR}/state`, { recursive: true });
  const out = fs.openSync(`${METRICS_DIR}/metrics.log`, "a");
  /* R218-a LESSON (measured, T-15): `bun run dev` under the inherited next-server
   * env resolves the ROOT package.json script (`next dev -p 3000` — EADDRINUSE),
   * NOT the organ's local script. Direct `bun index.ts` is the only correct
   * spawn form — same determinism law as R217 (no script-layer indirection). */
  const child = spawn("bun", ["index.ts"], {
    cwd: METRICS_DIR,
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  try {
    fs.writeFileSync(`${METRICS_DIR}/metrics.pid`, String(child.pid));
  } catch {
    /* best-effort */
  }
  return child.pid;
}

export type EnsureResult = {
  alive: boolean;
  action: "already-alive" | "spawned" | "spawn-failed";
  pid?: number;
};

export async function ensureMetricsAlive(): Promise<EnsureResult> {
  if (await metricsHealthy()) return { alive: true, action: "already-alive" };
  const pid = spawnMetrics();
  if (pid === null) return { alive: false, action: "spawn-failed" };
  /* 3 verify rounds x 2s — same bounded-verify doctrine as the watchdog */
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await metricsHealthy()) return { alive: true, action: "spawned", pid };
  }
  return { alive: false, action: "spawn-failed", pid };
}

export async function fetchSnapshot(): Promise<unknown | null> {
  try {
    const r = await fetch(SNAPSHOT, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/* R218-b: claims-auditor. GET = fresh-if-stale (organ's 6h bound);
 * POST = force re-run. A run fetches the page's own status proxy (30s engine
 * build), so the timeout is generous — the organ answers after it finishes. */
export async function fetchAudit(force = false): Promise<unknown | null> {
  try {
    const r = await fetch(`http://127.0.0.1:3042/audit`, {
      method: force ? "POST" : "GET",
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/* R218-c: merkle event-anchoring snapshot. GET = verify now; POST = force
 * anchor a new batch then verify. Local math only (seconds). */
export async function fetchMerkle(force = false): Promise<unknown | null> {
  try {
    const r = await fetch(`http://127.0.0.1:3042/merkle`, {
      method: force ? "POST" : "GET",
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
