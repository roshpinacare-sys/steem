import { spawn } from "child_process";
import fs from "fs";

/* R218-d: builder organ connector (:3043). Same survival doctrine as the
 * metrics organ: spawn from the surviving next-server tree, demand-heal,
 * single-instance law. PROPOSAL-ONLY organ — it cannot touch the live tree,
 * git, or keys even if compromised; merge stays a deliberate outside act. */

export const BUILDER_DIR = "/home/z/my-project/mini-services/saos-builder";
const HEALTH = "http://127.0.0.1:3043/health";

export async function builderHealthy(): Promise<boolean> {
  try {
    const r = await fetch(HEALTH, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch {
    return false;
  }
}

function spawnBuilder(): number | null {
  if (!fs.existsSync(`${BUILDER_DIR}/index.ts`)) return null;
  fs.mkdirSync(`${BUILDER_DIR}/state`, { recursive: true });
  const out = fs.openSync(`${BUILDER_DIR}/builder.log`, "a");
  /* R218-a LESSON embedded: direct `bun index.ts` — `bun run dev` under the
   * inherited next-server env resolves the ROOT package.json script. */
  const child = spawn("bun", ["index.ts"], {
    cwd: BUILDER_DIR,
    detached: true,
    stdio: ["ignore", out, out],
    env: process.env,
  });
  child.unref();
  try {
    fs.writeFileSync(`${BUILDER_DIR}/builder.pid`, String(child.pid));
  } catch {
    /* best-effort */
  }
  return child.pid;
}

export async function ensureBuilderAlive(): Promise<{ alive: boolean; action: string; pid?: number }> {
  if (await builderHealthy()) return { alive: true, action: "already-alive" };
  const pid = spawnBuilder();
  if (pid === null) return { alive: false, action: "spawn-failed" };
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await builderHealthy()) return { alive: true, action: "spawned", pid };
  }
  return { alive: false, action: "spawn-failed", pid };
}

async function call(path: string, body?: unknown, method: "GET" | "POST" = "GET", timeoutMs = 20_000): Promise<unknown | null> {
  try {
    const r = await fetch(`http://127.0.0.1:3043${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export const fetchBuilderStatus = () => call("/status");
/* LLM round-trip can take up to ~100s on the second attempt */
export const enqueueTask = (file: string, task: string) => call("/task", { file, task }, "POST", 15_000);
export const tickBuilder = () => call("/tick", {}, "POST", 220_000);
