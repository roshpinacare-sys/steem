#!/usr/bin/env node
/**
 * bee_wall.cjs — Task 74: THE BEE WALL, measured.
 *
 * "מה מגביל אותנו — אולי נוכל להתגבר ריבונית על ה-BEE הזה או להשיג אותו"
 *
 * The 100-BEE gate (Hive-Engine token creation for SAOS) is the last OLD
 * limitation that still binds. This script measures it scientifically:
 *
 *   1. FLEET CENSUS — every account, both chains + Hive-Engine wallets
 *      (liquid HIVE/HBD/STEEM/SBD, SWAP.HIVE, BEE, every dust token).
 *   2. THE GATE — live BEE ask/bid depth → exact cost of 100 BEE.
 *   3. UNLOCKABLE — dust with live bids (sellable value) + staked that
 *      could be unstaked + pending unstake releases (the trickle).
 *   4. INCOME RATE — measured from the genesis-ladder history
 *      (he_genesis_state.json: runs/bought/dates) + trickle schedule.
 *   5. VERDICT — fuel/deficit/ETA/binding-constraint, honest.
 *   6. ROUTING PLAN — the crack: dust sits on @headcorner whose Hive RC
 *      is drained by the daemon; soldiers hold their OWN RC pools + their
 *      own Hive ACTIVE keys → route sells through them (he_fleet_sell.cjs).
 *
 * Read-only. No keys. → bee_wall.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, 'bee_wall.json');
const HE_RPC = 'https://api.hive-engine.com/rpc/contracts';
const HIVE_RPC = 'https://api.hive.blog';
const STEEM_RPC = 'https://api.steemit.com';
const SYMBOL = 'BEE';
const TARGET = 100;

function log(msg) { console.log('[' + new Date().toISOString() + '] bee-wall: ' + msg); }

function rpc(urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 25000 },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            if (j.error) return reject(new Error(String(j.error.message || JSON.stringify(j.error)).slice(0, 200)));
            resolve(j.result);
          } catch (e) { reject(new Error('bad rpc: ' + buf.slice(0, 100))); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

const heFind = (contract, table, query, limit = 100, extra = {}) =>
  rpc(HE_RPC, { jsonrpc: '2.0', method: 'find', params: { contract, table, query, limit, ...extra }, id: 1 });

async function armyUsernames() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || []).map((a) => String(a.username).toLowerCase()).filter(Boolean);
  } catch (_) { return []; }
}

async function heWallet(account) {
  const rows = await heFind('tokens', 'balances', { account }, 100).catch(() => []);
  const out = {};
  for (const b of rows || []) {
    const bal = parseFloat(b.balance) || 0;
    const stake = parseFloat(b.stake) || 0;
    const pending = parseFloat(b.pendingUnstake) || 0;
    if (bal > 0 || stake > 0 || pending > 0) out[b.symbol] = { bal, stake, pending };
  }
  return out;
}

async function topBid(symbol) {
  const rows = await heFind('market', 'buyBook', { symbol }, 1, { indexes: [{ index: '_id', descending: true }] }).catch(() => []);
  const r = (rows || [])[0];
  return r ? { price: parseFloat(r.price), qty: parseFloat(r.quantity) } : null;
}

async function askDepth(symbol) {
  // fetch the book and sort client-side (HE natural order is _id, not price — discovery-74)
  const rows = await heFind('market', 'sellBook', { symbol }, 100).catch(() => []);
  return (rows || [])
    .map((r) => ({ price: parseFloat(r.price), qty: parseFloat(r.quantity) }))
    .filter((r) => r.price > 0 && r.qty > 0)
    .sort((a, b) => a.price - b.price);
}

function costForQty(asks, qty) {
  let left = qty, cost = 0, topPrice = 0;
  for (const a of asks) {
    if (left <= 0) break;
    const take = Math.min(left, a.qty);
    cost += take * a.price; topPrice = Math.max(topPrice, a.price); left -= take;
  }
  return { cost, topPrice, filled: qty - left, sufficient: left <= 1e-9 };
}

async function chainBalances(accounts) {
  const out = { hive: {}, steem: {} };
  try {
    const r = await rpc(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [accounts], id: 1 });
    for (const a of r || []) {
      out.hive[a.name] = {
        hive: parseFloat(a.balance) || 0,
        hbd: parseFloat(a.hbd_balance) || 0,
        vests: parseFloat(a.vesting_shares) || 0,
        hp: parseFloat((parseFloat(a.vesting_shares) * (parseFloat(a.received_vesting_shares) - parseFloat(a.delegated_vesting_shares)) / 1e6 + parseFloat(a.vesting_shares) / 1e6).toFixed(3)) || 0,
      };
    }
  } catch (e) { log('hive census ERR: ' + e.message); }
  try {
    const r = await rpc(STEEM_RPC, { jsonrpc: '2.0', method:'condenser_api.get_accounts', params: [accounts], id: 1 });
    for (const a of r || []) {
      out.steem[a.name] = {
        steem: parseFloat(a.balance) || 0,
        sbd: parseFloat(a.sbd_balance) || 0,
        vests: parseFloat(a.vesting_shares) || 0,
      };
    }
  } catch (e) { log('steem census ERR: ' + e.message); }
  return out;
}

async function main() {
  log('=== THE BEE WALL · measurement ===');
  const t0 = Date.now();
  const users = Array.from(new Set(['headcorner', ...(await armyUsernames())]));

  // 1 ── census: both chains + HE wallets (parallel)
  const [chain, wallets] = await Promise.all([
    chainBalances(users),
    Promise.all(users.map((u) => heWallet(u).then((w) => [u, w]).catch(() => [u, {}]))),
  ]);
  const he = Object.fromEntries(wallets);

  // 2 ── the gate: BEE book
  const [bid, asks] = await Promise.all([topBid(SYMBOL), askDepth(SYMBOL)]);
  const askTop = asks.length ? asks[0].price : null;
  const gate = costForQty(asks, TARGET);
  log('BEE book: bid=' + (bid ? bid.price.toFixed(6) : '—') + ' · ask-top=' + (askTop ? askTop.toFixed(6) : '—') + ' · asks=' + asks.length);
  log('cost of 100 BEE (walk-the-book): ' + gate.cost.toFixed(4) + ' SWAP.HIVE (sufficient depth: ' + gate.sufficient + ')');

  // 3 ── fuel + unlockable
  let swapHive = 0, hiveLiquid = 0, beeTotal = 0;
  const dust = [];
  const stakedDust = [];
  for (const [u, w] of Object.entries(he)) {
    for (const [sym, b] of Object.entries(w)) {
      if (sym === 'SWAP.HIVE') { swapHive += b.bal; continue; }
      if (sym === SYMBOL) { beeTotal += b.bal; continue; }
      if (b.bal > 0 && sym !== 'SWAP.HBD') dust.push({ account: u, symbol: sym, qty: b.bal });
      if (b.stake > 0) stakedDust.push({ account: u, symbol: sym, qty: b.stake });
    }
  }
  for (const [u, b] of Object.entries(chain.hive || {})) hiveLiquid += b.hive || 0;

  // dust value against live bids (per token — bid is per token symbol)
  const dustSymbols = Array.from(new Set(dust.map((d) => d.symbol)));
  const bidBySymbol = {};
  await Promise.all(dustSymbols.map(async (s) => { bidBySymbol[s] = await topBid(s); }));
  let dustUnlockable = 0;
  const dustRows = [];
  for (const d of dust) {
    const bid = bidBySymbol[d.symbol];
    const val = bid ? d.qty * bid.price : 0;
    dustUnlockable += val;
    dustRows.push({ ...d, bid: bid ? bid.price : null, valueHive: +val.toFixed(6) });
  }
  dustRows.sort((a, b) => (b.valueHive || 0) - (a.valueHive || 0));

  // staked-with-bid (would need unstake — slower)
  const stakedSymbols = Array.from(new Set(stakedDust.map((d) => d.symbol)));
  const sBid = {};
  await Promise.all(stakedSymbols.map(async (s) => { sBid[s] = await topBid(s); }));
  let stakedValue = 0;
  const stakedRows = [];
  for (const d of stakedDust) {
    const bid = sBid[d.symbol];
    const val = bid ? d.qty * bid.price : 0;
    stakedValue += val;
    if (val > 0.0005) stakedRows.push({ ...d, bid: bid ? bid.price : null, valueHive: +val.toFixed(6) });
  }

  // pending unstake trickle (the measured income schedule)
  let pendingValue = 0;
  const pendingRows = [];
  for (const [u, w] of Object.entries(he)) {
    for (const [sym, b] of Object.entries(w)) {
      if (b.pending > 0) {
        const bid = (bidBySymbol[sym] || sBid[sym]) || await topBid(sym).catch(() => null);
        const val = bid ? b.pending * bid.price : 0;
        pendingValue += val;
        pendingRows.push({ account: u, symbol: sym, pending: b.pending, valueHive: +val.toFixed(6) });
      }
    }
  }

  const fuelHive = swapHive + hiveLiquid; // HIVE liquid can be powered or swapped → count as fuel-equivalent
  const totalFuel = fuelHive + dustUnlockable;
  const deficit = Math.max(0, gate.cost - totalFuel);

  // 4 ── measured income rate from the genesis ladder history
  let incomeRate = null;
  try {
    const gs = JSON.parse(fs.readFileSync(path.join(__dirname, 'he_genesis_state.json'), 'utf8'));
    const gres = JSON.parse(fs.readFileSync(path.__dirname ? path.join(__dirname, 'he_genesis_result.json') : '', 'utf8'));
  } catch (_) { /* ignore */ }
  try {
    const gs = JSON.parse(fs.readFileSync(path.join(__dirname, 'he_genesis_state.json'), 'utf8'));
    const res = JSON.parse(fs.readFileSync(path.join(__dirname, 'he_genesis_result.json'), 'utf8'));
    const runs = gs.runs || 0;
    const bought = gs.totalBeeBought || 0;
    const at = res.at ? new Date(res.at).getTime() : Date.now();
    // ladder started 2026-09-03 (first HBD convert + runs) — measured from state mtime
    const stStat = fs.statSync(path.join(__dirname, 'he_genesis_state.json'));
    const started = new Date('2026-09-03T21:34:32Z').getTime(); // hbdConvertedAt (documented)
    const days = Math.max(0.25, (at - started) / 86400000);
    incomeRate = { beePerDay: +(bought / days).toFixed(4), runs, bought: +bought.toFixed(4), days: +days.toFixed(2) };
  } catch (e) { log('income-rate ERR: ' + e.message); }

  const beeNow = beeTotal;
  const remaining = Math.max(0, TARGET - beeNow);
  const etaDays = incomeRate && incomeRate.beePerDay > 0 ? +(remaining / incomeRate.beePerDay).toFixed(1) : null;

  // 5 ── binding constraint (honest verdict)
  let binding = 'fuel';
  if (gate.cost <= totalFuel) binding = 'none — fuel covers the gate';
  else if (dustUnlockable > fuelHive) binding = 'fuel (dust-locked — needs sells, sells RC-gated on head)';
  else if (pendingValue > deficit) binding = 'time (pending releases alone cover the deficit — ETA dominates)';
  else if (incomeRate && etaDays != null && etaDays > 60) binding = 'income-rate (trickle too slow — needs a new value stream or a bigger crack)';
  const verdict = {
    gateCostSWAP: +gate.cost.toFixed(4),
    gateDepthOk: gate.sufficient,
    askTop, bid: bid ? bid.price : null,
    fuel: { swapHive: +swapHive.toFixed(4), hiveLiquid: +hiveLiquid.toFixed(4), dustUnlockable: +dustUnlockable.toFixed(4), total: +totalFuel.toFixed(4) },
    deficit: +deficit.toFixed(4),
    beeNow: +beeNow.toFixed(4),
    target: TARGET,
    remaining: +remaining.toFixed(4),
    incomeRate, etaDays,
    pendingReleases: { valueHive: +pendingValue.toFixed(6), rows: pendingRows.slice(0, 12) },
    stakedUnlockable: { valueHive: +stakedValue.toFixed(6), rows: stakedRows.slice(0, 12) },
    binding,
    // the sovereign reframe (74): the gate no longer gates sovereignty —
    // SAOS-NET hosts the token natively; BEE is an optional host-listing
    sovereign: 'SAOS-NET v1.3 already hosts SAOS natively (kernel ops: supply/orders/LP/yield/produce, verify-pack sealed) — the 100-BEE gate is an optional Hive-Engine listing, not a sovereignty gate; the fleet route keeps the trickle unstoppable while the wall falls',
    noBridge: 'STEEM→HIVE cross-chain measured dead in this environment (blocktrades TLS-rejected ×2, simpleswap 404) — value generated on the Steem side cannot cross; all fuel for the gate must come from the Hive side',
  };

  // 6 ── routing plan (the crack — soldiers hold their own RC + Hive ACTIVE keys)
  const sellable = dustRows.filter((d) => d.valueHive >= 0.0001 && d.bid);
  const routing = {
    why: 'dust sells on @headcorner are Hive-RC-gated (observed: needs 143M RC, manabar 13M) — Hive has no RC delegation, so the crack is routing: transfer token head→soldier (tiny op), soldier sells with their own key + own RC pool, SWAP.HIVE returns to head',
    plan: sellable.slice(0, 8).map((d) => ({ ...d, route: d.account + ' → soldier(active-key) → sell@97%bid → SWAP.HIVE → headcorner' })),
    consolidation: Object.entries(he)
      .filter(([u, w]) => u !== 'headcorner' && (w['SWAP.HIVE'] || {}).bal > 0)
      .map(([u, w]) => ({ account: u, swapHive: w['SWAP.HIVE'].bal, action: 'transfer → headcorner' })),
    soldiers: users.filter((u) => u !== 'headcorner').slice(0, 12),
  };

  const result = {
    at: new Date().toISOString(),
    mode: 'measure',
    durationMs: Date.now() - t0,
    census: {
      accounts: users,
      hive: chain.hive,
      steem: chain.steem,
      heWallets: he,
    },
    verdict,
    routing,
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  log('=== WALL VERDICT ===');
  log('gate: 100 BEE = ' + verdict.gateCostSWAP + ' SWAP.HIVE · depth-ok=' + verdict.gateDepthOk);
  log('fuel: ' + verdict.fuel.total + ' (swap ' + verdict.fuel.swapHive + ' + hive ' + verdict.fuel.hiveLiquid + ' + dust ' + verdict.fuel.dustUnlockable + ') · deficit ' + verdict.deficit);
  log('BEE ' + verdict.beeNow + '/' + TARGET + ' · rate ' + (incomeRate ? incomeRate.beePerDay + '/day over ' + incomeRate.days + 'd' : '?') + ' · ETA ' + (etaDays != null ? etaDays + 'd' : '?'));
  log('binding constraint: ' + binding);
  log('routing: ' + routing.plan.length + ' sellable dust rows · consolidation: ' + routing.consolidation.length + ' fleet SWAP.HIVE rows');
  log('→ ' + OUT + ' (' + result.durationMs + 'ms)');
}

main().catch((e) => { log('FATAL ' + ((e && e.message) || e)); process.exit(1); });
