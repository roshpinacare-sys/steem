/**
 * beat-keeper — [agent-zai/W1] sovereign heartbeat scheduler for the
 * machine-local engine (steem@saos-cockpit mini-services/saos-engine).
 * This host has no cron and reaps detached processes; a managed mini-service
 * survives. Every half-hour boundary it runs /home/z/audit/beat-keeper.sh
 * (beat → honest verdicts → state churn commit → FF-only push, no force).
 * The cloud beat (saos-runtime 30-min cron) remains the wipe-proof primary.
 */
import fs from "node:fs";

const KEEPER = "/home/z/saos-steem/scripts/beat-reconcile-push.sh";
const LOG = "/home/z/my-project/mini-services/beat-keeper/beat.log";

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
