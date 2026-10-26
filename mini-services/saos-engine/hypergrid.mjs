/**
 * hypergrid.mjs — T-19b HYPER-GRID: the VOLUME layer of the sovereign engine.
 * ═══════════════════════════════════════════════════════════════════════════
 * Operator order (2026-09-30): "אני צריך אלפי אם לא מאות אלפי עסקאות גריד
 * ביום" — thousands to hundreds of thousands of grid transactions per day.
 * The measured answer (rc-probe.mjs, live): the 4034-SP RC tank regenerates
 * 1.23e12 RC/day and a requote pair costs ~76.5M RC ⇒ EQUILIBRIUM ≈ 32k
 * ops/day. The old 1500/day cap was 5% of the machine's lungs.
 *
 * WHAT THIS LAYER IS:
 *   a self-paced high-frequency requoting loop that keeps our FLOW presence
 *   at the live book front, throttled by an RC equilibrium governor, with
 *   chain-truth day accounting. It is REAL market-making presence: every op
 *   repositions a lawful level (anchor/ceiling/CEIL3 laws via planLadder);
 *   TTL requotes are honestly labeled presence-refresh (churn), front-chases
 *   are labeled requote-front.
 *
 * WHAT THIS LAYER IS NOT:
 *   it is not profit. ops measure presence; fills measure trades; the P&L
 *   stays A-10 honest (unbased ≠ profit). The scaling law to 100,000× is
 *   RC/SP acquisition (delegation, powering up) — ops/day ∝ RC tank.
 *
 * SAFETY LAWS (all inherited or new):
 *   - executes ONLY through signer.executeOps (armed/pause/RC-floor/verify)
 *   - ORDER-ID PARTITION LAW: hyper ids live in [2.1e9, 4.294e9] — the
 *     cycle's tSec-based ids (~1.79e9) can never collide with ours
 *   - OURS-ONLY cancels: hyper cancels only ids it created (registry) or ids
 *     in the hyper id-partition, plus legacy tranche="flow" ids (migration)
 *   - the cycle's flow-requote is DISABLED when hyperGrid.enabled (single
 *     owner of the mobile layer — no self-competition, T-19 law kept)
 *   - single-flight: one tick at a time; cycle-running → this tick is skipped
 *   - chain-truth day counter (max(state, chain-tail) evidence, T-18 law)
 *   - journal discipline: events.jsonl on broadcasts/verdict-changes only;
 *     the state file carries the per-tick truth
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  planLadder, rcEconomics, rcGovernor, RC_COSTS,
  countDayOrderOpsFromHistory, diffHyperTick, rcAnomaly,
} from "./lib.mjs";
import { rpcCall, accountState, openOrders } from "./measure.mjs";
import { executeOps, armedConf, execPaused, masterAccount, loadCredential } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const HYPER_FILE = path.join(STATE, "hyper-grid.json");
const OPS_FILE = path.join(STATE, "hyper-ops.json");
const OURS_FILE = path.join(STATE, "our-orders.json");
const OBSERVE_FILE = path.join(STATE, "observe.json");
const OFFER_FILE = path.join(STATE, "offer.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
/* ATOMIC-WRITE LAW (the registry-wipe bug, proven live 19:24): a plain
 * truncate+write lets a concurrent reader see a HALF-EMPTY file → the reader
 * treats it as {orderids: []} and writes the wipe back. tmp+rename is
 * atomic on POSIX — a reader ever sees old-or-new, never half. */
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); };

/** ORDER-ID PARTITION LAW: hyper ids ∈ [2.1e9, 4.294e9]; cycle ids are
 * tSec-based (~1.79e9 + small offset) — collision impossible by construction. */
const ID_LO = 2_100_000_000;
const ID_HI = 4_294_967_290;
const inHyperSpace = (id) => Number(id) >= ID_LO && Number(id) <= ID_HI;

export const HYPER_DEFAULTS = {
  enabled: true,
  tickMs: 3000,           // one poll per block
  levels: 10,             // per side (capital-permitting)
  spacingBps: 15,         // front-anchored level spacing
  ttlSec: 60,             // presence-refresh: levels older than this requote
  orderTtlSec: 3600,      // chain-side self-clean if we ever die (1h)
  askBudgetPct: 0.12,     // of liquid STEEM (T-19 flow tranche doctrine)
  minRcPct: 25,           // hard floor — the votes' RC is never starved
  /* W24 (owner liquidity doctrine, trace 1a1599a1f656e08d): the setpoint is
   * now a CODE law, not runtime state — the W23-d 50→40 change died with the
   * sandbox wipe because it lived only in memory. 40 = the measured 7×
   * quoting-pace equilibrium; floor 25 untouched; ladder to 35 only after
   * 24h of stable PnL at 40 (measured, reversible, one notch at a time). */
  /* G41 (owner volume mandate, trace 1a15c3717053dcad): W24's planned 40→35
   * notch executed NOW, with measured proof: hyper-grid.json economics
   * (2026-10-21) regen 779.4B/d > burn 540.4B/d at equilibrium pace — trading
   * at equilibrium REGENERATES RC net-positive, so waiting at 40 only idled
   * ~a day of presence (rcPct 35.4 → GOVERNOR-ACCUMULATING, pairs 0). One
   * reversible notch; floor 25 untouched; owner order: "רוצה יותר ווליום". */
  setpointPct: 35,        // governor equilibrium target (G41 notch, measured-sustainable)
  burst: 3,               // transient burn multiplier above equilibrium
  maxOpsPerTick: 24,      // per-broadcast op ceiling
  opsDayCap: 32000,       // doctrine cap = the MEASURED equilibrium
  chainTailSec: 60,       // chain-truth tail verification cadence
  maxOpsPerTx: 24,
};

let timer = null;
let tailTimer = null;
let startedAt = null;
let balancesCache = null;   // { steem, sbd, at }
const BALANCE_TTL_MS = 30_000;

/* CROSS-RELOAD SINGLE-FLIGHT LAW (the multi-instance storm, proven live):
 * bun --hot re-runs module top-level but keeps the OLD module's timers —
 * N module instances raced N concurrent ticks (duplicate txs, duplicate
 * orderids, registry wipe). The tick mutex + timer handles live on
 * globalThis — shared across reloads, one loop per PROCESS, always the
 * NEWEST module's code. */
const G = globalThis;

export function hyperConf() {
  const conf = armedConf();
  return { ...HYPER_DEFAULTS, ...(conf.hyperGrid ?? {}) };
}

export function hyperState() {
  return {
    running: timer != null,
    startedAt,
    pid: process.pid,
    runtime: readJson(HYPER_FILE, null),
    ops: readJson(OPS_FILE, null),
  };
}

/* verdict-change journaling: the state file holds the last verdict; events
 * only on CHANGE (a 3s tick that journals every poll would flood the bus) */
let lastEventVerdict = null;
function journalVerdict(verdict, extra = {}) {
  const st = readJson(HYPER_FILE, {});
  if (st.lastVerdict !== verdict) {
    lastEventVerdict = verdict;
    appendLine(EVENTS_FILE, { type: "hyper.verdict", at: new Date().toISOString(), verdict, ...extra });
  }
}

async function readBook() {
  const r = await rpcCall("condenser_api.get_order_book", [1]);
  if (!r.ok) return null;
  const a = r.result?.asks?.[0], b = r.result?.bids?.[0];
  const unit = (o) => {
    if (!o) return 0;
    const rp = Number(o.real_price);
    return Number.isFinite(rp) && rp > 0 ? rp : 0;
  };
  return { bestAsk: unit(a), bestBid: unit(b) };
}

async function readRc() {
  const r = await rpcCall("rc_api.find_rc_accounts", { accounts: [masterAccount()] });
  const a = r.ok ? r.result?.rc_accounts?.[0] : null;
  if (!a) return null;
  const cur = parseInt(a.rc_manabar?.current_mana ?? "0", 10);
  const max = parseInt(a.max_rc ?? "0", 10);
  if (!(max > 0)) return null;
  return { pct: Math.round((cur / max) * 1000) / 10, cur, max };
}

async function readBalances() {
  const now = Date.now();
  if (balancesCache && now - balancesCache.at < BALANCE_TTL_MS) return balancesCache;
  const acc = await accountState(masterAccount());
  balancesCache = { steem: Math.max(0, acc.ok ? acc.steem ?? 0 : 0), sbd: Math.max(0, acc.ok ? acc.sbd ?? 0 : 0), at: now };
  return balancesCache;
}

/** live hyper orders + legacy flow ids to migrate, from get_open_orders */
async function readLiveHyper(account) {
  const oo = await openOrders(account);
  if (!oo.ok) return { ok: false, live: [], flowLegacyIds: [] };
  const nowMs = Date.now();
  const live = [];
  const flowLegacyIds = [];
  for (const o of oo.orders ?? []) {
    const isHyper = inHyperSpace(o.orderid);
    if (isHyper) {
      live.push({
        orderid: o.orderid, side: o.side, unit: o.unit,
        createdAtMs: o.created ? Date.parse(o.created.endsWith("Z") ? o.created : o.created + "Z") : 0,
      });
    } else {
      /* legacy flow tranche owned by THIS engine's registry → migrate */
      const ours = readJson(OURS_FILE, { orderids: [] });
      const mine = (ours.orderids ?? []).find((x) => (typeof x === "object" ? x.id : x) === o.orderid);
      if (mine && typeof mine === "object" && mine.tranche === "flow") flowLegacyIds.push(o.orderid);
    }
  }
  return { ok: true, live, flowLegacyIds };
}

/* the chain-truth tail (T-18 law, sampled): the last-400-op history window
 * proves our state counter isn't lying about RECENT ops. At 30k ops/day the
 * window covers ~30min — a sample, not a full-day proof (honest labeling). */
async function chainTailCount(account, day) {
  try {
    const r = await rpcCall("condenser_api.get_account_history", [account, -1, 400]);
    if (!r.ok) return null;
    return countDayOrderOpsFromHistory(r.result ?? [], account, day);
  } catch { return null; }
}

async function tickInner() {
  const now = new Date();
  const nowMs = now.getTime();
  const conf = armedConf();
  const hc = hyperConf();
  const account = masterAccount();
  const today = now.toISOString().slice(0, 10);

  const st = readJson(HYPER_FILE, {});
  const opsDay = readJson(OPS_FILE, { day: null, opsToday: 0, chainTail: null, chainTailAt: null });
  if (opsDay.day !== today) { opsDay.day = today; opsDay.opsToday = 0; opsDay.chainTail = null; }

  const baseState = {
    running: G.__saosHyperTimer != null,
    lastTickAt: now.toISOString(),
    ticks: (st.ticks ?? 0) + 1,
    nextId: st.nextId ?? ID_LO,
    conf: hc,
  };
  const finish = (patch, evExtra) => {
    /* spread order LAW: st (tick-start snapshot) first, then the FRESH
     * baseState (lastTickAt/ticks must never be overwritten by stale), then
     * the patch (broadcast results win). The earlier order let the stale
     * snapshot win — lastTickAt froze while verdicts advanced. */
    writeJson(HYPER_FILE, { ...st, ...baseState, ...patch, day: today });
    if (evExtra) journalVerdict(patch.lastVerdict, evExtra);
    else journalVerdict(patch.lastVerdict);
  };

  if (!conf.armed) return finish({ lastVerdict: "DISARMED", lastVerdictAt: now.toISOString() });
  if (execPaused()) return finish({ lastVerdict: "OPERATOR-PAUSED", lastVerdictAt: now.toISOString() });
  if (hc.enabled !== true) return finish({ lastVerdict: "DISABLED", lastVerdictAt: now.toISOString() });
  try { loadCredential(); } catch (e) {
    return finish({ lastVerdict: "CREDENTIAL-MISSING", lastVerdictAt: now.toISOString(), lastError: String(e?.message ?? e).slice(0, 120) });
  }

  /* cycle-overlap guard: while a signing cycle is in flight its execute step
   * owns the account's order surgery — one writer per moment (T-17 lineage).
   * R299 · STALE-MARKER LAW (measured 21:25-21:52Z): a cycle whose await
   * never settles (stalled socket) left running:true forever and the grid
   * deferred every tick for 27 minutes — the book froze. A marker older
   * than CYCLE_STALE_MS (2× the slowest measured healthy cycle) is a DEAD
   * cycle: journal honestly, clear the marker, and trade. */
  const marker = readJson(path.join(STATE, "cycle-run.json"), null);
  const CYCLE_STALE_MS = Number(process.env.SAOS_CYCLE_STALE_MS) || 20 * 60_000;
  const pidAlive = (pid) => { try { if (!pid || pid === process.pid) return true; process.kill(pid, 0); return true; } catch { return false; } };
  if (marker?.running === true) {
    const ageMs = Date.now() - (Date.parse(marker.startedAt) || 0);
    const foreignDead = marker.pid && marker.pid !== process.pid && !pidAlive(marker.pid);
    if (ageMs > CYCLE_STALE_MS || foreignDead) {
      try { fs.rmSync(path.join(STATE, "cycle-run.json"), { force: true }); } catch { /* best-effort */ }
      journalVerdict("CYCLE-MARKER-STALE-PROCEED", { staleMs: ageMs, startedAt: marker.startedAt, foreignDead, markerPid: marker.pid ?? null });
    } else {
      return finish({ lastVerdict: "CYCLE-IN-FLIGHT", lastVerdictAt: now.toISOString() });
    }
  }

  /* reads (parallel): RC + book + live orders */
  const [rc, book, liveR] = await Promise.all([readRc(), readBook(), readLiveHyper(account)]);
  if (!rc) return finish({ lastVerdict: "NO-RC-EVIDENCE", lastVerdictAt: now.toISOString() });
  /* T-21 RC-ANOMALY GUARD (defense-in-depth for the identity-hijack class):
   * the doctrine account's RC tank cannot legally shrink 10× between two
   * reads — when it does, the read is a lie (identity flip / RPC poison).
   * No burn on anomaly; the guard is proven by the selftest vectors. */
  if (rcAnomaly(st.lastMaxRc, rc.max)) {
    journalVerdict("RC-ANOMALY-NO-BURN");
    return finish({ lastVerdict: "RC-ANOMALY-NO-BURN", lastVerdictAt: now.toISOString(), rcPct: rc.pct, lastMaxRc: st.lastMaxRc ?? null, anomalyMaxRc: rc.max });
  }
  baseState.lastMaxRc = rc.max;
  if (!book || !(book.bestAsk > 0) || !(book.bestBid > 0)) return finish({ lastVerdict: "NO-BOOK", lastVerdictAt: now.toISOString(), rcPct: rc.pct });
  if (rc.pct < hc.minRcPct) {
    journalVerdict("RC-FLOOR");
    return finish({ lastVerdict: "RC-FLOOR", lastVerdictAt: now.toISOString(), rcPct: rc.pct });
  }

  /* the equilibrium governor decides how much this tick may burn (the
   * fraction carry accumulates sub-pair credits across ticks — the
   * starvation-bug fix) */
  const g = rcGovernor({
    rcPct: rc.pct, floorPct: hc.minRcPct, setpointPct: hc.setpointPct, burst: hc.burst,
    tickMs: hc.tickMs, maxRc: rc.max, createCost: RC_COSTS.create, cancelCost: RC_COSTS.cancel,
    maxOpsPerTick: hc.maxOpsPerTick, opsDayCap: hc.opsDayCap, opsToday: opsDay.opsToday,
    carry: st.carryGovernor ?? 0,
  });
  const withCarry = (patch) => ({ carryGovernor: g.carry, ...patch });
  if (g.pairs <= 0) {
    const v = g.reason === "ops-day-cap" ? "OPS-DAY-CAP" : g.reason === "accumulating" ? "GOVERNOR-ACCUMULATING" : g.reason === "rc-floor" ? "RC-FLOOR" : "GOVERNOR-THROTTLED";
    return finish(withCarry({ lastVerdict: v, lastVerdictAt: now.toISOString(), rcPct: rc.pct, governor: g, opsToday: opsDay.opsToday }));
  }

  /* plan via the SAME ladder laws (anchor/ceiling/CEIL3/dedup) — value
   * budgets zeroed so ONLY the flow tranche is planned here */
  const obs = readJson(OBSERVE_FILE, null);
  const parity = obs?.parity?.parity ?? null;
  const feedAnchor = obs?.feed ?? readJson(OFFER_FILE, null)?.flow?.feedAnchor ?? null;
  if (!(parity > 0)) return finish({ lastVerdict: "NO-PARITY", lastVerdictAt: now.toISOString(), rcPct: rc.pct });

  const bal = await readBalances();
  const askBudget = Math.max(0, Math.min(bal.steem * hc.askBudgetPct, bal.steem - 0.001));
  const bidBudget = Math.max(0, bal.sbd - 0.5); // bid reserve (conf.bidReserveSbd law)
  const plan = planLadder({
    parity, askBudgetSteem: 0, bidBudgetSbd: 0,
    bestAsk: book.bestAsk, bestBid: book.bestBid, feedAnchor: feedAnchor > 0 ? feedAnchor : null,
    flowAskBudgetSteem: askBudget, flowBidBudgetSbd: bidBudget,
    flowLevels: hc.levels, flowSpacingBps: hc.spacingBps,
    now: now.toISOString(),
  });
  const planned = [...(plan.flowAsks ?? []), ...(plan.flowBids ?? [])];
  if (plan.blocker || (planned.length === 0 && liveR.flowLegacyIds.length === 0)) {
    return finish(withCarry({ lastVerdict: plan.blocker ? "PLAN-BLOCKED" : "NO-PLAN", lastVerdictAt: now.toISOString(), rcPct: rc.pct, blocker: plan.blocker, planned: planned.length, liveHyper: liveR.live.length }));
  }

  /* the minimal honest diff — no churn for churn */
  const liveForDiff = liveR.live.map((o) => ({ ...o, orderid: Number(o.orderid) }));
  const diff = diffHyperTick({ planned, live: liveForDiff, epsBps: 2, ttlMs: hc.ttlSec * 1000, nowMs });
  const cancelIds = [...diff.cancelIds, ...liveR.flowLegacyIds]; // legacy migration
  if (diff.unchanged && cancelIds.length === 0) {
    return finish(withCarry({ lastVerdict: "NO-CHANGE", lastVerdictAt: now.toISOString(), rcPct: rc.pct, liveHyper: liveR.live.length, planned: planned.length, governor: g }));
  }

  /* clamp to the governor budget: cancels first (free capital + law), then
   * creates; a throttled tick may cancel without creating — the next tick
   * replaces (the layer breathes within its measured lung capacity) */
  let opsBudget = g.pairs * 2;
  const cancelOps = cancelIds.slice(0, Math.max(0, Math.min(cancelIds.length, opsBudget, hc.maxOpsPerTx))).map((id) => ["limit_order_cancel", { owner: account, orderid: id }]);
  opsBudget -= cancelOps.length;
  const tSec = Math.floor(nowMs / 1000);
  let nextId = Math.max(ID_LO, st.nextId ?? ID_LO);
  const createdIds = [];
  const createOps = [];
  for (const lvl of diff.creates) {
    if (createOps.length >= opsBudget || createOps.length >= hc.maxOpsPerTx) break;
    if (nextId > ID_HI) nextId = ID_LO; // wraps after 2.19e9 ops — decades
    const id = nextId++;
    if (lvl.side === "ask") {
      const amt = Number(lvl.amountSteem.toFixed(3));
      const sOut = lvl.sbdOut3 != null ? lvl.sbdOut3 : amt * lvl.unit;
      if (!(amt >= 0.001)) continue;
      createOps.push(["limit_order_create", { owner: account, orderid: id, amount_to_sell: `${amt.toFixed(3)} STEEM`, min_to_receive: `${Number(sOut).toFixed(3)} SBD`, fill_or_kill: false, expiration: tSec + hc.orderTtlSec }]);
    } else {
      const amt = Number(lvl.amountSbd.toFixed(3));
      const stOut = lvl.steemOut3 != null ? lvl.steemOut3 : amt / lvl.unit;
      if (!(amt >= 0.001)) continue;
      createOps.push(["limit_order_create", { owner: account, orderid: id, amount_to_sell: `${amt.toFixed(3)} SBD`, min_to_receive: `${Number(stOut).toFixed(3)} STEEM`, fill_or_kill: false, expiration: tSec + hc.orderTtlSec }]);
    }
    createdIds.push({ id, side: lvl.side, unit: lvl.unit, tranche: "hyper", at: now.toISOString() });
  }
  const ops = [...cancelOps, ...createOps];
  if (!ops.length) {
    return finish(withCarry({ lastVerdict: "GOVERNOR-THROTTLED", lastVerdictAt: now.toISOString(), rcPct: rc.pct, governor: g, diff: { cancels: cancelIds.length, creates: diff.creates.length } }));
  }

  /* the ONE execution rail — armed/pause/RC-floor/verify live inside */
  const res = await executeOps(ops, { tag: "hyper-grid", rcPct: rc.pct });
  if (!(res.ok ?? res.verdict === "BROADCAST")) {
    const err = String(res.error ?? res.verdict);
    /* RACE-HONESTY LAW (proven live): cancel-of-already-gone = "unknown key"
     * (the probe proved the error signature; the multi-instance storm made
     * it common — the winner cancelled, the loser failed). A race loss on a
     * PURE-CANCEL batch means the goal (orders gone) is ALREADY achieved by
     * the other writer — journaled honestly, NOT a sticky error. A race
     * loss with creates ⇒ those creates re-plan next tick (self-healing). */
    if (/unknown key/i.test(err) && createOps.length === 0) {
      return finish(withCarry({ lastVerdict: "CANCEL-RACE-LOST", lastVerdictAt: now.toISOString(), rcPct: rc.pct, governor: g, lastError: null }));
    }
    return finish(withCarry({ lastVerdict: "BROADCAST-FAIL", lastVerdictAt: now.toISOString(), rcPct: rc.pct, lastError: err.slice(0, 160), governor: g }));
  }

  /* bookkeeping: registry, day counter, economics journal */
  const cancelledSet = new Set(cancelOps.map(([, o]) => o.orderid));
  const ours = readJson(OURS_FILE, { orderids: [] });
  const cut = (ours.orderids ?? []).filter((o) => !cancelledSet.has(typeof o === "object" ? o.id : o));
  writeJson(OURS_FILE, { orderids: [...cut, ...createdIds].slice(-400) });
  const opsToday = opsDay.opsToday + ops.length;
  writeJson(OPS_FILE, { day: today, opsToday, chainTail: opsDay.chainTail ?? null, chainTailAt: opsDay.chainTailAt ?? null, opsDayCap: hc.opsDayCap, lastTxid: res.txid ?? null, lastBroadcastAt: now.toISOString() });

  const econ = rcEconomics({ maxRc: rc.max });
  const label = cancelIds.length > 0 && diff.creates.length > 0 ? "requote-front" : cancelIds.length > 0 ? "drift-cancel" : "front-create";
  appendLine(EVENTS_FILE, {
    type: "hyper.requote", at: now.toISOString(), label,
    ops: ops.length, cancels: cancelOps.length, creates: createOps.length,
    txid: res.txid ?? null, rcPct: rc.pct, opsToday,
    equilibriumOpsPerDay: econ.opsPerDay,
    bestAsk: book.bestAsk, bestBid: book.bestBid,
  });
  return finish(withCarry({
    lastVerdict: "BROADCAST", lastVerdictAt: now.toISOString(), rcPct: rc.pct,
    opsToday, nextId, lastTxid: res.txid ?? null, governor: g, lastError: null,
    liveHyper: liveR.live.length - cancelOps.length + createOps.length,
    planned: planned.length, label, economics: econ,
  }), { label, ops: ops.length, txid: res.txid ?? null });
}

async function tick() {
  if (G.__saosHyperInFlight === true) return;
  G.__saosHyperInFlight = true;
  try { await tickInner(); } catch (e) {
    writeJson(HYPER_FILE, { ...(readJson(HYPER_FILE, {})), lastVerdict: "TICK-ERROR", lastError: String(e?.message ?? e).slice(0, 200), lastTickAt: new Date().toISOString() });
  } finally { G.__saosHyperInFlight = false; }
}

/* the chain-truth tail sampler — once per chainTailSec */
let lastTailAt = 0;
async function tailSample() {
  const hc = hyperConf();
  if (Date.now() - lastTailAt < hc.chainTailSec * 1000) return;
  lastTailAt = Date.now();
  const account = masterAccount();
  const day = new Date().toISOString().slice(0, 10);
  const tail = await chainTailCount(account, day);
  if (!tail) return;
  /* T-21 day-rollover law (the stale-09-30 ledger cosmetic bug): the tail
   * sampler must never resurrect yesterday's day/opsToday into the ledger */
  const opsDay = readJson(OPS_FILE, { day, opsToday: 0, chainTail: null, chainTailAt: null });
  if (opsDay.day !== day) { opsDay.day = day; opsDay.opsToday = 0; opsDay.chainTail = null; }
  writeJson(OPS_FILE, { ...opsDay, chainTail: tail, chainTailAt: new Date().toISOString() });
}

export function startHyperGrid() {
  /* hot-reload/boot idempotent: ONE loop per process, always the newest code */
  if (G.__saosHyperTimer) clearInterval(G.__saosHyperTimer);
  if (G.__saosHyperTailTimer) clearInterval(G.__saosHyperTailTimer);
  const hc = hyperConf();
  startedAt = new Date().toISOString();
  if (hc.enabled !== true) {
    if (G.__saosHyperTimer) clearInterval(G.__saosHyperTimer);
    G.__saosHyperTimer = null;
    writeJson(HYPER_FILE, { ...(readJson(HYPER_FILE, {})), running: false, startedAt, conf: hc, lastVerdict: "DISABLED-AT-BOOT" });
    return hyperState();
  }
  appendLine(EVENTS_FILE, { type: "hyper.boot", at: startedAt, pid: process.pid, conf: hc });
  G.__saosHyperTimer = setInterval(() => { void tick(); }, Math.max(1000, hc.tickMs));
  timer = G.__saosHyperTimer;
  void tick();
  void tailSample().catch(() => {});
  G.__saosHyperTailTimer = setInterval(() => { void tailSample().catch(() => {}); }, 15_000);
  tailTimer = G.__saosHyperTailTimer;
  return hyperState();
}
