#!/usr/bin/env node
'use strict';
/**
 * ladder_refresh.cjs — Task 16-b: the ladder-refresh EXECUTOR (the 15-c spec, now implemented).
 *
 * Owner directive TODAY: "I don't want to wait — MUCH faster, MUCH more; more trades, more
 * ways to inject liquidity." This executor is the disciplined answer: it keeps the @headcorner
 * STEEM/SBD internal-market ladder near the live mid by CANCEL+REPLACE of stale orders only —
 * we reprice EXISTING liquidity, never inject fresh capital.
 *
 * HARD CAPS (in code AND in every receipt — the caps win over appetite):
 *   MAX_PAIRS               = 3    cancel+replace pairs TOTAL per run
 *   STALE_MIN_AGE_HOURS     = 168  (7d)  — an order must be older than 7d to touch
 *   STALE_DIST_PCT          = 2.0  — AND further than 2% from the book mid
 *   REPLACE_BAND_PCT        = 2.0  — replacement price within ±2% of mid (hard abort per-op)
 *   TARGET_OFFSET_PCT       = 1.5  — repost at mid±1.5% (sell above / buy below)
 *   FLOOR                   = the 2 lowest asks + the 2 highest bids are NEVER cancel-eligible
 *   STANDING_MIN            = 4    — never cancel all: ≥4 orders must remain standing after plan
 *   BOOK_ANOMALY_ABORT      = depth <3 levels on either side OR book spread >15%
 *   identical base amount on every replace (no fresh capital injection, ever)
 *   abort-on-error: first failed broadcast stops the run; receipt records the partial state
 *   NEVER_TOUCH = /^ynet/ + /^tov-hive/ (doctrine; this tool is headcorner-only by hard lock)
 *
 * GATES (all must agree for any broadcast):
 *   repo live-gate 28-b:  HE_LIVE=1 AND HE_LIVE_CONFIRM=<account> (or --live) — lib/live_gate.cjs
 *   task gate:            LADDER_ARM=1
 *   kill-switch:          EXECUTOR_DISABLED=true → status=disabled receipt, zero ops
 *   anything else:        plan-only SHAPE output, exit 0 (DRY doctrine)
 *
 * Modes:
 *   LADDER_RECON=1  → read-only recon: writes agent/receipts/<UTC-date>-ladder-recon.json
 *                     (keyless — works with zero key material; used by Task 16-b step 1)
 *   default         → plan (SHAPE-ONLY print) + [gated] execute + account-history read-back
 *                     + receipt agent/receipts/<UTC-date>-ladder-refresh-<n>.json
 *
 * Secrets: ACTIVE_WIF comes from env or agent/.env, is held in memory only, and is NEVER
 * printed, logged or written to any receipt. Prices/sizes/orderids are chain-public.
 *
 * Run:  AGENT_ACCOUNT=headcorner node agent/ladder_refresh.cjs [--recon-env]
 * Arm:  AGENT_ACCOUNT=headcorner HE_LIVE=1 HE_LIVE_CONFIRM=headcorner LADDER_ARM=1 node agent/ladder_refresh.cjs
 */

const fs = require('fs');
const path = require('path');

// 8-b: acting account mandatory — no default (docs/117o-KEY-INCIDENT.md). Head-only lock.
const ACCOUNT = 'headcorner'; // THE ONLY account this executor may ever touch (it holds the liquid ladder)
const ACTING = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACTING) {
  console.error('usage: AGENT_ACCOUNT=<account> node agent/ladder_refresh.cjs — no default acting account (2026-09-08 incident)');
  process.exit(1);
}
if (ACTING !== ACCOUNT) {
  console.error('FATAL: ladder_refresh is headcorner-only by hard lock (requested: ' + ACTING + '). Never touch ynet-*/tov-hive/other accounts.');
  process.exit(1);
}

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACTING });
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}

// steem lib: repo agent/node_modules first, CI fallback via STEEMJS_DIR (economy-engine pattern)
let steem;
try {
  steem = require('steem');
} catch (_) {
  const alt = process.env.STEEMJS_DIR;
  if (!alt) { console.error('FATAL: steem lib unavailable (neither agent/node_modules nor STEEMJS_DIR)'); process.exit(1); }
  steem = require(path.join(alt, 'node_modules', 'steem'));
}
steem.api.setOptions({ url: process.env.LADDER_NODE || 'https://api.steemit.com' });

const RPCS = [process.env.LADDER_NODE || 'https://api.steemit.com', 'https://api.justyy.com'];
const OUT_DIR = path.join(__dirname, 'receipts');
const NOW = () => new Date().toISOString();
const log = (m) => console.log('[' + NOW() + '] ladder: ' + m);

// ─────────────────────────── caps (single source of truth) ───────────────────────────
const CAPS = Object.freeze({
  maxPairsPerRun: 3,
  staleMinAgeHours: 168,          // 7d
  staleDistPct: 2.0,              // >2% from mid AND >7d ⇒ refresh-eligible
  replaceBandPct: 2.0,            // replacement must sit within ±2% of mid (hard)
  targetOffsetPct: 1.5,           // repost at mid±1.5%
  floorLowestAsks: 2,             // NEVER touch the 2 lowest asks
  floorHighestBids: 2,            // symmetric floor: NEVER touch the 2 highest bids
  standingMinAfter: 4,            // ladder must remain standing (never cancel all)
  bookMinDepthLevels: 3,          // anomaly abort below this
  bookAnomalySpreadPct: 15.0,     // anomaly abort above this
  orderLifetimeHours: 24,
  accountLock: ACCOUNT,
  neverTouch: ['^ynet', '^tov-hive'],
});

function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq <= 0) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

let rpcIdx = 0;
async function rpc(method, params) {
  let lastErr = null;
  for (let attempt = 0; attempt < RPCS.length * 2; attempt++) {
    const url = RPCS[rpcIdx % RPCS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.' + method, params }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.error) throw new Error('rpc-error: ' + (j.error.message || JSON.stringify(j.error)).slice(0, 140));
      rpcIdx = (rpcIdx + 1) % RPCS.length;
      return j.result;
    } catch (e) { lastErr = e; rpcIdx = (rpcIdx + 1) % RPCS.length; }
  }
  throw new Error('all RPC nodes failed (' + (lastErr && lastErr.message) + ')');
}

const num = (assetStr) => parseFloat(String(assetStr).split(' ')[0]);
const unit = (assetStr) => String(assetStr).split(' ')[1];
const r3 = (x) => Math.round(x * 1000) / 1000;
const r8 = (x) => Math.round(x * 1e8) / 1e8;
const pct = (x) => Math.round(x * 10000) / 100;

/** Pull the market world: open orders + book + recent market ops (evidence of concurrent managers). */
async function pullWorld() {
  const [orders, book, hist, props] = await Promise.all([
    rpc('get_open_orders', [ACCOUNT]),
    rpc('get_order_book', [20]),
    rpc('get_account_history', [ACCOUNT, -1, 100]),
    rpc('get_dynamic_global_properties', []),
  ]);
  const bestBid = book.bids.length ? parseFloat(book.bids[0].real_price) : null;
  const bestAsk = book.asks.length ? parseFloat(book.asks[0].real_price) : null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  const spreadPct = mid ? pct((bestAsk - bestBid) / mid) : null;

  const nowMs = Date.now();
  const rows = orders.map((o) => {
    const baseAmt = num(o.sell_price.base);
    const quoteAmt = num(o.sell_price.quote);
    const baseAsset = unit(o.sell_price.base);
    const side = baseAsset === 'STEEM' ? 'sell-steem' : 'buy-steem';
    // normalize to SBD-per-STEEM: sell posts base=STEEM/quote=SBD; buy posts base=SBD/quote=STEEM
    const price = side === 'sell-steem' ? quoteAmt / baseAmt : baseAmt / quoteAmt;
    const offeredBase = o.for_sale / 1000; // for_sale is in 0.001 of the base asset
    const steemVolume = side === 'sell-steem' ? offeredBase : offeredBase / price;
    return {
      orderid: o.id,
      side, // sell-steem | buy-steem
      price: r8(price),
      baseAmount: r3(offeredBase),      // committed base asset (STEEM for sells, SBD for buys)
      steemVolume: r3(steemVolume),
      vsMidPct: mid ? pct((price - mid) / mid) : null,
      created: o.created,
      ageHours: Math.round(((nowMs - Date.parse(o.created + 'Z')) / 3600000) * 100) / 100,
      expiration: o.expiration,
      raw: o, // kept in-memory only — never serialized into receipts
    };
  });

  const marketOps = hist.map((h) => h[1]).filter((x) => /^limit_order_(create|cancel)$|^fill_order$/.test(x.op[0]));
  const usedOrderIds = new Set();
  for (const r of rows) usedOrderIds.add(r.orderid);
  for (const x of marketOps) { const oid = x.op[1] && (x.op[1].orderid || x.op[1].order); if (oid != null) usedOrderIds.add(Number(oid)); }

  return { at: NOW(), headBlock: props.head_block_number, orders: rows, book, bestBid, bestAsk, mid, spreadPct, marketOps, usedOrderIds, props };
}

/** Book sanity gates — any anomaly aborts the whole run honestly (no ops). */
function bookAnomaly(world) {
  const bids = world.book.bids.length, asks = world.book.asks.length;
  if (bids < CAPS.bookMinDepthLevels || asks < CAPS.bookMinDepthLevels)
    return 'book thinner than ' + CAPS.bookMinDepthLevels + ' levels (bids=' + bids + ', asks=' + asks + ')';
  if (world.spreadPct === null || !isFinite(world.mid) || world.mid <= 0) return 'book mid unavailable';
  if (world.spreadPct > CAPS.bookAnomalySpreadPct) return 'book spread ' + world.spreadPct + '% > ' + CAPS.bookAnomalySpreadPct + '% anomaly ceiling';
  return null;
}

/** Classify ladder orders with floor anchors. Floors: 2 lowest asks + 2 highest bids are NEVER eligible. */
function classify(world) {
  const sells = world.orders.filter((o) => o.side === 'sell-steem').sort((a, b) => a.price - b.price);
  const buys = world.orders.filter((o) => o.side === 'buy-steem').sort((a, b) => b.price - a.price);
  const askFloor = new Set(sells.slice(0, CAPS.floorLowestAsks).map((o) => o.orderid));
  const bidFloor = new Set(buys.slice(0, CAPS.floorHighestBids).map((o) => o.orderid));
  for (const o of world.orders) {
    o.floor = askFloor.has(o.orderid) || bidFloor.has(o.orderid);
    o.stale = !o.floor && o.ageHours > CAPS.staleMinAgeHours && Math.abs(o.vsMidPct) > CAPS.staleDistPct;
  }
  return { sells, buys, askFloor, bidFloor };
}

/** Compute the refresh plan under every cap. Returns { ops, notes, drops } — SHAPE-safe (no secrets, chain-public numbers only). */
function planRefresh(world) {
  const notes = [];
  const drops = [];
  const anomaly = bookAnomaly(world);
  if (anomaly) return { ops: [], notes: [], drops: [], abort: anomaly };

  classify(world);
  const eligible = world.orders
    .filter((o) => o.stale)
    .sort((a, b) => Math.abs(b.vsMidPct) - Math.abs(a.vsMidPct)) // farthest from mid first
    .slice(0, CAPS.maxPairsPerRun);                              // ≤3 pairs TOTAL

  if (world.orders.length - eligible.length < CAPS.standingMinAfter) {
    drops.push({ orderid: null, reason: 'standing-guard: cancelling ' + eligible.length + ' would leave <' + CAPS.standingMinAfter + ' orders standing' });
    return { ops: [], notes, drops, abort: 'standing-guard' };
  }
  const after = world.orders.filter((o) => !eligible.some((e) => e.orderid === o.orderid));
  for (const side of ['sell-steem', 'buy-steem']) {
    if (!after.some((o) => o.side === side)) {
      drops.push({ orderid: null, reason: 'side-guard: plan would empty the ' + side + ' side' });
      return { ops: [], notes, drops, abort: 'side-guard' };
    }
  }

  const ops = [];
  // fresh, never-before-seen orderids (nowSec base + jitter; exclusion-checked against open orders + recent ops)
  let idBase = Math.max(Math.floor(Date.now() / 1000), Math.max(...world.usedOrderIds) + 1);
  const nextId = () => {
    for (let t = 0; t < 50; t++) { const cand = idBase + t; if (!world.usedOrderIds.has(cand)) { world.usedOrderIds.add(cand); idBase = cand + 1; return cand; } }
    throw new Error('orderid allocation exhausted');
  };
  const expir = new Date(Date.now() + CAPS.orderLifetimeHours * 3600000).toISOString().slice(0, 19);

  for (const o of eligible) {
    let target;
    if (o.side === 'sell-steem') target = world.mid * (1 + CAPS.targetOffsetPct / 100);
    else target = world.mid * (1 - CAPS.targetOffsetPct / 100);
    const band = Math.abs(target - world.mid) / world.mid * 100;
    if (band > CAPS.replaceBandPct) { drops.push({ orderid: o.orderid, reason: 'replace ' + pct((target - world.mid) / world.mid) + '% outside ±' + CAPS.replaceBandPct + '% band' }); continue; }
    // post-only discipline: never cross the live book
    if (o.side === 'sell-steem' && !(target > world.bestBid)) { drops.push({ orderid: o.orderid, reason: 'sell replacement would cross best bid' }); continue; }
    if (o.side === 'buy-steem' && !(target < world.bestAsk)) { drops.push({ orderid: o.orderid, reason: 'buy replacement would cross best ask' }); continue; }

    // identical committed base amount — no fresh capital, ever
    if (o.side === 'sell-steem') {
      const steemStr = o.raw.sell_price.base;              // exact original "X.XXX STEEM"
      const sbdTarget = r3(num(steemStr) * target);
      if (sbdTarget <= 0) { drops.push({ orderid: o.orderid, reason: 'degenerate quote amount' }); continue; }
      const eff = sbdTarget / num(steemStr);
      if (Math.abs(eff - world.mid) / world.mid * 100 > CAPS.replaceBandPct) { drops.push({ orderid: o.orderid, reason: 'post-rounding pushed price outside ±' + CAPS.replaceBandPct + '% band' }); continue; }
      ops.push({
        kind: 'cancel+replace',
        side: o.side,
        cancel: { op: 'limit_order_cancel', owner: ACCOUNT, orderid: o.orderid, staleReason: 'age ' + o.ageHours + 'h > ' + CAPS.staleMinAgeHours + 'h AND ' + o.vsMidPct + '% vs mid' },
        create: { op: 'limit_order_create', owner: ACCOUNT, orderid: nextId(), amount_to_sell: steemStr, min_to_receive: sbdTarget.toFixed(3) + ' SBD', fill_or_kill: false, expiration: expir },
        priceVsMidPct: pct((eff - world.mid) / world.mid),
        oldPriceVsMidPct: o.vsMidPct,
      });
    } else {
      const sbdStr = o.raw.sell_price.base;               // exact original "X.XXX SBD"
      const steemTarget = r3(num(sbdStr) / target);
      if (steemTarget <= 0) { drops.push({ orderid: o.orderid, reason: 'degenerate quote amount' }); continue; }
      const eff = num(sbdStr) / steemTarget;
      if (Math.abs(eff - world.mid) / world.mid * 100 > CAPS.replaceBandPct) { drops.push({ orderid: o.orderid, reason: 'post-rounding pushed price outside ±' + CAPS.replaceBandPct + '% band' }); continue; }
      ops.push({
        kind: 'cancel+replace',
        side: o.side,
        cancel: { op: 'limit_order_cancel', owner: ACCOUNT, orderid: o.orderid, staleReason: 'age ' + o.ageHours + 'h > ' + CAPS.staleMinAgeHours + 'h AND ' + o.vsMidPct + '% vs mid' },
        create: { op: 'limit_order_create', owner: ACCOUNT, orderid: nextId(), amount_to_sell: sbdStr, min_to_receive: steemTarget.toFixed(3) + ' STEEM', fill_or_kill: false, expiration: expir },
        priceVsMidPct: pct((eff - world.mid) / world.mid),
        oldPriceVsMidPct: o.vsMidPct,
      });
    }
  }
  notes.push('caps: ≤' + CAPS.maxPairsPerRun + ' pairs/run · staleness >' + CAPS.staleMinAgeHours + 'h AND >' + CAPS.staleDistPct + '% from mid · repost at mid±' + CAPS.targetOffsetPct + '% within ±' + CAPS.replaceBandPct + '% band · floor = ' + CAPS.floorLowestAsks + ' lowest asks + ' + CAPS.floorHighestBids + ' highest bids untouchable · identical base amounts (no fresh capital)');
  return { ops, notes, drops, abort: null };
}

/** SHAPE-ONLY plan print — chain-public numbers, zero secrets. */
function printPlanShape(plan, world) {
  log('PLAN SHAPE (SHAPE-ONLY — orderids/prices are chain-public, no key material):');
  log('  book: mid=' + r8(world.mid) + ' SBD/STEEM spread=' + world.spreadPct + '% depth=' + world.book.bids.length + '/' + world.book.asks.length);
  log('  ops: ' + plan.ops.length + (plan.abort ? ' (ABORT: ' + plan.abort + ')' : ''));
  for (const op of plan.ops) {
    log('  · cancel ' + op.cancel.orderid + ' (' + op.cancel.staleReason + ') → create ' + op.create.orderid + ' ' + op.create.amount_to_sell + '→' + op.create.min_to_receive + ' @ ' + op.priceVsMidPct + '% vs mid (was ' + op.oldPriceVsMidPct + '%)');
  }
  for (const d of plan.drops) log('  · drop ' + (d.orderid == null ? '-' : d.orderid) + ': ' + d.reason);
  for (const n of plan.notes) log('  · ' + n);
}

/** Read back account-history until the op with our orderid shows up (txid + block), bounded retries. */
async function confirmOp(pred, what) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const hist = await rpc('get_account_history', [ACCOUNT, -1, 100]);
    for (const [idx, ev] of hist) {
      const { op, trx_id, block } = ev;
      if (pred(op)) return { accountHistoryIndex: idx, txid: trx_id, block, op: { type: op[0], payload: op[1] } };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('confirmation read-back failed for ' + what + ' (op not in account-history within retries) — abort-on-error doctrine');
}

async function broadcastOp(operation, wif, label) {
  // PROVEN pattern (wrapped.cjs): steem.broadcast.sendAsync signs locally with the active key.
  if (stasisStop('ladder-refresh')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
  const ops = [[operation.op, {
    owner: operation.owner,
    ...(operation.op === 'limit_order_cancel'
      ? { orderid: operation.orderid }
      : { orderid: operation.orderid, amount_to_sell: operation.amount_to_sell, min_to_receive: operation.min_to_receive, fill_or_kill: operation.fill_or_kill, expiration: operation.expiration }),
  }]];
  try {
    await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, [wif]);
  } catch (e) {
    throw new Error('broadcast failed (' + label + '): ' + ((e && e.message) || String(e)).slice(0, 160));
  }
}

async function main() {
  const reconMode = process.env.LADDER_RECON === '1';
  const armed = !GATE.dryForced && GATE.live && process.env.LADDER_ARM === '1' && process.env.EXECUTOR_DISABLED !== 'true';
  const killSwitch = process.env.EXECUTOR_DISABLED === 'true';

  log('=== ladder-refresh · ' + (reconMode ? 'RECON' : armed ? 'ARMED' : 'PLAN-ONLY') + ' · @' + ACCOUNT + ' ===');
  announceGate(GATE, log);

  const world = await pullWorld();
  const ladderShape = {
    openOrders: world.orders.length,
    sells: world.orders.filter((o) => o.side === 'sell-steem').length,
    buys: world.orders.filter((o) => o.side === 'buy-steem').length,
    steemOfferedSellSide: r3(world.orders.filter((o) => o.side === 'sell-steem').reduce((a, o) => a + o.steemVolume, 0)),
    steemSoughtBuySide: r3(world.orders.filter((o) => o.side === 'buy-steem').reduce((a, o) => a + o.steemVolume, 0)),
    oldestOrderHours: world.orders.length ? Math.max(...world.orders.map((o) => o.ageHours)) : 0,
    orders: world.orders.map((o) => ({ orderid: o.orderid, side: o.side, price: o.price, baseAmount: o.baseAmount, steemVolume: o.steemVolume, vsMidPct: o.vsMidPct, ageHours: o.ageHours, expiration: o.expiration })),
  };
  const market = { bestBid: r8(world.bestBid), bestAsk: r8(world.bestAsk), mid: r8(world.mid), spreadPct: world.spreadPct, depthBids: world.book.bids.length, depthAsks: world.book.asks.length, headBlock: world.headBlock };
  const churn = {
    marketOpsInLast100AcctOps: world.marketOps.length,
    spanFirstLastSeconds: world.marketOps.length > 1 ? Math.round((Date.parse(world.marketOps[world.marketOps.length - 1].timestamp + 'Z') - Date.parse(world.marketOps[0].timestamp + 'Z')) / 1000) : 0,
    verdict: world.marketOps.length > 20
      ? 'HIGH-FREQUENCY CONCURRENT MANAGER OBSERVED — another process is actively churning this ladder; this executor stays cap-limited and staleness-gated inside that reality'
      : 'no high-frequency churn observed in the recent history window',
  };

  const plan = planRefresh(world);
  printPlanShape(plan, world);

  if (reconMode) {
    const recon = {
      receipt: 'ladder-recon',
      task: '16-b step 1 — head-corner ladder market recon (read-only; decides the refresh plan)',
      at: world.at, node: RPCS[rpcIdx], account: ACCOUNT, market, ladder: ladderShape, churn,
      caps: CAPS,
      anomaly: plan.abort,
      planDecision: plan.abort
        ? { status: 'ABORT-ANOMALY', ops: 0, reason: plan.abort }
        : plan.ops.length === 0
          ? {
              status: 'LADDER-HEALTHY-NO-OPS',
              ops: 0,
              reason: 'no order qualifies stale (staleness gate: >' + CAPS.staleMinAgeHours + 'h old AND >' + CAPS.staleDistPct + '% from mid) — oldest order is ' + ladderShape.oldestOrderHours + 'h old; per Task 16-b: DO NOTHING on-chain, implement executor + workflow for future automated runs instead',
            }
          : { status: 'PLAN-READY', ops: plan.ops.length, shape: plan.ops.map((o) => ({ side: o.side, cancelOrderid: o.cancel.orderid, createOrderid: o.create.orderid, amount_to_sell: o.create.amount_to_sell, min_to_receive: o.create.min_to_receive, priceVsMidPct: o.priceVsMidPct })) },
      drops: plan.drops,
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, world.at.slice(0, 10) + '-ladder-recon.json');
    fs.writeFileSync(out, JSON.stringify(recon, null, 2) + '\n');
    log('recon receipt: ' + path.relative(path.join(__dirname), out) + ' · decision: ' + recon.planDecision.status);
    return;
  }

  // ── execution path (gates: live-gate 28-b AND LADDER_ARM=1 AND not EXECUTOR_DISABLED) ──
  const receiptBase = {
    receipt: 'ladder-refresh',
    task: '16-b — ladder-refresh executor run (≤3 cancel+replace pairs, ±2% band, floor-anchored, no fresh capital)',
    at: world.at, node: RPCS[rpcIdx], account: ACCOUNT, market, ladderShape, churn, caps: CAPS,
    gates: { liveGate28b: GATE.live, ladderArm: process.env.LADDER_ARM === '1', executorDisabled: killSwitch, dryForced: GATE.dryForced },
    dryRunPlanPrint: plan.ops.map((o) => ({ cancel: o.cancel, create: o.create, priceVsMidPct: o.priceVsMidPct })), // EXACT ops list before any broadcast
    drops: plan.drops,
    anomaly: plan.abort,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = Date.now().toString(36);
  const out = path.join(OUT_DIR, world.at.slice(0, 10) + '-ladder-refresh-' + stamp + '.json');

  const writeReceipt = (extra) => {
    fs.writeFileSync(out, JSON.stringify(Object.assign({}, receiptBase, extra), null, 2) + '\n');
    log('receipt: ' + path.relative(path.join(__dirname), out));
  };

  if (killSwitch) { writeReceipt({ status: 'disabled', ops: [], executed: [] }); log('EXECUTOR_DISABLED — zero ops, honest disabled receipt'); return; }
  if (plan.abort) { writeReceipt({ status: 'abort-anomaly', ops: [], executed: [] }); log('ABORT (anomaly): ' + plan.abort + ' — zero ops'); return; }
  if (!armed) {
    if (plan.ops.length === 0) {
      writeReceipt({ status: 'plan-only-ladder-healthy-no-ops', ops: [], executed: [], reason: 'no order qualifies stale (>7d AND >2% from mid) — nothing to refresh by design; run was plan-only (unarmed)' });
      log('ladder healthy, plan-only — zero ops, exit 0');
    } else {
      writeReceipt({ status: 'plan-only-armed-needed', ops: plan.ops.length, executed: [], reason: 'plan ready but gates not fully armed (need HE_LIVE=1 + HE_LIVE_CONFIRM + LADDER_ARM=1) — DRY doctrine, exit 0' });
      log('PLAN-ONLY (not armed, ' + plan.ops.length + ' op(s) ready) — exit 0 without broadcasting');
    }
    return;
  }

  // ARMED: verify the key against the live chain BEFORE anything else (even for a 0-op run,
  // the supervised armed receipt should prove "armed + key matches live authority").
  loadDotEnv();
  const wif = process.env.ACTIVE_WIF || '';
  if (!wif) { writeReceipt({ status: 'abort-no-key', ops: plan.ops.length, executed: [] }); console.error('FATAL: no ACTIVE_WIF — cannot arm'); process.exit(1); }
  // live-authority proof: derived pubkey MUST equal the chain active authority (public fingerprints only)
  const [acctRow] = await rpc('get_accounts', [[ACCOUNT]]);
  const chainPubs = acctRow.active.key_auths.map((k) => k[0]);
  const derivedPub = steem.auth.wifToPublic(wif);
  const keyFingerprint = derivedPub.slice(0, 8) + '…' + derivedPub.slice(-4);
  if (!chainPubs.includes(derivedPub)) {
    writeReceipt({ status: 'abort-key-mismatch', ops: plan.ops.length, executed: [], keyFingerprint });
    console.error('FATAL: armed key does not match @' + ACCOUNT + ' live active authority — refusing');
    process.exit(1);
  }
  log('armed: key fingerprint ' + keyFingerprint + ' matches live active authority');
  // STASIS (owner 2026-10-04): the brake beats the armed plan — healthy no-op exit 0 with an honest receipt
  if (stasisStop('ladder-refresh')) { writeReceipt({ status: 'stasis-halt', ops: plan.ops.length, executed: [], keyFingerprint, reason: 'STASIS active — zero broadcasts (owner directive 2026-10-04)' }); return; }
  if (plan.ops.length === 0) {
    writeReceipt({ status: 'ladder-healthy-no-ops', ops: [], executed: [], keyVerified: true, keyFingerprint, reason: 'armed + key verified against live authority, but no order qualifies stale (>7d AND >2% from mid) — honest no-op broadcast, zero ops by design' });
    log('ladder healthy (ARMED) — zero qualifying ops; no broadcast needed; honest receipt written');
    return;
  }

  const executed = [];
  for (const op of plan.ops) {
    try {
      log('exec: cancel ' + op.cancel.orderid + ' …');
      await broadcastOp(op.cancel, wif, 'cancel ' + op.cancel.orderid);
      const cancelConf = await confirmOp((o) => o[0] === 'limit_order_cancel' && o[1].owner === ACCOUNT && Number(o[1].orderid) === Number(op.cancel.orderid), 'cancel ' + op.cancel.orderid);
      log('exec: create ' + op.create.orderid + ' …');
      await broadcastOp(op.create, wif, 'create ' + op.create.orderid);
      const createConf = await confirmOp((o) => o[0] === 'limit_order_create' && o[1].owner === ACCOUNT && Number(o[1].orderid) === Number(op.create.orderid), 'create ' + op.create.orderid);
      executed.push({ side: op.side, cancel: op.cancel, create: op.create, priceVsMidPct: op.priceVsMidPct, confirmations: { cancel: cancelConf, create: createConf } });
      log('ok: pair complete (cancel tx ' + cancelConf.txid + ' · create tx ' + createConf.txid + ')');
    } catch (e) {
      log('ABORT-ON-ERROR after ' + executed.length + '/' + plan.ops.length + ' pairs: ' + e.message);
      writeReceipt({ status: 'partial-abort', opsPlanned: plan.ops.length, executed, error: e.message });
      process.exit(1);
    }
  }

  // final on-chain read-back: old ids gone, new ids present
  const after = await rpc('get_open_orders', [ACCOUNT]);
  const afterIds = new Set(after.map((o) => o.id));
  const verify = plan.ops.map((op) => ({ cancelledGone: !afterIds.has(op.cancel.orderid), createdPresent: afterIds.has(op.create.orderid) }));
  const allOk = verify.every((v) => v.cancelledGone && v.createdPresent);
  writeReceipt({
    status: allOk ? 'executed-verified' : 'executed-unverified',
    opsPlanned: plan.ops.length,
    executed,
    verify,
    ladderAfter: { openOrders: after.length },
  });
  log('run complete: ' + executed.length + ' pair(s) executed, verified=' + allOk);
  if (!allOk) process.exit(1);
}

main().catch((e) => { console.error('LADDER-FAIL: ' + ((e && e.message) || e)); process.exit(1); });
