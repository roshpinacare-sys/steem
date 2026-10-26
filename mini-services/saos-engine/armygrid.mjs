/**
 * armygrid.mjs — T-559 ARMY-GRID: one smart body, MANY HANDS.
 * ═══════════════════════════════════════════════════════════════════════════
 * Owner order (2026-10-21, verbatim): "אני רוצה ממש שזה יהיה גוף אחד חכם עם
 * הרבה ידיים אני רוצה לפזר הרבה עסקאות הרבה יותר ולשמור על רווחיות ולהפעיל
 * לנסות לייצר יותר ווליום ורווחיות... צריך להבין איך להפעיל את כולם יותר טוב
 * ולקבל שליטה ואחיזה טובה יותר שלנו על השוק המקומי של סטים".
 *
 * THE MEASURED GAP this module closes (probe 2026-10-21 ~02:3xZ): the hyper
 * layer trades ONLY the doctrine account (headcorner, 36 live orders) while
 * the machine holds VERIFIED chain custody for 10 army accounts whose books
 * sit EMPTY (zero open orders, zero grid presence) despite live RC tanks
 * (cashmachine 98.6%, israelnews 99.2%, lsa 99.3%, macrame 99.2%, haran 95%,
 * wic 96.6%, woq 62.1%, hcsoldier6 68.9%) and liquid STEEM (~6 each,
 * cashmachine ~101). The owner looked at those wallets and saw nothing —
 * because nothing was there. Now there is.
 *
 * LINEAGE / AUTHORITY: the T-80 stop-order (2026-10-04) froze the OLD
 * soldiers lane "until re-authorization". THIS explicit owner order is that
 * re-authorization — for custody-verified accounts only, riding the FULL
 * gate stack (executeAs → command-hierarchy → think-gate → RC floor). The
 * dead hcsoldier1/2/3 (no matching keys, operator verdict 1a155710681d6421)
 * are NOT resurrected — the gate itself would refuse; we never even ask.
 *
 * WHAT THIS LAYER IS:
 *   a staggered, per-account requote loop. ONE account per tick (round-robin
 *   over the ELIGIBLE roster: custody-verified + RC ≥ floor + liquid ≥ min),
 *   the SAME ladder laws (planLadder flow tranche), the SAME diff discipline
 *   (no churn for churn), per-account RC governor + day-cap + registry.
 *   Asks lead (liquid STEEM); bids self-bootstrap from ask fills (SBD) —
 *   the soldiers' original funding law, now measured into practice.
 *
 * WHAT THIS LAYER IS NOT:
 *   it is not new profit doctrine — ops measure presence; fills measure
 *   trades; P&L stays honest per the A-10 law. It is not a writer of
 *   transfers/delegations (never issued here; the gate would refuse).
 *
 * SAFETY LAWS (all inherited or new):
 *   - executes ONLY through executeAs(account, ops) — the ONE rail with the
 *     full gate stack; custody fail-closed per tick (NO-CUSTODY = skip).
 *   - ORDER-ID PARTITION LAW kept: army ids live in the SAME hyper space
 *     [2.1e9, 4.294e9] — orderids are OWNER-SCOPED on chain, so one space
 *     per account cannot collide across accounts; the registry is
 *     per-account (state/army-grid/<account>.json).
 *   - ONE WRITER PER ACCOUNT: army-grid is the ONLY trading writer on army
 *     books (the cycle writes claims/votes, never order ops, on these).
 *   - per-account backoff: 3 consecutive broadcast failures ⇒ 10min skip.
 *   - per-account RC anomaly guard (rcAnomaly) + RC floor + day-cap.
 *   - single-flight across the whole layer + cross-reload single-flight on
 *     globalThis (the multi-instance storm law, hypergrid lineage).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  planLadder, rcEconomics, rcGovernor, RC_COSTS, diffHyperTick, rcAnomaly,
  countDayOrderOpsFromHistory,
} from "./lib.mjs";
import { rpcCall, accountState, openOrders } from "./measure.mjs";
import { executeAs, armedConf, execPaused, masterAccount, custodyOf } from "./signer.mjs";
import { ARMY_ROSTER_VAULT } from "./vault-revival.mjs";
/* T-564 · ABSORPTION RUNGS (owner order; AutoHedge/agency-agents study):
 * two-phase idempotent order commit + per-fill PnL attribution → routing */
import { journalPendingCreates, markCommits, settleCommits, guardedKeys, createContentKey, commitsSummary } from "./twophase.mjs";
import { sweepAll as sweepPnl, routingTable as pnlRoutingTable, pnlState } from "./fills-pnl.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const AG_DIR = path.join(STATE, "army-grid");
const EVENTS_FILE = path.join(AG_DIR, "events.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
/* ATOMIC-WRITE LAW (hypergrid lineage — the registry-wipe bug): tmp+rename */
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/* the SAME hyper id-space — orderids are owner-scoped on chain */
const ID_LO = 2_100_000_000;
const ID_HI = 4_294_967_290;

export const ARMYGRID_DEFAULTS = {
  enabled: true,          // the owner's activation order IS the doctrine
  tickMs: 4000,           // ONE hand per tick — staggered presence
  levels: 3,              // per side (T-565: 2→3, deeper coverage per requote)
  spacingBps: 25,         // T-565: 15→25 — the DEDUP/ceil3 law merges sub-milli levels anyway; 25bps = ~2.6 millis at army amounts = DISTINCT achievable prices
  ttlSec: 600,            // T-565: 90→600 — rest, don't chase (presence refresh 10min)
  orderTtlSec: 3600,      // chain-side self-clean (1h)
  epsBps: 25,             // T-565 GRILL FIX: was hardcoded 2 — achievable-price granularity is ~36bps per milli at army amounts (T-19 ACHIEVABLE-PRICE LAW), so eps 2 = the diff could NEVER rest → creates≈cancels treadmill with zero fills. 25bps tolerates front wiggle below 2.6 millis.
  askBudgetPct: 0.5,      // of liquid STEEM (small accounts quote visibly)
  steemReserve: 0.5,      // never spend the last half STEEM
  bidMinSbd: 0.5,         // bid side arms only above this (self-bootstrap)
  bidReserveSbd: 0.05,
  minRcPct: 30,           // higher floor than master (small tanks)
  setpointPct: 80,        // army tanks idle at ~99% — burn toward 80
  burst: 2,
  maxOpsPerTick: 8,
  opsDayCap: 1000,        // per account per day (RC-measured ~1200 pairs/day)
  chainTailSec: 600,      // per-account chain-truth sample, 10min cadence
  maxOpsPerTx: 8,
  failBackoffMs: 10 * 60_000,
  maxConsecFails: 3,
  minLiquidSteem: 1.0,
  pnlSweepSec: 600,       /* T-564: fills→PnL sweep cadence (10min) */
};

/* ── T-571 VALUE ROUND · LADDER-VARIANT LAW ────────────────────────────────
 * Owner-delegated decision (trace 1a16118dcfa4f3f9 — "תחליט עבורי... תבחן
 * ותיישם"): T-566 measured the fleet as ONE strategy replicated 13× —
 * identical ladders → correlated fills, zero variance, and the per-fill PnL
 * router (T-564) had nothing to rank. DECISION: DIVERSIFY ACROSS HANDS while
 * keeping the core discipline WITHIN each hand (וגם וגם — the strongest AND
 * the most right):
 *   · UNIFORM everywhere: epsBps=25 (anti-treadmill), ttlSec/orderTtlSec,
 *     governor caps, two-phase commit, PnL sweep — the proven core laws.
 *   · VARIED per hand (deterministic, reproducible, recorded): rung distance
 *     (spacingBps), depth (levels), bid-tier depth (bidCeilingBps — rides the
 *     W27 tier hook ALREADY inside planLadder, byte-identical at 0), ask
 *     weight (askBudgetPct).
 * Tiers: base = the proven eps-25 profile (CONTROL — the top earners
 * hcsoldier4/israelnews stay here, the known-good baseline never stops);
 * tight-flow = near rungs + deeper ladder (flow runners); wide-value = deep
 * bid tier + wide rungs + lighter asks (patient value tranche — the biggest
 * tank cashmachine leads it). All spacings ≥ eps 25 ⇒ zero dedup ambiguity.
 * The verdict belongs to the PnL ledger + fuel router from now on. */
export const HAND_LADDER_VARIANTS = {
  hcsoldier4:  { tier: "base" },
  israelnews:  { tier: "base" },
  hcsoldier5:  { tier: "base" },
  hcsoldier6:  { tier: "base" },
  lsa:         { tier: "tight-flow", spacingBps: 30, levels: 4 },
  tov:         { tier: "tight-flow", spacingBps: 30, levels: 4 },
  haran:       { tier: "tight-flow", spacingBps: 30, levels: 4 },
  cashmachine: { tier: "wide-value", bidCeilingBps: 30, spacingBps: 60, levels: 2, askBudgetPct: 0.4 },
  macrame:     { tier: "wide-value", bidCeilingBps: 30, spacingBps: 60, levels: 2, askBudgetPct: 0.4 },
  wic:         { tier: "wide-value", bidCeilingBps: 30, spacingBps: 60, levels: 2, askBudgetPct: 0.4 },
  siq:         { tier: "wide-value", bidCeilingBps: 30, spacingBps: 60, levels: 2, askBudgetPct: 0.4 },
  wog:         { tier: "wide-value", bidCeilingBps: 30, spacingBps: 60, levels: 2, askBudgetPct: 0.4 },
  woq:         { tier: "wide-value", bidCeilingBps: 30, spacingBps: 60, levels: 2, askBudgetPct: 0.4 },
};

const G = globalThis;

export function armyGridConf() {
  const conf = armedConf();
  return { ...ARMYGRID_DEFAULTS, ...(conf.armyGrid ?? {}) };
}

/** eligibility is MEASURED per tick, never cached past its evidence */
export function armyRoster() {
  const master = masterAccount();
  return (ARMY_ROSTER_VAULT ?? []).filter((a) => a && a !== master);
}

function acctFile(account) { return path.join(AG_DIR, `${account}.json`); }

export function armyGridState() {
  const conf = armyGridConf();
  const roster = armyRoster();
  /* T-80 retirement, chain-judged + owner-approved (IM 1a157f3c9973fe45):
   * dead bodies are shown as RETIRED, never as a custody failure */
  let retired = [];
  try { retired = readJson(path.join(STATE, "army-custody.json"), {})?.denominator?.retired ?? []; } catch { /* measurement lives without it */ }
  const accounts = [];
  const FRESH_MS = 30 * 60_000; /* chain-truth samples newer than 30min are display truth */
  for (const a of roster) {
    const st = readJson(acctFile(a), {}) ?? {};
    const ops = readJson(path.join(AG_DIR, `${a}-ops.json`), {}) ?? {};
    const rawCustody = custodyOf(a);
    const isRetired = (retired ?? []).includes(a);
    /* T-565 GRILL FIX — DISPLAY-TRUTH LAW: the grill proved opsToday (boot-local
     * counter) and liveHyper (in-memory bookkeeping) UNDERCOUNT vs the chain
     * (166 vs 374; 0 vs real orders). When a fresh chain-tail exists, the chain
     * numbers ARE the display; the local counters remain as boot-since fallback. */
    const tailFresh = ops.chainTailAt && (Date.now() - Date.parse(ops.chainTailAt)) < FRESH_MS;
    const liveFresh = ops.chainLive?.at && (Date.now() - Date.parse(ops.chainLive.at)) < FRESH_MS;
    accounts.push({
      account: a,
      custody: isRetired && rawCustody === "no-custody" ? "retired-operator-approved" : rawCustody,
      retired: isRetired,
      lastVerdict: st.lastVerdict ?? null,
      lastVerdictAt: st.lastVerdictAt ?? null,
      variant: st.variant ?? HAND_LADDER_VARIANTS[a]?.tier ?? "base", /* T-571: ladder profile truth on the card */
      lastError: st.lastError ?? null,
      rcPct: st.rcPct ?? null,
      lastMaxRc: st.lastMaxRc ?? null,
      opsToday: ops.day === new Date().toISOString().slice(0, 10)
        ? (tailFresh && ops.chainTail?.total != null ? ops.chainTail.total : ops.opsToday ?? 0)
        : 0,
      opsDayCap: conf.opsDayCap,
      chainTail: ops.chainTail ?? null,
      nextId: st.nextId ?? ID_LO,
      skipUntil: st.skipUntil ?? null,
      lastBroadcastAt: st.lastBroadcastAt ?? null,
      lastTxid: st.lastTxid ?? null,
      lastBalances: st.balances ?? null,
      liveHyper: liveFresh && ops.chainLive?.mine != null ? ops.chainLive.mine : (st.liveHyper ?? null),
      liveOrdersChain: liveFresh ? ops.chainLive?.total ?? null : null,
      commits: commitsSummary(a), /* T-564: two-phase commit journal truth */
    });
  }
  const pnl = pnlState(); /* T-564: per-fill PnL truth + routing proposal */
  return {
    running: G.__saosArmyTimer != null,
    startedAt: G.__saosArmyStartedAt ?? null,
    pid: process.pid,
    conf,
    roster: roster.length,
    eligible: accounts.filter((x) => x.custody === "verified").length,
    accounts,
    pnl: {
      hands: pnl.hands,
      routing: pnl.routing,
      totals: {
        fills: pnl.hands.reduce((s, h) => s + (h.totals?.fills ?? 0), 0),
        realizedSbd: Math.round(pnl.hands.reduce((s, h) => s + (h.totals?.realizedSbd ?? 0), 0) * 1e6) / 1e6,
        /* T-566 GRILL: measured-window honesty surfaced on the card (the state
         * carried windowFrom/windowTo since T-565 — the card never showed them) */
        windowFrom: pnl.hands.length ? (pnl.hands.map((h) => h.windowFrom).filter(Boolean).sort()[0] ?? null) : null,
        windowTo: pnl.hands.length ? (pnl.hands.map((h) => h.windowTo).filter(Boolean).sort().slice(-1)[0] ?? null) : null,
      },
    },
    totals: {
      opsToday: accounts.reduce((s, x) => s + (x.opsToday ?? 0), 0),
      /* T-566 GRILL FIX — DISPLAY-TRUTH-2 (multi-writer fleet): the grill measured
       * liveOrders=10 (writer-band only) while the CHAIN holds 54 open orders in
       * our name — sibling engines' bands own the rest. The card now reports the
       * chain-fleet number as liveOrders; the writer-band total stays honest as
       * liveOrdersMine. Chain numbers are fresh-gated (stale → band fallback). */
      liveOrders: accounts.reduce((s, x) => s + (x.liveOrdersChain ?? x.liveHyper ?? 0), 0),
      liveOrdersMine: accounts.reduce((s, x) => s + (x.liveHyper ?? 0), 0),
    },
  };
}

/* verdict-change journaling per account: the state file holds the last
 * verdict; events only on CHANGE (a 4s stagger would otherwise flood) */
const lastJournalVerdict = {};
function journalVerdict(account, verdict, extra = {}) {
  if (lastJournalVerdict[account] === verdict) return;
  lastJournalVerdict[account] = verdict;
  appendLine(EVENTS_FILE, { type: "army.verdict", at: new Date().toISOString(), account, verdict, ...extra });
}

/* ── reads ─────────────────────────────────────────────────────────────── */

async function readBookShared() {
  const r = await rpcCall("condenser_api.get_order_book", [1]);
  if (!r.ok) return null;
  const unit = (o) => {
    if (!o) return 0;
    const rp = Number(o.real_price);
    return Number.isFinite(rp) && rp > 0 ? rp : 0;
  };
  const a = r.result?.asks?.[0], b = r.result?.bids?.[0];
  return { bestAsk: unit(a), bestBid: unit(b) };
}

async function readRc(account) {
  let r = await rpcCall("rc_api.find_rc_accounts", { accounts: [account] });
  let a = r.ok ? r.result?.rc_accounts?.[0] : null;
  /* R561 · EMPTY-RC NODE-DEFECT LAW (measured 2026-10-21): boylikegirl returns
   * an ok-but-EMPTY rc_accounts for live custody-verified accounts (hcsoldier4/
   * 5/6 measured 407B max_rc on api.steemit.com) — treating "answered, empty"
   * as truth amputated three live hands from the grid (NO-RC-EVIDENCE). An
   * empty answer for a live account is a NODE DEFECT, not a chain truth →
   * failover to the remaining nodes before declaring no-evidence. */
  if (!a) {
    for (const node of ["https://api.justyy.com", "https://api.steemit.com"]) {
      try {
        const resp = await fetch(node, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "rc_api.find_rc_accounts", params: { accounts: [account] }, id: 1 }), signal: AbortSignal.timeout(8000) });
        const j = await resp.json().catch(() => null);
        const cand = j?.result?.rc_accounts?.[0];
        if (cand) { a = cand; break; }
      } catch { /* next node */ }
    }
  }
  if (!a) return null;
  const cur = parseInt(a.rc_manabar?.current_mana ?? "0", 10);
  const max = parseInt(a.max_rc ?? "0", 10);
  if (!(max > 0)) return null;
  return { pct: Math.round((cur / max) * 1000) / 10, cur, max };
}

async function readBalances(account) {
  const acc = await accountState(account);
  return {
    steem: Math.max(0, acc.ok ? acc.steem ?? 0 : 0),
    sbd: Math.max(0, acc.ok ? acc.sbd ?? 0 : 0),
  };
}

/* live army orders for THIS account (hyper-space ids only) */
async function readLiveHyper(account) {
  const oo = await openOrders(account);
  if (!oo.ok) return { ok: false, live: [] };
  const live = [];
  for (const o of oo.orders ?? []) {
    if (Number(o.orderid) >= ID_LO && Number(o.orderid) <= ID_HI) {
      live.push({
        orderid: o.orderid, side: o.side, unit: o.unit,
        createdAtMs: o.created ? Date.parse(o.created.endsWith("Z") ? o.created : o.created + "Z") : 0,
      });
    }
  }
  return { ok: true, live };
}

async function chainTailCount(account, day) {
  try {
    const r = await rpcCall("condenser_api.get_account_history", [account, -1, 400]);
    if (!r.ok) return null;
    return countDayOrderOpsFromHistory(r.result ?? [], account, day);
  } catch { return null; }
}

/* ── one hand, one tick ────────────────────────────────────────────────── */

async function tickAccount(account, book, parity, feedAnchor, rosterLen) {
  const now = new Date();
  const nowMs = now.getTime();
  const conf = armedConf();
  const ag = armyGridConf();
  /* T-571: per-hand ladder variant (see HAND_LADDER_VARIANTS) — exactly three
   * profile knobs ride the SAME governor/eps/ttl core; a hand missing from
   * the table stays byte-identical base. */
  const av = HAND_LADDER_VARIANTS[account] ?? null;
  const agH = av ? { ...ag, levels: av.levels ?? ag.levels, spacingBps: av.spacingBps ?? ag.spacingBps, askBudgetPct: av.askBudgetPct ?? ag.askBudgetPct } : ag;
  const today = now.toISOString().slice(0, 10);
  const FILE = acctFile(account);
  const OPS_FILE = path.join(AG_DIR, `${account}-ops.json`);

  /* the governor must see the account's REAL breathing period: the layer
   * ticks every ag.tickMs but ONE hand speaks per tick, so each account's
   * effective cadence is tickMs × roster — feeding the loop tickMs instead
   * would starve every hand to (1/roster) of its measured RC lung. */
  const effTickMs = ag.tickMs * Math.max(1, rosterLen ?? 1);

  const st = readJson(FILE, {}) ?? {};

  /* T-564 · PHASE-2 chain-judge first: resolve any stale PENDING commits
   * against live open orders, THEN read the young-PENDING guard. The sweep
   * is a rare path (only when old PENDINGs exist) — one openOrders probe. */
  await settleCommits(account).catch(() => null);
  const guard = guardedKeys(account);
  const opsDay = readJson(OPS_FILE, { day: null, opsToday: 0, chainTail: null }) ?? {};
  if (opsDay.day !== today) { opsDay.day = today; opsDay.opsToday = 0; opsDay.chainTail = null; }

  const finish = (patch) => {
    writeJson(FILE, { ...st, variant: av?.tier ?? "base", ...patch, lastTickAt: now.toISOString() });
    if (patch.lastVerdict) journalVerdict(account, patch.lastVerdict);
  };

  /* gates — cheapest first, every one fail-closed */
  if (execPaused()) return finish({ lastVerdict: "OPERATOR-PAUSED", lastVerdictAt: now.toISOString() });
  if (conf.armed !== true) return finish({ lastVerdict: "DISARMED", lastVerdictAt: now.toISOString() });
  if (ag.enabled !== true) return finish({ lastVerdict: "DISABLED", lastVerdictAt: now.toISOString() });
  const custody = custodyOf(account);
  if (custody !== "verified") {
    return finish({ lastVerdict: "NO-CUSTODY", lastVerdictAt: now.toISOString(), custody });
  }
  if (st.skipUntil && nowMs < st.skipUntil) {
    return finish({ lastVerdict: "BACKOFF", lastVerdictAt: now.toISOString() });
  }

  /* per-account RC + anomaly guard (the T-21 guard, per hand) */
  const rc = await readRc(account);
  if (!rc) return finish({ lastVerdict: "NO-RC-EVIDENCE", lastVerdictAt: now.toISOString() });
  if (rcAnomaly(st.lastMaxRc, rc.max)) {
    return finish({ lastVerdict: "RC-ANOMALY-NO-BURN", lastVerdictAt: now.toISOString(), rcPct: rc.pct, lastMaxRc: st.lastMaxRc ?? null, anomalyMaxRc: rc.max });
  }
  if (rc.pct < ag.minRcPct) return finish({ lastVerdict: "RC-FLOOR", lastVerdictAt: now.toISOString(), rcPct: rc.pct, lastMaxRc: rc.max });
  if (!(book && book.bestAsk > 0 && book.bestBid > 0)) return finish({ lastVerdict: "NO-BOOK", lastVerdictAt: now.toISOString(), rcPct: rc.pct });
  if (!(parity > 0)) return finish({ lastVerdict: "NO-PARITY", lastVerdictAt: now.toISOString(), rcPct: rc.pct });

  /* the per-account governor (same laws, smaller lungs) */
  const g = rcGovernor({
    rcPct: rc.pct, floorPct: ag.minRcPct, setpointPct: ag.setpointPct, burst: ag.burst,
    tickMs: effTickMs, maxRc: rc.max, createCost: RC_COSTS.create, cancelCost: RC_COSTS.cancel,
    maxOpsPerTick: ag.maxOpsPerTick, opsDayCap: ag.opsDayCap, opsToday: opsDay.opsToday ?? 0,
    carry: st.carryGovernor ?? 0,
  });
  const withCarry = (patch) => ({ carryGovernor: g.carry, ...patch });
  if (g.pairs <= 0) {
    const v = g.reason === "ops-day-cap" ? "OPS-DAY-CAP" : g.reason === "accumulating" ? "GOVERNOR-ACCUMULATING" : g.reason === "rc-floor" ? "RC-FLOOR" : "GOVERNOR-THROTTLED";
    return finish(withCarry({ lastVerdict: v, lastVerdictAt: now.toISOString(), rcPct: rc.pct, governor: g, opsToday: opsDay.opsToday ?? 0, lastMaxRc: rc.max }));
  }

  /* budgets: asks lead (liquid STEEM); bids self-bootstrap from fills (SBD) */
  const bal = st.balancesAt && nowMs - st.balancesAt < 30_000 && st.balances
    ? st.balances
    : await readBalances(account);
  const spendableSteem = Math.max(0, bal.steem - ag.steemReserve);
  const askBudget = Math.max(0, Math.min(spendableSteem * agH.askBudgetPct, spendableSteem - 0.001));
  const bidBudget = bal.sbd > ag.bidMinSbd ? Math.max(0, bal.sbd - ag.bidReserveSbd) : 0;
  if (bal.steem < ag.minLiquidSteem && bidBudget <= 0) {
    return finish(withCarry({ lastVerdict: "NO-LIQUID", lastVerdictAt: now.toISOString(), rcPct: rc.pct, balances: bal, balancesAt: nowMs, lastMaxRc: rc.max }));
  }

  const plan = planLadder({
    parity, askBudgetSteem: 0, bidBudgetSbd: 0,
    bestAsk: book.bestAsk, bestBid: book.bestBid, feedAnchor: feedAnchor > 0 ? feedAnchor : null,
    flowAskBudgetSteem: askBudget, flowBidBudgetSbd: bidBudget,
    flowLevels: agH.levels, flowSpacingBps: agH.spacingBps,
    bidCeilingBps: av?.bidCeilingBps ?? 0, /* T-571: per-hand bid-tier depth (W27 hook) */
    now: now.toISOString(),
  });
  const planned = [...(plan.flowAsks ?? []), ...(plan.flowBids ?? [])];

  const liveR = await readLiveHyper(account);
  if (!liveR.ok) return finish(withCarry({ lastVerdict: "NO-OPEN-ORDERS-READ", lastVerdictAt: now.toISOString(), rcPct: rc.pct, lastMaxRc: rc.max }));
  if (plan.blocker || (planned.length === 0 && liveR.live.length === 0)) {
    return finish(withCarry({ lastVerdict: plan.blocker ? "PLAN-BLOCKED" : "NO-PLAN", lastVerdictAt: now.toISOString(), rcPct: rc.pct, blocker: plan.blocker, planned: planned.length, liveHyper: liveR.live.length, balances: bal, balancesAt: nowMs, lastMaxRc: rc.max }));
  }

  const liveForDiff = liveR.live.map((o) => ({ ...o, orderid: Number(o.orderid) }));
  const diff = diffHyperTick({ planned, live: liveForDiff, epsBps: ag.epsBps ?? 25, ttlMs: ag.ttlSec * 1000, nowMs });
  const cancelIds = [...diff.cancelIds];
  /* T-564: a level whose identical content is PENDING (outcome unknown) is
   * NOT re-created — this is the duplicate-order killer (see twophase.mjs). */
  let guardSkipped = 0;
  if (diff.unchanged && cancelIds.length === 0) {
    return finish(withCarry({ lastVerdict: "NO-CHANGE", lastVerdictAt: now.toISOString(), rcPct: rc.pct, liveHyper: liveR.live.length, planned: planned.length, balances: bal, balancesAt: nowMs, lastMaxRc: rc.max, governor: g }));
  }

  let opsBudget = g.pairs * 2;
  const cancelOps = cancelIds.slice(0, Math.max(0, Math.min(cancelIds.length, opsBudget, ag.maxOpsPerTx))).map((id) => ["limit_order_cancel", { owner: account, orderid: id }]);
  opsBudget -= cancelOps.length;
  const tSec = Math.floor(nowMs / 1000);
  let nextId = Math.max(ID_LO, st.nextId ?? ID_LO);
  const createdIds = [];
  const createOps = [];
  const journalCreates = []; /* T-564 phase-1 intent rows */
  for (const lvl of diff.creates) {
    if (createOps.length >= opsBudget || createOps.length >= ag.maxOpsPerTx) break;
    if (nextId > ID_HI) nextId = ID_LO;
    const id = nextId++;
    if (lvl.side === "ask") {
      const amt = Number(lvl.amountSteem.toFixed(3));
      const sOut = lvl.sbdOut3 != null ? lvl.sbdOut3 : amt * lvl.unit;
      if (!(amt >= 0.001)) continue;
      const key = createContentKey(account, { side: "ask", amt, min: Number(Number(sOut).toFixed(3)) });
      if (guard.has(key)) { guardSkipped++; continue; } /* outcome unknown — hold */
      createOps.push(["limit_order_create", { owner: account, orderid: id, amount_to_sell: `${amt.toFixed(3)} STEEM`, min_to_receive: `${Number(sOut).toFixed(3)} SBD`, fill_or_kill: false, expiration: tSec + ag.orderTtlSec }]);
      journalCreates.push({ key, side: "ask", amt, min: Number(Number(sOut).toFixed(3)), orderid: id });
    } else {
      const amt = Number(lvl.amountSbd.toFixed(3));
      const stOut = lvl.steemOut3 != null ? lvl.steemOut3 : amt / lvl.unit;
      if (!(amt >= 0.001)) continue;
      const key = createContentKey(account, { side: "bid", amt, min: Number(Number(stOut).toFixed(3)) });
      if (guard.has(key)) { guardSkipped++; continue; } /* outcome unknown — hold */
      createOps.push(["limit_order_create", { owner: account, orderid: id, amount_to_sell: `${amt.toFixed(3)} SBD`, min_to_receive: `${Number(stOut).toFixed(3)} STEEM`, fill_or_kill: false, expiration: tSec + ag.orderTtlSec }]);
      journalCreates.push({ key, side: "bid", amt, min: Number(Number(stOut).toFixed(3)), orderid: id });
    }
    createdIds.push({ id, side: lvl.side, unit: lvl.unit, tranche: "army", at: now.toISOString() });
  }
  const ops = [...cancelOps, ...createOps];
  if (!ops.length) {
    const v = guardSkipped > 0 ? "PENDING-UNSETTLED" : "GOVERNOR-THROTTLED";
    return finish(withCarry({ lastVerdict: v, lastVerdictAt: now.toISOString(), rcPct: rc.pct, governor: g, guardSkipped, lastMaxRc: rc.max }));
  }
  /* T-564 · PHASE-1: journal the intent BEFORE anything is signed */
  if (journalCreates.length) journalPendingCreates(account, journalCreates);

  /* the ONE execution rail — full gate stack, per-account custody, journal */
  const res = await executeAs(account, ops, { tag: "army-grid", rcPct: rc.pct });
  if (!(res.ok ?? res.verdict === "BROADCAST")) {
    const err = String(res.error ?? res.verdict);
    /* R559 · TYPED CUSTODY STATE (measured 2026-10-21): the vault's army
     * ACTIVE generation is dead vs the live chain (9/9 active-authority-
     * mismatch, public-key proof) — a posting-verified identity can never
     * sign order ops, and that is the DESIGNED defense, not a malfunction.
     * The typed verdict routes the owner instead of wearing a sticky error:
     * the layer is LIVE and starts trading the moment ACTIVE custody lands
     * (owner ingest via the two-seal intake, or an owner-signed authority
     * rotation to a machine-held key). */
    if (/ROLE-KEY-ABSENT|no-credential/i.test(err)) {
      return finish({ lastVerdict: "ACTIVE-CUSTODY-ABSENT", lastVerdictAt: now.toISOString(), rcPct: rc.pct, custodyNote: "posting-verified; live ACTIVE key not machine-held (vault gen dead vs chain) — owner routing per law 9", consecFails: 0, skipUntil: null, lastMaxRc: rc.max });
    }
    if (/unknown key/i.test(err) && createOps.length === 0) {
      /* cancel-race honesty law (hypergrid lineage): the goal is already
       * achieved by the other writer — not a sticky error */
      return finish(withCarry({ lastVerdict: "CANCEL-RACE-LOST", lastVerdictAt: now.toISOString(), rcPct: rc.pct, consecFails: 0, skipUntil: null, lastMaxRc: rc.max }));
    }
    /* T-564 phase-2: a definite failure settles the intent as ABANDONED */
    if (journalCreates.length) markCommits(account, journalCreates.map((c) => c.key), "ABANDONED", { note: err.slice(0, 120) });
    const fails = (st.consecFails ?? 0) + 1;
    const skipUntil = fails >= ag.maxConsecFails ? nowMs + ag.failBackoffMs : (st.skipUntil ?? null);
    return finish(withCarry({ lastVerdict: "BROADCAST-FAIL", lastVerdictAt: now.toISOString(), rcPct: rc.pct, lastError: err.slice(0, 160), consecFails: fails, skipUntil, lastMaxRc: rc.max, governor: g }));
  }

  /* T-564 phase-2: the rail answered — settle the intent CONFIRMED */
  if (journalCreates.length) markCommits(account, journalCreates.map((c) => c.key), "CONFIRMED", { txid: res.txid ?? null });

  /* success bookkeeping */
  const cancelledSet = new Set(cancelOps.map(([, o]) => o.orderid));
  const opsToday = (opsDay.opsToday ?? 0) + ops.length;
  writeJson(OPS_FILE, { day: today, opsToday, chainTail: opsDay.chainTail ?? null, chainTailAt: opsDay.chainTailAt ?? null, opsDayCap: ag.opsDayCap, lastTxid: res.txid ?? null, lastBroadcastAt: now.toISOString() });
  const econ = rcEconomics({ maxRc: rc.max });
  const label = cancelOps.length > 0 && createOps.length > 0 ? "requote-front" : cancelOps.length > 0 ? "drift-cancel" : "front-create";
  appendLine(EVENTS_FILE, {
    type: "army.requote", at: now.toISOString(), account, label,
    ops: ops.length, cancels: cancelOps.length, creates: createOps.length,
    txid: res.txid ?? null, rcPct: rc.pct, opsToday,
    equilibriumOpsPerDay: econ.opsPerDay,
    bestAsk: book.bestAsk, bestBid: book.bestBid,
  });
  return finish(withCarry({
    lastVerdict: "BROADCAST", lastVerdictAt: now.toISOString(), rcPct: rc.pct,
    opsToday, nextId, lastTxid: res.txid ?? null, lastError: null, consecFails: 0, skipUntil: null,
    liveHyper: Math.max(0, liveR.live.length - cancelOps.length + createOps.length),
    planned: planned.length, label, balances: bal, balancesAt: nowMs, lastMaxRc: rc.max,
    economics: econ, guardSkipped,
  }));
}

/* ── the staggered loop ────────────────────────────────────────────────── */

let roundIdx = 0;

async function tickInner() {
  const ag = armyGridConf();
  const conf = armedConf();
  if (!conf.armed || ag.enabled !== true || execPaused()) return;
  const roster = armyRoster();
  if (!roster.length) return;
  /* one shared book read per layer-tick; parity from the engine's own observe */
  const book = await readBookShared();
  const obs = readJson(path.join(STATE, "observe.json"), null);
  const parity = obs?.parity?.parity ?? null;
  const feedAnchor = obs?.feed ?? readJson(path.join(STATE, "offer.json"), null)?.flow?.feedAnchor ?? null;
  /* round-robin: the next eligible hand speaks each tick */
  for (let i = 0; i < roster.length; i++) {
    const account = roster[(roundIdx + i) % roster.length];
    if (custodyOf(account) !== "verified") continue;
    roundIdx = (roundIdx + i + 1) % roster.length;
    try { await tickAccount(account, book, parity, feedAnchor, roster.length); } catch (e) {
      appendLine(EVENTS_FILE, { type: "army.tick-error", at: new Date().toISOString(), account, error: String(e?.message ?? e).slice(0, 160) });
    }
    return; // ONE hand per tick — the stagger IS the pacing law
  }
}

async function tick() {
  if (G.__saosArmyInFlight === true) return;
  G.__saosArmyInFlight = true;
  try { await tickInner(); } catch (e) {
    appendLine(EVENTS_FILE, { type: "army.layer-error", at: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 200) });
  } finally { G.__saosArmyInFlight = false; }
}

/* per-account chain-truth tail sampler (honest day counters + live presence) */
let lastTailAt = {};
async function tailSample() {
  const ag = armyGridConf();
  if (Date.now() - (lastTailAt._g ?? 0) < (ag.chainTailSec ?? 600) * 1000) return;
  lastTailAt._g = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  for (const account of armyRoster()) {
    if (custodyOf(account) !== "verified") continue;
    /* T-565 GRILL FIX: the tail sample now ALSO reads live presence from the
     * chain — the grill proved the in-memory liveHyper bookkeeping drifts to 0
     * while the chain holds real orders; the chain is the display truth. */
    const [tail, oo] = await Promise.all([
      chainTailCount(account, day),
      openOrders(account).catch(() => ({ ok: false, orders: [] })),
    ]);
    const chainLive = oo.ok
      ? { total: (oo.orders ?? []).length, mine: (oo.orders ?? []).filter((o) => Number(o.orderid) >= ID_LO && Number(o.orderid) <= ID_HI).length, at: new Date().toISOString() }
      : null;
    if (!tail && !chainLive) continue;
    const OPS_FILE = path.join(AG_DIR, `${account}-ops.json`);
    const opsDay = readJson(OPS_FILE, { day, opsToday: 0 }) ?? {};
    if (opsDay.day !== day) { opsDay.day = day; opsDay.opsToday = 0; }
    writeJson(OPS_FILE, { ...opsDay, ...(tail ? { chainTail: tail, chainTailAt: new Date().toISOString() } : {}), ...(chainLive ? { chainLive } : {}) });
  }
}

export function startArmyGrid() {
  /* hot-reload/boot idempotent: ONE loop per process, always the newest code */
  if (G.__saosArmyTimer) clearInterval(G.__saosArmyTimer);
  if (G.__saosArmyTailTimer) clearInterval(G.__saosArmyTailTimer);
  const ag = armyGridConf();
  G.__saosArmyStartedAt = new Date().toISOString();
  if (ag.enabled !== true) {
    G.__saosArmyTimer = null;
    appendLine(EVENTS_FILE, { type: "army.boot", at: G.__saosArmyStartedAt, pid: process.pid, verdict: "DISABLED-AT-BOOT" });
    return armyGridState();
  }
  appendLine(EVENTS_FILE, { type: "army.boot", at: G.__saosArmyStartedAt, pid: process.pid, conf: ag, roster: armyRoster() });
  G.__saosArmyTimer = setInterval(() => { void tick(); }, Math.max(1000, ag.tickMs));
  void tick();
  void tailSample().catch(() => {});
  G.__saosArmyTailTimer = setInterval(() => { void tailSample().catch(() => {}); }, 60_000);
  /* T-564 · the fills→PnL sweeper: chain-truth PnL per hand + routing
   * proposal. Fail-soft per hand; the trading loop never depends on it. */
  if (G.__saosArmyPnlTimer) clearInterval(G.__saosArmyPnlTimer);
  if (G.__saosArmyPnlFirst) clearTimeout(G.__saosArmyPnlFirst);
  const pnlSweep = async () => {
    try {
      const rows = await sweepPnl(armyRoster().filter((a) => custodyOf(a) === "verified"));
      pnlRoutingTable(rows.map((r) => ({ account: r.account })));
      appendLine(EVENTS_FILE, { type: "army.pnl-sweep", at: new Date().toISOString(), hands: rows.length, ok: rows.filter((r) => r.ok).length });
    } catch (e) {
      appendLine(EVENTS_FILE, { type: "army.pnl-sweep-error", at: new Date().toISOString(), error: String(e?.message ?? e).slice(0, 160) });
    }
  };
  G.__saosArmyPnlFirst = setTimeout(() => { void pnlSweep(); }, 45_000); /* first sweep after custody settles */
  G.__saosArmyPnlTimer = setInterval(() => { void pnlSweep(); }, Math.max(60_000, (ag.pnlSweepSec ?? 600) * 1000));
  return armyGridState();
}
