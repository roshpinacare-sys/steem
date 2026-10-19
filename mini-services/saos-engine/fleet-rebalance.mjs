/* ─────────────────────────────────────────────────────────────────────────
 * W12 · FLEET REBALANCE — the mutual-support rail (划转互填).
 *
 * The owner's W12 order: the accounts act AS ONE BODY — smart transfers
 * refill whoever needs filling. This rail turns the fleet matrix into a
 * measured plan and executes EXACTLY AS FAR AS THE STANDING POLICY ALLOWS —
 * never one step further (the think-gate in executeAs is the law, this rail
 * never bypasses it).
 *
 * THE THREE MOVES (each doctrine-honest):
 *  1. liquidity-sweep — a custody-verified soldier holding surplus while
 *     the master is below its floor: the soldier's ACTIVE key signs the
 *     transfer home. Where the armed policy allows outbound transfers for
 *     allowlisted bodies (the CI reality: the soldier top-ups broadcast
 *     live), this ACTS; elsewhere it records REFUSED-POLICY honestly.
 *  2. sp-ladder (PLAN-ONLY by standing law) — headcorner's idle own-SP
 *     re-delegated to RC-starved trading soldiers (measured: each soldier's
 *     RC tank ≈ 45× smaller than the master's — THE volume bottleneck).
 *     delegate_vesting_shares is FORBIDDEN by default (R292; signer.mjs
 *     policy.allowDelegation=false) — the plan is written to state with the
 *     exact one-flag arm (policy.allowDelegation=true) and stays a plan
 *     until the operator arms it. THE UNLOCK IS ONE GLANCE.
 *  3. idle-recall (PLAN-ONLY by standing law) — delegations parked on
 *     dormant-keyless bodies (hcsoldier5 today) recalled to the master.
 *     Zero-amount recalls are also policy-gated (allowDelegationRecall).
 *
 * W12-b · THE SP-LADDER LEAVE (the one-flag unlock, measured): the operator's
 * W12 verbatim directive (mutual-support smart rebalancing) + the owner-
 * approved command hierarchy (delegate_vesting_shares = T1 REVERSIBLE,
 * 7-day undelegation, capped) arm the ladder's EXECUTION leg. Two keys must
 * turn together or nothing leaves PLAN-ONLY: (1) the operator's live flag
 * (.secrets/exec-armed.json policy.allowDelegation=true), (2) the committed
 * order record (state/operator-orders.json W12B-SP-LADDER). A REAL day-cap
 * ledger (measured from receipts, per UTC day — the planner knob counts
 * per-cycle by design and must never be the execution cap) bounds the
 * blast radius; every attempt lands a receipt; the think-gate owns every
 * broadcast exactly as before — this rail never bypasses it.
 *
 * LAWS: measured inputs only (fleet-matrix) · T-80 (frozen bodies never
 * receive) · day-cap on executed transfers (≤2/cycle, chain-spaced) ·
 * receipts for every attempt · pure planner fully selftested.
 * ───────────────────────────────────────────────────────────────────────── */

import * as fs from "node:fs";
import * as path from "node:path";
import { executeAs, armedConf, execPaused } from "./signer.mjs";
import { readFleetMatrix, measureFleetMatrix } from "./fleet-matrix.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE_DIR = path.join(DIR, "state");
const REBALANCE_FILE = path.join(STATE_DIR, "fleet-rebalance.json");
const RECEIPTS = path.join(DIR, "receipts", "fleet-rebalance.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

export const MASTER = "headcorner";

/* planner knobs (measured, conservative round-1; the T-36 step-up pattern
 * applies AFTER a measured day — never before) */
export const REBALANCE_POLICY = {
  masterSpOwnFloor: 1372,     // keep the master grid ≥ ~50% equilibrium RC
  soldierSpTarget: 175,       // each trading soldier tops up TO this, never beyond
  maxSpMovesPerDay: 6,        // 1 tx each, doctrine-capped ladder
  sweepSurplusSteem: 8,       // soldier surplus above this may sweep home
  sweepSurplusSbd: 2,
  masterSteemFloor: 40,       // existing top-up law floor (daily.mjs soldier rail)
  masterSbdFloor: 1,
  maxSweepsPerCycle: 2,       // outbound transfers are the scarcest policy right
};

const isVerified = (c) => c === "verified" || c === "master-verified" || c === "era-verified" || c === "master-era-verified";

/* W12-b · the committed order record — the LAWFUL ORDER the live flag must
 * answer to. Zero secrets: quotes + scope only. If the record is missing,
 * disarmed, or names another op, the ladder stays PLAN-ONLY even with the
 * flag on (two keys, one door). */
const ORDERS_FILE = path.join(STATE_DIR, "operator-orders.json");
export function operatorOrderArmed(orderId) {
  const o = readJson(ORDERS_FILE, null);
  const ord = o?.orders?.[orderId];
  return ord?.armed === true && ord?.op === "delegate_vesting_shares";
}

/* W12-b · the REAL day-cap ledger — counted from EXECUTED receipts of this
 * UTC day. The planner's maxSpMovesPerDay counts per-cycle (by design: it
 * bounds the PLAN), so the execution leg must measure its own day. A
 * partial/corrupt receipts line counts as nothing (honest read). */
export function spLadderExecutedToday(receiptsFile, now, type = "fleet-rebalance-sp-ladder") {
  try {
    const day = String(now).slice(0, 10);
    let n = 0;
    for (const line of String(fs.readFileSync(receiptsFile, "utf8")).split("\n")) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        if (r.type === type && r.verdict === "BROADCAST" && String(r.at ?? "").slice(0, 10) === day) n += 1;
      } catch { /* partial line — skip */ }
    }
    return n;
  } catch { return 0; }
}

/* W12-b · the execution partition — PURE in verdicts, identity-keeping in
 * selection (selftested): executable moves are the ORIGINAL objects with
 * vests+mode attached (mode flips to "EXEC" so the state filter excludes
 * them); planned moves become copies with an honest planWhy. Order of
 * laws: flag → order record → day-cap → math. */
export function partitionSpLadder(moves, { flagArmed, orderArmed, dayExecuted = 0, maxPerDay = 6, vestsPerSp = null } = {}) {
  const exec = [], plan = [];
  let budget = Math.max(0, maxPerDay - dayExecuted);
  for (const m of moves) {
    if (!flagArmed) { plan.push({ ...m, planWhy: "flag-off" }); continue; }
    if (!orderArmed) { plan.push({ ...m, planWhy: "order-record-missing" }); continue; }
    if (budget <= 0) { plan.push({ ...m, planWhy: "day-cap-reached" }); continue; }
    const vests = vestsPerSp ? Math.round(m.sp * vestsPerSp) : 0;
    if (!(vests > 0)) { plan.push({ ...m, planWhy: "no-vestsPerSp" }); continue; }
    m.vests = vests; m.mode = "EXEC"; /* identity-kept: the state filter reads mode */
    exec.push(m);
    budget -= 1;
  }
  return { exec, plan };
}

/* ── pure planner (selftested) ─────────────────────────────────────────── */
export function planFleetRebalance(matrix, opts = {}) {
  const p = { ...REBALANCE_POLICY, ...(opts.policy ?? {}) };
  const moves = [];
  if (!matrix || !Array.isArray(matrix.rows)) return { moves, why: "no-matrix" };

  const master = matrix.rows.find((r) => r.name === MASTER) ?? null;
  const masterSpOwn = master?.spOwn ?? null;
  const masterSteem = master?.steem ?? 0;
  const masterSbd = master?.sbd ?? 0;

  /* 1 · sp-ladder — idle master SP → RC-starved trading soldiers.
   * Targets ONLY verified bodies with 24h activity (grid or curation):
   * the trading proof is what makes the RC investment lawful (T-80+). */
  if (masterSpOwn !== null && masterSpOwn > p.masterSpOwnFloor) {
    let headroom = masterSpOwn - p.masterSpOwnFloor;
    for (const r of matrix.rows) {
      if (moves.length >= p.maxSpMovesPerDay) break;
      if (r.name === MASTER) continue;
      if (!isVerified(r.custody)) continue;
      const active = r.class === "GRID-ACTIVE" || r.class === "CURATE-ONLY";
      if (!active) continue;
      const cur = r.sp ?? 0;
      if (cur >= p.soldierSpTarget) continue;
      const grant = Math.min(p.soldierSpTarget - cur, headroom, 60);
      if (grant < 10) continue; // dust SP moves are churn, not support
      moves.push({
        kind: "sp-ladder", from: MASTER, to: r.name, sp: grant,
        mode: "PLAN-ONLY", requiredFlag: "policy.allowDelegation=true",
        why: `RC bottleneck: tank ${r.rcMax != null ? (r.rcMax / 1e12).toFixed(2) : "?"}T vs master ${master?.rcMax != null ? (master.rcMax / 1e12).toFixed(1) : "?"}T; SP ${cur}→${cur + grant} ≈ RC ×${Math.round(((cur + grant) / Math.max(cur, 1)) * 10) / 10}`,
      });
      headroom -= grant;
    }
  }

  /* 2 · idle-recall — delegations parked on frozen-keyless bodies return
   * to the master (T-80: they can never be used by the frozen body). */
  if (Array.isArray(matrix.delegationsOutRows)) {
    for (const d of matrix.delegationsOutRows) {
      const r = matrix.rows.find((x) => x.name === d.to);
      if (r && r.class === "FROZEN-NO-CUSTODY") {
        moves.push({
          kind: "sp-recall", from: MASTER, to: MASTER, vests: d.vests, frozenHolder: d.to,
          mode: "PLAN-ONLY", requiredFlag: "policy.allowDelegationRecall=true",
          why: "idle SP parked on a keyless body (T-80) — recall recycles it to the master grid after the 7-day return",
        });
      }
    }
  }

  /* 3 · liquidity-sweep — verified ACTIVE soldiers sweep surplus home when
   * the master is below its floor. EXECUTABLE where the armed policy's
   * transfer law allows; the think-gate decides per body. */
  if (masterSteem < p.masterSteemFloor || masterSbd < p.masterSbdFloor) {
    let sweeps = 0;
    for (const r of matrix.rows) {
      if (sweeps >= p.maxSweepsPerCycle) break;
      if (r.name === MASTER) continue;
      if (!isVerified(r.custody)) continue;
      if (r.class !== "GRID-ACTIVE") continue; // only bodies PROVEN to hold active custody trade
      if (masterSteem < p.masterSteemFloor && (r.steem ?? 0) > p.sweepSurplusSteem) {
        moves.push({
          kind: "liquidity-sweep", from: r.name, to: MASTER, asset: "STEEM",
          amount: Math.floor((r.steem - p.sweepSurplusSteem) * 1000) / 1000,
          mode: "attempt", why: `master below floor (${masterSteem} < ${p.masterSteemFloor}) while ${r.name} holds surplus`,
        });
        sweeps += 1;
      } else if (masterSbd < p.masterSbdFloor && (r.sbd ?? 0) > p.sweepSurplusSbd) {
        moves.push({
          kind: "liquidity-sweep", from: r.name, to: MASTER, asset: "SBD",
          amount: Math.floor((r.sbd - p.sweepSurplusSbd) * 1000) / 1000,
          mode: "attempt", why: `master SBD below floor (${masterSbd} < ${p.masterSbdFloor}) while ${r.name} holds surplus`,
        });
        sweeps += 1;
      }
    }
  }

  return { moves, why: moves.length ? "planned" : "balanced-no-moves" };
}

/* ── the acting rail ───────────────────────────────────────────────────── */
export async function runFleetRebalance({ now = new Date().toISOString(), persist = true } = {}) {
  if (execPaused()) return { verdict: "PAUSED", at: now };
  const conf = armedConf();
  if (!conf.armed) return { verdict: "DISARMED", at: now };

  let matrix = readFleetMatrix();
  const fresh = matrix && matrix.at && (Date.now() - Date.parse(matrix.at + (matrix.at.endsWith("Z") ? "" : "Z")) < 10 * 60_000);
  if (!fresh) matrix = await measureFleetMatrix({ now, persist });

  const { moves, why } = planFleetRebalance(matrix);
  const executed = [], refused = [];

  /* W12-b · the two-key arm, measured: live flag × committed order record ×
   * real day-cap ledger × vests math. Pure partition, then sequential
   * execution — one tx per move (T-80 think-gate owns every broadcast). */
  const confPol = armedConf().policy ?? {};
  const flagArmed = confPol.allowDelegation === true;
  const orderArmed = operatorOrderArmed("W12B-SP-LADDER");
  const dayExecuted = spLadderExecutedToday(RECEIPTS, now);
  const ladderMoves = moves.filter((m) => m.kind === "sp-ladder");
  const otherMoves = moves.filter((m) => m.kind !== "sp-ladder");
  const { exec: ladderExec, plan: ladderPlan } = partitionSpLadder(ladderMoves, {
    flagArmed, orderArmed, dayExecuted,
    maxPerDay: REBALANCE_POLICY.maxSpMovesPerDay,
    vestsPerSp: matrix.vestsPerSp ?? null,
  });

  for (const m of otherMoves) {
    if (m.kind === "liquidity-sweep") {
      const amt = `${m.amount.toFixed(3)} ${m.asset}`;
      try {
        const res = await executeAs(m.from, [["transfer", { from: m.from, to: m.to, amount: amt, memo: "W12 fleet rebalance sweep" }]], { tag: "fleet-rebalance-sweep" });
        const rec = { move: m, verdict: res.verdict, txid: res.txid ?? null, error: res.error ?? null, at: now };
        if (res.verdict === "BROADCAST") executed.push(rec); else refused.push(rec);
        appendLine(RECEIPTS, { type: "fleet-rebalance", at: now, ...rec });
      } catch (e) {
        refused.push({ move: m, verdict: "ERROR", error: String(e?.message ?? e).slice(0, 160), at: now });
      }
    } else {
      /* PLAN-ONLY (sp-recall: allowDelegationRecall not armed) — the plan is
       * the deliverable; the operator's one flag makes it live. Never bypassed. */
      appendLine(RECEIPTS, { type: "fleet-rebalance-plan", at: now, move: m });
    }
  }

  /* W12-b · the SP-ladder leg — T1 REVERSIBLE ops, master active key, one
   * tx each, receipts for every attempt (ALLOW and REFUSED alike). */
  for (const m of ladderExec) {
    try {
      const res = await executeAs(m.from, [["delegate_vesting_shares", { delegator: m.from, delegatee: m.to, vesting_shares: `${m.vests} VESTS` }]], { tag: "fleet-rebalance-sp-ladder", role: "active" });
      const rec = { move: { kind: m.kind, from: m.from, to: m.to, sp: m.sp, vests: m.vests, why: m.why }, verdict: res.verdict, txid: res.txid ?? null, error: res.error ?? null, at: now };
      if (res.ok && (res.verdict === "BROADCAST" || res.verdict === "BROADCAST-SPLIT")) executed.push(rec); else refused.push(rec);
      appendLine(RECEIPTS, { type: "fleet-rebalance-sp-ladder", at: now, ...rec });
    } catch (e) {
      refused.push({ move: m, verdict: "ERROR", error: String(e?.message ?? e).slice(0, 160), at: now });
      appendLine(RECEIPTS, { type: "fleet-rebalance-sp-ladder", at: now, move: { kind: m.kind, from: m.from, to: m.to, sp: m.sp, vests: m.vests }, verdict: "ERROR", error: String(e?.message ?? e).slice(0, 160) });
    }
  }
  for (const m of ladderPlan) {
    /* PLAN-ONLY with the honest why: flag-off / order-record-missing /
     * day-cap-reached / no-vestsPerSp. Never bypassed. */
    appendLine(RECEIPTS, { type: "fleet-rebalance-plan", at: now, move: m });
  }

  const out = {
    schema: "fleet-rebalance-v1", at: now, why,
    policy: REBALANCE_POLICY,
    arm: { flag: flagArmed, order: orderArmed, spLadderExecutedToday: dayExecuted, spLadderExecNow: ladderExec.length, spLadderPlannedNow: ladderPlan.length },
    planOnly: moves.filter((m) => m.mode === "PLAN-ONLY"),
    executed, refused,
    verdict: executed.length ? `EXECUTED-${executed.length}` : (moves.length ? (moves.some((m) => m.mode === "PLAN-ONLY") ? (flagArmed && orderArmed ? "PLANNED-DAY-CAP" : "PLANNED-AWAITING-POLICY") : "NO-EXEC") : "BALANCED"),
  };
  if (persist) writeJson(REBALANCE_FILE, out);
  return out;
}
