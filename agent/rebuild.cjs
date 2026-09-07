#!/usr/bin/env node
/**
 * rebuild.cjs — Task 51: world reconstruction from public chain history ONLY.
 *
 * The claim: our entire economic world — SAOS balances, order book, fills,
 * AMM pool (reserves/LP/fees), DEX credits — is fully reproducible from the
 * PUBLIC history of a single account (the issuer). No private state, no
 * database, no trust. Anyone with RPC access can rebuild it.
 *
 * This script is an INDEPENDENT second implementation of the replay engine
 * (the first lives in src/lib/steem/saos-dex.ts, TypeScript). It walks the
 * issuer's history, replays every saos/v1 op in ascending order with the
 * same protocol rules, then compares its reconstructed world against the
 * live server snapshot. Two independent engines agreeing on the same public
 * input = the world is provably chain-carried.
 *
 * Read-only. No keys. Result → rebuild_result.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const STEEM_RPC = 'https://api.steemit.com';
const HIST_NODES = [STEEM_RPC, 'https://steemapi.boylikegirl.club', 'https://api.justyy.com'];
const ISSUER = 'headcorner';
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // server uses 14 — we go deeper, dedupe keeps it safe

function log(msg) { console.log('[' + new Date().toISOString() + '] rebuild: ' + msg); }
const r3 = (v) => Number(Number(v).toFixed(3));
const r6 = (v) => Number(Number(v).toFixed(6));

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(typeof json.error === 'string' ? json.error : json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) { reject(new Error('bad rpc: ' + data.slice(0, 100))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function num(s) { return Number(String(s ?? '').split(' ')[0]) || 0; }
function assetUnit(s) { return String(s ?? '').split(' ')[1] || ''; }

/* ------------------------------------------------------------------ *
 * 1) Corpus — issuer history, deep walk, freshest-node race
 * ------------------------------------------------------------------ */
async function fetchCorpus() {
  const pages = [];
  let lowest = -1;
  // page 0: multi-node race → freshest
  const settled = await Promise.allSettled(HIST_NODES.map((u) =>
    rpcV4(u, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ISSUER, -1, PAGE_SIZE], id: 1 })));
  let freshest = null, newestIdx = -1;
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !Array.isArray(s.value) || !s.value.length) continue;
    const pageNewest = s.value.reduce((m, [idx]) => Math.max(m, idx), -1);
    if (pageNewest > newestIdx) { newestIdx = pageNewest; freshest = s.value; }
  }
  if (freshest) { pages.push(freshest); lowest = freshest[0][0]; }
  for (let p = 1; p < MAX_PAGES && lowest > 0; p++) {
    try {
      const raw = await rpcV4(HIST_NODES[0], { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ISSUER, lowest - 1, PAGE_SIZE], id: 1 });
      if (!Array.isArray(raw) || !raw.length) break;
      pages.push(raw);
      lowest = raw.reduce((m, [idx]) => Math.min(m, idx), lowest);
    } catch (e) { log('page ' + p + ' failed: ' + e.message); break; }
  }
  const seen = new Set();
  const all = pages.flat().filter(([idx]) => (seen.has(idx) ? false : (seen.add(idx), true))).sort((a, b) => a[0] - b[0]);
  return { all, lowest, newestIdx, pagesScanned: pages.length };
}

function parseSaosJson(j) { try { return JSON.parse(String(j ?? '{}')); } catch (_) { return null; } }

/* ------------------------------------------------------------------ *
 * 2) Independent replay engine (same protocol rules, new implementation)
 * ------------------------------------------------------------------ */
function replay(all) {
  const saos = new Map(), locked = new Map(), credit = new Map(), creditLocked = new Map();
  const orders = new Map();
  const pools = new Map();
  const trades = [];
  let lastPrice = null, malformed = 0, invalidOps = 0;

  const addSaos = (a, v) => saos.set(a, r3((saos.get(a) ?? 0) + v));
  const addLocked = (a, v) => locked.set(a, r3((locked.get(a) ?? 0) + v));
  const addCredit = (a, v) => credit.set(a, r6((credit.get(a) ?? 0) + v));
  const addCreditLocked = (a, v) => creditLocked.set(a, r6((creditLocked.get(a) ?? 0) + v));

  for (const [idx, entry] of all) {
    const [type, value] = entry.op;

    if (type === 'transfer') {
      const from = String(value.from ?? '').toLowerCase();
      const to = String(value.to ?? '').toLowerCase();
      const memo = String(value.memo ?? '');
      const amt = num(value.amount);
      if (memo.startsWith('saos:escrow') && to === ISSUER && assetUnit(value.amount) === 'STEEM' && amt > 0) { addCredit(from, amt); continue; }
      if (memo.startsWith('saos:withdraw') && from === ISSUER && assetUnit(value.amount) === 'STEEM' && amt > 0) { addCredit((memo.split(':')[2] || to).toLowerCase(), -amt); continue; }
      continue;
    }
    if (type !== 'custom_json' || value?.id !== 'saos') continue;
    const payload = parseSaosJson(value.json);
    if (!payload || payload.protocol !== 'saos/v1') { malformed++; continue; }
    const action = String(payload.action ?? '');
    const time = entry.timestamp || entry.block;
    const txid = entry.trx_id ?? '';
    const account = String(payload.account ?? payload.from ?? ISSUER).toLowerCase();

    if (action === 'mint' || action === 'burn' || action === 'transfer') {
      const amount = r3(Number(payload.amount ?? 0));
      const to = String(payload.to ?? '').toLowerCase();
      if (!(amount > 0) || !Number.isFinite(amount)) { invalidOps++; continue; }
      if (action === 'mint') addSaos(to, amount);
      else if (action === 'burn') addSaos(account, -amount);
      else { addSaos(account, -amount); addSaos(to, amount); }
      continue;
    }

    if (action === 'order') {
      const oid = String(payload.oid ?? '');
      const side = payload.side === 'buy' ? 'buy' : payload.side === 'sell' ? 'sell' : null;
      const price = r6(Number(payload.price ?? 0));
      const amount = r3(Number(payload.amount ?? 0));
      if (!oid || !side || !(price > 0) || !(amount > 0) || orders.has(oid)) { invalidOps++; continue; }
      if (side === 'sell') {
        if ((saos.get(account) ?? 0) + 1e-9 < amount) { invalidOps++; continue; }
        addSaos(account, -amount); addLocked(account, amount);
      } else {
        const cost = r6(price * amount);
        if ((credit.get(account) ?? 0) + 1e-9 < cost) { invalidOps++; continue; }
        addCredit(account, -cost); addCreditLocked(account, cost);
      }
      orders.set(oid, { oid, side, owner: account, price, amount, filled: 0, status: 'open', placedTime: time });
      continue;
    }

    if (action === 'cancel') {
      const o = orders.get(String(payload.oid ?? ''));
      if (!o || o.status !== 'open' || o.owner !== account) { invalidOps++; continue; }
      if (o.side === 'sell') { const back = r3(o.amount - o.filled); addLocked(o.owner, -back); addSaos(o.owner, back); }
      else { const back = r6(o.price * (o.amount - o.filled)); addCreditLocked(o.owner, -back); addCredit(o.owner, back); }
      o.status = 'cancelled';
      continue;
    }

    if (action === 'fill') {
      const oid = String(payload.oid ?? '');
      const taker = String(payload.taker ?? account).toLowerCase();
      const amt = r3(Number(payload.amount ?? 0));
      const o = orders.get(oid);
      if (!o || o.status !== 'open' || !(amt > 0) || amt > o.amount - o.filled + 1e-9) { invalidOps++; continue; }
      if (o.side === 'sell') {
        const cost = r6(o.price * amt);
        if ((credit.get(taker) ?? 0) + 1e-9 < cost) { invalidOps++; continue; }
        addLocked(o.owner, -amt); addSaos(taker, amt); addCredit(taker, -cost); addCredit(o.owner, cost);
      } else {
        if ((saos.get(taker) ?? 0) + 1e-9 < amt) { invalidOps++; continue; }
        const cost = r6(o.price * amt);
        addSaos(taker, -amt); addSaos(o.owner, amt); addCreditLocked(o.owner, -cost); addCredit(taker, cost);
      }
      o.filled = r3(o.filled + amt);
      if (o.filled >= o.amount - 1e-9) o.status = 'filled';
      lastPrice = o.price;
      trades.push({ oid, side: o.side, maker: o.owner, taker, amount: amt, price: o.price });
      continue;
    }

    if (action === 'pool_init' || action === 'pool_add' || action === 'pool_swap' || action === 'pool_remove' || action === 'pool_lock') {
      const pair = String(payload.pair ?? 'SAOS:STEEM').toUpperCase();
      if (action === 'pool_init') {
        if (pools.has(pair)) { invalidOps++; continue; }
        const feeBps = Math.round(Number(payload.feeBps ?? 30));
        if (!(feeBps >= 0 && feeBps <= 1000)) { invalidOps++; continue; }
        pools.set(pair, { pair, feeBps, saos: 0, steem: 0, lpSupply: 0, swaps: 0, feesSaos: 0, feesSteem: 0, locked: 0, lp: new Map() });
        continue;
      }
      const p = pools.get(pair);
      if (!p) { invalidOps++; continue; }
      if (action === 'pool_add') {
        const sIn = r3(Number(payload.saosAmt ?? 0));
        const tIn = r6(Number(payload.steemAmt ?? 0));
        if (sIn < 0 || tIn < 0 || (sIn === 0 && tIn === 0)) { invalidOps++; continue; }
        if ((saos.get(account) ?? 0) + 1e-9 < sIn || (credit.get(account) ?? 0) + 1e-9 < tIn) { invalidOps++; continue; }
        let shares;
        if (p.lpSupply <= 1e-9) {
          if (sIn <= 0 || tIn <= 0) { invalidOps++; continue; }
          shares = r6(Math.sqrt(sIn * tIn));
        } else {
          const rS = sIn > 0 ? (sIn / p.saos) : Infinity;
          const rT = tIn > 0 ? (tIn / p.steem) : Infinity;
          const ratio = Math.min(rS, rT);
          if (!Number.isFinite(ratio) || ratio <= 0) { invalidOps++; continue; }
          shares = r6(ratio * p.lpSupply);
        }
        if (!(shares > 1e-9)) { invalidOps++; continue; }
        addSaos(account, -sIn); addCredit(account, -tIn);
        p.saos = r3(p.saos + sIn); p.steem = r6(p.steem + tIn);
        p.lpSupply = r6(p.lpSupply + shares);
        p.lp.set(account, r6((p.lp.get(account) ?? 0) + shares));
        continue;
      }
      if (action === 'pool_swap') {
        const taker = String(payload.taker ?? account).toLowerCase();
        const side = String(payload.side ?? '');
        const inAmt = Number(payload.inAmt ?? 0);
        const withFee = r6(inAmt * (1 - p.feeBps / 10000));
        if (!(inAmt > 0) || !(withFee > 0)) { invalidOps++; continue; }
        if (side === 'sell_saos') {
          if ((saos.get(taker) ?? 0) + 1e-9 < inAmt || p.steem <= 1e-9) { invalidOps++; continue; }
          const out = r6((p.steem * withFee) / (p.saos + withFee));
          if (!(out > 1e-6) || out >= p.steem) { invalidOps++; continue; }
          addSaos(taker, -r3(inAmt)); addCredit(taker, out);
          p.saos = r3(p.saos + inAmt); p.steem = r6(p.steem - out);
          p.feesSteem = r6(p.feesSteem + (r6(inAmt) - withFee));
        } else if (side === 'buy_saos') {
          if ((credit.get(taker) ?? 0) + 1e-9 < inAmt || p.saos <= 1e-9) { invalidOps++; continue; }
          const out = r3((p.saos * withFee) / (p.steem + withFee));
          if (!(out > 1e-6) || out >= p.saos) { invalidOps++; continue; }
          addCredit(taker, -inAmt); addSaos(taker, out);
          p.steem = r6(p.steem + inAmt); p.saos = r3(p.saos - out);
          p.feesSaos = r3(p.feesSaos + (r3(inAmt) - r3(withFee)));
        } else { invalidOps++; continue; }
        p.swaps += 1;
        continue;
      }
      if (action === 'pool_remove') {
        const burn = r6(Number(payload.lpAmt ?? 0));
        const have = p.lp.get(account) ?? 0;
        if (!(burn > 1e-9) || have + 1e-9 < burn || p.lpSupply + 1e-9 < burn) { invalidOps++; continue; }
        const sOut = r3((p.saos * burn) / p.lpSupply);
        const tOut = r6((p.steem * burn) / p.lpSupply);
        p.saos = r3(p.saos - sOut); p.steem = r6(p.steem - tOut);
        p.lpSupply = r6(p.lpSupply - burn);
        const left = r6(have - burn);
        if (left > 1e-9) p.lp.set(account, left); else p.lp.delete(account);
        addSaos(account, sOut); addCredit(account, tOut);
        continue;
      }
      // Task 53 — pool_lock: permanent-liquidity lock (parity with saos-dex.ts)
      if (action === 'pool_lock') {
        const have = p.lp.get(account) ?? 0;
        const pct = Math.min(Math.max(Number(payload.pct ?? 0), 0), 1);
        const burn = r6(have * pct);
        if (!(burn > 1e-9)) { invalidOps++; continue; }
        const left = r6(have - burn);
        if (left > 1e-9) p.lp.set(account, left); else p.lp.delete(account);
        p.locked = r6((p.locked ?? 0) + burn);
        continue;
      }
    }
    // ping / shard / fleet_ping / unknown → no economic state effect
  }

  // compose book
  const asks = [], bids = [];
  for (const o of orders.values()) {
    if (o.status !== 'open') continue;
    const row = { oid: o.oid, owner: o.owner, price: o.price, remaining: r3(o.amount - o.filled), placedTime: o.placedTime };
    (o.side === 'sell' ? asks : bids).push(row);
  }
  asks.sort((a, b) => a.price - b.price);
  bids.sort((a, b) => b.price - a.price);

  const supply = r3([...saos.values()].reduce((a, b) => a + b, 0) + [...locked.values()].reduce((a, b) => a + b, 0));
  const creditsTotal = r6([...credit.values()].reduce((a, b) => a + b, 0));
  return { asks, bids, pools: [...pools.values()], trades, lastPrice, malformed, invalidOps, supply, creditsTotal, opsReplayed: all.length };
}

/* ------------------------------------------------------------------ *
 * 3) Compare vs live server snapshot (its own independent engine)
 * ------------------------------------------------------------------ */
function fetchLocalApi(pathname, ms) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port: 3000, path: pathname, method: 'GET', family: 4, headers: { Accept: 'application/json' }, timeout: ms || 20000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
    req.end();
  });
}

function close(a, b, eps) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= (eps ?? 1e-6);
}

async function main() {
  log('rebuilding world from PUBLIC history of @' + ISSUER + ' …');
  const corpus = await fetchCorpus();
  log('corpus: ' + corpus.all.length + ' ops (idx ' + corpus.lowest + '→' + corpus.newestIdx + ', ' + corpus.pagesScanned + ' pages)');
  const w = replay(corpus.all);
  log('replayed: supply=' + w.supply + ' SAOS · asks=' + w.asks.length + ' bids=' + w.bids.length + ' · pools=' + w.pools.length + ' · trades=' + w.trades.length + ' · malformed=' + w.malformed + ' invalid=' + w.invalidOps);

  const snap = await fetchLocalApi('/api/ops/saos/dex?username=' + ISSUER, 25000);
  const matches = [];
  const M = (name, ok, detail) => { matches.push({ name, ok, detail }); log((ok ? 'MATCH ' : 'DIFF  ') + name + ' — ' + detail); };

  if (!snap) {
    M('server snapshot reachable', false, 'GET /api/ops/saos/dex failed — comparison impossible this run');
  } else {
    M('bestAsk', close(w.asks[0]?.price, snap.stats.bestAsk, 1e-9), 'replay=' + w.asks[0]?.price + ' server=' + snap.stats.bestAsk);
    M('bestBid', close(w.bids[0]?.price, snap.stats.bestBid, 1e-9), 'replay=' + w.bids[0]?.price + ' server=' + snap.stats.bestBid);
    const myAsks = w.asks.map((a) => a.oid + '@' + a.price + ':' + a.remaining).join('|');
    const svAsks = (snap.book.asks || []).map((a) => a.oid + '@' + a.price + ':' + a.remaining).join('|');
    M('book.asks identical', myAsks === svAsks, myAsks.slice(0, 110) || '(empty)');
    const myBids = w.bids.map((a) => a.oid + '@' + a.price + ':' + a.remaining).join('|');
    const svBids = (snap.book.bids || []).map((a) => a.oid + '@' + a.price + ':' + a.remaining).join('|');
    M('book.bids identical', myBids === svBids, myBids.slice(0, 110) || '(empty)');
    const wp = w.pools[0], sp = (snap.pools || [])[0];
    M('pool reserves (saos)', close(wp?.saos, sp?.saos, 1e-9), 'replay=' + wp?.saos + ' server=' + sp?.saos);
    M('pool reserves (steem)', close(wp?.steem, sp?.steem, 1e-9), 'replay=' + wp?.steem + ' server=' + sp?.steem);
    M('pool lpSupply', close(wp?.lpSupply, sp?.lpSupply, 1e-9), 'replay=' + wp?.lpSupply + ' server=' + sp?.lpSupply);
    M('pool swaps count', wp?.swaps === sp?.swaps, 'replay=' + wp?.swaps + ' server=' + sp?.swaps);
    M('pool fees captured', close(wp?.feesSteem, sp?.feesSteem, 1e-9) && close(wp?.feesSaos, sp?.feesSaos, 1e-9), 'replay=' + wp?.feesSteem + '/' + wp?.feesSaos + ' server=' + sp?.feesSteem + '/' + sp?.feesSaos);
    M('trades total', w.trades.length === snap.stats.tradesTotal, 'replay=' + w.trades.length + ' server=' + snap.stats.tradesTotal);
    M('last price', close(w.lastPrice, snap.stats.lastPrice, 1e-9), 'replay=' + w.lastPrice + ' server=' + snap.stats.lastPrice);
  }

  const passed = matches.filter((m) => m.ok).length;
  const result = {
    at: new Date().toISOString(),
    issuer: ISSUER,
    corpus: { ops: corpus.all.length, lowestIdx: corpus.lowest, newestIdx: corpus.newestIdx, pages: corpus.pagesScanned },
    replay: { supply: w.supply, creditsTotal: w.creditsTotal, bestAsk: w.asks[0]?.price ?? null, bestBid: w.bids[0]?.price ?? null, asks: w.asks.length, bids: w.bids.length, pools: w.pools.map((p) => ({ pair: p.pair, saos: p.saos, steem: p.steem, lpSupply: p.lpSupply, swaps: p.swaps, feesSaos: p.feesSaos, feesSteem: p.feesSteem, lps: [...p.lp.entries()].map(([account, shares]) => ({ account, shares })) })), trades: w.trades.length, lastPrice: w.lastPrice, malformed: w.malformed, invalidOps: w.invalidOps, opsReplayed: w.opsReplayed },
    comparison: matches,
    passed,
    total: matches.length,
    verdict: passed + '/' + matches.length,
    allPass: matches.length > 0 && passed === matches.length,
  };
  fs.writeFileSync(path.join(__dirname, 'rebuild_result.json'), JSON.stringify(result, null, 2) + '\n');
  log('VERDICT ' + result.verdict + ' → rebuild_result.json');
  if (!result.allPass) process.exit(2);
}

main().catch((e) => { log('FATAL ' + (e.message || e)); process.exit(1); });
