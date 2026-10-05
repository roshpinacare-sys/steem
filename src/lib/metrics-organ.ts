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
  const child = spawn("bun", ["run", "dev"], {
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
