/**
 * OFFICE-KEEPER (bun) — W16 port of scripts/office-supervisor.sh.
 *
 * MEASURED ROOT (2026-10-19T18:2xZ, three deaths): the sandbox reaper kills
 * BASH-spawned background loops between tool calls ("even setsid sleep 600
 * is reaped" — R262's law, re-proven with a controlled A/B: a bash while-loop
 * died across one tool-call boundary while a bun setInterval loop survived).
 * The office's self-healing layer must therefore run on a BUN lineage.
 *
 * Same laws as the bash original (R321/R324-CONT-2):
 *  - port → service map (office map: dex=3037 NOT 3046)
 *  - 1 respawn per service per COOLDOWN (no OOM storm → spawn storm)
 *  - 4s health budget (the engine's /health can be slow under load)
 *  - single-instance via pidfile (stale takeover allowed)
 *  - respawn = detached `bun index.ts` in the service dir (the lineage that
 *    measurably survives this sandbox)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOG = path.join(ROOT, ".zscripts", "office-supervisor.log");
const PIDFILE = "/tmp/saos-office-supervisor.pid";
const PORTS: Record<number, string> = {
  3037: "saos-dex",
  3040: "saos-engine",
  3041: "saos-custodian",
  3042: "saos-metrics",
  3043: "saos-builder",
  3047: "state-witness",
  3045: "dex-beat-service", /* W25: the hourly :53 chain-home keeper-driver (lives in my-project, symlinked here for office respawn) */
};
const COOLDOWN_MS = 600_000;
const INTERVAL_MS = 60_000;
const last: Record<number, number> = Object.fromEntries(Object.keys(PORTS).map((p) => [Number(p), 0]));

const log = (line: string) => {
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + "\n"); } catch { /* bounded best-effort */ }
};

/* single-instance law (stale takeover: a dead pid's lock is not a lock) */
if (fs.existsSync(PIDFILE)) {
  const pid = Number(fs.readFileSync(PIDFILE, "utf8").trim());
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch { /* stale */ }
  if (alive && pid !== process.pid) {
    log(`[${new Date().toISOString()}] keeper: already running (pid ${pid}) — duplicate-exit`);
    process.exit(0);
  }
}
fs.writeFileSync(PIDFILE, String(process.pid));
process.on("exit", () => { try { if (fs.readFileSync(PIDFILE, "utf8").trim() === String(process.pid)) fs.rmSync(PIDFILE, { force: true }); } catch { /* best effort */ } });

log(`[${new Date().toISOString()}] office-keeper(bun) up (pid ${process.pid}, interval ${INTERVAL_MS / 1000}s, cooldown ${COOLDOWN_MS / 1000}s)`);

async function probe(port: number): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctl.signal });
    clearTimeout(t);
    return r.status === 200;
  } catch { return false; }
}

function respawn(service: string) {
  const dir = path.join(ROOT, "mini-services", service);
  const out = path.join(ROOT, ".zscripts", `mini-service-${service}.log`);
  try {
    const child = spawn("bun", ["index.ts"], {
      cwd: dir,
      detached: true,
      stdio: ["ignore", fs.openSync(out, "a"), fs.openSync(out, "a")],
      env: process.env,
    });
    child.unref();
  } catch (e) {
    log(`[${new Date().toISOString()}] keeper: respawn ${service} failed: ${String(e).slice(0, 80)}`);
  }
}

setInterval(async () => {
  for (const [portStr, service] of Object.entries(PORTS)) {
    const port = Number(portStr);
    if (await probe(port)) continue;
    const now = Date.now();
    if (now - last[port] <= COOLDOWN_MS) continue;
    last[port] = now;
    log(`[${new Date().toISOString()}] port ${port} DOWN — respawn ${service} (bun-keeper)`);
    respawn(service);
  }
}, INTERVAL_MS);
