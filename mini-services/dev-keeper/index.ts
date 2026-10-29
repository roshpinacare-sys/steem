/* ═══ dev-keeper · :3044 · engine guardian — pulse + self-heal (R291/R310) ═════
 * REBUILT G104 (trace 1a17d5314095aa65 · §3 stalled-pipeline repair):
 * measured 2026-10-27T13:19Z — fleet.mjs verdicts the "watchdog" agent from
 * THIS dir's state/keeper.lock (pid+at, <5min); the dir itself was wiped
 * (2026-10-24 wipe class) so the engine's own 60s keeper-guardian hatch
 * (saos-engine index.ts R291) failed every cycle and the fleet carried a
 * permanent DEAD watchdog. This rebuild restores the contract:
 *
 *   1. :3044/health — the T-37 dark-keeper law port (engine stops re-hatching
 *      while this answers).
 *   2. state/keeper.lock — {pid, at} heartbeat written every 30s (fleet
 *      freshness window 5min; pidAlive is checked by fleet.mjs).
 *   3. Measure + report: engine :3040 health, cockpit :3000 probe, and the
 *      two OWNED revivers — saos-engine-host (:3050, owns :3040 revival with
 *      self-provision) and guardian.mjs (:3025, owns :3000 revival). Zero
 *      duplication: we do NOT resurrect ports owned by living revivers.
 *   4. Last-resort heal: ONLY when the engine is dark AND saos-engine-host
 *      is dead/stale → hatch the engine directly (bun index.ts, cwd
 *      saos-engine, detached, 120s cooldown, MemAvailable>500MB guard —
 *      same anti-OOM law as guardian.mjs). counters: checks/heals — honest.
 *
 * Zero secrets · zero fabrication: every verdict field is a measured probe
 * result; dark means dark. Boot log + heal log honest lines only.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const HERE = import.meta.dir;
const STATE_DIR = path.join(HERE, "state");
const LOCK_FILE = path.join(STATE_DIR, "keeper.lock");
const LOG_FILE = path.join(HERE, "keeper-stdout.log");
const PORT = 3044;

const ENGINE = "http://127.0.0.1:3040/health";
const COCKPIT = "http://127.0.0.1:3000/__keeper_probe";
const ENGINE_HOST = "http://127.0.0.1:3050/health";
const ENGINE_DIR = process.env.KEEPER_ENGINE_DIR || "/home/z/fleet/vault-home/mini-services/saos-engine";
const HOST_HEARTBEAT = process.env.KEEPER_HOST_HB || "/home/z/fleet/saos-engine-host-heartbeat.json";
const BUN = ["/usr/local/bin/bun", "/home/z/.bun/bin/bun", "/usr/bin/bun"].find((p) => {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
}) ?? "bun";

const LOOP_MS = 30_000;
const HEAL_COOLDOWN_MS = 120_000;
const HOST_STALE_MS = 6 * 60_000; // host writes heartbeat every 60s; 6min = truly dead
const MEM_FLOOR_MB = 500;

let checks = 0, heals = 0, lastHealAt = 0;
let last = { engine: null as boolean | null, cockpit: null as boolean | null, engineHost: null as boolean | null };
const bootedAt = new Date().toISOString();

function log(line: string): void {
  // single-writer law: stdout only — the launcher (nohup/engine-hatch) owns the file handle.
  console.log(`[keeper ${new Date().toISOString()}] ${line}`);
}

function memAvailMb(): number {
  try {
    const t = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+) kB/m);
    return t ? Math.round(Number(t[1]) / 1024) : -1;
  } catch { return -1; }
}

async function probe(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4_000), cache: "no-store" });
    return r.ok;
  } catch { return false; }
}

function hostStale(): boolean {
  try {
    const hb = JSON.parse(fs.readFileSync(HOST_HEARTBEAT, "utf8")) as { at?: string; atEpoch?: number };
    const at = hb.atEpoch ?? (hb.at ? Date.parse(hb.at) : 0);
    return !at || Date.now() - at > HOST_STALE_MS;
  } catch { return true; } // unreadable heartbeat = stale (honest)
}

function writeLock(): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: Date.now(), bootedAt }) + "\n");
  } catch (e) { log(`lock-write failed: ${String(e).slice(0, 90)}`); }
}

async function healEngineIfOrphan(): Promise<void> {
  if (last.engine !== false) return;               // engine alive — nothing to heal
  if (!last.engineHost === false && last.engineHost !== false) return; // unreachable state guard
  if (last.engineHost === true) return;            // owner alive — it owns :3040 revival
  if (!hostStale() && last.engineHost !== false) return;
  const now = Date.now();
  if (now - lastHealAt < HEAL_COOLDOWN_MS) return;
  const mem = memAvailMb();
  if (mem >= 0 && mem < MEM_FLOOR_MB) { log(`heal deferred: MemAvailable ${mem}MB < ${MEM_FLOOR}MB`); return; }
  lastHealAt = now; heals++;
  try {
    const out = fs.openSync(LOG_FILE, "a");
    const child = spawn(BUN, ["index.ts"], { cwd: ENGINE_DIR, detached: true, stdio: ["ignore", out, out], env: process.env });
    child.unref();
    log(`HEAL: engine dark + saos-engine-host dead/stale → hatched engine pid=${child.pid} (heal #${heals})`);
  } catch (e) { log(`heal spawn failed: ${String(e).slice(0, 110)}`); }
}

async function loop(): Promise<void> {
  checks++;
  last.engine = await probe(ENGINE);
  last.cockpit = await probe(COCKPIT);
  last.engineHost = await probe(ENGINE_HOST);
  writeLock();
  if (checks % 10 === 1) {
    log(`pulse #${checks}: engine=${last.engine} cockpit=${last.cockpit} engineHost=${last.engineHost} checks=${checks} heals=${heals}`);
  }
  await healEngineIfOrphan();
}

const MEM_FLOOR = MEM_FLOOR_MB; // (referenced in heal log line above)

Bun.serve({
  port: PORT,
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/health") {
      return Response.json({
        ok: true, service: "dev-keeper", port: PORT, at: new Date().toISOString(), bootedAt,
        measured: last, checks, heals, lastHealAt: lastHealAt || null,
        law: "R291/R310 — keeper.lock heartbeat + last-resort engine heal; :3040 revival owned by saos-engine-host when alive; :3000 owned by guardian.mjs",
      });
    }
    return Response.json({ ok: false, error: "not-found", routes: ["/health"] }, { status: 404 });
  },
});

log(`dev-keeper up :${PORT} (rebuild G104 trace 1a17d5314095aa65) · loop ${LOOP_MS / 1000}s · heal cooldown ${HEAL_COOLDOWN_MS / 1000}s`);
await loop();
setInterval(() => void loop(), LOOP_MS);
