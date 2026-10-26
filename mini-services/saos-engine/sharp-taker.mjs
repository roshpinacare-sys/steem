/**
 * sharp-taker.mjs — G44 · THE MASTER-RAIL DISLOCATION TAKER.
 * ═══════════════════════════════════════════════════════════════════════════
 * OWNER MANDATE (2026-10-21, trace web-d6bba2fd): "אני מאשר קדימה · תפעיל
 * הכל" — the blanket approval that lawfully flips what shadow-first was
 * waiting for. The per-hand taker (manyhands takeLaw) is custody-blocked
 * (hands' active keys match no held WIF — measured G43/G44), but the MASTER
 * rail has proven custody (64+ fills). So the sharp taker now trades where
 * custody actually lives.
 *
 * WHAT THIS LAYER IS:
 *   the DISLOCATION-CAPTURE layer. hyper-grid quotes (presence), dexflow
 *   self-crosses (volume), and THIS crosses the book when the front pays
 *   ≥ edge over the witness-median feed fair — an ask below fair is free
 *   STEEM, a bid above fair is free SBD. ONE law, ZERO duplication: the
 *   verdict is `takeLaw` imported from manyhands.mjs — the exact law the
 *   hands rail was built on, now executed on the account that can sign.
 *
 * WHAT THIS LAYER IS NOT:
 *   it is not presence (hyper), not self-volume (dexflow), not a resting
 *   maker (every take is fill_or_kill — either it crosses NOW or it dies
 *   at TTL). It never chases the book into the fair band (band guard).
 *
 * SAFETY LAWS (each inherited or new, all fail-closed):
 *   - STANDING-ORDER GATE: runs only when exec-armed.json carries
 *     sharpTaker.enabled === true (the operator's file may only LOOSEN
 *     explicitly — signer law). Default in code = DISARMED.
 *   - executes ONLY through signer.executeOps (armed/pause/RC-floor/verify
 *     live inside) — no private signing path.
 *   - ORDER-ID PARTITION LAW: sharp ids ∈ [1.7e9, 1.79e9) — disjoint from
 *     dexflow [1.5e9, 1.7e9), the cycle's tSec ids (epoch ≈ 1.7902e9+, never
 *     below), hyper's [2.1e9, 4.294e9) and the hands' [2.4e9, 2.42e9].
 *     No co-layer sweep can cancel our resting order (and FOK+TTL means
 *     leftovers self-clean anyway).
 *   - CAPS (operator-tunable in exec-armed.json sharpTaker block):
 *     edge ≥ 100bps · band ≤ 800bps · ≤ 2 SBD per take · ≤ 0.05 dust floor ·
 *     ≤ 60 takes/day · TTL 600s · FOK always.
 *   - SINGLE-FLIGHT: one tick at a time (globalThis mutex — hyper law).
 *   - CYCLE RESPECT: a live cycle-run marker defers this tick (the cycle
 *     owns the account's order surgery at that moment).
 *   - RC FLOOR: master rcPct below conf.minRcPct (25) → skip (graded laws
 *     live in hyper/dexflow; the taker is the LAST claimant on RC).
 *   - FAIR LAW (unchanged): fair = observe.feed (the witness median), the
 *     same fair the manyhands taker and the parity triggers consume. The
 *     external real-money anchor (external-quotes W27-c) keeps sharpening
 *     the OTHER layers; this layer does not re-price anything.
 *   - JOURNAL DISCIPLINE: every take/take-fail journals immediately; skips
 *     journal only on verdict-change or every 30 ticks (bounded noise).
 *   - ATOMIC-WRITE law (tmp+rename) on the state file.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { takeLaw } from "./manyhands.mjs";
import { rpcCall, accountState } from "./measure.mjs";
import { executeOps, armedConf, execPaused, masterAccount, loadCredential } from "./signer.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const TAKER_FILE = path.join(STATE, "sharp-taker.json");
const OBSERVE_FILE = path.join(STATE, "observe.json");
const EVENTS_FILE = path.join(STATE, "events.jsonl");

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2));
  fs.renameSync(tmp, p);
};
const appendLine = (p, v) => { try { fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* best-effort */ } };

/* ── PURE LAWS (selftest-covered) ──────────────────────────────────────── */

/** ORDER-ID PARTITION LAW: [1.7e9, 1.79e9) — the free territory between
 * dexflow's ceiling and the epoch-second horizon (proof in the header). */
export const TAKER_BASE0 = 1_700_000_000;
export const TAKER_STRIDE = 90_000_000;
export function takerIdOk(id) {
  const n = Number(id);
  return Number.isFinite(n) && Number.isInteger(n) && n >= TAKER_BASE0 && n < TAKER_BASE0 + TAKER_STRIDE;
}

/** BACKOFF LAW (AutoHedge cadence pattern, adopted fail-closed): on
 * consecutive errors the layer waits base·2^k (capped), never a fixed
 * retry-storm, never a stop. k=0 → base. Garbage inputs → base (fail-closed
 * to the least surprising value, never a throw). */
export function backoffDelayMs(k, baseMs = 3000, capMs = 60_000) {
  const kk = Number.isFinite(Number(k)) && Number(k) >= 0 ? Math.floor(Number(k)) : 0;
  const base = Number.isFinite(Number(baseMs)) && Number(baseMs) > 0 ? Number(baseMs) : 3000;
  const cap = Number.isFinite(Number(capMs)) && Number(capMs) >= base ? Number(capMs) : 60_000;
  let d = base;
  for (let i = 0; i < kk && d < cap; i++) d = Math.min(d * 2, cap);
  return Math.min(d, cap);
}

/** OP BUILDER LAW: the single lawful shape of a master-rail take.
 * buy  ⇒ sell SBD, receive STEEM (amounts to 3dp strings — chain format).
 * sell ⇒ sell STEEM, receive SBD. fill_or_kill ALWAYS true. The orderid is
 * rejected unless it sits in the sharp partition. Pure. */
export function masterTakeOp({ side, orderid, tSec, ttlSec = 600, spendSbd, receiveSbd, qtySteem }) {
  if (side !== "buy" && side !== "sell") return { error: "SIDE-INVALID" };
  if (!takerIdOk(orderid)) return { error: "ORDERID-OUTSIDE-PARTITION" };
  if (!Number.isFinite(Number(tSec)) || Number(tSec) <= 0) return { error: "TSEC-INVALID" };
  const ttl = Number.isFinite(Number(ttlSec)) && Number(ttlSec) > 0 ? Math.floor(Number(ttlSec)) : 600;
  const f3 = (x) => Number(x).toFixed(3);
  if (side === "buy") {
    if (!(Number(spendSbd) > 0) || !(Number(qtySteem) > 0)) return { error: "AMOUNTS-INVALID" };
    return { op: ["limit_order_create", { owner: "headcorner", orderid, amount_to_sell: `${f3(spendSbd)} SBD`, min_to_receive: `${f3(qtySteem)} STEEM`, fill_or_kill: true, expiration: Math.floor(Number(tSec)) + ttl }] };
  }
  if (!(Number(qtySteem) > 0) || !(Number(receiveSbd) > 0)) return { error: "AMOUNTS-INVALID" };
  return { op: ["limit_order_create", { owner: "headcorner", orderid, amount_to_sell: `${f3(qtySteem)} STEEM`, min_to_receive: `${f3(receiveSbd)} SBD`, fill_or_kill: true, expiration: Math.floor(Number(tSec)) + ttl }] };
}

export const SHARP_DEFAULTS = {
  tickMs: 10_000,
  edgeBps: 100,        // minimum profitable dislocation vs feed-fair
  bandBps: 800,        // fair-vs-mid anomaly gate (takeLaw)
  maxTakeSbd: 2,       // per-take notional ceiling
  minTakeSbd: 0.05,    // dust floor
  dayCap: 60,          // takes/day
  ttlSec: 600,         // FOK lifetime (self-cleaning leftovers)
  minRcPct: 25,        // last claimant on RC
  reserveSbd: 0.5,     // bid reserve law (hyper/manyhands parity)
};

export function sharpConf() {
  const c = armedConf()?.sharpTaker ?? {};
  return { ...SHARP_DEFAULTS, ...c };
}

/* ── RUNTIME ────────────────────────────────────────────────────────────── */

const G = globalThis;
let startedAt = null;

export function sharpTakerState() {
  const st = readJson(TAKER_FILE, null);
  if (!st) return { running: false, startedAt: null, lastVerdict: "NEVER-BOOTED" };
  return { ...st, startedAt, conf: sharpConf(), armed: armedConf()?.sharpTaker?.enabled === true };
}

async function tick() {
  if (G.__saosSharpInFlight === true) return;
  G.__saosSharpInFlight = true;
  const now = new Date();
  const nowMs = now.getTime();
  const today = now.toISOString().slice(0, 10);
  const sc = sharpConf();
  try {
    /* standing-order gate — the ONLY on/off (fail-closed default DISARMED) */
    if (armedConf()?.sharpTaker?.enabled !== true) {
      return finish(sc, { lastVerdict: "DISARMED", lastVerdictAt: now.toISOString() });
    }
    if (execPaused()) return finish(sc, { lastVerdict: "EXEC-PAUSED", lastVerdictAt: now.toISOString() });
    try { loadCredential(masterAccount()); } catch (e) {
      return finish(sc, { lastVerdict: "CREDENTIAL-MISSING", lastVerdictAt: now.toISOString(), lastError: String(e?.message ?? e).slice(0, 120) });
    }
    /* cycle respect (dexflow law): the cycle owns order surgery while fresh */
    const marker = readJson(path.join(STATE, "cycle-run.json"), null);
    const markerAt = marker?.startedAt ? Date.parse(marker.startedAt) : 0;
    if (marker?.running === true && Number.isFinite(markerAt) && nowMs - markerAt < 10 * 60_000) {
      return finish(sc, { lastVerdict: "CYCLE-IN-FLIGHT", lastVerdictAt: now.toISOString() });
    }

    const st = readJson(TAKER_FILE, {});
    let takesToday = st.day === today ? (st.takesToday ?? 0) : 0;
    if (takesToday >= sc.dayCap) {
      return finish(sc, { lastVerdict: "DAY-CAP", lastVerdictAt: now.toISOString(), takesToday });
    }

    /* reads: book + feed-fair (the witness median — manyhands fair law) */
    const obs = readJson(OBSERVE_FILE, null);
    const fair = obs?.feed > 0 ? obs.feed : (obs?.parity > 0 ? obs.parity : 0);
    const r = await rpcCall("condenser_api.get_order_book", [1]);
    if (!r.ok) return finish(sc, { lastVerdict: "NO-BOOK", lastVerdictAt: now.toISOString(), takesToday, fair });
    const unit = (o) => { if (!o) return 0; const rp = Number(o.real_price); return Number.isFinite(rp) && rp > 0 ? rp : 0; };
    const bestAsk = unit(r.result?.asks?.[0]);
    const bestBid = unit(r.result?.bids?.[0]);
    if (!(bestAsk > 0) || !(bestBid > 0) || !(fair > 0)) {
      return finish(sc, { lastVerdict: "NO-EVIDENCE", lastVerdictAt: now.toISOString(), takesToday, fair });
    }
    const mid = (bestAsk + bestBid) / 2;

    /* RC floor — the taker is the last claimant on the tank */
    const acc = await accountState(masterAccount());
    const rcPct = acc?.rcPct ?? null;
    if (!(Number(rcPct) >= sc.minRcPct)) {
      return finish(sc, { lastVerdict: "RC-FLOOR", lastVerdictAt: now.toISOString(), takesToday, fair, rcPct });
    }

    /* THE ONE LAW — takeLaw exactly as the hands rail runs it */
    const t = takeLaw({
      fair, bestAsk, bestBid, mid,
      edgeBps: sc.edgeBps, bandBps: sc.bandBps,
      maxTakeSbd: sc.maxTakeSbd, minTakeSbd: sc.minTakeSbd,
      steemFree: Math.max(0, (Number(acc?.steem) || 0) - 0.001),
      sbdFree: Math.max(0, (Number(acc?.sbd) || 0) - sc.reserveSbd),
    });

    if (t.halt) {
      appendLine(EVENTS_FILE, { type: "sharp.take-halt", at: now.toISOString(), ...t, fair });
      return finish(sc, { lastVerdict: `HALT:${t.halt}`, lastVerdictAt: now.toISOString(), takesToday, fair, rcPct });
    }
    if (!t.take) {
      /* bounded skip journal: verdict-change or every 30 ticks */
      const lastSkip = st.lastSkipVerdict ?? null;
      const ticks = (st.ticks ?? 0) + 1;
      const due = lastSkip !== t.skip || ticks - (st.lastSkipTick ?? -30) >= 30;
      if (due) appendLine(EVENTS_FILE, { type: "sharp.skip", at: now.toISOString(), skip: t.skip, fair, bestAsk, bestBid });
      return finish(sc, { lastVerdict: `SKIP:${t.skip}`, lastVerdictAt: now.toISOString(), takesToday, fair, rcPct, ticks, lastSkipVerdict: t.skip, lastSkipTick: due ? ticks : (st.lastSkipTick ?? 0) });
    }

    /* EXECUTE — master custody, one FOK op, the lawful signer path */
    const tid = (st.nextId && takerIdOk(st.nextId)) ? st.nextId : TAKER_BASE0 + 7;
    const built = masterTakeOp({ side: t.side, orderid: tid, tSec: Math.floor(nowMs / 1000), ttlSec: sc.ttlSec, spendSbd: t.spendSbd, receiveSbd: t.receiveSbd, qtySteem: t.qtySteem });
    if (built.error) {
      appendLine(EVENTS_FILE, { type: "sharp.take-refused", at: now.toISOString(), error: built.error, ...t });
      return finish(sc, { lastVerdict: `REFUSED:${built.error}`, lastVerdictAt: now.toISOString(), takesToday, fair, rcPct, nextId: tid });
    }
    const res = await executeOps([built.op], { tag: "sharp-take", rcPct });
    const ok = res.ok ?? res.verdict === "BROADCAST";
    appendLine(EVENTS_FILE, {
      type: ok ? "sharp.take" : "sharp.take-fail", at: now.toISOString(),
      side: t.side, edgeBps: t.edgeBps, spendSbd: t.spendSbd ?? null, receiveSbd: t.receiveSbd ?? null,
      qtySteem: t.qtySteem, fair, bestAsk, bestBid, orderid: tid, txid: res.txid ?? null,
      error: ok ? null : String(res.error ?? res.verdict).slice(0, 140),
    });
    return finish(sc, {
      lastVerdict: ok ? `TAKE:${t.side}` : "TAKE-FAIL", lastVerdictAt: now.toISOString(),
      takesToday: ok ? takesToday + 1 : takesToday, fair, rcPct, nextId: tid + 1, lastTxid: res.txid ?? null,
      lastTake: ok ? { side: t.side, edgeBps: t.edgeBps, spendSbd: t.spendSbd ?? null, receiveSbd: t.receiveSbd ?? null, qtySteem: t.qtySteem, at: now.toISOString() } : (st.lastTake ?? null),
    });
  } catch (e) {
    return finish(sc, { lastVerdict: "TICK-ERROR", lastVerdictAt: now.toISOString(), lastError: String(e?.message ?? e).slice(0, 160) });
  } finally {
    G.__saosSharpInFlight = false;
  }
}

function finish(sc, patch) {
  const st = readJson(TAKER_FILE, {});
  writeJson(TAKER_FILE, { ...st, running: true, conf: sc, ...patch });
}

export function startSharpTaker() {
  /* hot-reload/boot idempotent: ONE loop per process, always the newest code */
  if (G.__saosSharpTimer) clearInterval(G.__saosSharpTimer);
  startedAt = new Date().toISOString();
  const sc = sharpConf();
  const prev = readJson(TAKER_FILE, {});
  writeJson(TAKER_FILE, { ...prev, running: true, startedAt, conf: sc, lastVerdict: prev.lastVerdict ?? "BOOTED", lastVerdictAt: startedAt });
  appendLine(EVENTS_FILE, { type: "sharp.boot", at: startedAt, pid: process.pid, armed: armedConf()?.sharpTaker?.enabled === true, conf: sc });
  G.__saosSharpTimer = setInterval(() => { void tick(); }, Math.max(5000, Number(sc.tickMs) || 10_000));
  void tick();
  return sharpTakerState();
}
