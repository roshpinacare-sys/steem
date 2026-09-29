'use strict';
// LIVE-GATE shared contract (Task 28-b rollout) — DRY by default.
// Broadcast requires (--live OR HE_LIVE=1) AND HE_LIVE_CONFIRM === acting account.
// Legacy --dry always forces DRY. See DAEMONS.md (owner decision, Task 24).
function resolveLiveGate(argv, opts) {
  const args = Array.isArray(argv) ? argv : process.argv;
  const o = opts || {};
  // 8-b: אין ברירת-מחדל לחשבון-הפעולה (המשך 7-c, docs/117o-KEY-INCIDENT.md) —
  // בלי חשבון מפורש ({account} או AGENT_ACCOUNT) השער אף-פעם לא יכול להיות חי.
  const account = String(o.account || process.env.AGENT_ACCOUNT || '').toLowerCase();
  const flagLive = args.includes('--live');
  const envLive = String(process.env.HE_LIVE || '') === '1';
  const confirm = String(process.env.HE_LIVE_CONFIRM || '').toLowerCase();
  const dryForced = args.includes('--dry');
  if ((flagLive || envLive) && !account) {
    throw new Error('live-gate: no acting account — set AGENT_ACCOUNT (no default account exists · docs/117o-KEY-INCIDENT.md)');
  }
  const live = !dryForced && (flagLive || envLive) && !!account && confirm === account;
  return { account, live, dry: !live, dryForced };
}
function announceGate(gate, logFn) {
  const log = logFn || console.log;
  if (gate.live) {
    log('[LIVE-GATE] LIVE MODE ENABLED — real broadcast to Hive mainnet (Hive-Engine sidechain ops) as @' + gate.account);
  } else {
    log('[LIVE-GATE] dry-run default — broadcast requires --live flag (or HE_LIVE=1) AND HE_LIVE_CONFIRM=' + gate.account);
  }
}
module.exports = { resolveLiveGate, announceGate };
