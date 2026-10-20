/**
 * beat-scheduler — [agent-zai/W1] sovereign heartbeat cadence for the
 * machine-local engine (steem@saos-cockpit → mini-services/saos-engine).
 *
 * This sandbox host has no cron and reaps detached background processes;
 * the ONLY persistent process is the platform-managed Next.js server. The
 * scheduler therefore lives here: a catch-up beat shortly after boot, then
 * a beat every 30 minutes, aligned to the half-hour boundary.
 *
 * The keeper itself (/home/z/audit/beat-keeper.sh) mirrors the cloud
 * workflow contract: run ci-cycle → honest verdicts → state-churn commit
 * ([agent-zai/beat] identity) → FF-only push, no force. Engine-level lease
 * (withLease "ci-selftest") plus the keeper's flock prevent any overlap.
 * The cloud beat (saos-runtime 30-min cron) stays the wipe-proof primary.
 */
import { spawn } from "node:child_process";

const KEEPER = "/home/z/audit/saos-dex/deploy/dex-beat-keeper.sh"; // W2.0: repointed to the git-resident canonical keeper (was /home/z/audit/beat-keeper.sh — dead path, measured exit=127 at :00/:30 for hours). Redundant pacer by design: the OS flock + the keeper's own standby guard (cloud-first, 10min) arbitrate overlap — honest skip, never a double beat.
const HALF_HOUR_MS = 30 * 60 * 1000;

let started = false;

export function startBeatScheduler(): void {
  if (started) return;
  started = true;

  const log = (...a: unknown[]) =>
    console.log("[beat-keeper]", new Date().toISOString(), ...a);

  const runBeat = () => {
    try {
      const p = spawn("/bin/bash", [KEEPER], { stdio: "ignore" });
      p.on("exit", (code) => log("beat finished, keeper exit =", code));
      p.on("error", (e) => log("beat spawn error:", String(e)));
      return p;
    } catch (e) {
      log("beat spawn-fail:", String(e));
      return null;
    }
  };

  log("scheduler armed — catch-up beat in 15s, then every 30min");

  /* catch-up beat: cover the gap since the last session's beats */
  setTimeout(runBeat, 15_000);

  /* cadence: aligned to :00/:30 so local and cloud beats share the clock */
  const tick = () => {
    runBeat();
    const now = Date.now();
    const next = Math.ceil(now / HALF_HOUR_MS) * HALF_HOUR_MS;
    setTimeout(tick, Math.max(1000, next - now));
  };
  setTimeout(tick, HALF_HOUR_MS);
}
