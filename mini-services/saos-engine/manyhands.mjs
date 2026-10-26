/**
 * manyhands.mjs — G43 · ONE-BODY-MANY-HANDS + THE SHARP TAKER (ריבונות-על-הדקס-שלנו).
 * ═══════════════════════════════════════════════════════════════════════════
 * OPERATOR ORDER (2026-10-21, trace 1a15c84153ee8595): "הכי הייתי רוצה שנוכל
 * לייצר באמת שוק חריף של גרידים וארביטראזים דווקא על הדקס שלנו... גוף אחד
 * חכם עם הרבה ידיים... אני מסתכל בכמה חשבונות בארנק שלהם לא רואים פעילות
 * של גריד" — a sharp market of grids AND arbitrages on OUR OWN DEX, one
 * smart body with many hands, every wallet visibly alive.
 *
 * THE MEASURED ROOT CAUSE (this wave, chain-truth):
 *   1. Volume was gated by ONE RC tank — master's. hyper-grid (setpoint 35)
 *      + dexflow (floor 40) both idled below it while 9 fleet hands sat at
 *      RC 62–134% with REAL inventory (~210 STEEM, ~8.7 SBD). The lungs
 *      existed; the body never connected them.
 *   2. THE AUTHORITY GAP (measured three ways, fail-closed): the hands'
 *      on-chain ACTIVE authorities match NEITHER the vault's GEN-2 active
 *      WIFs (army-custody: ACTIVE-GEN-2-REFUSED ×9) NOR GEN-1 pubs NOR the
 *      canonical owner-secret derivation sha256(account+role+secret9) —
 *      which DOES reproduce headcorner's canonical active pub (STM89CBd…,
 *      self-verified this wave). The controlling active WIFs live outside
 *      our reachable vaults (provenance: the same class as headcorner's
 *      working STEEM_ACTIVE_WIF repo-secret, KEY-PROVENANCE-VERDICT
 *      2026-10-19). SO: hands auto-join THE MOMENT a controlling active WIF
 *      verifies (custody gate below) — the rail is their body in waiting,
 *      never a fake heartbeat. אפס-המצאת-פעילות.
 *   3. The DEX had makers (hyper ladder) and self-cross volume (dexflow)
 *      but NO taker that crosses EXTERNAL dislocations. A sharp market
 *      takes the other side when the price is wrong: an ask below feed-fair
 *      is free STEEM; a bid above feed-fair is free SBD. This rail adds
 *      THE SHARP TAKER — fill_or_kill against feed-fair edges ≥ takeEdgeBps,
 *      dust-capped, shadow-first (the Vibe-Trading discipline the operator
 *      pointed at: measure before arm, budgets on every loop).
 *
 * WHAT THIS RAIL IS:
 *   the ONE-BODY coordinator: one roster law, one ladder law (planLadder —
 *   the SAME anchor/ceiling/CEIL3 laws as master), one diff law
 *   (diffHyperTick), per-hand RC governors with the hand's OWN lungs, and
 *   the sharp taker — every hand a lawful mirror of the master's grid.
 *
 * WHAT THIS RAIL IS NOT:
 *   it never invents activity. A hand without verified active custody is a
 *   typed HAND-AUTHORITY-PENDING verdict, journaled, visible — not a skip
 *   pretending all is well. The taker in shadow measures and journals; it
 *   does not trade until conf.manyHands.takerLive === true (one flag, one
 *   law, the flip is auditable in events.jsonl).
 *
 * SAFETY LAWS (all inherited or new, each measured in a previous round):
 *   - executes ONLY through signer.executeAs (armed/pause/think-gate/
 *     command-hierarchy/RC-floor/verify live inside) — no private path
 *   - HAND-ID PARTITION LAW: hand i's ids ∈ [2.4e9 + i·1e5, +99_999] —
 *     per-ACCOUNT namespaces on chain; disjoint bases keep OUR registry
 *     per-hand and our cancels ours-only (max 6 hands ⇒ ≤ 6e5 ids, decades)
 *   - OURS-ONLY cancels: registry + partition, per hand (hyper-grid law)
 *   - single-flight per PROCESS; cycle-marker respect (master's surgery
 *     window is hyper/dexflow's law; hands have no marker conflict — the
 *     peer's army CI does social/curation ops only, never order surgery)
 *   - PER-HAND GOVERNOR: rcGovernor on the hand's OWN maxRc (floor 25,
 *     setpoint 35 — the measured-sustainable notch), carry per hand
 *   - PER-HAND DUST FLOORS: no bid under SBD reserve 0.5; no ask under
 *     0.001 STEEM; a hand whose balances cannot lawful-quote → NO-BUDGET
 *     (typed, honest)
 *   - DAY CAPS: per-hand 600 ops, rail total 6000 ops, master doctrine cap
 *     untouched (32000 belongs to master's tank alone)
 *   - TAKER LAWS: fair = the chain feed (observe.feed, the witness median);
 *     fire only when |book front − fair| ≥ takeEdgeBps (default 100) in the
 *     PROFITABLE direction; fill_or_kill=true (zero resting exposure);
 *     per-take ≤ maxTakeSbd (default 2 SBD); ≤ takerDayCap takes/day/rail;
 *     band guard — fair must sit within takerBandBps (default 800) of book
 *     mid or the read is declared a lie (BOOK-FAIR-ANOMALY)
 *   - SHADOW-FIRST: takerLive=false ⇒ every opportunity is measured,
 *     bounded-journaled (wouldEdgeBps, wouldSpendSbd, wouldQtySteem), zero
 *     broadcast; the flip to live is ONE armedConf flag, journaled on change
 *   - ATOMIC-WRITE LAW (registry-wipe bug): state via tmp+rename
 *   - CHAIN-TRUTH METERING (T-18): hand trades metered by their own history
 *     windows via the existing fills ledger's account attribution (W12-D
 *     one-body law — inter-body trades never double-counted)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { planLadder, rcGovernor, diffHyperTick } from "./lib.mjs";
import { rpcCall, accountState, openOrders } from "./measure.mjs";
import { executeAs, armedConf, execPaused, masterAccount, custodyOf, adoptedWifFor } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const MH_FILE = path.join(STATE, "manyhands.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");
const OBSERVE_FILE = path.join(STATE, "observe.json");
const CUSTODY_FILE = path.join(STATE, "army-custody.json");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
/* ATOMIC-WRITE LAW: tmp+rename — a concurrent reader ever sees old-or-new, never half */
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* best-effort */ } };

/* ═══ PURE LAWS (selftest-vectorable) ═══════════════════════════════════ */

/** HAND-ID PARTITION LAW: hand index i owns [base, base+99_999]. Disjoint
 * per construction; bases live inside the hyper space's unused upper band —
 * orderids are per-OWNER on chain, so these never collide with master's ids
 * even numerically-adjacent; the disjoint bases are for OUR registry law. */
export const HAND_BASE0 = 2_400_000_000;
export const HAND_STRIDE = 100_000;
export function handIdBase(index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i > 20) return null;
  return HAND_BASE0 + i * HAND_STRIDE;
}
export function inHandSpace(id, index) {
  const base = handIdBase(index);
  if (base == null) return false;
  const n = Number(id);
  return Number.isFinite(n) && n >= base && n <= base + HAND_STRIDE - 1;
}

/** ROSTER LAW: living hands = the custody doc's living roster, minus the
 * master (master trades through hyper/dexflow), minus T-80 retired.
 * Fail-closed: missing/stale custody doc ⇒ [] (NO-CUSTODY-EVIDENCE). */
export function livingRoster(custodyDoc, { master = "headcorner", maxAgeMs = 12 * 3600_000, nowMs = Date.now() } = {}) {
  if (!custodyDoc || typeof custodyDoc !== "object") return { hands: [], why: "NO-CUSTODY-DOC" };
  const at = Date.parse(custodyDoc.at ?? "");
  if (!Number.isFinite(at) || nowMs - at > maxAgeMs) return { hands: [], why: "CUSTODY-STALE" };
  if (custodyDoc.verdict !== "FLEET-CUSTODY-ALIVE") return { hands: [], why: "CUSTODY-NOT-ALIVE" };
  const retired = new Set(custodyDoc.denominator?.retired ?? []);
  const full = new Set([
    ...(custodyDoc.fullRoster?.living ?? []),
  ]);
  if (full.size === 0) {
    // fallback: derive from adopted accounts when fullRoster is absent
    for (const a of custodyDoc.adopted ?? []) if (a?.account) full.add(a.account);
  }
  const hands = [...full].filter((a) => a && a !== master && !retired.has(a)).sort();
  return { hands, why: hands.length ? "ROSTER-OK" : "ROSTER-EMPTY" };
}

/** HAND-BUDGET LAW: reserves + dust floors. A hand quotes asks only from
 * liquid STEEM above reserve, bids only from SBD above the 0.5 reserve;
 * sub-dust budgets are zero (never a phantom level). */
export function handBudgets({ steem = 0, sbd = 0 }, conf) {
  const askBudget = Math.max(0, Math.min(steem * (conf.handAskBudgetPct ?? 0.12), steem - 0.001));
  const bidBudget = Math.max(0, sbd - (conf.reserveSbd ?? 0.5));
  return {
    askBudget: Math.floor(askBudget * 1000) / 1000,
    bidBudget: Math.floor(bidBudget * 1000) / 1000,
    canAsk: askBudget >= 0.001,
    canBid: bidBudget >= 0.001,
  };
}

/** THE SHARP-TAKER LAW (pure): cross an EXTERNAL dislocation when the book
 * front pays ≥ edge over the feed-fair, in the PROFITABLE direction only.
 *  - ask < fair·(1−e)  ⇒ TAKE the ask (buy STEEM below fair, pay SBD)
 *  - bid > fair·(1+e)  ⇒ TAKE the bid (sell STEEM above fair, receive SBD)
 * anything else ⇒ null (a maker's job, not a taker's). Band guard: |fair −
 * mid| > bandBps ⇒ { halt: "BOOK-FAIR-ANOMALY" } (the read is a lie until
 * proven). Quantity bounded by BOTH the taker notional cap and the hand's
 * free balances; fill_or_kill always — zero resting exposure. */
export function takeLaw({ fair, bestAsk, bestBid, mid, edgeBps = 100, bandBps = 800, maxTakeSbd = 2, minTakeSbd = 0.05, steemFree = 0, sbdFree = 0 }) {
  if (!(fair > 0) || !(bestAsk > 0) || !(bestBid > 0) || !(mid > 0)) return { skip: "NO-EVIDENCE" };
  const fairDistBps = Math.abs(fair - mid) / mid * 10000;
  if (fairDistBps > bandBps) return { halt: "BOOK-FAIR-ANOMALY", fairDistBps: Math.round(fairDistBps * 10) / 10 };
  const e = edgeBps / 10000;
  if (bestAsk < fair * (1 - e)) {
    const edgeBpsMeasured = (fair - bestAsk) / bestAsk * 10000;
    const spendSbd = Math.min(maxTakeSbd, sbdFree);
    const qtySteem = Math.floor(Math.min(spendSbd / bestAsk, steemFree) * 1000) / 1000;
    const spend = Math.floor(qtySteem * bestAsk * 1000) / 1000;
    if (!(qtySteem > 0) || spend < minTakeSbd) return { skip: "TAKE-DUST", edgeBpsMeasured: Math.round(edgeBpsMeasured * 10) / 10 };
    return { side: "buy", unit: bestAsk, qtySteem, spendSbd: spend, edgeBps: Math.round(edgeBpsMeasured * 10) / 10, fillOrKill: true };
  }
  if (bestBid > fair * (1 + e)) {
    const edgeBpsMeasured = (bestBid - fair) / fair * 10000;
    const spendSbd = Math.min(maxTakeSbd, (steemFree * bestBid));
    const qtySteem = Math.floor(Math.min(spendSbd / bestBid, steemFree) * 1000) / 1000;
    const receive = Math.floor(qtySteem * bestBid * 1000) / 1000;
    if (!(qtySteem > 0) || receive < minTakeSbd) return { skip: "TAKE-DUST", edgeBpsMeasured: Math.round(edgeBpsMeasured * 10) / 10 };
    return { side: "sell", unit: bestBid, qtySteem, receiveSbd: receive, edgeBps: Math.round(edgeBpsMeasured * 10) / 10, fillOrKill: true };
  }
  return { skip: "NO-EDGE" };
}

/** SHADOW GATE LAW: the taker trades only when the explicit flag is true;
 * anything else (missing, stale, string "true") is SHADOW. Fail-closed. */
export function shadowGate(conf) {
  return conf?.takerLive === true ? "LIVE" : "SHADOW";
}

/* ═══ THE RAIL ══════════════════════════════════════════════════════════ */

export const MANYHANDS_DEFAULTS = {
  enabled: true,
  tickMs: 12_000,          // one coordinator pass per 12s (hands breathe slower than master)
  handsPerTick: 2,         // round-robin: each hand refreshed every ~54s at 9 hands
  levels: 6,               // per side per hand (small books, small money)
  spacingBps: 15,          // the SAME front-anchored spacing law as master
  ttlSec: 90,              // presence-refresh window (hyper-grid law, tighter for small books)
  orderTtlSec: 3600,       // chain-side self-clean
  handAskBudgetPct: 0.12,  // of the hand's liquid STEEM
  reserveSbd: 0.5,         // bid-reserve law (inherited)
  minRcPct: 25,            // hard floor per hand (the hand's own tank)
  setpointPct: 35,         // the measured-sustainable notch (G41 law, per hand)
  handOpsDayCap: 600,      // per hand per day
  railOpsDayCap: 6000,     // the whole rail per day
  takerEdgeBps: 100,       // minimum profitable dislocation vs feed-fair
  takerBandBps: 800,       // fair-vs-mid anomaly gate
  takerMaxSbd: 2,          // per-take notional ceiling
  takerMinSbd: 0.05,       // dust floor
  takerDayCap: 60,         // takes/day/rail (live mode)
  takerLive: false,        // SHADOW-FIRST LAW — the flip is one auditable flag
};

let timer = null;
let startedAt = null;
const G = globalThis;

export function manyhandsConf() {
  const conf = armedConf();
  return { ...MANYHANDS_DEFAULTS, ...(conf.manyHands ?? {}) };
}

export function manyhandsState() {
  return { running: timer != null, startedAt, pid: process.pid, runtime: readJson(MH_FILE, null) };
}

function journalVerdict(v, extra = {}) {
  const st = readJson(MH_FILE, {});
  if (st.lastVerdict !== v) appendLine(EVENTS_FILE, { type: "manyhands.verdict", at: new Date().toISOString(), verdict: v, ...extra });
}

/** the book front (SBD per STEEM axis) — the same read the master layers use */
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

async function tickInner() {
  const now = new Date();
  const nowMs = now.getTime();
  const conf = armedConf();
  const mc = manyhandsConf();
  const today = now.toISOString().slice(0, 10);

  const st = readJson(MH_FILE, {});
  const base = {
    running: G.__saosMhTimer != null,
    lastTickAt: now.toISOString(),
    ticks: (st.ticks ?? 0) + 1,
    day: today,
    conf: mc,
  };
  const finish = (patch) => { writeJson(MH_FILE, { ...st, ...base, ...patch }); journalVerdict(patch.lastVerdict); };

  if (!conf.armed) return finish({ lastVerdict: "DISARMED", lastVerdictAt: now.toISOString() });
  if (execPaused()) return finish({ lastVerdict: "OPERATOR-PAUSED", lastVerdictAt: now.toISOString() });
  if (mc.enabled !== true) return finish({ lastVerdict: "DISABLED", lastVerdictAt: now.toISOString() });

  const roster = livingRoster(readJson(CUSTODY_FILE, null), { master: masterAccount(), nowMs });
  if (!roster.hands.length) {
    return finish({ lastVerdict: roster.why, lastVerdictAt: now.toISOString(), hands: 0, handsPending: 0 });
  }

  /* per-hand custody gate — a hand trades ONLY with a chain-verified ACTIVE
   * wif in hand (the authority-gap law; pending hands are typed, never faked) */
  const eligible = [];
  const pending = [];
  for (const h of roster.hands) {
    if (custodyOf(h) === "verified" && adoptedWifFor(h, "active")) eligible.push(h);
    else pending.push(h);
  }
  if (!eligible.length) {
    return finish({
      lastVerdict: "HANDS-AUTHORITY-PENDING", lastVerdictAt: now.toISOString(),
      hands: roster.hands.length, handsPending: pending.length,
      pendingWhy: "on-chain active authorities match no held active WIF (measured G43); hands auto-join the moment custody verifies",
    });
  }

  /* reads: book + feed-fair (the witness median from the cycle's observe) */
  const [book, obs] = await Promise.all([readBook(), Promise.resolve(readJson(OBSERVE_FILE, null))]);
  if (!book || !(book.bestAsk > 0) || !(book.bestBid > 0)) return finish({ lastVerdict: "NO-BOOK", lastVerdictAt: now.toISOString(), eligible: eligible.length });
  const fair = obs?.feed > 0 ? obs.feed : (obs?.parity > 0 ? obs.parity : 0);

  /* round-robin cursor */
  const cursor = st.cursor ?? 0;
  const batch = [];
  for (let k = 0; k < Math.min(mc.handsPerTick, eligible.length); k++) batch.push(eligible[(cursor + k) % eligible.length]);
  const nextCursor = (cursor + batch.length) % eligible.length;

  const perHand = {};
  let railOpsToday = st.railOpsToday ?? 0;
  if (st.day !== today) { railOpsToday = 0; }
  let takerToday = st.takerToday ?? 0;
  if (st.day !== today) { takerToday = 0; }

  for (const hand of batch) {
    const idx = eligible.indexOf(hand);
    const verdict = await tradeHand(hand, idx, { mc, book, fair, now, nowMs, today, railOpsToday, st });
    perHand[hand] = verdict;
    if (verdict.opsAdded) railOpsToday += verdict.opsAdded;
    /* the taker: ONE eligible hand per tick, shadow or live, master's feed-fair law */
    if (fair > 0 && verdict.takerCandidate !== false && takerToday < mc.takerDayCap) {
      const t = takeLaw({
        fair, bestAsk: book.bestAsk, bestBid: book.bestBid,
        mid: (book.bestAsk + book.bestBid) / 2,
        edgeBps: mc.takerEdgeBps, bandBps: mc.takerBandBps,
        maxTakeSbd: mc.takerMaxSbd, minTakeSbd: mc.takerMinSbd,
        steemFree: Math.max(0, (verdict.balances?.steem ?? 0) - 0.001),
        sbdFree: Math.max(0, (verdict.balances?.sbd ?? 0) - mc.reserveSbd),
      });
      const mode = shadowGate(mc);
      if (t.take) {
        if (mode === "LIVE") {
          const tSec = Math.floor(nowMs / 1000);
          const tid = (st.takerNextId ?? handIdBase(20)) || handIdBase(20);
          const op = t.side === "buy"
            ? ["limit_order_create", { owner: hand, orderid: tid, amount_to_sell: `${t.spendSbd.toFixed(3)} SBD`, min_to_receive: `${t.qtySteem.toFixed(3)} STEEM`, fill_or_kill: true, expiration: tSec + mc.orderTtlSec }]
            : ["limit_order_create", { owner: hand, orderid: tid, amount_to_sell: `${t.qtySteem.toFixed(3)} STEEM`, min_to_receive: `${t.receiveSbd.toFixed(3)} SBD`, fill_or_kill: true, expiration: tSec + mc.orderTtlSec }];
          const res = await executeAs(hand, [op], { tag: "manyhands-take", rcPct: verdict.rcPct ?? null });
          const ok = res.ok ?? res.verdict === "BROADCAST";
          appendLine(EVENTS_FILE, { type: ok ? "manyhands.take" : "manyhands.take-fail", at: now.toISOString(), hand, ...t, txid: res.txid ?? null, error: ok ? null : String(res.error ?? res.verdict).slice(0, 140) });
          if (ok) { takerToday += 1; verdict.taker = { ...t, executed: true }; }
          else verdict.taker = { ...t, executed: false, error: String(res.error ?? res.verdict).slice(0, 80) };
          st.takerNextId = tid + 1;
        } else {
          verdict.taker = { ...t, shadow: true };
          /* bounded shadow journal: at most every 30 ticks per verdict change */
          if ((st.ticks ?? 0) - (st.lastShadowJournalTick ?? -30) >= 30) {
            st.lastShadowJournalTick = st.ticks ?? 0;
            appendLine(EVENTS_FILE, { type: "manyhands.take-shadow", at: now.toISOString(), hand, edgeBps: t.edgeBps, side: t.side, wouldSpendSbd: t.spendSbd ?? null, wouldReceiveSbd: t.receiveSbd ?? null, wouldQtySteem: t.qtySteem, fair, note: "shadow-first law: measured, not traded (takerLive=false)" });
          }
        }
      } else if (t.halt) {
        verdict.taker = t;
        appendLine(EVENTS_FILE, { type: "manyhands.take-halt", at: now.toISOString(), hand, ...t });
      }
    }
  }

  return finish({
    lastVerdict: "MANYHANDS-TICK", lastVerdictAt: now.toISOString(),
    eligible: eligible.length, handsPending: pending.length, pending: pending.slice(0, 8),
    cursor: nextCursor, perHand, railOpsToday, takerToday,
    takerMode: shadowGate(mc), fair: fair > 0 ? Math.round(fair * 1e6) / 1e6 : null,
    book: { bestAsk: Math.round(book.bestAsk * 1e6) / 1e6, bestBid: Math.round(book.bestBid * 1e6) / 1e6 },
  });
}

/** ONE hand, ONE pass: governor → plan (the SAME ladder law) → diff → execute.
 * Every verdict is typed; a failure never touches the other hands. */
async function tradeHand(hand, index, { mc, book, fair, now, nowMs, today, railOpsToday, st }) {
  const base = { hand };
  try {
    if (!inHandSpace(0, index) && handIdBase(index) == null) return { ...base, verdict: "HAND-INDEX-INVALID", opsAdded: 0, takerCandidate: false };
    const acc = await accountState(hand);
    if (!acc?.ok) return { ...base, verdict: "NO-ACCOUNT-EVIDENCE", opsAdded: 0, takerCandidate: false };
    const rcPct = acc.rcPct ?? null;
    const budgets = handBudgets({ steem: acc.steem ?? 0, sbd: acc.sbd ?? 0 }, mc);
    const out = { ...base, rcPct, balances: { steem: acc.steem ?? 0, sbd: acc.sbd ?? 0 }, opsAdded: 0 };

    const g = rcGovernor({
      rcPct, floorPct: mc.minRcPct, setpointPct: mc.setpointPct, burst: 2,
      tickMs: mc.tickMs, maxRc: acc.maxRc ?? 0,
      createCost: 42_235_658, cancelCost: 34_292_271,
      maxOpsPerTick: 12, opsDayCap: mc.handOpsDayCap,
      opsToday: (st.handOps?.[hand]?.opsToday ?? 0) * (st.day === today ? 1 : 0),
      carry: st.handCarry?.[hand] ?? 0,
    });
    out.governor = { pairs: g.pairs, headroom: g.headroom, reason: g.reason };
    if (g.pairs <= 0) {
      out.verdict = g.reason === "ops-day-cap" ? "HAND-DAY-CAP" : g.reason === "rc-floor" ? "HAND-RC-FLOOR" : "HAND-GOVERNOR-ACCUMULATING";
      out.takerCandidate = true;
      return out;
    }

    if (!(book.bestAsk > 0) || !(fair > 0)) { out.verdict = "NO-FAIR"; out.takerCandidate = false; return out; }

    const plan = planLadder({
      parity: fair, askBudgetSteem: 0, bidBudgetSbd: 0,
      bestAsk: book.bestAsk, bestBid: book.bestBid, feedAnchor: fair,
      flowAskBudgetSteem: budgets.askBudget, flowBidBudgetSbd: budgets.bidBudget,
      flowLevels: Math.min(mc.levels, g.pairs * 2), flowSpacingBps: mc.spacingBps,
      now: now.toISOString(),
    });
    const planned = [...(plan.flowAsks ?? []), ...(plan.flowBids ?? [])];
    if (plan.blocker) { out.verdict = `PLAN-BLOCKED:${String(plan.blocker).slice(0, 40)}`; out.takerCandidate = true; return out; }

    const oo = await openOrders(hand);
    const live = (oo.ok ? oo.orders ?? [] : [])
      .filter((o) => inHandSpace(o.orderid, index))
      .map((o) => ({ orderid: Number(o.orderid), side: o.side, unit: o.side === "ask" ? Number(o.unit) : Number(o.unit) > 0 ? 1 / Number(o.unit) : 0, createdAtMs: o.created ? Date.parse(o.created.endsWith("Z") ? o.created : o.created + "Z") : 0 }));
    const diff = diffHyperTick({ planned, live, epsBps: 2, ttlMs: mc.ttlSec * 1000, nowMs });
    if (diff.unchanged) { out.verdict = "HAND-NO-CHANGE"; out.takerCandidate = true; return out; }

    let opsBudget = Math.min(g.pairs * 2, mc.handOpsDayCap - ((st.handOps?.[hand]?.opsToday ?? 0) * (st.day === today ? 1 : 0)));
    const cancelOps = diff.cancelIds.slice(0, Math.max(0, Math.min(diff.cancelIds.length, opsBudget, 12))).map((id) => ["limit_order_cancel", { owner: hand, orderid: id }]);
    opsBudget -= cancelOps.length;
    const tSec = Math.floor(nowMs / 1000);
    const idBase = handIdBase(index);
    let nextId = Math.max(idBase, st.handIds?.[hand] ?? idBase);
    const createOps = [];
    const createdIds = [];
    for (const lvl of diff.creates) {
      if (createOps.length >= Math.min(opsBudget, 12)) break;
      if (nextId > idBase + HAND_STRIDE - 1) nextId = idBase;
      const id = nextId++;
      if (lvl.side === "ask") {
        const amt = Number(lvl.amountSteem.toFixed(3));
        const sOut = lvl.sbdOut3 != null ? lvl.sbdOut3 : amt * lvl.unit;
        if (!(amt >= 0.001)) continue;
        createOps.push(["limit_order_create", { owner: hand, orderid: id, amount_to_sell: `${amt.toFixed(3)} STEEM`, min_to_receive: `${Number(sOut).toFixed(3)} SBD`, fill_or_kill: false, expiration: tSec + mc.orderTtlSec }]);
      } else {
        const amt = Number(lvl.amountSbd.toFixed(3));
        const stOut = lvl.steemOut3 != null ? lvl.steemOut3 : amt / lvl.unit;
        if (!(amt >= 0.001)) continue;
        createOps.push(["limit_order_create", { owner: hand, orderid: id, amount_to_sell: `${amt.toFixed(3)} SBD`, min_to_receive: `${Number(stOut).toFixed(3)} STEEM`, fill_or_kill: false, expiration: tSec + mc.orderTtlSec }]);
      }
      createdIds.push({ id, side: lvl.side, unit: lvl.unit, at: now.toISOString() });
    }
    const ops = [...cancelOps, ...createOps];
    if (!ops.length) { out.verdict = "HAND-THROTTLED"; out.takerCandidate = true; return out; }
    if (railOpsToday + ops.length > mc.railOpsDayCap) { out.verdict = "RAIL-DAY-CAP"; out.takerCandidate = true; return out; }

    const res = await executeAs(hand, ops, { tag: "manyhands-grid", rcPct });
    if (!(res.ok ?? res.verdict === "BROADCAST")) {
      out.verdict = "HAND-BROADCAST-FAIL";
      out.error = String(res.error ?? res.verdict).slice(0, 140);
      out.takerCandidate = true;
      return out;
    }
    out.opsAdded = ops.length;
    out.verdict = "HAND-BROADCAST";
    out.txid = res.txid ?? null;
    out.cancels = cancelOps.length;
    out.creates = createOps.length;
    out.nextId = nextId;
    out.takerCandidate = true;
    return out;
  } catch (e) {
    return { ...base, verdict: "HAND-ERROR", error: String(e?.message ?? e).slice(0, 120), opsAdded: 0, takerCandidate: false };
  }
}

async function tick() {
  if (G.__saosMhInFlight === true) return;
  G.__saosMhInFlight = true;
  try { await tickInner(); } catch (e) {
    writeJson(MH_FILE, { ...(readJson(MH_FILE, {})), lastVerdict: "TICK-ERROR", lastError: String(e?.message ?? e).slice(0, 200), lastTickAt: new Date().toISOString() });
  } finally { G.__saosMhInFlight = false; }
}

export function startManyHands() {
  /* hot-reload/boot idempotent: ONE loop per process, always the newest code */
  if (G.__saosMhTimer) clearInterval(G.__saosMhTimer);
  const mc = manyhandsConf();
  startedAt = new Date().toISOString();
  if (mc.enabled !== true) {
    G.__saosMhTimer = null;
    timer = null;
    writeJson(MH_FILE, { ...(readJson(MH_FILE, {})), running: false, startedAt, conf: mc, lastVerdict: "DISABLED-AT-BOOT" });
    return manyhandsState();
  }
  appendLine(EVENTS_FILE, { type: "manyhands.boot", at: startedAt, pid: process.pid, conf: mc });
  G.__saosMhTimer = setInterval(() => { void tick(); }, Math.max(3000, mc.tickMs));
  timer = G.__saosMhTimer;
  void tick();
  return manyhandsState();
}
