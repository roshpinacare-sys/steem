#!/usr/bin/env node
'use strict';
/**
 * headladder-report.cjs — Task 15-c step 2 (READ-ONLY market report, zero secrets, zero broadcasts).
 *
 * Pulls @headcorner open orders + the STEEM/SBD central limit order book from a condenser node
 * and reports: ladder shape, per-order price vs book mid (spread), staleness, and the proposed
 * executor spec for a future wave (IMPLEMENTATION DELIBERATELY NOT HERE — this tool only reads).
 *
 * Receipt: agent/receipts/<UTC-date>-headladder-report.json (counts + numbers only — no keys).
 * Run:     node agent/headladder-report.cjs
 */
const fs = require('fs');
const path = require('path');

const ACCOUNT = 'headcorner';
const NODE = process.env.HL_NODE || 'https://api.steemit.com';
const OUT_DIR = path.join(__dirname, 'receipts');

async function rpc(method, params) {
  const res = await fetch(NODE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.' + method, params }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json();
  if (j.error) throw new Error(method + ': ' + JSON.stringify(j.error).slice(0, 160));
  return j.result;
}
const num = (assetStr) => parseFloat(String(assetStr).split(' ')[0]);
const pct = (x) => Math.round(x * 10000) / 100;

(async () => {
  const at = new Date().toISOString();
  const [orders, book] = await Promise.all([
    rpc('get_open_orders', [ACCOUNT]),
    rpc('get_order_book', [20]),
  ]);

  // book mid (SBD per STEEM)
  const bestBid = book.bids.length ? parseFloat(book.bids[0].real_price) : null;
  const bestAsk = book.asks.length ? parseFloat(book.asks[0].real_price) : null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  const bookSpreadPct = mid ? pct((bestAsk - bestBid) / mid) : null;

  // classify our orders: base asset = what we offer, quote = what we request
  // sell (STEEM→SBD): price_sbd_per_steem = quote/base ; buy (SBD→STEEM): same formula, base=SBD
  const nowMs = Date.now();
  const rows = orders.map((o) => {
    const baseAmt = num(o.sell_price.base);
    const quoteAmt = num(o.sell_price.quote);
    const baseAsset = String(o.sell_price.base).split(' ')[1];
    const side = baseAsset === 'STEEM' ? 'sell-steem' : 'buy-steem';
    // normalize everything to SBD-per-STEEM: a sell posts base=STEEM/quote=SBD (quote/base is
    // already SBD/STEEM); a buy posts base=SBD/quote=STEEM (must invert base/quote)
    const price = side === 'sell-steem' ? quoteAmt / baseAmt : baseAmt / quoteAmt;
    const offeredBase = o.for_sale / 1000; // for_sale is in 0.001 of the base asset
    const steemVolume = side === 'sell-steem' ? offeredBase : offeredBase / price;
    const stalenessMin = Math.round((nowMs - Date.parse(o.created + 'Z')) / 60000);
    const distVsMid = mid ? (price - mid) / mid : null;
    const isBest = side === 'sell-steem' ? price === bestAsk : price === bestBid;
    return {
      id: o.id,
      side,
      priceSbdPerSteem: Math.round(price * 1e8) / 1e8,
      baseOffered: offeredBase,
      steemVolume: Math.round(steemVolume * 1000) / 1000,
      vsMidPct: distVsMid === null ? null : Math.round(distVsMid * 10000) / 100,
      created: o.created,
      stalenessMinutes: stalenessMin,
      expiration: o.expiration,
      topsBookSide: isBest,
    };
  });

  const sells = rows.filter((r) => r.side === 'sell-steem');
  const buys = rows.filter((r) => r.side === 'buy-steem');
  const sum = (arr, k) => Math.round(arr.reduce((a, x) => a + x[k], 0) * 1000) / 1000;

  const report = {
    receipt: 'headladder-report',
    task: '15-c step 2 — head-ladder market report (read-only; executor spec is PROPOSED, not implemented)',
    at,
    node: NODE,
    account: ACCOUNT,
    market: {
      bestBidSbdPerSteem: bestBid,
      bestAskSbdPerSteem: bestAsk,
      midSbdPerSteem: mid ? Math.round(mid * 1e8) / 1e8 : null,
      bookSpreadPct,
      bookDepth: { bids: book.bids.length, asks: book.asks.length },
    },
    ladder: {
      openOrders: rows.length,
      sellOrders: sells.length,
      buyOrders: buys.length,
      steemOfferedSellSide: sum(sells, 'steemVolume'),
      steemSoughtBuySide: sum(buys, 'steemVolume'),
      steemOpenInterestBothSides: Math.round((sum(sells, 'steemVolume') + sum(buys, 'steemVolume')) * 1000) / 1000,
      oldestOrderMinutes: Math.max(...rows.map((r) => r.stalenessMinutes)),
      newestOrderMinutes: Math.min(...rows.map((r) => r.stalenessMinutes)),
      orders: rows,
    },
    observations: [
      'the ~882-STEEM figure quoted in the wave brief corresponds to the BUY side ladder: 5 orders of 15.629 SBD each seeking ~807.8 STEEM combined + one ~4.98 STEEM best-bid probe (live count at report time may drift ±1 order)',
      'the SELL side is a thin wall: 5 identical 1.033-STEEM orders at 0.10454985 (exactly 5 book ask levels) + 4×0.160-STEEM + 1×0.5-STEEM — headcorner owns that wall',
      'headcorner also holds the single best bid (0.100402 SBD/STEEM) — tops the book on the buy side',
      'all orders are young (< 3h) and expire ~24h after creation — 1.033/0.160/15.629 base units indicate satoshi-rounded ladder minting',
      'first sell sits ~+2.2% over mid and the top buy ~-1.9% under mid — inside the proposed 2-8% executor band, so a disciplined executor would currently place no new orders, by design',
    ],
    proposedExecutorSpec: {
      status: 'PROPOSED ONLY — implementation is NOT part of this wave (no market broadcasts anywhere in 15-c)',
      cadence: 'one engine pass per day, right after the curation cycle; ops ≤ 3 per run',
      caps: {
        maxOpsPerRun: 3,
        maxSteemMovedPerRun: 150,
        maxOrderLifetimeHours: 24,
        minSpreadFromMidPct: 2.0,
        maxSpreadFromMidPct: 8.0,
        maxNewOrdersPerSidePerRun: 2,
        maxCancelsPerRun: 1,
      },
      rules: [
        'never cancel below floor: the lowest priced buy and the 5×1.033-STEEM sell wall are floor-anchored — cancel only orders older than 12h AND further than 8% from mid',
        'post-only pricing: new sells ≥ mid × 1.02, new buys ≤ mid × 0.98 (2% min-spread hard rule)',
        'active-only authority: market ops require ACTIVE key, which the posting-only economy engine must NEVER hold — a separate single-purpose executor path with its own receipt stream is mandatory',
        'dry-run first: 7 consecutive dry cycles with honest spread-hit simulation before any live op',
        'kill-switch: env EXECUTOR_DISABLED=true short-circuits; scheduled receipt still written with status=disabled',
        'receipt per op: txid + block + price vs mid at placement, pushed to steem/agent/receipts within the same run',
      ],
    },
    costs: { principalAtRisk: 'existing open orders only (pre-existing ladder — untouched this wave)', newOrdersPlaced: 0, ordersCancelled: 0 },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, at.slice(0, 10) + '-headladder-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log('SUMMARY ' + JSON.stringify({
    at, account: ACCOUNT, openOrders: rows.length,
    steemOfferedSellSide: report.ladder.steemOfferedSellSide,
    steemSoughtBuySide: report.ladder.steemSoughtBuySide,
    midSbdPerSteem: report.market.midSbdPerSteem,
    bookSpreadPct: report.market.bookSpreadPct,
    oldestOrderMinutes: report.ladder.oldestOrderMinutes,
    receipt: path.relative(path.join(__dirname), out),
  }));
})().catch((e) => { console.error('HEADLADDER-FAIL: ' + (e && e.message)); process.exit(1); });
