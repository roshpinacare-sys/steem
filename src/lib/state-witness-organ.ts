import { spawn } from "child_process";
import fs from "fs";

/* R273-b: state-witness organ connector (:3046). Survival doctrine identical
 * to spawn-metrics (R218-a) / spawn-dev-keeper (R262): the sandbox reaps
 * ad-hoc launches, but processes spawned from the SURVIVING next-server
 * process tree are not reaped. Measured gap in R273-b: the witness died with
 * the second crash and NOTHING re-spawned it (no route, no watchdog entry) —
 * it had to be launched by hand. This connector closes that gap with the same
 * idempotent, single-instance, refused-when-healthy law as its siblings. */

export const STATE_WITNESS_DIR = "/home/z/my-project/mini-services/state-witness";
const HEALTH = "http://127.0.0.1:3046/health";

export async function stateWitnessHealthy(): Promise<boolean> {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

function spawnStateWitness(): number | null {
  if (!fs.existsSync(`${STATE_WITNESS_DIR}/index.ts`)) return null;
  const out = fs.openSync(`${STATE_WITNESS_DIR}/witness.log`, "a");
  /* R218-a LESSON honored: direct `bun index.ts` spawn form (no script-layer
   * indirection, the inherited env would resolve the ROOT dev script). */
  const child = spawn("bun", ["index.ts"], {
    cwd: STATE_WITNESS_DIR,
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  try {
    fs.writeFileSync(`${STATE_WITNESS_DIR}/witness.pid`, String(child.pid));
  } catch {
    /* best-effort */
  }
  return child.pid;
}

export type EnsureWitnessResult = {
  alive: boolean;
  action: "already-alive" | "spawned" | "spawn-failed";
  pid?: number;
};

export async function ensureStateWitnessAlive(): Promise<EnsureWitnessResult> {
  if (await stateWitnessHealthy()) return { alive: true, action: "already-alive" };
  const pid = spawnStateWitness();
  if (pid === null) return { alive: false, action: "spawn-failed" };
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await stateWitnessHealthy()) return { alive: true, action: "spawned", pid };
  }
  return { alive: false, action: "spawn-failed", pid };
}
