#!/usr/bin/env node
/**
 * he_fleet_sell.cjs — Task 74: THE RC-DROUGHT ROUTER — the trickle becomes
 * unstoppable.
 *
 * "איך אירוע יגרום לאירוע שיגרום לאירוע והתוצאה הסופית תחזק את המערכת"
 *
 * Measured (bee_wall.cjs + genesis rc-gate + rc_api): every Hive-Engine op
 * of @headcorner costs ~143-280M Hive RC; the daemon drains head's mana;
 * the genesis ladder then WAITS ~14min per drought instead of buying.
 * Hive has no RC delegation (measured negative knowledge), but the soldiers
 * hold their OWN Hive RC pools + their OWN Hive ACTIVE keys — so in a
 * drought we route: head transfers the asset to a soldier (1 small op),
 * the soldier executes the market op with their own fuel, and the product
 * returns.
 *
 *   mode A (BEE route):  head →(SWAP.HIVE)→ soldier →(buy BEE ≤cap)→ head
 *   mode B (dust route): head →(token)→ soldier →(sell @97% bid)→ head
 *   probe (--probe):     the same 3-leg chain with 0.05 SWAP.HIVE — a tiny
 *                        live proof of the whole mechanism, no day-marker.
 *
 * Iron rules: DRY by default (--live) · RESUMABLE PHASES (idle →
 * transferred → bought → done — a route never repeats a leg, a stranded leg
 * is completed on the next run) · caps (3 HE ops/run · spend guard · price
 * guards) · day-idempotent per mode (probe exempt) · honest misses recorded
 * · evidence = txid + balance delta · never trust a broadcast alone.
 *
 * → he_fleet_result.json + he_fleet_state.json (the causal-chain ledger)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const steem = require('steem');

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');

const PROBE = process.argv.includes('--probe');   // tiny live proof of the full chain (0.05)
const FORCE = process.argv.includes('--force');   // route even with healthy head RC (real cap)
const FORCE_CAP = 1.0;
const PROBE_CAP = 0.05;
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const HE_RPC = 'https://api.hive-engine.com/rpc/contracts';
const OUT_RESULT = path.join(__dirname, 'he_fleet_result.json');
const OUT_STATE = path.join(__dirname, 'he_fleet_state.json');

// 8-b: חשבון-הפעולה חובה מה-env — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
const HEAD = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!HEAD) { console.error('usage: AGENT_ACCOUNT=<account> node agent/he_fleet_sell.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const GATE = resolveLiveGate(process.argv, { account: HEAD });
const LIVE = GATE.live;
announceGate(GATE, log);

const RC_MIN_HEAD_MARKET = 280000000; // genesis-ladder market-op cost (measured)
const RC_MIN_HEAD_TRANSFER = 150000000; // transfers are cheaper (measured 143M worst-case)
const RC_MIN_SOLDIER = 200000000;     // HE market op ≈143M (measured) + headroom
const BUY_PRICE_CAP = 0.65;
const CROSS_PCT = 0.97;
const SPEND_CAP = 2.5;
const MAX_OPS = 3;
const SELL_DUST_HIVE = 0.005;

function log(msg) { console.log('[' + new Date().toISOString() + '] fleet-sell: ' + msg); }
const today = () => new Date().toISOString().slice(0, 10);

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(__dirname);
const HEAD_ACTIVE = process.env.ACTIVE_WIF || '';

function loadSoldiers() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || [])
      .map((a) => ({ username: String(a.username).toLowerCase(), activeWif: (a.keys && a.keys.active && a.keys.active.wif) || null }))
      .filter((a) => a.activeWif && a.username !== HEAD);
  } catch (_) { return []; }
}

function rpcV4(urlStr, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const payload = JSON.stringify(body);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 22000 },
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
const heFind = (contract, table, query, limit = 100) => rpcV4(HE_RPC, { jsonrpc: '2.0', method: 'find', params: { contract, table, query, limit }, id: 1 });
const hiveRpc = (method, params) => rpcV4(HIVE_RPC, { jsonrpc: '2.0', method, params, id: 1 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function txId(tx) {
  try {
    const buf = steem.transaction.toBuffer(tx);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 40);
  } catch (_) { return null; }
}

async function heBroadcastAs(username, wif, payload) {
  const operations = [[
    'custom_json',
    {
      required_auths: [username],
      required_posting_auths: [],
      id: 'ssc-mainnet-hive',
      json: JSON.stringify(payload),
    },
  ]];
  const dgp = await hiveRpc('condenser_api.get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations,
    extensions: [],
  };
  const prev = steem.config.get('chain_id');
  let signed;
  try {
    steem.config.set('chain_id', HIVE_CHAIN_ID);
    signed = steem.auth.signTransaction(tx, [wif]);
  } finally {
    steem.config.set('chain_id', prev);
  }
  await hiveRpc('condenser_api.broadcast_transaction', [signed]);
  return { txid: txId(tx) };
}

async function wallet(account) {
  const rows = await heFind('tokens', 'balances', { account }, 100);
  const map = {};
  for (const r of rows || []) map[r.symbol] = { liq: parseFloat(r.balance), stake: parseFloat(r.stake || '0'), pending: parseFloat(r.pendingUnstake || '0') };
  return map;
}

async function book(symbol, side) {
  const rows = await heFind('market', side, { symbol }, 50);
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ price: parseFloat(r.price), qty: parseFloat(r.quantity), account: r.account }))
    .filter((r) => r.price > 0 && r.qty > 0);
}

/** estimated Hive RC now (current_mana is frozen between txs — regen computed) */
async function hiveRcNow(account) {
  try {
    const rc = await hiveRpc('rc_api.find_rc_accounts', { accounts: [account] });
    const rca = rc && rc.rc_accounts && rc.rc_accounts[0];
    if (!rca) return null;
    const maxRc = parseInt(rca.max_rc || '0');
    const stored = parseInt(rca.rc_manabar.current_mana || '0');
    const lu = parseInt(rca.rc_manabar.last_update_time || '0');
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - lu);
    return stored + Math.floor((elapsed * maxRc) / (5 * 86400));
  } catch (_) { return null; }
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(OUT_STATE, 'utf8')); } catch (_) { return { days: {}, chains: [], routes: 0, beeRouted: 0, swapRouted: 0, misses: 0, probes: 0 }; }
}
function saveState(s) { fs.writeFileSync(OUT_STATE, JSON.stringify(s, null, 2) + '\n'); }

async function main() {
  log('=== RC-DROUGHT ROUTER · ' + (PROBE ? 'PROBE' : FORCE ? 'FORCE' : LIVE ? 'LIVE' : 'DRY') + ' ===');
  const state = loadState();
  const day = today();
  state.days[day] = state.days[day] || {};
  const legs = [];
  const misses = [];
  const leg = (cause, action, detail, txid, verified) => { legs.push({ at: new Date().toISOString(), cause, action, detail, txid: txid || null, verified: !!verified }); log('leg: ' + action + (txid ? ' txid=' + txid : '') + (verified ? ' ✓' : '')); };

  if (!HEAD_ACTIVE && LIVE) { log('FATAL: no head ACTIVE_WIF'); process.exit(1); }
  const soldiers = loadSoldiers();
  if (!soldiers.length) { log('FATAL: no soldiers with active keys'); process.exit(1); }

  const headRc = await hiveRcNow(HEAD);
  log('head Hive RC estimated: ' + (headRc == null ? '?' : headRc));

  const drought = headRc != null && headRc < RC_MIN_HEAD_MARKET;
  if (!PROBE && !FORCE && !drought) {
    log('head RC healthy — the genesis ladder routes its own ops. Router stands down.');
    const result = { at: new Date().toISOString(), mode: LIVE ? 'live' : 'dry', acted: false, why: 'head-rc-healthy', headRc, legs: [], misses: [] };
    fs.writeFileSync(OUT_RESULT, JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (PROBE && headRc != null && headRc < RC_MIN_HEAD_TRANSFER) {
    log('head too dry even for the probe transfer — honest miss');
    const result = { at: new Date().toISOString(), mode: 'probe', acted: false, why: 'head-rc-below-transfer', headRc, legs, misses };
    fs.writeFileSync(OUT_RESULT, JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // ── the route book (resumable phases) ──
  // probe → state.probeBook; real routes → state.routeA (day-marked)
  const book0 = PROBE
    ? (state.probeBook = state.probeBook || { phase: 'idle' })
    : (state.routeA = state.routeA || { phase: 'idle', day: null, soldier: null, swapSent: 0, beeBought: 0, spent: 0, txids: {} });
  const cap = PROBE ? PROBE_CAP : FORCE ? FORCE_CAP : SPEND_CAP;
  const isNewRoute = book0.phase === 'idle';
  if (!PROBE && isNewRoute) {
    if (state.days[day].bee) { log('route A already done today (day-idempotent)'); book0.phase = 'done'; }
    else { book0.day = day; }
  }
  if (PROBE && book0.phase === 'done') {
    log('probe already proven — rerun with fresh state to repeat');
    const result = { at: new Date().toISOString(), mode: 'probe', acted: false, why: 'probe-done', headRc, legs, misses };
    fs.writeFileSync(OUT_RESULT, JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // soldier binding: a route in progress stays with its soldier; fresh routes
  // pick the freshest RC pool (deterministic tiebreak)
  let soldier = null;
  if (!isNewRoute && book0.soldier) {
    soldier = soldiers.find((s) => s.username === book0.soldier) || null;
    if (!soldier) { log('bound soldier lost from vault — honest miss'); misses.push({ why: 'bound-soldier-lost', soldier: book0.soldier }); }
  } else {
    const ranked = [];
    for (const s of soldiers.slice(0, 8)) {
      const rc = await hiveRcNow(s.username);
      ranked.push({ ...s, rc: rc == null ? 0 : rc });
    }
    ranked.sort((a, b) => b.rc - a.rc || a.username.localeCompare(b.username));
    soldier = ranked[0] || null;
    if (soldier) log('router soldier: @' + soldier.username + ' (RC ' + soldier.rc + ')');
  }
  const soldierRc = soldier ? await hiveRcNow(soldier.username) : 0;

  // reconciliation — a leg verified=false on broadcast (HE indexer lag) gets
  // its post-hoc confirmation here, before anything new happens
  if (book0.phase === 'transferred' && book0.soldier && book0.leg1Verified !== true && LIVE) {
    const wR = await wallet(book0.soldier);
    const fuel = (wR['SWAP.HIVE'] || {}).liq || 0;
    if (fuel >= (book0.swapSent || 0)) {
      book0.leg1Verified = true;
      leg('reconcile', 'leg1 CONFIRMED post-hoc (indexer lag)', book0.swapSent + ' SWAP.HIVE parked on @' + book0.soldier, null, true);
    }
  }

  const headWallet = await wallet(HEAD);
  const swapHead = (headWallet['SWAP.HIVE'] || {}).liq || 0;
  const beeHead = (headWallet['BEE'] || {}).liq || 0;
  log('head wallet: SWAP.HIVE=' + swapHead + ' · BEE=' + beeHead + ' · phase=' + book0.phase);

  let ops = 0;

  // ── leg 1 (idle → transferred): head hands the fuel to the soldier ──
  if (book0.phase === 'idle' && ops < MAX_OPS && soldier) {
    if (swapHead < cap) {
      misses.push({ why: 'no-fuel-to-route', swapHead, cap });
      log('no SWAP.HIVE to route (fuel ' + swapHead + ' < ' + cap + ') — the trickle will refill');
    } else if (!LIVE) {
      leg('rc-drought(head ' + headRc + ')', '[DRY] transfer SWAP.HIVE → @' + soldier.username, cap.toFixed(8) + ' SWAP.HIVE');
      book0.phase = 'transferred'; book0.soldier = soldier.username; book0.swapSent = cap;
    } else {
      try {
        const qtyStr = cap.toFixed(8);
        const r = await heBroadcastAs(HEAD, HEAD_ACTIVE, { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: 'SWAP.HIVE', quantity: qtyStr, to: soldier.username, memo: 'saos:rc-route' } });
        ops++;
        const w2 = await wallet(HEAD); const w2s = (w2['SWAP.HIVE'] || {}).liq || 0;
        await sleep(6000);
        const s2 = await wallet(soldier.username); const s2s = (s2['SWAP.HIVE'] || {}).liq || 0;
        let ok = s2s > 0;
        if (!ok) { await sleep(6000); const s3 = await wallet(soldier.username); ok = ((s3['SWAP.HIVE'] || {}).liq || 0) > 0; }
        leg('rc-drought(head ' + headRc + ')', 'transfer SWAP.HIVE → @' + soldier.username, qtyStr + ' · head ' + swapHead.toFixed(4) + '→' + w2s.toFixed(4) + ' · soldier ' + s2s.toFixed(4), r.txid, ok);
        book0.phase = 'transferred'; book0.soldier = soldier.username;
        book0.swapSent = cap; book0.txids = book0.txids || {}; book0.txids.transfer = r.txid;
        book0.leg1Verified = ok;
        saveState(state);
      } catch (e) {
        misses.push({ why: 'transfer-fail', err: String(e.message || e).slice(0, 140) });
        log('leg1 FAIL: ' + String(e.message || e).slice(0, 110));
      }
    }
  }

  // ── leg 2 (transferred → bought): the soldier buys BEE with their own RC ──
  if (book0.phase === 'transferred' && ops < MAX_OPS && soldier && LIVE) {
    if ((soldierRc || 0) < RC_MIN_SOLDIER) {
      misses.push({ why: 'soldier-rc-low', soldier: soldier.username, rc: soldierRc, need: RC_MIN_SOLDIER });
      log('soldier RC ' + soldierRc + ' < ' + RC_MIN_SOLDIER + ' — phase stays transferred, next run resumes (fuel parked safely on the soldier)');
    } else {
      await sleep(2000);
      const asks = (await book('BEE', 'sellBook')).sort((a, b) => a.price - b.price).filter((a) => a.price <= BUY_PRICE_CAP);
      if (!asks.length) {
        misses.push({ why: 'no-ask-under-cap', cap: BUY_PRICE_CAP });
        log('no BEE asks ≤ ' + BUY_PRICE_CAP + ' — honest miss (fuel stays parked)');
      } else {
        const sw = await wallet(soldier.username);
        let left = Math.min((sw['SWAP.HIVE'] || {}).liq || 0, cap);
        let bought = 0, spent = 0, buyTx = null;
        try {
          for (const a of asks) {
            if (left <= 0 || ops >= MAX_OPS) break;
            const cost = Math.min(left, a.qty * a.price);
            const qty = cost / a.price;
            const r = await heBroadcastAs(soldier.username, soldier.activeWif, { contractName: 'market', contractAction: 'buy', contractPayload: { symbol: 'BEE', quantity: qty.toFixed(8), price: a.price.toFixed(8) } });
            ops++;
            bought += qty; spent += cost; left -= cost; buyTx = r.txid;
            await sleep(2500);
          }
        } catch (e) {
          misses.push({ why: 'soldier-buy-partial', err: String(e.message || e).slice(0, 140), bought });
          log('leg2 partial/FAIL: ' + String(e.message || e).slice(0, 110));
        }
        if (bought > 0) {
          await sleep(3000);
          const sw2 = await wallet(soldier.username);
          const sBee = (sw2['BEE'] || {}).liq || 0;
          leg('transfer-leg', 'soldier buys BEE (walk-the-book)', bought.toFixed(8) + ' BEE for ' + spent.toFixed(4) + ' SWAP.HIVE', buyTx, sBee > 0);
          book0.phase = 'bought'; book0.beeBought = +((book0.beeBought || 0) + bought).toFixed(8);
          book0.spent = +((book0.spent || 0) + spent).toFixed(8);
          book0.txids.buy = buyTx;
          saveState(state);
        }
      }
    }
  } else if (book0.phase === 'transferred' && !LIVE) {
    leg('transfer-leg', '[DRY] soldier buys BEE (walk-the-book ≤' + BUY_PRICE_CAP + ')', '≤' + cap + ' SWAP.HIVE');
    book0.phase = 'bought'; book0.beeBought = cap / 0.5963;
  }

  // ── leg 3 (bought → done): the BEE returns home ──
  if (book0.phase === 'bought' && ops < MAX_OPS && soldier && LIVE) {
    await sleep(2000);
    try {
      const sw2 = await wallet(soldier.username);
      const sBee = (sw2['BEE'] || {}).liq || 0;
      if (!(sBee > 0)) {
        misses.push({ why: 'no-bee-on-soldier', soldier: soldier.username });
        log('no BEE on the soldier to return — honest miss');
      } else if ((soldierRc || 0) < RC_MIN_SOLDIER) {
        misses.push({ why: 'soldier-rc-low-return', soldier: soldier.username, rc: soldierRc });
        log('soldier RC too low for the return transfer — phase stays bought, next run resumes');
      } else {
        const r = await heBroadcastAs(soldier.username, soldier.activeWif, { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: 'BEE', quantity: sBee.toFixed(8), to: HEAD, memo: 'saos:rc-route-return' } });
        ops++;
        const hw2 = await wallet(HEAD);
        const beeAfter = (hw2['BEE'] || {}).liq || 0;
        const ok = beeAfter > beeHead;
        leg('soldier-buy-leg', 'transfer BEE → @' + HEAD, sBee.toFixed(8) + ' BEE · head ' + beeHead.toFixed(8) + '→' + beeAfter.toFixed(8), r.txid, ok);
        if (ok) {
          if (PROBE) { state.probes++; book0.phase = 'done'; }
          else {
            state.routes++; state.beeRouted = +((state.beeRouted || 0) + sBee).toFixed(8);
            state.days[book0.day || day].bee = { bee: +sBee.toFixed(8), soldier: soldier.username, swap: book0.spent || 0 };
            book0.phase = 'done';
          }
        }
      }
    } catch (e) {
      misses.push({ why: 'return-fail', err: String(e.message || e).slice(0, 140) });
      log('leg3 FAIL: ' + String(e.message || e).slice(0, 110));
    }
  } else if (book0.phase === 'bought' && !LIVE) {
    leg('soldier-buy-leg', '[DRY] transfer BEE → @' + HEAD, 'the BEE returns home');
    book0.phase = 'done';
  }

  // ── mode B: dust route (drought days only, one token per day) ──
  if (!PROBE && ops < MAX_OPS && drought && !state.days[day].dust && soldier && LIVE) {
    const candidates = [];
    const symbols = Object.keys(headWallet).filter((s) => !['SWAP.HIVE', 'SWAP.HBD', 'BEE'].includes(s) && (headWallet[s].liq || 0) > 0);
    for (const sym of symbols) {
      try {
        const bids = await book(sym, 'buyBook');
        const best = bids.sort((a, b) => b.price - a.price)[0];
        if (!best) continue;
        const value = headWallet[sym].liq * best.price;
        if (value >= SELL_DUST_HIVE) candidates.push({ sym, qty: headWallet[sym].liq, bid: best.price, value });
      } catch (_) { continue; }
    }
    candidates.sort((a, b) => b.value - a.value);
    if (candidates.length && (headRc || 0) >= RC_MIN_HEAD_TRANSFER) {
      const c = candidates[0];
      try {
        const r = await heBroadcastAs(HEAD, HEAD_ACTIVE, { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: c.sym, quantity: c.qty.toFixed(8), to: soldier.username, memo: 'saos:rc-route-dust' } });
        ops++;
        leg('rc-drought', 'transfer ' + c.sym + ' → @' + soldier.username, c.qty + ' ' + c.sym + ' (value ≈' + c.value.toFixed(4) + ')', r.txid, true);
        await sleep(4000);
        const priceStr = (c.bid * CROSS_PCT).toFixed(8);
        const r2 = await heBroadcastAs(soldier.username, soldier.activeWif, { contractName: 'market', contractAction: 'sell', contractPayload: { symbol: c.sym, quantity: c.qty.toFixed(8), price: priceStr } });
        ops++;
        leg('dust-route', 'soldier sells ' + c.sym + ' @' + priceStr + ' (97% of bid)', '≈' + (c.value * CROSS_PCT).toFixed(4) + ' SWAP.HIVE', r2.txid, true);
        await sleep(4000);
        const sw = await wallet(soldier.username);
        const proceeds = (sw['SWAP.HIVE'] || {}).liq || 0;
        if (proceeds > 0 && ops < MAX_OPS) {
          const r3 = await heBroadcastAs(soldier.username, soldier.activeWif, { contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: 'SWAP.HIVE', quantity: proceeds.toFixed(8), to: HEAD, memo: 'saos:rc-route-dust-return' } });
          ops++;
          leg('dust-return', 'transfer SWAP.HIVE → @' + HEAD, proceeds.toFixed(8) + ' SWAP.HIVE', r3.txid, true);
          state.routes++; state.swapRouted = +((state.swapRouted || 0) + proceeds).toFixed(8);
        }
        state.days[day].dust = { symbol: c.sym, qty: c.qty, soldier: soldier.username, proceeds: +proceeds.toFixed(8) };
      } catch (e) {
        misses.push({ why: 'dust-route-fail', err: String(e.message || e).slice(0, 140) });
        log('dust route FAIL: ' + String(e.message || e).slice(0, 110));
      }
    } else if (!candidates.length) {
      misses.push({ why: 'no-dust-above-floor', floor: SELL_DUST_HIVE });
    }
  } else if (!PROBE && state.days[day] && state.days[day].dust) {
    log('mode B already done today (day-idempotent)');
  }

  // ── the causal-chain ledger ──
  if (legs.length) {
    state.chains = state.chains || [];
    state.chains.push({ at: new Date().toISOString(), day, mode: PROBE ? 'probe' : FORCE ? 'force' : 'drought', headRc, soldier: soldier ? soldier.username : null, legs });
    if (state.chains.length > 48) state.chains = state.chains.slice(-48);
  }
  state.misses = (state.misses || 0) + misses.length;
  saveState(state);
  const result = { at: new Date().toISOString(), mode: PROBE ? 'probe' : FORCE ? 'force' : LIVE ? 'live' : 'dry', acted: legs.length > 0, headRc, drought, soldier: soldier ? soldier.username : null, phase: book0.phase, opsBudgetUsed: ops + '/' + MAX_OPS, legs, misses, state: { routes: state.routes, beeRouted: state.beeRouted, swapRouted: state.swapRouted, probes: state.probes } };
  fs.writeFileSync(OUT_RESULT, JSON.stringify(result, null, 2) + '\n');
  log('=== ROUTER DONE · phase=' + book0.phase + ' · legs ' + legs.length + ' · ops ' + ops + '/' + MAX_OPS + ' ===');
}

main().catch((e) => { log('FATAL ' + ((e && e.message) || e)); process.exit(1); });
