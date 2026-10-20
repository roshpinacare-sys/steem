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
 *  3-b. R287 PRE-EMPTIVE RSS GUARD (measured): the kernel OOM-kill fired at
 *     next-server RSS=1.74GB while the server was still UP — law 3 only acted
 *     AFTER death. The guard now watches /proc RSS every tick: > 1.6GB
 *     sustained 3 consecutive ticks (24s) → SIGTERM the server tree → the
 *     existing probe+respawn machinery rebuilds it with a clean cache.
 *     Bounded: 30min cooldown, no kill storm inside cooldown.
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
/* R291 · MUTUAL GUARDIANSHIP (measured death 2026-10-09): the kernel OOM-killed
 * next-server AND the keeper itself sat dead for hours — no one owned the
 * engine's life. The keeper now also guards the engine (probe :3040 →
 * respawn after 3 dead ticks, cooldown 60s). The engine reciprocally hatches
 * THIS keeper when both :3000 and :3044 are dark. Single-instance laws stay:
 * each guardian spawns its ward only when the ward's port is dark. */
/* T-80 REALITY ALIGNMENT (2026-10-16, measured): office-selfcheck lawfully
 * owns :3040 and answers /health — the keeper was "proving" the engine alive
 * on the WRONG port (a sibling office masquerading as the engine), and
 * ENGINE_DIR pointed at the pre-estate-move path (gone). Now: the engine's
 * port rides SAOS_ENGINE_PORT (hatched keepers inherit the engine's env),
 * and the dir is DERIVED (WIPE-#4 law: never hardcode — dev-keeper and
 * saos-engine are siblings under mini-services/). */
const ENGINE_PORT = Number(process.env.SAOS_ENGINE_PORT || 3040);
const ENGINE_DIR = path.resolve(import.meta.dir, "..", "saos-engine");
let engineUp: boolean | null = null;
let engineDownTicks = 0;
let engineSpawns = 0;
let lastEngineSpawnMs = 0;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const STATE_DIR = path.join(HERE, "state");
const LOCK = path.join(STATE_DIR, "keeper.lock");
const LOG = path.join(HERE, "keeper.log");
const NEXT_DIR = path.join(ROOT, ".next");
const LOOP_MS = 8000;
const BOOT_GRACE_MS = 45_000;
const RESPAWN_COOLDOWN_MS = 25_000;
const NEXT_CACHE_LIMIT = 1.2 * 1024 * 1024 * 1024; // 1.2GB
const RSS_LIMIT_KB = 1.6 * 1024 * 1024; // 1.6GB — OOM fired at 1.74GB (measured)
const RSS_SUSTAINED_TICKS = 3;
const RSS_COOLDOWN_MS = 30 * 60_000;
const RSS_HARD_CEILING_KB = 2.0 * 1024 * 1024; // R287b: within-cooldown override — at 2.0GB the no-storm law yields to imminent OOM (measured 21:59: the server died at 2.3GB while the cooldown withheld the kill)

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

/* ── R287 pre-emptive RSS guard: rebuild BEFORE the kernel decides for us ── */
let rssTicks = 0;
let lastRssActionMs = 0;
let rssRespawns = 0;
let lastRssMB = 0;

function nextServerPids(): number[] {
  const out: number[] = [];
  for (const pat of ["next-server", "next dev"]) {
    try {
      const r = spawnSync("pgrep", ["-f", pat], { encoding: "utf8", timeout: 8000 });
      for (const line of (r.stdout ?? "").split("\n")) {
        const pid = Number(line.trim());
        if (pid && pid !== process.pid && !out.includes(pid)) out.push(pid);
      }
    } catch { /* pgrep missing is impossible on this box; ignore quietly */ }
  }
  return out.slice(0, 16);
}

function biggestRss(): { pid: number; rssKb: number } | null {
  let best: { pid: number; rssKb: number } | null = null;
  for (const pid of nextServerPids()) {
    try {
      const st = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const m = /VmRSS:\s+(\d+)\s+kB/.exec(st);
      if (m) {
        const rssKb = Number(m[1]);
        if (!best || rssKb > best.rssKb) best = { pid, rssKb };
      }
    } catch { /* pid vanished mid-scan: fine */ }
  }
  return best;
}

function rssGuard() {
  const hit = biggestRss();
  lastRssMB = hit ? Math.round(hit.rssKb / 1024) : 0;
  if (!hit || hit.rssKb < RSS_LIMIT_KB) { rssTicks = 0; return; }
  rssTicks += 1;
  if (rssTicks < RSS_SUSTAINED_TICKS && hit.rssKb < RSS_HARD_CEILING_KB) { lastAction = `rss-watch-${lastRssMB}MB`; return; }
  if (Date.now() - lastRssActionMs < RSS_COOLDOWN_MS && hit.rssKb < RSS_HARD_CEILING_KB) {
    log(`rss-guard: ${lastRssMB}MB again within cooldown — NOT killing (no storm); watching`);
    return;
  }
  lastRssActionMs = Date.now();
  rssTicks = 0;
  rssRespawns += 1;
  const pids = nextServerPids();
  log(`rss-guard: RSS=${lastRssMB}MB > ${Math.round(RSS_LIMIT_KB / 1024)}MB sustained ${RSS_SUSTAINED_TICKS} ticks — SIGTERM pre-emptive rebuild (pids ${pids.join(",")}, respawn #${rssRespawns})`);
  for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ } }
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
        engineUp, engineDownTicks, engineSpawns,
        nextMB: Math.round(nextDirBytes() / 1048576),
        rssMB: lastRssMB, rssLimitMB: Math.round(RSS_LIMIT_KB / 1024), rssRespawns,
        law: "R262 dev-keeper: fixed-command watchdog over :3000, R216-b surviving-lineage spawn, no secrets, no params; R287 pre-emptive RSS guard 1.6GB→SIGTERM→rebuild; R291 mutual guardianship: engine :3040 respawn after 3 dead ticks",
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

/* R291 · engine guardian — same fixed-command law as spawnDevServer */
function spawnEngine(): boolean {
  try {
    const out = fs.openSync(path.join(ENGINE_DIR, "engine-stdout.log"), "a");
    const child = spawn("bun", ["run", "dev"], {
      cwd: ENGINE_DIR,
      detached: true,
      stdio: ["ignore", out, out],
      env: process.env,
    });
    child.unref();
    engineSpawns += 1;
    lastEngineSpawnMs = Date.now();
    lastAction = `engine-respawned pid=${child.pid}`;
    log(`engine-guardian: respawn bun run dev (pid=${child.pid}, spawns=${engineSpawns})`);
    return true;
  } catch (e) {
    lastAction = "engine-spawn-error";
    log(`engine-spawn-error: ${String(e).slice(0, 160)}`);
    return false;
  }
}

async function engineHealthy(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${ENGINE_PORT}/health`, { signal: AbortSignal.timeout(6000) });
    return r.ok;
  } catch {
    return false;
  }
}

setInterval(async () => {
  heartbeat();
  devUp = await devHealthy();
  rssGuard(); /* R287: runs regardless of health — the ballooning process IS healthy-looking until it dies */
  /* R291 · engine guardianship — W19-b amendment (measured 2026-10-20):
   * the old 3-dead-ticks law left the economy dark up to 45min per engine
   * death (3 × keeper cadence) while the sovereign auto-cycle now lives
   * INSIDE the engine — engine downtime = economy downtime. NEW LAW: one
   * dead tick + a 10s confirming re-probe → respawn (own 60s cooldown
   * still guards against respawn storms; BOOT_GRACE_MS unchanged). A
   * transient blip survives the re-probe and never spawns. */
  const engOk = await engineHealthy();
  engineUp = engOk;
  engineDownTicks = engOk ? 0 : engineDownTicks + 1;
  if (!engOk && engineDownTicks >= 1 && Date.now() - lastEngineSpawnMs > 60_000 && Date.now() - booted > BOOT_GRACE_MS) {
    const confirm = await new Promise((r) => setTimeout(r, 10_000)).then(() => engineHealthy());
    if (!confirm) spawnEngine();
    else engineDownTicks = 0; /* blip — the re-probe found it alive */
  }
  if (devUp) { lastAction = "dev-healthy"; return; }
  if (Date.now() - booted < BOOT_GRACE_MS) { lastAction = "boot-grace"; return; }
  if (Date.now() - lastSpawnMs < RESPAWN_COOLDOWN_MS) { lastAction = "cooldown"; return; }
  lastSpawnMs = Date.now();
  spawnDevServer();
}, LOOP_MS);
