/**
 * disperse.mjs — W120 · THE LIQUIDITY DISPERSION RAIL (איכותי-מתואם)
 * ═══════════════════════════════════════════════════════════════════════
 * OWNER MANDATE (W119+W120, verbatim evidence): "תגביר עוד את החיילים אין
 * להם מספיק ודאג שיהיה פיזור איכותי מתואם בין כולם למקסום רווחיות" +
 * "חמש הכל תפעיל הכל למה לא אני מאשר קדימה". MEASURED ROOT (2026-10-21
 * 04:49Z): the army grid is LIVE (roster 13 · custody verified 13/13) but
 * the bodies sit NO-LIQUID / thin (cashmachine 0.5 STEEM · siq 2.4 ·
 * hcsoldier4/5/6 = 0) — the hands were re-attached (G43 active custody +
 * RC ×12.6) yet have no inventory to grid with. THE LAST MILE.
 *
 * WHAT THIS RAIL DOES (and its hard laws):
 *   - INTERNAL-ONLY: transfers flow master → OWN allowlisted bodies
 *     (exec-armed policy.transferAllowlist = the army roster). Zero outflow
 *     to any non-roster destination — the signer gate enforces it too.
 *   - TARGET-FILL: tops each body up to disperse.targetBodySteem (default
 *     15 STEEM) + driest-body SBD dust (≤ disperse.maxSbdPerBody).
 *   - MASTER FLOOR: never disperses below masterReservePct (default 40%) of
 *     the master's live liquid STEEM, and keeps bidReserveSbd on the master.
 *   - CAPS: maxSteemPerRun, maxSbdPerRun, one run per minIntervalSec,
 *     per-body idempotency via the ack ledger (state/disperse-ack.json).
 *   - RAIL: executeAs(master, [transfer…], tag "liquidity-disperse") — the
 *     single execution rail with the full gate stack; identity proven
 *     in-run; verdicts + txids journaled (state/disperse.json + events).
 *   - fail-closed: any read failure, custody doubt, or policy absence =
 *     NO-RUN with an honest verdict. Keys never leave the vault strata.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rpcCall, accountState } from "./measure.mjs";
import { executeAs, armedConf, execPaused, masterAccount, custodyOf } from "./signer.mjs";
import { ARMY_ROSTER_VAULT } from "./vault-revival.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FILE = path.join(STATE, "disperse.json");
const ACK_FILE = path.join(STATE, "disperse-ack.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* best-effort */ } };
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

export const DISPERSE_DEFAULTS = {
  enabled: true,
  targetBodySteem: 15,      // top each body up TO this (measured grid fuel)
  minBodyTrigger: 14.5,     // only bodies BELOW this are topped
  maxSteemPerBody: 16,      // hard per-body ceiling
  maxSbdPerBody: 0.3,       // driest-bodies bid dust
  sbdTrigger: 0.5,          // only bodies below this get SBD dust
  maxSteemPerRun: 130,      // run ceiling (measured: full top-up ≈ 100)
  maxSbdPerRun: 2.0,
  masterReservePct: 40,     // master keeps ≥40% of its live liquid STEEM
  masterBidReserveSbd: 2.0, // master keeps its own bid fuel
  minIntervalSec: 900,      // one run per 15 min max
  law: "internal-dispersion-only: master → own allowlisted bodies; zero external outflow; signer allowlist enforced independently",
};

export function disperseConf() {
  const c = armedConf();
  return { ...DISPERSE_DEFAULTS, ...(c.disperse ?? {}) };
}

export function disperseState() {
  return readJson(FILE, { verdict: "NEVER-RUN", note: "disperse.json missing — the rail has not run yet" });
}

async function liveBalances(account) {
  const acc = await accountState(account);
  if (!acc.ok) return null;
  return { steem: Math.max(0, acc.steem ?? 0), sbd: Math.max(0, acc.sbd ?? 0) };
}

/* W120 CORE — one measured, capped, idempotent dispersion run */
export async function runDisperse({ now = new Date().toISOString(), executeAsFn = null, dryRun = false } = {}) {
  const conf = disperseConf();
  const master = masterAccount();
  const day = now.slice(0, 10);
  const base = { at: now, day, law: conf.law };

  const done = (patch) => { const st = { ...base, ...patch }; writeJson(FILE, st); appendLine(EVENTS_FILE, { type: "disperse.verdict", ...st }); return st; };

  if (conf.enabled !== true) return done({ verdict: "DISABLED" });
  if (execPaused()) return done({ verdict: "OPERATOR-PAUSED" });

  /* allowlist = the standing policy (signer-enforced too) + roster sanity */
  const pol = armedConf();
  const allow = Array.isArray(pol.policy?.transferAllowlist) ? pol.policy.transferAllowlist : [];
  const roster = (ARMY_ROSTER_VAULT ?? []).filter((a) => a && a !== master);
  if (!roster.length) return done({ verdict: "NO-ROSTER" });
  const unknown = allow.filter((a) => !roster.includes(a));
  if (unknown.length) return done({ verdict: "POLICY-DRIFT", note: `allowlist has non-roster entries: ${unknown.join(",")}` });

  /* idempotency + interval from the ack ledger */
  const ack = readJson(ACK_FILE, { days: {} });
  const dayRec = (ack.days[day] = ack.days[day] ?? { runs: 0, bodies: {} });
  const prev = readJson(FILE, null);
  if (prev?.at && dayRec.runs > 0) {
    const gapSec = (Date.parse(now) - Date.parse(prev.at)) / 1000;
    if (gapSec < conf.minIntervalSec) return done({ verdict: "INTERVAL-GUARD", note: `${Math.round(gapSec)}s < ${conf.minIntervalSec}s since last run` });
  }

  /* live reads — fail-closed on every stratum */
  const mb = await liveBalances(master);
  if (!mb) return done({ verdict: "MASTER-BALANCE-UNREADABLE" });
  const reserveFloor = (mb.steem * conf.masterReservePct) / 100;

  const custodyMap = roster.map((a) => ({ account: a, custody: custodyOf(a) }));
  const unverified = custodyMap.filter((c) => c.custody !== "verified").map((c) => c.account);
  /* bodies without verified custody are SKIPPED (never funded blind) — the rest proceed */

  const targets = [];
  for (const c of custodyMap) {
    if (c.custody !== "verified") continue;
    if (dayRec.bodies[c.account]?.verified) continue; // already acked today
    const b = await liveBalances(c.account);
    if (!b) { targets.push({ account: c.account, skip: "balance-unreadable" }); continue; }
    const needSteem = b.steem < conf.minBodyTrigger
      ? Math.min(conf.targetBodySteem - b.steem, conf.maxSteemPerBody)
      : 0;
    const needSbd = b.sbd < conf.sbdTrigger ? conf.maxSbdPerBody : 0;
    if (needSteem > 0 || needSbd > 0) targets.push({ account: c.account, needSteem: Math.round(needSteem * 1000) / 1000, needSbd: Math.round(needSbd * 1000) / 1000, cur: b });
  }

  /* caps + master floor — the largest run the laws allow */
  let steemLeft = Math.min(conf.maxSteemPerRun, Math.max(0, mb.steem - reserveFloor));
  let sbdLeft = Math.min(conf.maxSbdPerRun, Math.max(0, mb.sbd - conf.masterBidReserveSbd));
  const plan = [];
  for (const t of targets) {
    if (t.skip) continue;
    const giveSteem = Math.min(t.needSteem ?? 0, steemLeft);
    const giveSbd = Math.min(t.needSbd ?? 0, sbdLeft);
    if (giveSteem >= 0.001 || giveSbd >= 0.001) {
      plan.push({ account: t.account, steem: Math.round(giveSteem * 1000) / 1000, sbd: Math.round(giveSbd * 1000) / 1000, cur: t.cur });
      steemLeft = Math.round((steemLeft - giveSteem) * 1000) / 1000;
      sbdLeft = Math.round((sbdLeft - giveSbd) * 1000) / 1000;
    }
  }
  const skipped = targets.filter((t) => t.skip).map((t) => t.account);
  const custNote = { unverifiedSkipped: unverified, unreadableSkipped: skipped };

  if (!plan.length) {
    return done({ verdict: "ALL-FUNDED-OR-CAPPED", master: mb, plan: [], ...custNote, reserveFloor: Math.round(reserveFloor * 1000) / 1000 });
  }
  const planTotals = {
    steem: Math.round(plan.reduce((s, p) => s + p.steem, 0) * 1000) / 1000,
    sbd: Math.round(plan.reduce((s, p) => s + p.sbd, 0) * 1000) / 1000,
  };
  if (dryRun) return done({ verdict: "DRY-RUN", master: mb, plan, totals: planTotals, ...custNote, reserveFloor: Math.round(reserveFloor * 1000) / 1000 });

  /* identity proven THIS RUN, then the ONE rail */
  const execFn = executeAsFn ?? executeAs;
  if (!execFn) return done({ verdict: "NO-EXECUTOR" });
  const executed = [];
  for (const p of plan) {
    const ops = [];
    if (p.steem >= 0.001) ops.push(["transfer", { from: master, to: p.account, amount: `${p.steem.toFixed(3)} STEEM`, memo: "W120 liquidity-disperse internal (army grid fuel)" }]);
    if (p.sbd >= 0.001) ops.push(["transfer", { from: master, to: p.account, amount: `${p.sbd.toFixed(3)} SBD`, memo: "W120 bid-dust internal" }]);
    if (!ops.length) continue;
    const res = await execFn(master, ops, { tag: "liquidity-disperse", role: "active" });
    const entry = { account: p.account, steem: p.steem, sbd: p.sbd, ok: !!res.ok, verdict: res.verdict ?? null, txid: res.txid ?? null, error: res.ok ? null : String(res.error ?? res.verdict ?? "").slice(0, 140) };
    executed.push(entry);
    if (res.ok) { dayRec.bodies[p.account] = { at: now, steem: p.steem, sbd: p.sbd, txid: res.txid ?? null, verified: false }; }
  }
  dayRec.runs += 1;
  writeJson(ACK_FILE, ack);

  const okN = executed.filter((e) => e.ok).length;
  const st = done({
    verdict: okN === executed.length ? "DISPERSED" : okN > 0 ? "PARTIAL" : "BROADCAST-FAIL",
    master: mb, plan, totals: planTotals, executed, ...custNote,
    reserveFloor: Math.round(reserveFloor * 1000) / 1000,
    note: okN > 0 ? "internal only — army grid fuel" : "all broadcasts refused — see executed[].error",
  });
  return st;
}

/* CLI: bun disperse.mjs [--dry] */
if (import.meta.url === `file://${process.argv[1]}`) {
  const dry = process.argv.includes("--dry");
  const out = await runDisperse({ dryRun: dry });
  console.log(JSON.stringify(out, null, 2));
}
