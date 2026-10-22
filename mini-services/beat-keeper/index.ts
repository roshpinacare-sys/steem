/**
 * beat-keeper — [agent-zai/W1] sovereign heartbeat scheduler for the
 * machine-local engine (steem@saos-cockpit mini-services/saos-engine).
 * This host has no cron and reaps detached processes; a managed mini-service
 * survives. Every half-hour boundary it runs the LIVING beat target inside the
 * git home: /home/z/saos-steem/scripts/beat-reconcile-push.sh
 * (beat → honest verdicts → state churn commit → FF-only push, no force).
 * History: /home/z/audit/beat-keeper.sh died with the audit wipe (exit=127
 * every 30min 2026-10-19→10-20); the W-heal law points the keeper at the
 * git-vault copy so a sandbox wipe can never orphan the heartbeat again.
 * The cloud beat (saos-runtime 30-min cron) remains the wipe-proof primary.
 */
import fs from "node:fs";
import { spawn } from "node:child_process";

const KEEPER = "/home/z/saos-steem/scripts/beat-reconcile-push.sh";
const LOG = "/home/z/my-project/mini-services/beat-keeper/beat.log";

/* W25 · MUTUAL-GUARDIANSHIP HATCH (R291 spirit, T-37 law):
 * the reaper kills every descendant of interactive shells (measured 01:37-01:55Z:
 * engine died 3×, sleepers too) — only boot-managed mini-services survive.
 * beat-keeper IS a boot-managed survivor, so it hatches the office-keeper
 * (the whole-office supervisor: 3037/3040/3041/3042/3043/3047), which in turn
 * revives the engine + dex + custodian + metrics + builder + state-witness.
 * Probe = office-keeper's own pidfile with a /proc liveness check (stale takeover
 * law honored). Hatch loop re-arms every 60s — under any reaper behavior the
 * office gets at most a 60s dark window, and at next boot the platform starts
 * everything natively (symlinks installed in my-project/mini-services). */
const OFFICE_KEEPER_PIDFILE = "/tmp/saos-office-supervisor.pid";
/* W35 hatch-preference flip: the my-project copy is platform-guaranteed (tar-
 * restored at every boot), the git home is the fallback — /home/z/saos-steem is
 * exactly what a wipe deletes first (measured 2026-10-21T22:30Z: hatch ENOENT,
 * office dark until an owner message forced a manual revival. Never again). */
const OFFICE_KEEPER_DIRS = [
  "/home/z/my-project/mini-services/office-keeper",
  "/home/z/saos-steem/mini-services/office-keeper",
];
const OFFICE_KEEPER_DIR = (() => {
  for (const d of OFFICE_KEEPER_DIRS) {
    try {
      /* W37: a symlink to a vanished home resolves to nothing — realpath
       * proves the ground is REAL before we spawn on it. */
      const real = fs.realpathSync(d);
      if (fs.existsSync(real + "/index.ts")) return real;
    } catch { /* dangling — next candidate */ }
  }
  return OFFICE_KEEPER_DIRS[0];
})();
let lastOfficeHatchMs = 0;
const OFFICE_HATCH_COOLDOWN_MS = 120_000;

function officeKeeperAlive(): boolean {
  try {
    const pid = Number(fs.readFileSync(OFFICE_KEEPER_PIDFILE, "utf8").trim());
    if (!pid) return false;
    process.kill(pid, 0); /* throws if dead */
    return true;
  } catch { return false; }
}

function hatchOfficeKeeper() {
  const now = Date.now();
  if (officeKeeperAlive()) return;
  if (now - lastOfficeHatchMs < OFFICE_HATCH_COOLDOWN_MS) return;
  lastOfficeHatchMs = now;
  try {
    const out = fs.openSync("/tmp/office-keeper-stdout.log", "a");
    const child = spawn("bun", ["index.ts"], {
      cwd: OFFICE_KEEPER_DIR,
      detached: true,
      stdio: ["ignore", out, out],
      env: process.env,
    });
    /* W37: spawn errors are ASYNC (ENOENT fires here, not in catch) — the
     * silent pid=undefined class must SPEAK or the office stays dark mute. */
    child.on("error", (e) => log(`${new Date().toISOString()} HATCH-SPAWN-ERROR office-keeper: ${String(e).slice(0, 160)} (cwd=${OFFICE_KEEPER_DIR})\n`));
    child.unref();
    log(`${new Date().toISOString()} HATCH office-keeper pid=${child.pid} cwd=${OFFICE_KEEPER_DIR} (dark office → R291/T-37 mutual guardianship via boot-survivor)\n`);
  } catch (e) {
    log(`${new Date().toISOString()} HATCH-FAIL office-keeper ${String(e).slice(0, 120)}\n`);
  }
}

setInterval(hatchOfficeKeeper, 60_000).unref?.();
setTimeout(hatchOfficeKeeper, 5_000).unref?.(); /* first hatch 5s after boot/reload */

function log(s: string) {
  try { fs.appendFileSync(LOG, s); } catch { /* honest */ }
}

function run() {
  const at = new Date().toISOString();
  try {
    const p = Bun.spawnSync(["/bin/bash", KEEPER], { stdout: "pipe", stderr: "pipe" });
    const line = `${at} keeper exit=${p.exitCode}\n`;
    console.log(line.trim());
    log(line);
  } catch (e) {
    log(`${at} keeper spawn-fail ${String(e)}\n`);
  }
}

/* fire once at boot so a restarted service catches up immediately */
run();

/* then align to :00 / :30 boundaries */
function schedule() {
  const now = Date.now();
  const next = Math.ceil(now / 1800000) * 1800000;
  setTimeout(() => { run(); schedule(); }, Math.max(1000, next - now));
}
schedule();

console.log(`beat-keeper up ${new Date().toISOString()} — every 30min, keeper=${KEEPER}`);
