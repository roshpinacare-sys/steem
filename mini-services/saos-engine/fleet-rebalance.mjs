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
 * W12-c · THE ABSOLUTE FLOOR (chain-judged 2026-10-19): a stale/divergent
 * runner (old sandbox checkout — the exact disease the owner warns about:
 * "שלא תעבוד על קומיט ישן מהסנדבוקס") re-broadcast the delta-SET bug
 * (96694 vs live 120973) and REDUCED 6 soldiers for 8 minutes before its
 * own heal leg restored byte-exact (receipts: 11:12 reduce → 11:20 restore).
 * The matrix-cached never-reduce guard was proven insufficient: the guard
 * is only as fresh as the runner's checkout. Three git-born laws close the
 * class for ANY runner executing git code:
 *   1. LIVE RE-PROOF — before any delegate_vesting_shares broadcast the
 *      current master→soldier level is re-measured FROM THE CHAIN (never
 *      from a cache); would-reduce-or-noop is refused at the boundary.
 *      Chain-unavailable ⇒ fail-closed: zero exec, honest planWhy.
 *   2. THE MONOTONIC SUPPORT FLOOR — state/fleet-support-floor.json records
 *      the proven support level per soldier (seeded from chain truth,
 *      updated ONLY upward by successful broadcasts: floor = max(floor,
 *      broadcast)). A broadcast below the floor is refused before key
 *      material — even if the runner's entire matrix view is a lie.
 *      Deliberate reduction stays possible ONLY via a committed operator
 *      order editing the floor file (same two-key culture as the ladder).
 *   3. THE RESTORE LEG (day-cap-exempt) — whenever live < floor, the rail
 *      plans and (two-key armed) broadcasts an exact floor restore, tagged
 *      fleet-rebalance-restore, journaled, NEVER counted by the ladder's
 *      day-cap ledger (repair is not growth). Capped ≤6 restores/cycle.
 *
 * LAWS: measured inputs only (fleet-matrix) · T-80 (frozen bodies never
 * receive) · day-cap on executed transfers (≤2/cycle, chain-spaced) ·
 * receipts for every attempt · pure planner fully selftested.
 * ───────────────────────────────────────────────────────────────────────── */

import * as fs from "node:fs";
import * as path from "node:path";
import { executeAs, armedConf, execPaused } from "./signer.mjs";
import { readFleetMatrix, measureFleetMatrix } from "./fleet-matrix.mjs";
import { rpcCall } from "./measure.mjs";

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

/* ── W12-c · the monotonic support floor (the absolute never-reduce law) ──
 * floors[soldier].vests is the LOWEST support level the estate has proven
 * and committed; the chain may only be HIGHER. Updated exclusively by
 * successful raise broadcasts (max-merge), so a buggy delta-SET can never
 * drag the floor down — the 11:12 incident class dies at this file. */
const FLOOR_FILE = path.join(STATE_DIR, "fleet-support-floor.json");
export function readSupportFloor(file = FLOOR_FILE) {
  const f = readJson(file, null);
  return f?.schema === "fleet-support-floor-v1" && f.floors && typeof f.floors === "object" ? f : null;
}
export function writeSupportFloor(floors, meta, file = FLOOR_FILE) {
  writeJson(file, { schema: "fleet-support-floor-v1", at: meta?.at ?? new Date().toISOString(), why: meta?.why ?? "seeded", floors });
}
export function mergeFloorFromBroadcast(floors, to, vests) {
  const prev = Number(floors?.[to]?.vests ?? 0);
  const next = Number(vests);
  if (!(next > 0)) return floors; /* no-op on garbage — never seed from nothing */
  if (next <= prev + 1e-6) return floors; /* monotonic: a broadcast never LOWERS the floor */
  return { ...floors, [to]: { vests: next, since: new Date().toISOString(), why: "broadcast-raise" } };
}
/* W12-c · pure boundary guard: re-prove each EXEC move against LIVE chain
 * levels AND the committed floor; a move that would reduce either is
 * demoted to plan with an honest why (before any key material). */
export function reproveAgainstLive(moves, liveDelegations, floors = {}) {
  const exec = [], demoted = [];
  for (const m of moves) {
    const setVests = Number(m.setVests ?? 0);
    const live = liveDelegations?.[m.to];
    const floorV = Number(floors?.[m.to]?.vests ?? 0);
    if (live != null && !(setVests > Number(live) + 1e-6)) { demoted.push({ ...m, mode: "PLAN-ONLY", planWhy: "live-guard-would-reduce-or-noop" }); continue; }
    if (floorV > 0 && !(setVests > floorV + 1e-6)) { demoted.push({ ...m, mode: "PLAN-ONLY", planWhy: "floor-guard-would-reduce-or-noop" }); continue; }
    exec.push(m);
  }
  return { exec, demoted };
}
/* W12-c · pure restore planner: live < floor ⇒ an exact-floor SET, T-80-safe
 * (verified + active bodies only), capped, day-cap-exempt by type. */
export function planSpRestores({ floors, liveDelegations, rows = [], maxRestores = 6 } = {}) {
  const moves = [];
  if (!floors || !liveDelegations) return moves;
  const rowByName = new Map(rows.map((r) => [r.name, r]));
  for (const [to, f] of Object.entries(floors)) {
    if (moves.length >= maxRestores) break;
    if (to === MASTER) continue;
    const floorV = Number(f?.vests ?? 0);
    const live = Number(liveDelegations?.[to] ?? 0);
    if (!(floorV > 0) || !(live + 1e-6 < floorV)) continue;
    const r = rowByName.get(to);
    if (!r || !isVerified(r.custody)) continue; /* T-80: unknown/frozen bodies get nothing */
    const active = r.class === "GRID-ACTIVE" || r.class === "CURATE-ONLY";
    if (!active) continue;
    moves.push({
      kind: "sp-restore", from: MASTER, to, setVests: floorV,
      curVests: live, drop: Math.round((floorV - live) * 1e6) / 1e6,
      dayCapExempt: true, mode: "PLAN-ONLY", requiredFlag: "policy.allowDelegation=true",
      why: `support dropped below the committed floor: live ${Math.round(live * 1e6) / 1e6} < floor ${Math.round(floorV * 1e6) / 1e6} — exact-floor restore (repair, not growth; never counted by the ladder day-cap)`,
    });
  }
  return moves;
}
/* W12-c · LIVE chain re-proof (the boundary's measured input). Returns a
 * plain map {delegatee: vests-number} or null when the chain is unreachable
 * (fail-closed callers must then refuse every exec, not guess). */
export async function liveMasterDelegations(timeoutMs = 12000) {
  try {
    const d = await rpcCall("condenser_api.get_vesting_delegations", [MASTER, null, 100], timeoutMs);
    const out = {};
    for (const x of (d?.result ?? [])) {
      const v = Number(String(x?.vesting_shares ?? "0").split(" ")[0]);
      if (x?.delegatee && v > 0 && !out[x.delegatee]) out[x.delegatee] = v;
    }
    return out;
  } catch { return null; }
}

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
 * mode flipped to "EXEC" (the state filter reads mode); planned moves
 * become copies with an honest planWhy. Order of laws: flag → order
 * record → day-cap → SET-semantics never-reduce guard (the chain-judged
 * lesson: delegate_vesting_shares SETS the level — an op amount ≤ the
 * current master→soldier delegation would REDUCE support and is refused
 * before any key material is touched). */
export function partitionSpLadder(moves, { flagArmed, orderArmed, dayExecuted = 0, maxPerDay = 6, currentDelegations = {} } = {}) {
  const exec = [], plan = [];
  let budget = Math.max(0, maxPerDay - dayExecuted);
  for (const m of moves) {
    if (!flagArmed) { plan.push({ ...m, planWhy: "flag-off" }); continue; }
    if (!orderArmed) { plan.push({ ...m, planWhy: "order-record-missing" }); continue; }
    if (budget <= 0) { plan.push({ ...m, planWhy: "day-cap-reached" }); continue; }
    const setVests = Number(m.setVests ?? 0);
    if (!(setVests > 0)) { plan.push({ ...m, planWhy: "no-setVests" }); continue; }
    const cur = currentDelegations?.[m.to];
    if (cur != null && !(setVests > Number(cur) + 1e-6)) { plan.push({ ...m, planWhy: "would-reduce-or-noop" }); continue; }
    m.mode = "EXEC"; /* identity-kept: the state filter reads mode */
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
   * the trading proof is what makes the RC investment lawful (T-80+).
   *
   * W12-b CHAIN-JUDGED CORRECTION (the SET-semantics lesson): RC capacity is
   * EFFECTIVE SP (own + RECEIVED — every soldier carries historical support
   * since 09-29), and delegate_vesting_shares is a SET op, never additive.
   * The grant is therefore sized against spEffective, and the emitted
   * setVests = current master→soldier delegation + grant — an op amount that
   * can only RAISE the support level. The execution leg re-proves this with
   * a never-reduce guard (partitionSpLadder) before any broadcast. */
  if (masterSpOwn !== null && masterSpOwn > p.masterSpOwnFloor && matrix.vestsPerSp > 0) {
    let headroom = masterSpOwn - p.masterSpOwnFloor;
    const delegByTo = new Map();
    for (const d of (Array.isArray(matrix.delegationsOutRows) ? matrix.delegationsOutRows : [])) {
      if (d?.to && !delegByTo.has(d.to)) {
        delegByTo.set(d.to, Number(String(d.vests ?? "0").split(" ")[0]) || 0);
      }
    }
    for (const r of matrix.rows) {
      if (moves.length >= p.maxSpMovesPerDay) break;
      if (r.name === MASTER) continue;
      if (!isVerified(r.custody)) continue;
      const active = r.class === "GRID-ACTIVE" || r.class === "CURATE-ONLY";
      if (!active) continue;
      const cur = r.spEffective ?? r.sp ?? 0;
      if (cur >= p.soldierSpTarget) continue;
      const grant = Math.min(p.soldierSpTarget - cur, headroom, 60);
      if (grant < 10) continue; // dust SP moves are churn, not support
      const curDelegV = delegByTo.get(r.name) ?? 0;
      const setVests = curDelegV + Math.round(grant * matrix.vestsPerSp);
      moves.push({
        kind: "sp-ladder", from: MASTER, to: r.name, sp: grant, setVests,
        curSpEffective: Math.round(cur * 10) / 10, curMasterDelegationVests: curDelegV,
        mode: "PLAN-ONLY", requiredFlag: "policy.allowDelegation=true",
        why: `RC bottleneck: tank ${r.rcMax != null ? (r.rcMax / 1e12).toFixed(2) : "?"}T vs master ${master?.rcMax != null ? (master.rcMax / 1e12).toFixed(1) : "?"}T; EFFECTIVE SP ${cur}→${Math.round((cur + grant) * 10) / 10} (received ${r.spReceived ?? 0}); master delegation +${grant} SP (SET ${Math.round(setVests * 1e6)/1e6})`,
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
  /* W12-b · the never-reduce guard's measured input: the CURRENT master→X
   * delegation levels (the same rows the planner sized setVests against). */
  const currentDelegations = {};
  for (const d of (Array.isArray(matrix.delegationsOutRows) ? matrix.delegationsOutRows : [])) {
    if (d?.to && !currentDelegations[d.to]) currentDelegations[d.to] = Number(String(d.vests ?? "0").split(" ")[0]) || 0;
  }
  const { exec: ladderExec, plan: ladderPlan } = partitionSpLadder(ladderMoves, {
    flagArmed, orderArmed, dayExecuted,
    maxPerDay: REBALANCE_POLICY.maxSpMovesPerDay,
    currentDelegations,
  });

  /* ── W12-c · THE BOUNDARY LAWS (chain-judged 2026-10-19 incident) ─────
   * 1) ONE live chain re-proof for every leg that might broadcast a
   *    delegation op. Chain unreachable ⇒ fail-closed: everything plans,
   *    nothing executes (an honest refusal is never a failure).
   * 2) RESTORE FIRST: live < committed floor ⇒ exact-floor SET (day-cap
   *    exempt — repair is not growth), same two-key arm, then the ladder. */
  const floorsObj = readSupportFloor()?.floors ?? {};
  const execDelegLegs = flagArmed && orderArmed && (ladderExec.length > 0 || Object.keys(floorsObj).length > 0);
  const live = execDelegLegs ? await liveMasterDelegations() : null;
  const liveProofOk = live != null;

  let restoreMoves = [];
  const restoreExec = [], restorePlan = [];
  if (Object.keys(floorsObj).length > 0) {
    restoreMoves = planSpRestores({ floors: floorsObj, liveDelegations: live, rows: matrix.rows });
    if (liveProofOk && flagArmed && orderArmed && restoreMoves.length > 0) {
      for (const m of restoreMoves) {
        m.mode = "EXEC";
        try {
          const res = await executeAs(m.from, [["delegate_vesting_shares", { delegator: m.from, delegatee: m.to, vesting_shares: `${Number(m.setVests).toFixed(6)} VESTS` }]], { tag: "fleet-rebalance-restore", role: "active" });
          const rec = { move: { kind: m.kind, from: m.from, to: m.to, setVests: m.setVests, curVests: m.curVests, why: m.why }, verdict: res.verdict, txid: res.txid ?? null, error: res.error ?? null, at: now };
          if (res.ok && (res.verdict === "BROADCAST" || res.verdict === "BROADCAST-SPLIT")) { restoreExec.push(rec); }
          else refused.push(rec);
          appendLine(RECEIPTS, { type: "fleet-rebalance-restore", at: now, ...rec });
        } catch (e) {
          const rec = { move: m, verdict: "ERROR", error: String(e?.message ?? e).slice(0, 160), at: now };
          refused.push(rec);
          appendLine(RECEIPTS, { type: "fleet-rebalance-restore", at: now, ...rec });
        }
      }
    } else {
      for (const m of restoreMoves) {
        const planWhy = !flagArmed ? "flag-off" : !orderArmed ? "order-record-missing" : "live-guard-unavailable";
        restorePlan.push({ ...m, planWhy });
        appendLine(RECEIPTS, { type: "fleet-rebalance-restore-plan", at: now, move: { ...m, planWhy } });
      }
    }
  }

  /* 3) LIVE RE-PROOF of the ladder's exec list (the matrix-cached guard
   *    already passed — the chain is the final judge, the floor the
   *    absolute one). Demotions land as honest plan receipts. */
  let demotedByLive = [];
  if (ladderExec.length > 0) {
    if (liveProofOk) {
      const rp = reproveAgainstLive(ladderExec, live, floorsObj);
      demotedByLive = rp.demoted;
      ladderExec.length = 0;
      ladderExec.push(...rp.exec);
      for (const d of demotedByLive) appendLine(RECEIPTS, { type: "fleet-rebalance-plan", at: now, move: d });
    } else {
      for (const m of ladderExec) { ladderPlan.push({ ...m, planWhy: "live-guard-unavailable" }); appendLine(RECEIPTS, { type: "fleet-rebalance-plan", at: now, move: { ...m, planWhy: "live-guard-unavailable" } }); }
      ladderExec.length = 0;
    }
  }

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
   * tx each, receipts for every attempt (ALLOW and REFUSED alike).
   * W12-c · every successful raise MERGES INTO THE MONOTONIC FLOOR (max-only),
   * so this very broadcast becomes the next runner's absolute boundary. */
  for (const m of ladderExec) {
    try {
      const res = await executeAs(m.from, [["delegate_vesting_shares", { delegator: m.from, delegatee: m.to, vesting_shares: `${Number(m.setVests).toFixed(6)} VESTS` }]], { tag: "fleet-rebalance-sp-ladder", role: "active" });
      const rec = { move: { kind: m.kind, from: m.from, to: m.to, sp: m.sp, setVests: m.setVests, curSpEffective: m.curSpEffective ?? null, why: m.why }, verdict: res.verdict, txid: res.txid ?? null, error: res.error ?? null, at: now };
      if (res.ok && (res.verdict === "BROADCAST" || res.verdict === "BROADCAST-SPLIT")) {
        executed.push(rec);
        const merged = mergeFloorFromBroadcast(floorsObj, m.to, m.setVests);
        if (merged !== floorsObj) { floorsObj[m.to] = merged[m.to]; writeSupportFloor(floorsObj, { at: now, why: "broadcast-raise" }); }
      } else refused.push(rec);
      appendLine(RECEIPTS, { type: "fleet-rebalance-sp-ladder", at: now, ...rec });
    } catch (e) {
      refused.push({ move: m, verdict: "ERROR", error: String(e?.message ?? e).slice(0, 160), at: now });
      appendLine(RECEIPTS, { type: "fleet-rebalance-sp-ladder", at: now, move: { kind: m.kind, from: m.from, to: m.to, sp: m.sp, setVests: m.setVests ?? null }, verdict: "ERROR", error: String(e?.message ?? e).slice(0, 160) });
    }
  }
  for (const m of ladderPlan) {
    /* PLAN-ONLY with the honest why: flag-off / order-record-missing /
     * day-cap-reached / no-vestsPerSp. Never bypassed. */
    appendLine(RECEIPTS, { type: "fleet-rebalance-plan", at: now, move: m });
  }

  const out = {
    schema: "fleet-rebalance-v1", at: now, why,
    railVersion: "W12-c",
    policy: REBALANCE_POLICY,
    arm: { flag: flagArmed, order: orderArmed, spLadderExecutedToday: dayExecuted, spLadderExecNow: ladderExec.length, spLadderPlannedNow: ladderPlan.length, restoreExecutedNow: restoreExec.length, restorePlannedNow: restorePlan.length, liveProof: liveProofOk },
    planOnly: moves.filter((m) => m.mode === "PLAN-ONLY"),
    executed, refused,
    verdict: executed.length ? `EXECUTED-${executed.length}` : (moves.length ? (moves.some((m) => m.mode === "PLAN-ONLY") ? (flagArmed && orderArmed ? "PLANNED-DAY-CAP" : "PLANNED-AWAITING-POLICY") : "NO-EXEC") : "BALANCED"),
  };
  if (persist) writeJson(REBALANCE_FILE, out);
  return out;
}
