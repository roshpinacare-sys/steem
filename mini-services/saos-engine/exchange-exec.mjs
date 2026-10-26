/**
 * exchange-exec.mjs — W17 · THE EXCHANGE EXECUTOR (מסילת-הביצוע-על-הבורסה).
 *
 * THE GAP (measured 2026-10-19): W13 delivered the signing/transport layer
 * (htx.mjs) + the economics guard (htx-ecg.mjs); W14 ARMED the order
 * (operator-orders W14-EXCHANGE-ARM + .secrets/exec-armed.json policy) —
 * but NO executor ever existed. The owner's words: "בכלל לא ראיתי תנועה
 * בחשבון" — correct: nothing could move. THIS module is the executor.
 *
 * THE DEPOSIT LEG (T2 — classified, capped-counted, journaled):
 *   headcorner → HTX deposit address (policy.exchange.depositCounterparty,
 *   MEASURED at census — the transfer refuses on absent/unmeasured), amount
 *   = min(maxDepositSteemOneShot, liquid − floor), one shot per 24h.
 *   Chain-judged custody REQUIRED (executeAs chain covers it).
 *
 * THE TRADE LEG (T1 — limit orders, cancelable):
 *   sell side: HTX steem balance → limit ASK above mid when the ECG margin
 *   clears (fees-eat-edge REFUSEs, default refusal); buy side only with USDT.
 *   Caps: maxOrderValueUsdt per order, maxOpenOrders live.
 *
 * HONESTY LAWS: every blocked precondition is a TYPED verdict journaled to
 * state/exchange-exec.json + exec-log.jsonl; zero secret material anywhere;
 * the API is the judge of permissions (a DENIED census is a verdict, not an
 * assumption); tick cadence 300s, honest idempotence via state.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { armedConf } from "./signer.mjs";
import { executeAs, execStatus } from "./signer.mjs";
import { htxConfig, htxPrivate, htxPublic } from "./htx.mjs";
import { ecgVerdict } from "./htx-ecg.mjs";
import { rpcCall } from "./measure.mjs";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const STATE = path.join(DIR, "state");
const STATE_FILE = path.join(STATE, "exchange-exec.json");
const LOG_FILE = path.join(STATE, "exec-log.jsonl");
const TICK_MS = 300_000; /* 5 min — the deposit is 24h-rate-limited anyway; trades are cap-bounded */
const DEPOSIT_COOLDOWN_MS = 86_400_000;
const LIQUID_FLOOR_STEEM = 5;

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); const t = `${p}.tmp.${process.pid}`; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, p); };
const appendLine = (p, v) => { try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(v) + "\n"); } catch { /* bounded best-effort */ } };

let inFlight = false;
let state = readJson(STATE_FILE, {
  format: "exchange-exec-1",
  createdAt: now(),
  ticks: 0,
  lastTickAt: null,
  lastVerdict: "BOOT",
  deposits: [], /* {at, amount, to, txid, verdict} */
  trades: [], /* {at, side, symbol, amount, price, orderId, verdict, marginBps} */
  counters: { deposits24h: 0, openOrderCount: 0 },
});

function record(verdict, extra = {}) {
  state.lastVerdict = verdict;
  state.lastTickAt = now();
  state.ticks += 1;
  writeJson(STATE_FILE, state);
  appendLine(LOG_FILE, { at: now(), tag: "exchange-exec", verdict, ...extra });
}

/* ---------- measurement helpers (all verdict-only, fail-closed) ---------- */

async function liquidSteem(account) {
  try {
    const r = await rpcCall("condenser_api.get_accounts", [[account]]);
    const a = Array.isArray(r) ? r[0] : null;
    const bal = parseFloat(a?.balance ?? "0");
    return { ok: Number.isFinite(bal), bal };
  } catch (e) {
    return { ok: false, bal: 0, why: String(e?.message ?? e).slice(0, 80) };
  }
}

async function htxBalances(accountId, cfg) {
  const r = await htxPrivate("GET", `/v1/account/accounts/${encodeURIComponent(accountId)}/balance`, {}, null, { cfg });
  if (!r.ok) return { ok: false, why: r.why, errMsg: r.errMsg ?? null };
  const nz = {};
  for (const row of r.data?.list ?? []) {
    const total = Number(row.balance ?? 0) + Number(row.locked ?? 0);
    if (total > 0) nz[row.currency] = (nz[row.currency] ?? 0) + total;
  }
  return { ok: true, nonzero: nz };
}

async function openOrders(accountId, cfg, symbol) {
  const r = await htxPrivate("GET", "/v1/order/openOrders", { "account-id": String(accountId), symbol }, null, { cfg });
  if (!r.ok) return { ok: false, why: r.why, errMsg: r.errMsg ?? null };
  return { ok: true, orders: r.data ?? [], count: (r.data ?? []).length };
}

/* W18 multi-network widening: the book reader is symbol-generic — the fleet
 * trades the network's pairs (steem/sbd/hive/trx), not one symbol. */
async function bookFor(symbol) {
  const d = await htxPublic("/market/depth", { symbol, type: "step0", depth: 5 });
  if (!d.ok) return { ok: false, why: d.why };
  const bids = (d.data?.tick?.bids ?? []).map(([p, q]) => [Number(p), Number(q)]);
  const asks = (d.data?.tick?.asks ?? []).map(([p, q]) => [Number(p), Number(q)]);
  if (!bids.length || !asks.length) return { ok: false, why: "empty-book" };
  const bestBid = bids[0][0], bestAsk = asks[0][0];
  const mid = (bestBid + bestAsk) / 2;
  /* edge model: SELL now at ask, BUY back at bid — the round trip captures
   * the spread minus fees; the ECG judges the spread AS the edge (bps of mid). */
  const edgeBps = ((bestAsk - bestBid) / mid) * 10_000;
  return { ok: true, bestBid, bestAsk, mid, edgeBps, askQty: asks[0][1], bidQty: bids[0][1] };
}

/* ---------- the legs ---------- */

async function depositLeg(account, pol) {
  if (!pol?.allowExchangeDeposit) return { verdict: "DEPOSIT-DISARMED" };
  const counterparty = pol?.depositCounterparty ?? null;
  if (!counterparty) return { verdict: "DEPOSIT-BLOCKED-NO-COUNTERPARTY", note: "the measured HTX deposit address must be set in exec-armed policy.exchange.depositCounterparty (census 500 server-side at 18:58Z — honest block, never a guessed address)" };
  const last = state.deposits[state.deposits.length - 1];
  if (last?.at && Date.now() - Date.parse(last.at) < DEPOSIT_COOLDOWN_MS) return { verdict: "DEPOSIT-RATE-LIMITED", lastAt: last.at };

  const liq = await liquidSteem(account);
  if (!liq.ok) return { verdict: "DEPOSIT-BLOCKED-LIQUID-UNMEASURED", why: liq.why ?? null };
  const cap = Number(pol?.maxDepositSteemOneShot ?? 30);
  const amt = Math.min(cap, liq.bal - LIQUID_FLOOR_STEEM);
  const amtStr = (Math.floor(amt * 1000) / 1000).toFixed(3);
  if (Number(amtStr) < 1) return { verdict: "DEPOSIT-REFUSE-INSUFFICIENT-LIQUID", liquid: liq.bal, computed: amtStr, floor: LIQUID_FLOOR_STEEM };

  const res = await executeAs(account, [["transfer", { from: account, to: counterparty, amount: `${amtStr} STEEM`, memo: String(pol?.depositMemo ?? "") }]], { tag: "exchange-deposit-w17" });
  const rec = { at: now(), amount: amtStr, to: counterparty, verdict: res?.ok ? "DEPOSIT-SENT" : "DEPOSIT-REFUSED", txid: res?.txid ?? res?.result?.txid ?? null, reason: res?.verdict ?? res?.reason ?? null };
  state.deposits.push(rec);
  return rec;
}

/* W18 THE MULTI-NETWORK TRADE LEG — one ECG-guarded loop over the network's
 * pairs (default steem/sbd/hive/trx vs USDT). Every per-symbol verdict is
 * typed and journaled; the default is still refusal — the widening adds
 * REACH, never permission. Base-asset map is explicit, never guessed. */
const TRADE_BASE = { steemusdt: "steem", sbdusdt: "sbd", hiveusdt: "hive", trxusdt: "trx" };

async function tradeLeg(account, pol) {
  if (!pol?.allowExchangeTrade) return { verdict: "TRADE-DISARMED" };
  let cfg;
  try { cfg = htxConfig(); } catch (e) { return { verdict: "TRADE-BLOCKED-NO-CRED", why: e.code ?? null }; }

  const accountId = pol?.exchange?.accountId ?? "73986225";
  const symbols = pol?.exchange?.tradeSymbols ?? Object.keys(TRADE_BASE);
  const maxOpen = Number(pol?.exchange?.maxOpenOrders ?? 2);
  const maxValUsdt = Number(pol?.exchange?.maxOrderValueUsdt ?? 10);
  const floorBps = Number(pol?.exchange?.ecgFloorBps ?? 55);

  const bal = await htxBalances(accountId, cfg);
  if (!bal.ok) return { verdict: "TRADE-BLOCKED-BALANCE-DENIED", why: bal.why };
  const usdtBal = bal.nonzero.usdt ?? 0;

  const results = [];
  let placed = 0, funding = 0, refused = 0, blocked = 0;
  for (const symbol of symbols) {
    const base = TRADE_BASE[symbol];
    if (!base) { results.push({ symbol, verdict: "TRADE-SKIP-UNKNOWN-SYMBOL" }); blocked++; continue; }
    const baseBal = bal.nonzero[base] ?? 0;
    if (baseBal < 1 && usdtBal < 1) { results.push({ symbol, verdict: "TRADE-WAIT-FUNDING", baseBal, usdtBal }); funding++; continue; }

    const oo = await openOrders(accountId, cfg, symbol);
    if (!oo.ok) { results.push({ symbol, verdict: "TRADE-BLOCKED-CENSUS-DENIED", why: oo.why, errMsg: oo.errMsg ?? null }); blocked++; continue; }
    if (oo.count >= maxOpen) { results.push({ symbol, verdict: "TRADE-SKIP-OPEN-ORDER-CAP", open: oo.count, cap: maxOpen }); blocked++; continue; }

    const book = await bookFor(symbol);
    if (!book.ok) { results.push({ symbol, verdict: "TRADE-BLOCKED-BOOK-UNMEASURED", why: book.why }); blocked++; continue; }

    /* the ECG judges (default refusal) — floor from the armed policy */
    const v = ecgVerdict({ edgeBps: book.edgeBps, minProfitBps: floorBps - 50 /* policy floor 55 = 5 profit + 50 core; the guard recomputes core internally */ });
    if (v.verdict !== "EXEC") { results.push({ symbol, verdict: `TRADE-REFUSE-${v.why.toUpperCase()}`, breakEvenBps: v.breakEvenBps, marginBps: v.marginBps, edgeBps: +book.edgeBps.toFixed(2) }); refused++; continue; }

    /* SELL side first (the deposit funds it) — maker limit ABOVE the ask by the margin; value cap in USDT. */
    let rec = null;
    if (baseBal >= 1) {
      const price = +(book.bestAsk * (1 + Math.min(v.marginBps, 100) / 10_000)).toFixed(6);
      const qty = Math.min(baseBal, +(maxValUsdt / price).toFixed(3));
      if (qty >= 1) {
        const place = await htxPrivate("POST", "/v1/order/orders/place", {}, { "account-id": Number(accountId), amount: qty.toString(), symbol, type: "sell-limit", price: price.toString() }, { cfg });
        rec = { at: now(), side: "sell", symbol, amount: qty, price, orderId: place?.data ?? null, verdict: place.ok ? "ORDER-PLACED" : "ORDER-REFUSED", why: place.why ?? null, marginBps: v.marginBps, breakEvenBps: v.breakEvenBps };
      }
    } else if (usdtBal >= 1) {
      const price = +(book.bestBid * (1 - Math.min(v.marginBps, 100) / 10_000)).toFixed(6);
      const qty = Math.min(+(usdtBal / price).toFixed(3), +(maxValUsdt / price).toFixed(3));
      if (qty >= 1) {
        const place = await htxPrivate("POST", "/v1/order/orders/place", {}, { "account-id": Number(accountId), amount: qty.toString(), symbol, type: "buy-limit", price: price.toString() }, { cfg });
        rec = { at: now(), side: "buy", symbol, amount: qty, price, orderId: place?.data ?? null, verdict: place.ok ? "ORDER-PLACED" : "ORDER-REFUSED", why: place.why ?? null, marginBps: v.marginBps, breakEvenBps: v.breakEvenBps };
      }
    }
    if (rec) { results.push(rec); state.trades.push(rec); placed++; }
    else results.push({ symbol, verdict: "TRADE-NO-LEG-ABOVE-MIN", baseBal, usdtBal });
  }
  if (state.trades.length > 200) state.trades = state.trades.slice(-200);
  return { verdict: placed ? `TRADE-MULTI-PLACED-${placed}` : (blocked ? `TRADE-MULTI-BLOCKED-${blocked}` : (funding ? "TRADE-MULTI-WAIT-FUNDING" : `TRADE-MULTI-REFUSED-${refused}`)), symbols: symbols.length, placed, refused, blocked, funding, results };
}

/* ---------- the tick ---------- */

export async function exchangeExecTick() {
  if (inFlight) return { verdict: "TICK-IN-FLIGHT" };
  inFlight = true;
  try {
    const conf = armedConf();
    const pol = conf?.policy?.exchange ?? null;
    const armed = conf?.armed === true;

    /* custody gate first — the chain judges; no signature, no movement */
    const cust = await execStatus();
    const custodyOk = cust?.verdict === "VERIFIED" || (!!cust?.armed && cust?.credential?.present === true);
    if (!armed) { record("EXCHANGE-DISARMED"); return { verdict: "EXCHANGE-DISARMED" }; }
    if (!custodyOk) { record("EXCHANGE-WAIT-CUSTODY", { note: "master custody dead — revival rides the git vault (armyseal meta.keysZipPass lane)" }); return { verdict: "EXCHANGE-WAIT-CUSTODY" }; }

    const dep = await depositLeg("headcorner", pol);
    const trd = await tradeLeg("headcorner", pol);
    record(`${dep?.verdict ?? "DEPOSIT-?"} / ${trd?.verdict ?? "TRADE-?"}`, { deposit: dep, trade: trd });
    return { verdict: state.lastVerdict, deposit: dep, trade: trd };
  } catch (e) {
    record("EXCHANGE-EXEC-ERROR", { error: String(e?.message ?? e).slice(0, 140) });
    return { verdict: "EXCHANGE-EXEC-ERROR" };
  } finally {
    inFlight = false;
  }
}

export function exchangeExecState() {
  return { ...state, tickMs: TICK_MS, running: !!timer };
}

let timer = null;
export function startExchangeExec() {
  if (timer) return;
  timer = setInterval(() => { exchangeExecTick().catch(() => {}); }, TICK_MS);
  setTimeout(() => { exchangeExecTick().catch(() => {}); }, 45_000); /* first honest tick 45s after boot */
}
