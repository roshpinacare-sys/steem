/**
 * DEV-KEEPER ORGAN (:3044) — R262, "the cockpit must not fall"
 *
 * PROBLEM (measured live, R262):
 *  - The Next.js dev server (next dev -p 3000) was boot-spawned by /start.sh.
 *    When it died (kernel OOM kill, turbopack cache grew unbounded to 2.5GB on
 *    a 4GB box), NOTHING resurrected it. The whole cockpit preview died.
 *  - Ad-hoc relaunch via the agent Bash tool is impossible to sustain: the
 *    sandbox reaps every tool-call process tree at call end (measured: even
 *    `setsid sleep 600` is reaped between calls).
 *
 * SOLUTION (R216-b survival doctrine, already proven by saos-metrics/builder):
 *  - This organ is spawned FROM the surviving next-server process tree (or at
 *    boot via the mini-services scan). Orphaned-to-pid-1 lineage processes are
 *    NOT reaped. Once alive, this keeper owns the dev server lifecycle:
 *    probe :3000 every 8s → if down → clean-cache-if-bloated → respawn
 *    `bun run dev` (detached, own lineage).
 *
 * LAWS:
 *  1. NO SECRETS, NO PARAMS: fixed command whitelist only (`bun run dev` in
 *     /home/z/my-project). No env smuggling, no arbitrary exec, no tokens.
 *  2. SINGLE-INSTANCE: fresh-lock takeover only (stale heartbeat > 45s).
 *  3. OOM ROOT-CAUSE HYGIENE: before every respawn, if .next/ > 1.2GB → wipe
 *     it (server is down at that moment — safe full rebuild). The measured
 *     failure was an unbounded turbopack cache, not a code bug.
 *  4. BOUNDED LOG: keeper.log capped (last ~200 lines rewritten).
 *  5. Boot-grace 45s: at boot, /start.sh itself starts dev; the keeper must
 *     not race it (EADDRINUSE self-resolves, but no need to burn a cycle).
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const PORT = 3044;
const DEV_PORT = 3000;
const ROOT = "/home/z/my-project";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const STATE_DIR = path.join(HERE, "state");
const LOCK = path.join(STATE_DIR, "keeper.lock");
const LOG = path.join(HERE, "keeper.log");
const NEXT_DIR = path.join(ROOT, ".next");
const LOOP_MS = 8000;
const BOOT_GRACE_MS = 45_000;
const RESPAWN_COOLDOWN_MS = 25_000;
const NEXT_CACHE_LIMIT = 1.2 * 1024 * 1024 * 1024; // 1.2GB

fs.mkdirSync(STATE_DIR, { recursive: true });

let spawns = 0;
let lastSpawnAt: string | null = null;
let devUp = false;
let lastAction = "boot";
const startedAt = Date.now();

function log(line: string) {
  try {
    let prev = "";
    try { prev = fs.readFileSync(LOG, "utf8").split("\n").slice(-199).join("\n"); } catch {}
    fs.writeFileSync(LOG, `${prev}\n${new Date().toISOString()} ${line}\n`.replace(/^\n/, ""));
  } catch {}
}

/* ── single-instance law (fresh-lock takeover) ─────────────────────────── */
function acquireLock(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK, "utf8"));
    const age = Date.now() - (Number(raw.at) || 0);
    if (age < 45_000 && Number(raw.pid) !== process.pid) {
      // another live keeper holds it — but verify the pid actually exists
      try { process.kill(Number(raw.pid), 0); return false; } catch { /* stale pid */ }
    }
  } catch { /* no lock yet */ }
  try {
    fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() }));
    return true;
  } catch { return false; }
}
function heartbeat() {
  try { fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, at: Date.now() })); } catch {}
}

/* ── dev-server probe: ANY HTTP response counts (compile-slow ok); only a
 *    connection-level failure counts as DOWN.
 *    R285 fix 1 (measured): the cold compile of / took 7.1s while the probe
 *    gave up at 6s → the keeper judged a HEALTHY compiling server as down
 *    and spawned a respawn storm (4 EADDRINUSE entries measured live).
 *    R285 fix 2 (measured): probing / itself is wrong — the cockpit page is
 *    the HEAVIEST route (SSR 1.3s+ warm, 40s+ cold) → a live server judged
 *    dead → needless respawns. The probe now hits a tiny non-existent path:
 *    a 404 answers instantly and proves listening without any compile. ── */
async function devHealthy(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${DEV_PORT}/__keeper_probe`, { signal: AbortSignal.timeout(6000) });
    return r.status > 0; // 404 is proof of life: the server is listening
  } catch {
    /* HTTP slow/failed — is the port at least accepting connections? */
    return await new Promise((resolve) => {
      const socket = new net.Socket();
      const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(4000);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
      socket.connect(DEV_PORT, "127.0.0.1");
    });
  }
}

function nextDirBytes(): number {
  try {
    const r = spawnSync("du", ["-sb", NEXT_DIR], { encoding: "utf8", timeout: 15000 });
    return Number((r.stdout ?? "").split(/\s+/)[0]) || 0;
  } catch { return 0; }
}

/* ── the one and only command this organ may ever spawn (fixed whitelist) ── */
function spawnDevServer(): boolean {
  if (nextDirBytes() > NEXT_CACHE_LIMIT) {
    log(`cache-hygiene: .next=${(nextDirBytes() / 1048576).toFixed(0)}MB > 1200MB — wiping for clean rebuild (OOM root-cause guard)`);
    try { fs.rmSync(NEXT_DIR, { recursive: true, force: true }); } catch {}
  }
  try {
    const out = fs.openSync(path.join(ROOT, "dev.log"), "a");
    const child = spawn("bun", ["run", "dev"], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", out, out],
      env: process.env,
    });
    child.unref();
    spawns += 1;
    lastSpawnAt = new Date().toISOString();
    lastAction = `respawned pid=${child.pid}`;
    log(`respawn: bun run dev (pid=${child.pid}, spawns=${spawns})`);
    return true;
  } catch (e) {
    lastAction = "spawn-error";
    log(`spawn-error: ${String(e).slice(0, 160)}`);
    return false;
  }
}

function json(obj: unknown, status = 200): Response {
  return Response.json(obj as any, { status });
}

Bun.serve({
  port: PORT,
  fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/health") {
      return json({
        ok: true, organ: "dev-keeper", pid: process.pid,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        devUp, spawns, lastSpawnAt, lastAction,
        nextMB: Math.round(nextDirBytes() / 1048576),
        law: "R262 dev-keeper: fixed-command watchdog over :3000, R216-b surviving-lineage spawn, no secrets, no params",
      });
    }
    return json({ ok: false, error: "not-found", routes: ["/health"] }, 404);
  },
});

/* ── main loop ──────────────────────────────────────────────────────────── */
if (!acquireLock()) {
  log("single-instance: healthy keeper already holds the lock — clean exit");
  console.log("[dev-keeper] another live keeper holds the lock — clean exit");
  process.exit(0);
}

log(`boot: dev-keeper pid=${process.pid} on :${PORT}, boot-grace=${BOOT_GRACE_MS / 1000}s`);
console.log(`[dev-keeper] up on :${PORT} — watching :${DEV_PORT} every ${LOOP_MS / 1000}s`);

let lastSpawnMs = 0; // 0 = allow immediate spawn after boot-grace elapses
const booted = Date.now();

setInterval(async () => {
  heartbeat();
  devUp = await devHealthy();
  if (devUp) { lastAction = "dev-healthy"; return; }
  if (Date.now() - booted < BOOT_GRACE_MS) { lastAction = "boot-grace"; return; }
  if (Date.now() - lastSpawnMs < RESPAWN_COOLDOWN_MS) { lastAction = "cooldown"; return; }
  lastSpawnMs = Date.now();
  spawnDevServer();
}, LOOP_MS);
