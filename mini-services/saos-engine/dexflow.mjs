/**
 * dexflow.mjs — R323 DEX-FLOW: the VOLUME-TAKER layer of the sovereign engine.
 * ═══════════════════════════════════════════════════════════════════════════
 * OPERATOR ORDER (2026-10-13): "מצא דרך ובצע וודא שזה עובד אני רוצה לראות
 * הרבה ווליום והרבה הרבה יותר פעילות אוטונומית בדקס" — real VOLUME and much
 * more autonomous DEX activity, on scarce capital, verified working.
 *
 * WHAT THIS LAYER IS:
 *   the SHARP execution layer the hyper-grid presence layer was missing.
 *   hyper-grid quotes the book (presence, ops); DEX-FLOW CROSSES it (fills,
 *   volume). One self-contained trip per tick, both legs in ONE transaction:
 *
 *     op1  limit_order_create  ask: sell A STEEM → B SBD  @ u
 *     op2  limit_order_create  bid: buy  A STEEM ← B SBD  @ u  (crosses op1)
 *
 *   The chain applies ops sequentially → op2 crosses op1 → BOTH fill at the
 *   maker price u (ours). After the trip the inventory is EXACTLY what it
 *   was (we sold A STEEM for B SBD, then bought A STEEM for B SBD at the
 *   same maker price; Steem limit fills carry no fee). Two REAL chain fills,
 *   REAL accumulating volume, ~zero capital bleed, ~zero directional risk.
 *   The DEX is currently ours alone (operator: no external traders) — the
 *   counterparty is always us, so crossing cannot harm any third party and
 *   cannot be front-run by one.
 *
 * WHAT THIS LAYER IS NOT:
 *   it is not profit and never claims to be (A-10 honesty). Trips measure
 *   VOLUME and FILLS. Realized edge is metered only when an external resting
 *   order gives it (labeled). Profit stays the hyper-grid/fuel rails' job.
 *
 * SAFETY LAWS (all inherited or new, each measured in a previous round):
 *   - executes ONLY through signer.executeOps (armed/pause/RC-floor/verify/
 *     think-gate live inside) — no private signing path
 *   - ORDER-ID PARTITION LAW: dexflow ids ∈ [1.5e9, 1.7e9) — disjoint from
 *     the cycle's tSec ids (~1.79e9) and hyper's [2.1e9, 4.294e9]; the cycle
 *     NEVER cancels a co-layer's partition (T-19 co-signer law, daily.mjs)
 *   - OURS-ONLY cancels: the sweep touches ONLY ids in the dexflow partition
 *   - single-flight: one tick at a time (globalThis mutex, hyper-grid law)
 *   - cycle-marker respect: while a signing cycle is fresh-in-flight, skip
 *     the tick (the cycle owns the account's order surgery at that moment)
 *   - RC SHARE GOVERNOR: own hard floor 40% (above hyper's 25% floor so the
 *     two layers cannot starve each other), graded back-off at 65%/50%
 *   - COMBINED DAY CAP: my opsToday + hyper opsToday ≤ doctrine cap 32000;
 *     my own cap 5000 ops/day (≈2500 trips)
 *   - CAPITAL RESERVES: ≤40% of liquid STEEM, ≤45% of (SBD − 0.5) per trip,
 *     hard notional ceiling maxTripSbd — scarce money is never committed
 *     whole (operator: "יש לנו כסף דל")
 *   - PRICE BAND GUARD: trip unit u within ±bandBps of the REAL book mid;
 *     spread > 500bps ⇒ BOOK-ANOMALY halt (the read is a lie until proven)
 *   - TTL + SWEEP: every order expires on-chain in ttlSec; my unmatched
 *     leftovers older than sweepAgeSec are swept (ours-only) so the book
 *     never accumulates a pile
 *   - ATOMIC-WRITE LAW: state via tmp+rename (the registry-wipe bug law)
 *   - CHAIN-TRUTH METERING (T-18 law): volume/fills come from the account's
 *     own history window (fill_order ops), sampled — the local trip counter
 *     and the chain tail cross-check; window is a sample, labeled so
 *   - ATOMIC-TRIP LAW: if op2 ever fails to cross op1 (node policy change),
 *     the leftover is price-protected (limit) + TTL'd + swept — the loop
 *     degrades to resting legs, never to an unbounded exposure
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { rcGovernor, RC_COSTS } from "./lib.mjs";
import { rpcCall, accountState, openOrders, accountHistory } from "./measure.mjs";
import { executeOps, armedConf, execPaused, masterAccount, loadCredential } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const FLOW_FILE = path.join(STATE, "dexflow.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
/* ATOMIC-WRITE LAW (registry-wipe bug, proven live): tmp+rename — a concurrent
 * reader sees old-or-new, never half. */
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* best-effort */ } };

/* ORDER-ID PARTITION LAW: [1.5e9, 1.7e9) — disjoint from cycle (~1.79e9+tSec)
 * and hyper ([2.1e9, 4.294e9]). 2e8 ids ≈ decades at 5000 ops/day. */
const DF_LO = 1_500_000_000;
const DF_HI = 1_699_999_999;
const inDfSpace = (id) => Number(id) >= DF_LO && Number(id) <= DF_HI;

export const DEXFLOW_DEFAULTS = {
  enabled: true,
  tickMs: 6000,          // one trip attempt per tick (≤ 600 trips/h ceiling)
  /* G43 notch (owner volume mandate, trace 1a15c84153ee8595): floor 40→30.
   * Measured proof (hyper-grid.json economics 2026-10-21): regen 816B/d >
   * burn 419B/d at equilibrium — trading REGENERATES RC net-positive, so a
   * floor above the live tank (32.5%) only idled a net-positive machine
   * (RC-FLOOR verdict, 0 trips while hands sat full). One reversible notch;
   * the tank law itself (never below 25) untouched; hyper's floor stays 25. */
  minRcPct: 30,          // own hard floor — above hyper's 25% floor
  backoff65Pct: 0.5,     // rcPct < 65 → half rate
  backoff50Pct: 0.25,    // rcPct < 50 → quarter rate
  maxTripSbd: 8.0,       // hard notional ceiling per trip (SBD side)
  minTripSbd: 0.05,      // below this the trip is RC-waste dust
  reserveSteem: 0.1,     // never commit the last dust
  reserveSbd: 0.5,       // bid-reserve law (inherited from hyper-grid)
  steemUsePct: 0.75,     // ≤75% of liquid STEEM per trip (volume with scarce capital)
  sbdUsePct: 0.85,       // ≤85% of (SBD − reserve) per trip
  bandBps: 150,          // trip unit must sit within ±150bps of book mid
  bookSpreadHaltBps: 500,// book anomaly gate
  opsDayCap: 8000,       // own day cap (2 ops per trip ≈ 4000 trips)
  combinedDayCap: 32000, // dexflow + hyper ≤ doctrine cap (T-19b economics)
  ttlSec: 1800,          // chain-side self-clean for resting leftovers
  sweepAgeSec: 90,       // unmatched leftovers older than this get swept (the sharp re-trip pace)
  sweepEveryTicks: 20,   // sweep cadence
  tailEveryTicks: 15,    // chain-truth metering cadence
  tailWindow: 400,       // history window for fill metering
};

let timer = null;
let startedAt = null;
const G = globalThis;

export function dexConf() {
  const conf = armedConf();
  return { ...DEXFLOW_DEFAULTS, ...(conf.dexFlow ?? {}) };
}

export function dexState() {
  return { running: timer != null, startedAt, pid: process.pid, runtime: readJson(FLOW_FILE, null) };
}

/* verdict-change journaling: events.jsonl on CHANGE only (the flood law) */
function journalVerdict(v, extra = {}) {
  const st = readJson(FLOW_FILE, {});
  if (st.lastVerdict !== v) appendLine(EVENTS_FILE, { type: "dexflow.verdict", at: new Date().toISOString(), verdict: v, ...extra });
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

/* live orders that belong to THIS layer's partition */
async function readLiveDf(account) {
  const oo = await openOrders(account);
  if (!oo.ok) return { ok: false, live: [] };
  return { ok: true, live: (oo.orders ?? []).filter((o) => inDfSpace(o.orderid)) };
}

/* the PARITY-EDGE trigger (operator: "יותר תנודתיות וטריגרים"): when the
 * external feed's implied unit drifts from the real book mid, the layer
 * sharpens (bigger trips, still inside every cap). Journal on change. */
let lastTrigger = null;
function parityTrigger(mid, feedUnit, bandBps) {
  let t = null;
  if (mid > 0 && feedUnit > 0) {
    const gapBps = Math.abs(feedUnit - mid) / mid * 10000;
    if (gapBps >= 250) t = { id: "PARITY-EDGE-2x", gapBps: Math.round(gapBps), sizeMult: 2.0 };
    else if (gapBps >= bandBps) t = { id: "PARITY-EDGE-1.5x", gapBps: Math.round(gapBps), sizeMult: 1.5 };
  }
  if ((t?.id ?? null) !== lastTrigger) {
    lastTrigger = t?.id ?? null;
    if (t) appendLine(EVENTS_FILE, { type: "dexflow.trigger", at: new Date().toISOString(), ...t, mid, feedUnit });
  }
  return t ?? { id: null, sizeMult: 1.0 };
}

/* openOrders unit convention: ask (STEEM→SBD) unit = SBD per STEEM;
 * bid (SBD→STEEM) unit = STEEM per SBD. Normalize everything to the book's
 * axis (SBD per STEEM) so band/cross math never mixes axes (proven live:
 * the two conventions differ by ~95×). */
const normUnit = (o) => (o?.side === "ask" ? Number(o.unit ?? 0) : Number(o.unit ?? 0) > 0 ? 1 / Number(o.unit) : 0);

/* partition id allocator: never exceed the ceiling, never collide */
const nextIdFor = (st) => {
  const n = Number(st?.nextId ?? DF_LO);
  return n >= DF_LO && n <= DF_HI ? n : DF_LO;
};
const tSecOf = (nowMs) => Math.floor(nowMs / 1000);

async function tickInner() {
  const now = new Date();
  const nowMs = now.getTime();
  const conf = armedConf();
  const dc = dexConf();
  const account = masterAccount();
  const today = now.toISOString().slice(0, 10);

  const st = readJson(FLOW_FILE, {});
  const base = {
    running: G.__saosDexTimer != null,
    lastTickAt: now.toISOString(),
    ticks: (st.ticks ?? 0) + 1,
    nextId: st.nextId ?? DF_LO,
    day: today,
    conf: dc,
  };
  const finish = (patch) => { writeJson(FLOW_FILE, { ...st, ...base, ...patch }); journalVerdict(patch.lastVerdict); };

  if (!conf.armed) return finish({ lastVerdict: "DISARMED", lastVerdictAt: now.toISOString() });
  if (execPaused()) return finish({ lastVerdict: "OPERATOR-PAUSED", lastVerdictAt: now.toISOString() });
  if (dc.enabled !== true) return finish({ lastVerdict: "DISABLED", lastVerdictAt: now.toISOString() });
  try { loadCredential(); } catch (e) {
    return finish({ lastVerdict: "CREDENTIAL-MISSING", lastVerdictAt: now.toISOString(), lastError: String(e?.message ?? e).slice(0, 120) });
  }

  /* cycle-overlap respect (hyper-grid law): the cycle owns the account's
   * order surgery while fresh-in-flight; a stale marker is cleared, a live
   * foreign marker defers this tick. */
  const marker = readJson(path.join(STATE, "cycle-run.json"), null);
  const CYCLE_STALE_MS = Number(process.env.SAOS_CYCLE_STALE_MS) || 20 * 60_000;
  const pidAlive = (pid) => { try { if (!pid || pid === process.pid) return true; process.kill(pid, 0); return true; } catch { return false; } };
  if (marker?.running === true) {
    const ageMs = Date.now() - (Date.parse(marker.startedAt) || 0);
    const foreignDead = marker.pid && marker.pid !== process.pid && !pidAlive(marker.pid);
    if (ageMs > CYCLE_STALE_MS || foreignDead) {
      try { fs.rmSync(path.join(STATE, "cycle-run.json"), { force: true }); } catch { /* best-effort */ }
    } else {
      return finish({ lastVerdict: "CYCLE-IN-FLIGHT", lastVerdictAt: now.toISOString() });
    }
  }

  /* reads (parallel): balances + book + my live partition orders */
  const [acc, book, mine] = await Promise.all([accountState(account), readBook(), readLiveDf(account)]);
  if (!acc?.ok) return finish({ lastVerdict: "NO-ACCOUNT-EVIDENCE", lastVerdictAt: now.toISOString() });
  const rcPct = acc.rcPct ?? null;
  if (!book || !(book.bestAsk > 0) || !(book.bestBid > 0)) return finish({ lastVerdict: "NO-BOOK", lastVerdictAt: now.toISOString(), rcPct });
  const spreadBps = (book.bestAsk - book.bestBid) / book.bestBid * 10000;
  if (!(spreadBps >= -100) || spreadBps > dc.bookSpreadHaltBps) {
    return finish({ lastVerdict: "BOOK-ANOMALY", lastVerdictAt: now.toISOString(), rcPct, spreadBps: Math.round(spreadBps * 10) / 10 });
  }

  /* day counters + the COMBINED cap (me vs hyper — one RC tank, one doctrine) */
  const opsDay = { day: today, opsToday: st.opsToday ?? 0 };
  if (st.day !== today) { opsDay.opsToday = 0; }
  const hyperOps = readJson(path.join(STATE, "hyper-ops.json"), { day: null, opsToday: 0 });
  const hyperToday = hyperOps.day === today ? (hyperOps.opsToday ?? 0) : 0;

  /* ONE-TRIP-ON-THE-BOOK LAW: a live leg of mine means the previous trip's
   * cross is pending. Three honest paths:
   *   1. LEG-COMPLETION (the sharp path): place ONLY the opposite leg at the
   *      current mid when it CROSSES the resting leg (maker price wins —
   *      inventory returns, trip completes, volume lands). One op tx.
   *   2. SWEEP: leftovers older than sweepAgeSec are cancelled (ours-only).
   *   3. RESTING-WAIT: young leg that the current book cannot cross — wait
   *      for an external fill or for the mid to come back.
   * The pile can never exceed 2 legs (trip) or 1 leg (waiting) by design. */
  if (mine.live.length > 0) {
    const leg = mine.live[0];
    const created = leg.created ? Date.parse(leg.created.endsWith("Z") ? leg.created : leg.created + "Z") : 0;
    const ageSec = created > 0 ? (nowMs - created) / 1000 : dc.sweepAgeSec + 1;
    const legU = normUnit(leg);                 /* SBD per STEEM */
    const legAmt = Number(String(leg.base ?? "0").split(" ")[0]) || 0; /* resting qty in base units (STEEM for ask, SBD for bid) */

    /* path 2: aged leftover — sweep it */
    if (ageSec >= dc.sweepAgeSec) {
      const ops = mine.live.slice(0, 24).map((o) => ["limit_order_cancel", { owner: account, orderid: o.orderid }]);
      const res = await executeOps(ops, { tag: "dexflow-sweep", rcPct });
      const ok = res.ok ?? res.verdict === "BROADCAST";
      return finish({
        lastVerdict: ok ? "SWEEP-BROADCAST" : "SWEEP-FAIL",
        lastVerdictAt: now.toISOString(), rcPct, swept: mine.live.length,
        lastTxid: ok ? res.txid ?? null : st.lastTxid ?? null,
        lastError: ok ? null : String(res.error ?? res.verdict).slice(0, 160),
        /* honesty hygiene: a success verdict must not carry a stale error */
        ...(ok ? { staleErrorCleared: st.lastError ?? null } : {}),
      });
    }

    /* path 1: leg-completion — opposite leg at current mid, ONLY if it crosses */
    const mid2 = (book.bestAsk + book.bestBid) / 2;
    const uNew = Math.floor(mid2 * 1e6) / 1e6;
    const crossOk = leg.side === "bid" ? uNew <= legU : uNew >= legU;  /* ask crosses bid at ≤ bid price; bid crosses ask at ≥ ask price */
    if (crossOk && legU > 0 && legAmt > 0) {
      let ops = null;
      if (leg.side === "bid") {
        /* resting bid: A_b = legAmt SBD buys legAmt×legU STEEM — complete with an ask of the SAME STEEM (inventory returns) */
        const A = Math.floor(legAmt * legU * 1000) / 1000;
        const S = Math.floor(A * uNew * 1000) / 1000;
        const steemFree = Math.max(0, (acc.steem ?? 0) - dc.reserveSteem);
        if (A >= 0.2 && A <= steemFree + 0.001) {
          ops = [["limit_order_create", { owner: account, orderid: nextIdFor(st), amount_to_sell: `${A.toFixed(3)} STEEM`, min_to_receive: `${S.toFixed(3)} SBD`, fill_or_kill: false, expiration: tSecOf(nowMs) + dc.ttlSec }]];
          var complMeta = { kind: "ask-completes-bid", A, S, uRest: Math.round(legU * 1e6) / 1e6, uNew };
        }
      } else {
        /* resting ask: A_a STEEM — complete with a bid of the SAME STEEM notional (SBD side = A×uNew ≤ our SBD reserve check) */
        const S = Math.floor(legAmt * uNew * 1000) / 1000;
        const sbdFree = Math.max(0, (acc.sbd ?? 0) - dc.reserveSbd);
        if (S >= dc.minTripSbd && S <= sbdFree + 0.001) {
          ops = [["limit_order_create", { owner: account, orderid: nextIdFor(st), amount_to_sell: `${S.toFixed(3)} SBD`, min_to_receive: `${legAmt.toFixed(3)} STEEM`, fill_or_kill: false, expiration: tSecOf(nowMs) + dc.ttlSec }]];
          var complMeta = { kind: "bid-completes-ask", S, A: legAmt, uRest: Math.round(legU * 1e6) / 1e6, uNew };
        }
      }
      if (ops) {
        const res = await executeOps(ops, { tag: "dexflow-complete", rcPct });
        if (res.ok ?? res.verdict === "BROADCAST") {
          const opsToday = (st.opsToday ?? 0) + 1;
          /* realized round-trip edge (honest): the resting leg is the maker —
           * its price vs the completion price IS the trip's realized edge */
          const A = complMeta.A, rest = complMeta.uRest, nw = complMeta.uNew;
          const edgeSbd = leg.side === "bid"
            ? Math.round(A * (rest - nw) * 1000) / 1000   /* we sell at uRest (> uNew) → + (uRest−uNew)·A */
            : Math.round(A * (nw - rest) * 10000) / 10000; /* we buy at uRest (< uNew) → saves (uNew−uRest)·A SBD */
          appendLine(EVENTS_FILE, { type: "dexflow.complete", at: now.toISOString(), ...complMeta, txid: res.txid ?? null, edgeSbd, rcPct, opsToday });
          return finish({
            lastVerdict: "COMPLETE-BROADCAST", lastVerdictAt: now.toISOString(),
            rcPct, opsToday, completions: (st.completions ?? 0) + 1,
            realizedEdgeSbd: Math.round(((st.realizedEdgeSbd ?? 0) + edgeSbd) * 10000) / 10000,
            lastTxid: res.txid ?? null, lastError: null,
            nextId: nextIdFor(st) + 1, completion: complMeta,
          });
        }
        return finish({ lastVerdict: "BROADCAST-FAIL", lastVerdictAt: now.toISOString(), rcPct, lastError: String(res.error ?? res.verdict).slice(0, 160) });
      }
    }

    /* path 3: wait (honest) */
    return finish({ lastVerdict: "RESTING-WAIT", lastVerdictAt: now.toISOString(), rcPct, liveLegs: mine.live.length, legAgeSec: Math.round(ageSec) });
  }

  if (rcPct == null || rcPct < dc.minRcPct) {
    journalVerdict("RC-FLOOR");
    return finish({ lastVerdict: "RC-FLOOR", lastVerdictAt: now.toISOString(), rcPct });
  }
  if (opsDay.opsToday >= dc.opsDayCap) return finish({ lastVerdict: "OPS-DAY-CAP", lastVerdictAt: now.toISOString(), rcPct, opsToday: opsDay.opsToday });
  if (opsDay.opsToday + hyperToday >= dc.combinedDayCap) return finish({ lastVerdict: "COMBINED-CAP", lastVerdictAt: now.toISOString(), rcPct, opsToday: opsDay.opsToday, hyperToday });

  /* graded RC back-off — the layer breathes with the tank (hyper-grid law) */
  let rateMult = 1.0;
  if (rcPct < 50) rateMult = dc.backoff50Pct;
  else if (rcPct < 65) rateMult = dc.backoff65Pct;
  if (rateMult < 1.0 && Math.random() > rateMult) {
    return finish({ lastVerdict: "GOVERNOR-BACKOFF", lastVerdictAt: now.toISOString(), rcPct, rateMult, opsToday: opsDay.opsToday });
  }

  /* the trip size: scarce-money reserves + hard notional ceiling + parity trigger */
  const mid = (book.bestAsk + book.bestBid) / 2;
  /* W27-c REAL-MONEY ANCHOR (owner trace 1a15c67385c253b5 — "תזרים אמיתי מבחוץ"):
   * when the external-quotes sweep is fresh, the REAL outside cross unit
   * (steemUsd/sbdUsd — what Poloniex/Bithumb actually pay) REPLACES the
   * internal feed as the parity trigger's anchor: the trigger then measures
   * our book against real money, not against the feed we ourselves quote.
   * Stale/absent anchor → the internal feed, byte-identical behavior. */
  const ext = readJson(path.join(STATE, "external-quotes.json"), null);
  const extAge = ext?.at ? (nowMs - (Date.parse(ext.at) || 0)) : Infinity;
  const extFresh = Number.isFinite(extAge) && extAge >= 0 && extAge < 15 * 60_000;
  const extUnit = extFresh && Number(ext.impliedUnitSbdPerSteem) > 0 ? Number(ext.impliedUnitSbdPerSteem) : 0;
  const feed = readJson(path.join(STATE, "observe.json"), null);
  const feedUnit = extUnit > 0 && extUnit < 2 ? extUnit : (feed?.feed ?? null); /* SBD per STEEM — external real-money first */
  const extGapBps = extUnit > 0 && mid > 0 ? Math.round((extUnit - mid) / mid * 10000) / 10 : null;
  const trig = parityTrigger(mid, feedUnit > 0 && feedUnit < 2 ? feedUnit : 0, dc.bandBps);

  const steemAvail = Math.max(0, (acc.steem ?? 0) - dc.reserveSteem);
  const sbdAvail = Math.max(0, (acc.sbd ?? 0) - dc.reserveSbd);
  let B = Math.min(sbdAvail * dc.sbdUsePct, dc.maxTripSbd) * trig.sizeMult;
  let A = B / mid;
  /* MIN-SIZE LAW: a trip below the RC-worthiness floor is waste — top B up
   * to reach A ≥ 0.2 when the notional ceiling allowed it; if the SBD side
   * cannot afford that, the money is truly scarce → NO-BALANCE (honest). */
  if (A < 0.2) {
    const Btop = 0.2 * mid;
    if (Btop <= Math.min(sbdAvail * dc.sbdUsePct, dc.maxTripSbd * trig.sizeMult)) { B = Btop; A = 0.2; }
  }
  if (A > steemAvail * dc.steemUsePct) A = steemAvail * dc.steemUsePct;
  A = Math.floor(A * 1000) / 1000;
  B = Math.floor(A * mid * 1000) / 1000;
  if (!(A >= 0.2) || !(B >= dc.minTripSbd)) {
    return finish({ lastVerdict: "NO-BALANCE", lastVerdictAt: now.toISOString(), rcPct, A, B, steemAvail: Math.round(steemAvail * 1000) / 1000, sbdAvail: Math.round(sbdAvail * 1000) / 1000 });
  }
  /* BAND GUARD: u must be within ±bandBps of the real mid (u = B/A ≈ mid by
   * construction; the guard is the honest re-check after rounding) */
  const u = B / A;
  const bandBpsActual = Math.abs(u - mid) / mid * 10000;
  if (bandBpsActual > dc.bandBps) {
    return finish({ lastVerdict: "BAND-HALT", lastVerdictAt: now.toISOString(), rcPct, u: Math.round(u * 1e6) / 1e6, mid: Math.round(mid * 1e6) / 1e6, bandBpsActual: Math.round(bandBpsActual * 10) / 10 });
  }

  /* ids from MY partition; expire on-chain in ttlSec */
  let nextId = Math.max(DF_LO, Math.min(st.nextId ?? DF_LO, DF_HI));
  if (nextId > DF_HI) nextId = DF_LO;
  const askId = nextId;
  const bidId = nextId + 1 <= DF_HI ? nextId + 1 : DF_LO;
  nextId = bidId + 1;
  const tSec = Math.floor(nowMs / 1000);
  const exp = tSec + dc.ttlSec;

  /* THE ATOMIC TRIP — both legs, one tx, sequential apply ⇒ op2 crosses op1 */
  const ops = [
    ["limit_order_create", { owner: account, orderid: askId, amount_to_sell: `${A.toFixed(3)} STEEM`, min_to_receive: `${B.toFixed(3)} SBD`, fill_or_kill: false, expiration: exp }],
    ["limit_order_create", { owner: account, orderid: bidId, amount_to_sell: `${B.toFixed(3)} SBD`, min_to_receive: `${A.toFixed(3)} STEEM`, fill_or_kill: false, expiration: exp }],
  ];
  const res = await executeOps(ops, { tag: "dexflow-trip", rcPct });
  if (!(res.ok ?? res.verdict === "BROADCAST")) {
    const err = String(res.error ?? res.verdict);
    return finish({ lastVerdict: "BROADCAST-FAIL", lastVerdictAt: now.toISOString(), rcPct, lastError: err.slice(0, 160), opsToday: opsDay.opsToday });
  }

  const opsToday = opsDay.opsToday + ops.length;
  const trips = (st.trips ?? 0) + 1;
  appendLine(EVENTS_FILE, {
    type: "dexflow.trip", at: now.toISOString(),
    A, B, u: Math.round(u * 1e6) / 1e6, mid: Math.round(mid * 1e6) / 1e6,
    askId, bidId, txid: res.txid ?? null, rcPct, opsToday, trips,
    trigger: trig.id ?? null, note: "self-cross trip — both legs ours, maker price ours, ~zero bleed",
  });
  return finish({
    lastVerdict: "TRIP-BROADCAST", lastVerdictAt: now.toISOString(),
    rcPct, opsToday, trips, nextId, lastTxid: res.txid ?? null, lastError: null,
    lastTrip: { A, B, u: Math.round(u * 1e6) / 1e6, askId, bidId, at: now.toISOString(), trigger: trig.id ?? null },
    trigger: trig.id ?? null, spreadBps: Math.round(spreadBps * 10) / 10,
    extAnchor: { source: extUnit > 0 ? "external-real-money" : "internal-feed", unit: feedUnit ? Math.round(feedUnit * 1e6) / 1e6 : null, gapBps: extGapBps, at: ext?.at ?? null },
  });
}

async function tick() {
  if (G.__saosDexInFlight === true) return;
  G.__saosDexInFlight = true;
  try { await tickInner(); } catch (e) {
    writeJson(FLOW_FILE, { ...(readJson(FLOW_FILE, {})), lastVerdict: "TICK-ERROR", lastError: String(e?.message ?? e).slice(0, 200), lastTickAt: new Date().toISOString() });
  } finally { G.__saosDexInFlight = false; }
}

/* the chain-truth tail sampler (T-18 law, INCREMENTAL watermarked): count
 * only fill_order ops NEWER than the last watermark and ACCUMULATE the day
 * totals — the sliding 400-op window alone undercounts as hyper-grid ops
 * flood it (proven live: a 42-STEEM fill morning slid to 36 within an hour).
 * The watermark is the newest op ts seen; day rollover resets everything. */
let lastTailTick = -1;
async function tailSample(account) {
  const st = readJson(FLOW_FILE, {});
  if ((st.ticks ?? 0) - lastTailTick < 15 && st.fillAcc != null) return;
  lastTailTick = st.ticks ?? 0;
  const day = new Date().toISOString().slice(0, 10);
  const h = await accountHistory(account, 400);
  const hist = h?.hist ?? [];
  if (!hist.length) return;
  const amt = (x) => {
    if (x && typeof x === "object") {
      const n = Number(x.amount ?? 0) / 10 ** Number(x.precision ?? 3);
      const sym = x.nai === "@@000000021" ? "STEEM" : x.nai === "@@000000013" ? "SBD" : String(x.nai ?? "?");
      return { v: n, sym };
    }
    const m = String(x ?? "").split(" ");
    return { v: Number(m[0]) || 0, sym: m[1] ?? "" };
  };
  const tsOf = (x) => x?.timestamp ? Date.parse(x.timestamp + (x.timestamp.endsWith("Z") ? "" : "Z")) : 0;
  const dayStartMs = Date.parse(`${day}T00:00:00Z`);
  const acc = st.fillAcc?.day === day ? st.fillAcc : { day, count: 0, volSteem: 0, volSbd: 0, lastTsMs: 0 };
  const wm = Math.max(0, Number(acc.lastTsMs ?? 0));
  let count = 0, volSteem = 0, volSbd = 0, lastFillAt = null, newestOpTs = 0;
  for (const [, x] of hist) {
    const ts = tsOf(x);
    if (ts > newestOpTs) newestOpTs = ts;
    if (ts <= wm || ts < dayStartMs) continue;
    const v = x?.op?.value ?? x?.op ?? x?.value ?? null;
    const type = x?.op?.type ?? x?.type ?? "";
    if (!/fill_order/i.test(String(type))) continue;
    const cur = amt(v?.current_pays), opn = amt(v?.open_pays);
    if (!cur.v || !opn.v) continue;
    count += 1;
    if (lastFillAt == null || ts > lastFillAt) lastFillAt = ts;
    const a1 = cur.sym === "STEEM" ? cur.v : opn.sym === "STEEM" ? opn.v : 0;
    const q1 = cur.sym === "SBD" ? cur.v : opn.sym === "SBD" ? opn.v : 0;
    volSteem += a1; volSbd += q1;
  }
  acc.count += count;
  acc.volSteem = Math.round((acc.volSteem + volSteem) * 1000) / 1000;
  acc.volSbd = Math.round((acc.volSbd + volSbd) * 1000) / 1000;
  if (newestOpTs > wm) acc.lastTsMs = newestOpTs;
  writeJson(FLOW_FILE, {
    ...st, day,
    fillAcc: acc,
    fillsToday: acc.count, volumeSteemToday: acc.volSteem, volumeSbdToday: acc.volSbd,
    chainLastFillAt: lastFillAt ? new Date(lastFillAt).toISOString() : (st.chainLastFillAt ?? null),
    chainWindow: hist.length, chainTailAt: new Date().toISOString(),
    meterNote: "incremental watermarked fill counter over a sliding 400-op history window",
  });
}

export function startDexFlow() {
  /* hot-reload/boot idempotent: ONE loop per process, always the newest code */
  if (G.__saosDexTimer) clearInterval(G.__saosDexTimer);
  const dc = dexConf();
  startedAt = new Date().toISOString();
  if (dc.enabled !== true) {
    G.__saosDexTimer = null;
    timer = null;
    writeJson(FLOW_FILE, { ...(readJson(FLOW_FILE, {})), running: false, startedAt, conf: dc, lastVerdict: "DISABLED-AT-BOOT" });
    return dexState();
  }
  appendLine(EVENTS_FILE, { type: "dexflow.boot", at: startedAt, pid: process.pid, conf: dc });
  G.__saosDexTimer = setInterval(() => { void tick(); }, Math.max(3000, dc.tickMs));
  timer = G.__saosDexTimer;
  void tick();
  const account = masterAccount();
  void tailSample(account).catch(() => {});
  G.__saosDexTailTimer = setInterval(() => { void tailSample(account).catch(() => {}); }, 60_000);
  return dexState();
}
