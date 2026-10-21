/**
 * yield-distributor.mjs — R288 · THE LOCAL TOKEN TRANSACTION ENGINE
 * (operator question #2, answered YES in code: "Do you want to build a local
 * token transaction engine to dynamically distribute the posting yields
 * between the secondary fleet wallets?" → YES, natively, zero new deps).
 *
 * WHAT MOVES (the honest pool — never the machine's fuel):
 *   pool = treasury LIQUID balance − the OPERATING FLOOR.
 *   The ladder/trading capital above the floor is untouchable by this rail —
 *   exactly the T-6 additive doctrine precedent (deploy idle liquidity
 *   WITHOUT touching the working ladder).
 *
 * THE LAWS (all pure, all selftest-covered):
 *   · POLICY     reservePct + fleetPct MUST total 100 (validated; else the
 *                whole rail verdicts POLICY-INVALID and nothing moves).
 *   · CUSTODY    not FLEET-CUSTODY-ALIVE 14/14 → CUSTODY-FROZEN, zero ops.
 *   · FLOOR      liquid ≤ operating floor → BELOW-FLOOR (the fuel is sacred).
 *   · DUST       a per-wallet share below the dust floor rolls BACK to
 *                reserve — the chain never sees dust spam.
 *   · CAP        perDayCap transfers per day, maxTransfersPerRun per run
 *                (the tail waits for the next run, honestly counted).
 *   · CADENCE    minIntervalSec between executed runs (anti-metronome).
 *   · ONE BODY   this rail executes ONLY through executeAs() — the think
 *                gate, the RC guard and the custody gate stay owned by the
 *                signer (the engine's single chain truth). A dry-run plan
 *                (execute=false) is the default posture of the 10min loop;
 *                execution happens on an explicit POST /yield-run.
 *   · JOURNAL    every attempt lands in receipts/yield-distribution.jsonl —
 *                verdicts and txids, never keys.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { accountState } from "./measure.mjs";
import { executeAs } from "./signer.mjs";
import { soldierRoster } from "./soldier-claims.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const stateDir = () => process.env.SAOS_STATE_DIR || path.join(DIR, "state");
const receiptsDir = () => path.join(DIR, "receipts");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };
const readLines = (p, n = 200) => {
  try { return fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
};

const TREASURY = process.env.SAOS_ACCOUNT || "headcorner";

export const POLICY_DEFAULTS = {
  reservePct: 60,          /* of the net pool — the machine's own buffer */
  fleetPct: 40,            /* split equally across the secondary wallets */
  operatingFloorSteem: 50, /* liquid under this stays the ladder's fuel */
  operatingFloorSbd: 5,
  dustSteem: 1,            /* a share below this rolls back to reserve */
  dustSbd: 2,
  maxTransfersPerRun: 4,
  perDayCap: 6,
  minIntervalSec: 300,     /* between EXECUTED runs (anti-metronome) */
  memo: "saos-yield",
};

export const YIELD_LAW = "pool = liquid above the operating floor; custody gate first; dust rolls back; caps bound the run; execution only through executeAs with the think gate; verdicts and txids journaled, keys never";

const r3 = (x) => Math.floor(Number(x) * 1000) / 1000;

/* ── pure: policy validation ─────────────────────────────────────────────── */
export function validatePolicy(p) {
  const reasons = [];
  const pp = { ...POLICY_DEFAULTS, ...(p ?? {}) };
  if (Number(pp.reservePct) + Number(pp.fleetPct) !== 100) reasons.push("reservePct+fleetPct-must-total-100");
  for (const k of ["reservePct", "fleetPct"]) {
    const v = Number(pp[k]);
    if (!Number.isFinite(v) || v < 0 || v > 100) reasons.push(`${k}-out-of-range`);
  }
  for (const k of ["operatingFloorSteem", "operatingFloorSbd", "dustSteem", "dustSbd"]) {
    const v = Number(pp[k]);
    if (!Number.isFinite(v) || v < 0) reasons.push(`${k}-must-be-nonneg`);
  }
  for (const k of ["maxTransfersPerRun", "perDayCap", "minIntervalSec"]) {
    const v = Number(pp[k]);
    if (!Number.isInteger(v) || v < 1) reasons.push(`${k}-must-be-positive-int`);
  }
  if (typeof pp.memo !== "string" || pp.memo.length > 60 || /[^\x20-\x7E]/.test(pp.memo)) reasons.push("memo-must-be-printable-ascii");
  return { ok: reasons.length === 0, reasons, policy: pp };
}

/* ── pure: custody gate (same source of truth as the compiler) ───────────── */
export function custodyGreen(custody) {
  return Boolean(custody && custody.verdict === "FLEET-CUSTODY-ALIVE"
    && Number(custody?.after?.verified ?? 0) >= Number(custody?.after?.total ?? 14)
    && Number(custody?.after?.total ?? 0) > 0);
}

/* ── pure: net pool = liquid − operating floor (fuel is sacred) ──────────── */
export function netPool({ liquidSteem, liquidSbd, policy }) {
  const pp = validatePolicy(policy).policy;
  const steem = Math.max(0, r3(Number(liquidSteem ?? 0) - Number(pp.operatingFloorSteem)));
  const sbd = Math.max(0, r3(Number(liquidSbd ?? 0) - Number(pp.operatingFloorSbd)));
  return { steem, sbd };
}

/* ── pure: THE PLANNER (selftest-covered end to end) ─────────────────────── */
export function planDistribution({ liquidSteem = 0, liquidSbd = 0, policy = POLICY_DEFAULTS, custody = null, roster = [], executedToday = 0, lastExecutedAt = null, now = new Date().toISOString() } = {}) {
  const v = validatePolicy(policy);
  if (!v.ok) return { verdict: "POLICY-INVALID", reasons: v.reasons, transfers: [], deferred: 0, reserveSteem: r3(liquidSteem), reserveSbd: r3(liquidSbd), perShare: 0, plannedTotal: 0, policy: v.policy };
  const pp = v.policy;

  const base = {
    at: now, policy: pp, treasury: TREASURY, rosterSize: roster.length,
    executedToday, perShare: 0, plannedTotal: 0, reserveSteem: 0, reserveSbd: 0,
    transfers: [], deferred: 0, executed: [],
  };

  if (!custodyGreen(custody)) return { ...base, verdict: "CUSTODY-FROZEN", custody: custody?.verdict ?? "UNKNOWN", law: YIELD_LAW };

  if (Number(executedToday) >= pp.perDayCap) return { ...base, verdict: "DAILY-CAP", law: YIELD_LAW };

  if (lastExecutedAt) {
    const last = Date.parse(String(lastExecutedAt));
    if (Number.isFinite(last) && Date.now() - last < pp.minIntervalSec * 1000) {
      return { ...base, verdict: "COOLDOWN", lastExecutedAt: String(lastExecutedAt), law: YIELD_LAW };
    }
  }

  const pool = netPool({ liquidSteem, liquidSbd, policy: pp });
  if (pool.steem <= 0 && pool.sbd <= 0) {
    return { ...base, verdict: "BELOW-FLOOR", pool, law: YIELD_LAW };
  }

  /* STEEM split */
  const reserveSteem = r3(pool.steem * pp.reservePct / 100);
  const distSteem = r3(pool.steem - reserveSteem);
  const n = roster.length;
  const perSteem = n > 0 ? r3(distSteem / n) : 0;
  if (n <= 0) return { ...base, verdict: "NO-ROSTER", pool, reserveSteem: pool.steem, reserveSbd: pool.sbd, law: YIELD_LAW };
  if (perSteem < pp.dustSteem) {
    return { ...base, verdict: "BELOW-DUST", pool, perShare: perSteem, reserveSteem: pool.steem, reserveSbd: pool.sbd, law: YIELD_LAW };
  }
  const capped = roster.slice(0, pp.maxTransfersPerRun);
  const transfers = capped.map((to) => ({ to, amount: perSteem, asset: "STEEM" }));
  const plannedTotal = r3(perSteem * transfers.length);
  const reserveAfterSteem = r3(pool.steem - plannedTotal);

  /* SBD split (same law, own dust floor) */
  const reserveSbd = r3(pool.sbd * pp.reservePct / 100);
  const distSbd = r3(pool.sbd - reserveSbd);
  const perSbd = r3(distSbd / n);
  if (perSbd >= pp.dustSbd) {
    const cappedSbd = roster.slice(0, pp.maxTransfersPerRun);
    for (const to of cappedSbd) transfers.push({ to, amount: perSbd, asset: "SBD" });
  } else {
    /* sub-dust SBD stays reserved */
  }
  const reserveSbdAfter = perSbd >= pp.dustSbd ? r3(pool.sbd - r3(perSbd * pp.maxTransfersPerRun)) : pool.sbd;

  return {
    ...base,
    verdict: "READY",
    pool,
    perShare: perSteem,
    perShareSbd: perSbd >= pp.dustSbd ? perSbd : 0,
    plannedTotal,
    reserveSteem: reserveAfterSteem,
    reserveSbd: Math.max(0, reserveSbdAfter),
    transfers,
    deferred: Math.max(0, n - capped.length),
    invariantOk: plannedTotal + reserveAfterSteem <= pool.steem + 1e-9,
    law: YIELD_LAW,
  };
}

/* ── the run: measure → plan → (optionally) execute through the one body ─── */
export async function runYieldDistribution({ now = new Date().toISOString(), execute = false } = {}) {
  const S = stateDir();
  const stored = readJson(path.join(S, "yield-policy.json"), null);
  const v = validatePolicy(stored ?? POLICY_DEFAULTS);
  const custody = readJson(path.join(S, "army-custody.json"), null);
  const roster = soldierRoster().filter((n) => n !== TREASURY);

  /* today's executed count + last executed at — from the receipts, not memory.
   * FIX (measured 2026-10-21T07:04Z): the cap counted ATTEMPT rows
   * (executed===true) so 4 THINK-GATE-REFUSED transfers — zero value moved —
   * burned the whole day's perDayCap and froze the rail (COOLDOWN).
   * The honest cap counts money that ACTUALLY moved: ok===true (txid present).
   * A refusal protects funds; it must not tax the day's dividend capacity. */
  const rec = readLines(path.join(receiptsDir(), "yield-distribution.jsonl"), 200);
  const day = String(now).slice(0, 10);
  const isMovedRow = (r) => typeof r?.at === "string" && r.executed === true && r.ok === true;
  const executedToday = rec.filter((r) => isMovedRow(r) && r.at.slice(0, 10) === day).length;
  const lastExecutedAt = rec.filter(isMovedRow).map((r) => r.at).sort().at(-1) ?? null;

  const acc = await accountState(TREASURY).catch(() => ({ ok: false }));
  if (!acc.ok) {
    const out = { at: now, verdict: "READ-FAILED", treasury: TREASURY, custody: custody?.verdict ?? "UNKNOWN", rosterSize: roster.length, law: YIELD_LAW };
    writeJson(path.join(S, "yield-distribution.json"), out);
    appendLine(path.join(receiptsDir(), "yield-distribution.jsonl"), { at: now, verdict: "READ-FAILED" });
    return out;
  }

  const plan = planDistribution({
    liquidSteem: Number(acc.steem ?? 0), liquidSbd: Number(acc.sbd ?? 0),
    policy: v.policy, custody, roster, executedToday, lastExecutedAt, now,
  });

  const out = { ...plan, treasury: TREASURY, executeRequested: Boolean(execute), liquidMeasured: { steem: Number(acc.steem ?? 0), sbd: Number(acc.sbd ?? 0) }, custody: custody?.verdict ?? null, custodyAfter: custody?.after ?? null };

  if (execute && plan.verdict === "READY" && plan.transfers.length) {
    out.executed = [];
    for (const t of plan.transfers) {
      const op = ["transfer", { from: TREASURY, to: t.to, amount: `${t.amount.toFixed(3)} ${t.asset}`, memo: `${v.policy.memo} ${day}` }];
      try {
        const r = await executeAs(TREASURY, [op], { tag: "yield-distribution" }); /* role defaults to active — transfers require it */
        const recRow = { at: new Date().toISOString(), executed: true, to: t.to, amount: t.amount, asset: t.asset, verdict: r?.verdict ?? "UNKNOWN", ok: !!r?.ok, txid: r?.txid ?? null };
        out.executed.push(recRow);
        appendLine(path.join(receiptsDir(), "yield-distribution.jsonl"), recRow);
        appendLine(path.join(S, "events.jsonl"), { at: recRow.at, type: "yield-distribution", to: t.to, amount: t.amount, asset: t.asset, verdict: recRow.verdict, ok: recRow.ok, txid: recRow.txid });
      } catch (e) {
        const recRow = { at: new Date().toISOString(), executed: true, to: t.to, amount: t.amount, asset: t.asset, verdict: "THREW", ok: false, error: String(e?.message ?? e).slice(0, 160) };
        out.executed.push(recRow);
        appendLine(path.join(receiptsDir(), "yield-distribution.jsonl"), recRow);
      }
    }
    out.verdict = out.executed.some((e) => e.ok) ? "EXECUTED" : "EXECUTION-FAILED";
  }

  writeJson(path.join(S, "yield-distribution.json"), out);
  appendLine(path.join(receiptsDir(), "yield-distribution.jsonl"), { at: now, verdict: out.verdict, planned: plan.transfers.length, executed: (out.executed ?? []).length });
  return out;
}

export function yieldState() { return readJson(path.join(stateDir(), "yield-distribution.json"), null); }
