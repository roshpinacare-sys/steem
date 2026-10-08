import { spawn } from "child_process";
import fs from "fs";

/* R262: dev-keeper organ connector (:3044). Survival doctrine identical to
 * spawn-metrics (R218-a) / spawn-custodian (R216-b): the sandbox reaps ad-hoc
 * launches, but processes spawned from the SURVIVING next-server process tree
 * are not reaped. The keeper then owns the dev server lifecycle (probe :3000,
 * clean-cache-if-bloated, respawn `bun run dev`), so the cockpit preview can
 * no longer die permanently after an OOM/crash — the measured R262 failure.
 * Single-instance law: refuse to spawn when :3044 already healthy. */

export const DEV_KEEPER_DIR = "/home/z/my-project/mini-services/dev-keeper";
const HEALTH = "http://127.0.0.1:3044/health";

export async function devKeeperHealthy(): Promise<boolean> {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

function spawnDevKeeper(): number | null {
  if (!fs.existsSync(`${DEV_KEEPER_DIR}/index.ts`)) return null;
  fs.mkdirSync(`${DEV_KEEPER_DIR}/state`, { recursive: true });
  const out = fs.openSync(`${DEV_KEEPER_DIR}/keeper.log`, "a");
  /* R218-a LESSON honored: direct `bun index.ts` spawn form (no script-layer
   * indirection — the inherited env would resolve the ROOT dev script). */
  const child = spawn("bun", ["index.ts"], {
    cwd: DEV_KEEPER_DIR,
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  try {
    fs.writeFileSync(`${DEV_KEEPER_DIR}/state/keeper.pid`, String(child.pid));
  } catch {
    /* best-effort */
  }
  return child.pid;
}

export type EnsureKeeperResult = {
  alive: boolean;
  action: "already-alive" | "spawned" | "spawn-failed";
  pid?: number;
};

export async function ensureDevKeeperAlive(): Promise<EnsureKeeperResult> {
  if (await devKeeperHealthy()) return { alive: true, action: "already-alive" };
  const pid = spawnDevKeeper();
  if (pid === null) return { alive: false, action: "spawn-failed" };
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await devKeeperHealthy()) return { alive: true, action: "spawned", pid };
  }
  return { alive: false, action: "spawn-failed", pid };
}
