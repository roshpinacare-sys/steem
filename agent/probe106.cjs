#!/usr/bin/env node
/* probe106.cjs — Task 106: אימוץ-מפת-המהנדס-השני (ENGINEER_BRIEF · steem-engeiner).
 *
 * הסוכן-השני קידם-ותכנן: פאזה-1 = מפת-LEO (InLeo על Hive-Engine — החלק-החסר-היחיד
 * במטריצת-השרשראות שלנו) · פאזה-2 = החייאת-Blurt (סריקת-צמתים ציבוריים).
 * כאן: שתי-המדידות-החיות-הראשונות — קריאה-בלבד, אפס-המצאה:
 *   A. LEO/LEOM על Hive-Engine: supply · ציטוט-שוק מול SWAP.HIVE/HIVE · נזילות.
 *   B. סריקת-צמתי-Blurt: איזה-endpoint חי (get_dynamic_global_properties) —
 *      הסריקה-הראשונה-מאז-99 שגילתה-את-שלושת-הנקודות-הישנות-מתות.
 * תוצאה: agent/leo106_result.json — קלט-להחלטת-עוגן-ג (LEO) ועוגן-ד (Blurt).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, 'leo106_result.json');
const BLURT_OUT = path.join(__dirname, 'blurt106_scan.json');
const log = (m) => console.log('[probe106] ' + m);

function postJSON(host, p, body, timeout = 12000) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({ hostname: host, path: p, method: 'POST', family: 4, timeout, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'User-Agent': 'saos-probe/106' } }, (x) => {
      let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ err: 'bad-json' }); } });
    });
    req.on('error', (e) => resolve({ err: String(e.message || e) }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ err: 'timeout' }); });
    req.write(data); req.end();
  });
}

function getJSON(host, p, timeout = 10000) {
  return new Promise((resolve) => {
    const req = https.get({ hostname: host, path: p, family: 4, timeout, headers: { 'User-Agent': 'saos-probe/106', Accept: 'application/json' } }, (x) => {
      let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ err: 'bad-json' }); } });
    });
    req.on('error', (e) => resolve({ err: String(e.message || e) }));
    req.setTimeout(timeout, () => { req.destroy(); resolve({ err: 'timeout' }); });
  });
}

const heCall = (contract, method, params) => postJSON('api.hive-engine.com', '/rpc/contracts', { jsonrpc: '2.0', id: 1, method: 'findContractCalls' === method ? method : 'findContractCalls', params: [] }).then(() => postJSON('api.hive-engine.com', '/rpc/contracts', { jsonrpc: '2.0', id: 2, method: 'find', params: { contract, table: method, query: params, limit: 1 } }));

async function leoProbe() {
  const t0 = Date.now();
  const token = async (sym) => {
    const r = await postJSON('api.hive-engine.com', '/rpc/contracts', { jsonrpc: '2.0', id: 1, method: 'find', params: { contract: 'tokens', table: 'tokens', query: { symbol: sym }, limit: 1 } });
    const row = r && r.result && r.result[0];
    return row ? { symbol: row.symbol, name: row.name, supply: row.supply, maxSupply: row.maxSupply, issuer: row.issuer } : { err: r ? r.err || 'empty' : 'null' };
  };
  const ticker = async (sym) => {
    /* 106-לקח-מדוד: טבלת-tickers ריקה-בפועל; הטבלה-החיה-היא metrics (נמדד: LEO 0.08167) */
    const r = await postJSON('api.hive-engine.com', '/rpc/contracts', { jsonrpc: '2.0', id: 1, method: 'find', params: { contract: 'market', table: 'metrics', query: { symbol: sym }, limit: 1 } });
    const row = r && r.result && r.result[0];
    return row ? { symbol: row.symbol, lastPrice: row.lastPrice, lowestAsk: row.lowestAsk, highestBid: row.highestBid, volume: row.volume, priceChangePct: row.priceChangePct, timestamp: row.timestamp } : { err: r ? r.err || 'empty' : 'null' };
  };
  const [leo, leom, tickLeo, tickSwap, tickHive] = await Promise.all([token('LEO'), token('LEOM'), ticker('LEO'), ticker('SWAP.HIVE'), token('SWAP.HIVE')]);
  const res = {
    at: new Date().toISOString(),
    src: 'hive-engine rpc (measured live — ENGINEER_BRIEF פאזה-1 · המדידה-הראשונה)',
    leo, leom,
    market: { leo: tickLeo, 'SWAP.HIVE': tickSwap },
    derived: (tickLeo && tickLeo.lastPrice)
      ? {
          leoInHive: +tickLeo.lastPrice,
          spreadPct: (tickLeo.lowestAsk && tickLeo.highestBid) ? +(((tickLeo.lowestAsk - tickLeo.highestBid) / +tickLeo.lowestAsk) * 100).toFixed(3) : null,
          usdNote: 'LEO-USD = LEO/HIVE (מדוד-חי) × HIVE-USD (ציטוט-חתום-על-הספר o106:px:PHIVE — coingecko) — נגזר-משני-מקורות-מדודים, לא-מומצא',
        }
      : null,
    ms: Date.now() - t0,
  };
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2) + '\n');
  log('LEO: ' + JSON.stringify({ supply: leo.supply, last: tickLeo && tickLeo.lastPrice, err: leo.err }));
  return res;
}

const BLURT_NODES = [
  'https://rpc.blurt.world',
  'https://blurt-rpc.saboin.com',
  'https://blurt.coinberg.org',
  'https://rpc.blurtbean.com',
  'https://blurtlatam.com/api',
  'https://rpc.blurtchain.com',
];

async function blurtScan() {
  const t0 = Date.now();
  const results = [];
  for (const node of BLURT_NODES) {
    try {
      const host = node.replace(/^https?:\/\//, '');
      const r = await postJSON(host, '/', { jsonrpc: '2.0', id: 1, method: 'call', params: ['database_api', 'get_dynamic_global_properties', {}] }, 8000);
      const props = r && r.result;
      const ok = !!(props && props.head_block_number);
      results.push({ node, alive: ok, headBlock: ok ? props.head_block_number : null, err: ok ? null : (r && r.err) || 'no-props' });
    } catch (e) {
      results.push({ node, alive: false, err: String(e.message || e).slice(0, 60) });
    }
  }
  const alive = results.filter((r) => r.alive);
  const res = {
    at: new Date().toISOString(),
    scanned: results.length,
    aliveCount: alive.length,
    nodes: results,
    verdict: alive.length
      ? 'חיים-נמצאו: ' + alive.map((a) => a.node + ' (blk ' + a.headBlock + ')').join(' · ') + ' — עוגן-ד יכול-לחזור (blurtBroadcast קיים-בקוד · health-gate ייפתח)'
      : 'אף-צומת-ציבורי-לא-חי מה-6-שנבדקו — Blurt נשאר-מת-מתועד (כנות-אדומה קדושה)',
    ms: Date.now() - t0,
  };
  fs.writeFileSync(BLURT_OUT, JSON.stringify(res, null, 2) + '\n');
  log('BLURT: ' + res.verdict.slice(0, 140));
  return res;
}

(async () => {
  const leo = await leoProbe();
  const blurt = await blurtScan();
  log('done · LEO ' + (leo.leo && leo.leo.supply != null ? 'supply=' + leo.leo.supply : 'unavailable') + ' · BLURT alive=' + blurt.aliveCount + '/' + blurt.scanned);
})().catch((e) => { console.error('[probe106] FAIL: ' + (e && e.message)); process.exit(1); });
