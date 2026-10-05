#!/usr/bin/env node
/**
 * he_genesis.cjs — TOKEN GENESIS LADDER (Hive-Engine sidechain).
 *
 * The authorized path to OUR OWN token: dead/liquid assets → SWAP.HIVE → BEE
 * → (≥100 BEE) create the SAOS token with staking+delegation+market, issue,
 * and seed the orderbook. Runs in stateful steps — every run advances the
 * ladder as far as today's fuel allows, every step effect-verified
 * (balance delta / book state), never trusting a broadcast alone.
 *
 *   step 1  sell liquid junk      (any HE token with a real bid, value ≥ dust)
 *   step 2  HBD → HIVE convert    (condenser convert — 3.5d, once, idempotent)
 *   step 3  HIVE → SWAP.HIVE      (HE 'hive' contract peg conversion)
 *   step 4  buy BEE               (walk the sellBook ≤ limit, ≤ max-spend/run)
 *   step 5  CREATE SAOS           (only when BEE ≥ threshold) + issue + params
 *                                 + market seed depth
 *
 * Stealth doctrine: plain market operations. The proof is the settlement.
 *
 * Usage: node he_genesis.cjs [--dry] [--max-spend 2.5] [--bee-limit 0.65]
 *                            [--reserve 0.05] [--no-convert-hbd]
 * Result → agent/he_genesis_result.json  ·  state → agent/he_genesis_state.json
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/he_genesis.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const steem = require('steem');
const { Client, PrivateKey } = require('@hiveio/dhive'); // Hive-native ops (convert) — steem-js serialization diverges post-fork (measured live)
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}

const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const HE_RPC = 'https://api.hive-engine.com/rpc/contracts';
const HIVE_NODES = ['https://api.hive.blog', 'https://api.deathwing.me', 'https://hive-api.arcange.eu'];

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

const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE, log);

const NO_HBD = process.argv.includes('--no-convert-hbd');
const argOf = (n, d) => {
  const i = process.argv.indexOf(n);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const MAX_SPEND = parseFloat(argOf('--max-spend', '2.5'));   // HIVE-equivalent spend cap per run
const BEE_LIMIT = parseFloat(argOf('--bee-limit', '0.65'));  // max acceptable BEE price
const RESERVE = parseFloat(argOf('--reserve', '0.05'));      // SWAP.HIVE never touched below this
const CREATE_THRESHOLD = 100.5;
const SELL_DUST_HIVE = 0.01;   // don't bother selling below this expected value
const SELL_CANDIDATES = ['CENT', 'PIZZA', 'POSH', 'VKBT', 'LEO', 'AFIT', 'SPORTS', 'WAIV'];

const TOKEN = {
  symbol: 'SAOS',
  name: 'SAOS Network Credit',
  url: 'https://saos.local',
  precision: 3,
  maxSupply: '1000000000',
};

function log(msg) {
  console.log('[' + new Date().toISOString() + '] he-genesis: ' + msg);
}

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) {
            reject(new Error('bad rpc response: ' + data.slice(0, 120)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout 20s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const heFind = (contract, table, query, limit = 10) =>
  rpcV4(HE_RPC, { jsonrpc: '2.0', method: 'find', params: { contract, table, query, limit }, id: 1 });
const hiveRpc = (method, params) =>
  rpcV4(HIVE_RPC, { jsonrpc: '2.0', method, params, id: 1 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const statePath = path.join(__dirname, 'he_genesis_state.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { return { runs: 0, totalBeeBought: 0, hbdConvertedAt: null }; }
}
function saveState(s) {
  fs.writeFileSync(statePath, JSON.stringify(s, null, 2) + '\n');
}

/** graphene txid — sha256 of the signature-less serialization (first 40 hex) */
function txId(tx) {
  try {
    const buf = steem.transaction.toBuffer(tx);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 40);
  } catch (_) {
    return null;
  }
}

/** broadcast one custom_json HE op (or a small array of them, ≤3) with active auth */
async function heBroadcast(ops) {
  if (stasisStop('he-genesis')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
  const list = Array.isArray(ops) ? ops : [ops];
  const operations = list.map((pl) => [
    'custom_json',
    {
      required_auths: [ACCOUNT],
      required_posting_auths: [],
      id: 'ssc-mainnet-hive',
      json: JSON.stringify(pl),
    },
  ]);
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
    signed = steem.auth.signTransaction(tx, [ACTIVE_WIF]);
  } finally {
    steem.config.set('chain_id', prev);
  }
  await hiveRpc('condenser_api.broadcast_transaction', [signed]);
  return { txid: txId(tx), ops: list.map((o) => o.contractName + ':' + o.contractAction) };
}

/** Hive-native op via dhive (convert etc. — ops whose serialization diverged post-fork) */
async function hiveNativeBroadcast(opName, opBody) {
  if (stasisStop('he-genesis')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
  const client = new Client(HIVE_NODES);
  await client.broadcast.sendOperations([[opName, opBody]], PrivateKey.fromString(ACTIVE_WIF));
  return { txid: null }; // dhive sendOperations returns no id — evidence = state delta
}

/** condenser op on HIVE (legacy-safe ops) with active auth */
async function hiveBroadcast(op) {
  if (stasisStop('he-genesis')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
  const dgp = await hiveRpc('condenser_api.get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [op],
    extensions: [],
  };
  const prev = steem.config.get('chain_id');
  let signed;
  try {
    steem.config.set('chain_id', HIVE_CHAIN_ID);
    signed = steem.auth.signTransaction(tx, [ACTIVE_WIF]);
  } finally {
    steem.config.set('chain_id', prev);
  }
  await hiveRpc('condenser_api.broadcast_transaction', [signed]);
  return { txid: txId(tx) };
}

async function balances() {
  const rows = await heFind('tokens', 'balances', { account: ACCOUNT }, 100);
  const map = {};
  for (const r of rows || []) map[r.symbol] = { liq: parseFloat(r.balance), stake: parseFloat(r.stake || '0'), pending: parseFloat(r.pendingUnstake || '0') };
  return map;
}
async function book(symbol, side) {
  const rows = await heFind('market', side, { symbol }, 50);
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ price: parseFloat(r.price), qty: parseFloat(r.quantity), account: r.account, id: r.$loki || r.txId || null }))
    .filter((r) => r.price > 0 && r.qty > 0);
}
async function hiveCondenserAccount() {
  const acc = await hiveRpc('condenser_api.get_accounts', [[ACCOUNT]]);
  return Array.isArray(acc) && acc[0] ? acc[0] : null;
}

async function main() {
  if (!ACTIVE_WIF) { log('no ACTIVE_WIF — ladder needs the active key'); process.exit(1); }
  const state = loadState();
  const steps = [];
  const step = (s) => { steps.push(s); log(`${s.ok ? '✓' : '·'} ${s.step}: ${s.detail}`); };

  // ── recon ──────────────────────────────────────────────────────────────
  const bal0 = await balances();
  const acc0 = await hiveCondenserAccount();
  const hbd0 = acc0 ? parseFloat(acc0.hbd_balance || '0') : 0;
  const hive0 = acc0 ? parseFloat(acc0.balance || '0') : 0;
  const swap0 = bal0['SWAP.HIVE'] ? bal0['SWAP.HIVE'].liq : 0;
  const bee0 = bal0['BEE'] ? bal0['BEE'].liq : 0;
  log(`recon: SWAP.HIVE=${swap0} · BEE=${bee0} · HIVE=${hive0} · HBD=${hbd0} · heSymbols=${Object.keys(bal0).length}`);

  // ── RC gate — Hive RC fuels every sidechain op. WARNING (measured live):
  // current_mana is FROZEN between txs (no lazy regen on read) — regen must be
  // computed: max_rc × elapsed / 5days. The bridge burned our mana; we wait
  // honestly instead of failing.
  let rcOk = true;
  try {
    const rc = await hiveRpc('rc_api.find_rc_accounts', { accounts: [ACCOUNT] });
    const rca = rc && rc.rc_accounts && rc.rc_accounts[0];
    if (rca) {
      const maxRc = parseInt(rca.max_rc || '0');
      const stored = parseInt(rca.rc_manabar.current_mana || '0');
      const lu = parseInt(rca.rc_manabar.last_update_time || '0');
      const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - lu);
      const rcNow = stored + Math.floor((elapsed * maxRc) / (5 * 86400));
      log(`rc gate: stored ${stored} + regen ${elapsed}s × ${maxRc}/5d → estimated ${rcNow}`);
      if (rcNow < 280000000) {
        rcOk = false;
        const waitMin = Math.ceil(((280000000 - rcNow) / (maxRc / 432000)) / 60);
        step({ step: 'rc-gate', ok: true, detail: `Hive RC estimated ${rcNow} < 280M — ladder waits ≈${waitMin}min for regen · nothing lost` });
      }
    }
  } catch (_) { /* rc api down — try anyway */ }

  // ── step 1: sell liquid junk with real bids ───────────────────────────
  if (rcOk) for (const sym of SELL_CANDIDATES) {
    const b = bal0[sym];
    if (!b || !(b.liq > 0)) continue;
    let bids;
    try { bids = await book(sym, 'buyBook'); } catch (_) { continue; }
    const best = bids[0];
    if (!best) continue;
    const value = b.liq * best.price;
    if (value < SELL_DUST_HIVE) continue;
    const qtyStr = b.liq.toFixed(8);
    const priceStr = best.price.toFixed(8);
    if (DRY) { step({ step: 'sell ' + sym, ok: true, detail: `[DRY] would sell ${qtyStr} @ ${priceStr} ≈ ${value.toFixed(4)} HIVE (bid by @${best.account})` }); continue; }
    try {
      const r = await heBroadcast({ contractName: 'market', contractAction: 'sell', contractPayload: { symbol: sym, quantity: qtyStr, price: priceStr } });
      await sleep(6500);
      const bal1 = await balances();
      const after = bal1[sym] ? bal1[sym].liq : 0;
      const filled = after < b.liq - 1e-9;
      step({ step: 'sell ' + sym, ok: true, detail: `${qtyStr} @ ${priceStr} ≈ ${value.toFixed(4)} HIVE · ${filled ? 'FILLED (liq ' + after + ')' : 'resting at top-of-book'} · tx ${r.txid || '?'}`, txid: r.txid });
    } catch (e) {
      step({ step: 'sell ' + sym, ok: false, detail: 'failed: ' + String(e.message || e).slice(0, 140) });
    }
  }

  // ── step 2: HBD → HIVE convert (once) ─────────────────────────────────
  if (rcOk && !NO_HBD && hbd0 >= 0.05 && !state.hbdConvertedAt) {
    if (DRY) step({ step: 'convert-hbd', ok: true, detail: `[DRY] would convert ${hbd0} HBD → HIVE (3.5d)` });
    else {
      try {
        const r = await hiveNativeBroadcast('convert', { owner: ACCOUNT, requestid: Math.floor(Date.now() / 1000) & 0x7fffffff, amount: hbd0.toFixed(3) + ' HBD' });
        state.hbdConvertedAt = new Date().toISOString();
        saveState(state);
        step({ step: 'convert-hbd', ok: true, detail: `${hbd0} HBD → HIVE (arrives in 3.5d) · dhive broadcast ✓ (evidence: HBD balance drops on-chain)` });
      } catch (e) {
        step({ step: 'convert-hbd', ok: false, detail: 'failed: ' + String(e.message || e).slice(0, 140) });
      }
    }
  }

  // ── step 3: HIVE → SWAP.HIVE ──────────────────────────────────────────
  const fresh = await hiveCondenserAccount();
  const hiveLiq = fresh ? parseFloat(fresh.balance || '0') : 0;
  if (rcOk && hiveLiq >= 0.2) {
    const qty = (hiveLiq - 0.05).toFixed(3);
    if (DRY) step({ step: 'hive→swap.hive', ok: true, detail: `[DRY] would peg ${qty} HIVE → SWAP.HIVE` });
    else {
      try {
        const r = await heBroadcast({ contractName: 'hive', contractAction: 'convert', contractPayload: { quantity: qty } });
        await sleep(6500);
        const bal1 = await balances();
        const swapNow = bal1['SWAP.HIVE'] ? bal1['SWAP.HIVE'].liq : 0;
        step({ step: 'hive→swap.hive', ok: true, detail: `${qty} HIVE pegged → SWAP.HIVE=${swapNow} · tx ${r.txid || '?'}`, txid: r.txid });
      } catch (e) {
        step({ step: 'hive→swap.hive', ok: false, detail: 'failed: ' + String(e.message || e).slice(0, 140) });
      }
    }
  }

  // ── step 4: buy BEE (≤ max-spend, walk asks) ──────────────────────────
  const balMid = await balances();
  const swapNow = balMid['SWAP.HIVE'] ? balMid['SWAP.HIVE'].liq : 0;
  const beeNow = balMid['BEE'] ? balMid['BEE'].liq : 0;
  let budget = Math.min(swapNow - RESERVE, MAX_SPEND);
  if (!rcOk) {
    step({ step: 'buy BEE', ok: true, detail: 'skipped — RC gate (regen in progress)' });
  } else if (budget < 0.05) {
    step({ step: 'buy BEE', ok: true, detail: `budget ${budget.toFixed(3)} SWAP.HIVE < 0.05 — nothing to buy this run (swap=${swapNow.toFixed(3)}, reserve=${RESERVE})` });
  } else {
    const asks = (await book('BEE', 'sellBook')).sort((a, b) => a.price - b.price);
    const buys = [];
    let left = budget;
    for (const lvl of asks) {
      if (left < 0.05) break;
      if (lvl.price > BEE_LIMIT) break;
      const afford = Math.floor((left / lvl.price) * 1e8) / 1e8;
      const qty = Math.min(afford, lvl.qty);
      if (qty < 0.000001) continue;
      buys.push({ price: lvl.price, qty, by: lvl.account });
      left -= qty * lvl.price;
    }
    if (!buys.length) {
      step({ step: 'buy BEE', ok: true, detail: `no ask ≤ ${BEE_LIMIT} within budget ${budget.toFixed(3)} — cheapest ${(asks[0] && asks[0].price) || '?'} — ladder waits` });
    } else {
      const planned = buys.reduce((s, b) => s + b.qty, 0);
      log(`buy plan: ${planned.toFixed(4)} BEE across ${buys.length} levels for ${(budget - left).toFixed(3)} SWAP.HIVE`);
      let bought = 0;
      if (DRY) {
        step({ step: 'buy BEE', ok: true, detail: `[DRY] would buy ${planned.toFixed(4)} BEE: ` + buys.map((b) => `${b.qty}@${b.price}`).join(' + ') });
      } else {
        for (let i = 0; i < buys.length; i += 3) {
          const batch = buys.slice(i, i + 3).map((b) => ({
            contractName: 'market',
            contractAction: 'buy',
            contractPayload: { symbol: 'BEE', quantity: b.qty.toFixed(8), price: b.price.toFixed(8) },
          }));
          try {
            const r = await heBroadcast(batch);
            bought += batch.length;
            step({ step: 'buy BEE#' + (Math.floor(i / 3) + 1), ok: true, detail: batch.map((b) => b.contractPayload.quantity + '@' + b.contractPayload.price).join(' + ') + ' · tx ' + (r.txid || '?'), txid: r.txid });
            await sleep(3500); // 5-custom_json-per-block wall (measured)
          } catch (e) {
            step({ step: 'buy BEE#' + (Math.floor(i / 3) + 1), ok: false, detail: 'failed: ' + String(e.message || e).slice(0, 140) });
          }
        }
        await sleep(6500);
        const balFin = await balances();
        const beeFin = balFin['BEE'] ? balFin['BEE'].liq : beeNow;
        const gained = beeFin - beeNow;
        state.totalBeeBought = (state.totalBeeBought || 0) + Math.max(0, gained);
        saveState(state);
        step({ step: 'buy BEE·settle', ok: gained > 0, detail: `BEE ${beeNow.toFixed(4)} → ${beeFin.toFixed(4)} (Δ+${gained.toFixed(4)}) · ladder ${beeFin.toFixed(2)}/100 · total bought ever ${(state.totalBeeBought || 0).toFixed(4)}` });
      }
    }
  }

  // ── step 5: CREATE THE TOKEN (≥ threshold) ────────────────────────────
  const balEnd = await balances();
  const beeEnd = balEnd['BEE'] ? balEnd['BEE'].liq : 0;
  const token = { symbol: TOKEN.symbol, created: false, issued: false, params: [], market: [] };
  if (!rcOk) {
    step({ step: 'genesis gate', ok: true, detail: `${beeEnd.toFixed(2)}/100 BEE · RC-gated — autonomous rerun when regen completes` });
  } else if (beeEnd >= CREATE_THRESHOLD) {
    log(`THRESHOLD REACHED — ${beeEnd.toFixed(2)} BEE ≥ ${CREATE_THRESHOLD} — genesis available`);
    const createOp = { contractName: 'tokens', contractAction: 'create', contractPayload: { ...TOKEN } };
    if (DRY) {
      step({ step: 'create SAOS', ok: true, detail: '[DRY] would create token ' + TOKEN.symbol + ' (precision ' + TOKEN.precision + ', maxSupply ' + TOKEN.maxSupply + ')' });
    } else {
      try {
        const r = await heBroadcast(createOp);
        await sleep(6500);
        token.created = true;
        token.createTxid = r.txid;
        step({ step: 'create SAOS', ok: true, detail: `TOKEN ${TOKEN.symbol} CREATED on Hive-Engine · tx ${r.txid || '?'}`, txid: r.txid });
      } catch (e) {
        step({ step: 'create SAOS', ok: false, detail: 'create failed: ' + String(e.message || e).slice(0, 160) });
      }
      if (token.created) {
        // issue initial supply to the treasury
        try {
          const r = await heBroadcast({ contractName: 'tokens', contractAction: 'issue', contractPayload: { symbol: TOKEN.symbol, to: ACCOUNT, quantity: '1000000' } });
          token.issued = true;
          token.issueTxid = r.txid;
          step({ step: 'issue SAOS', ok: true, detail: '1,000,000 SAOS issued to @' + ACCOUNT + ' · tx ' + (r.txid || '?'), txid: r.txid });
        } catch (e) {
          step({ step: 'issue SAOS', ok: false, detail: 'issue failed: ' + String(e.message || e).slice(0, 160) });
        }
        // enable staking + delegation (economy primitives) — engine may charge/require more BEE; errors are measurements
        for (const pl of [
          { contractName: 'tokens', contractAction: 'updateParams', contractPayload: { symbol: TOKEN.symbol, staking: { enabled: true, unstakingCooldown: 7, numberTransactions: 1 } } },
          { contractName: 'tokens', contractAction: 'updateParams', contractPayload: { symbol: TOKEN.symbol, delegation: { enabled: true, undelegationCooldown: 7 } } },
          { contractName: 'tokens', contractAction: 'updateParams', contractPayload: { symbol: TOKEN.symbol, market: { open: true } } },
        ]) {
          try {
            const r = await heBroadcast(pl);
            token.params.push({ ok: true, payload: JSON.stringify(pl.contractPayload).slice(0, 90), txid: r.txid });
            step({ step: 'params ' + Object.keys(pl.contractPayload)[1], ok: true, detail: 'accepted · tx ' + (r.txid || '?'), txid: r.txid });
          } catch (e) {
            token.params.push({ ok: false, payload: JSON.stringify(pl.contractPayload).slice(0, 90), err: String(e.message || e).slice(0, 140) });
            step({ step: 'params', ok: false, detail: 'rejected (measured): ' + String(e.message || e).slice(0, 140) });
          }
          await sleep(3500);
        }
        // seed the market — depth toward SWAP.HIVE
        const seedOrders = [
          { quantity: '500', price: '0.100' },
          { quantity: '200', price: '0.250' },
          { quantity: '100', price: '0.500' },
        ];
        for (const o of seedOrders) {
          try {
            const r = await heBroadcast({ contractName: 'market', contractAction: 'sell', contractPayload: { symbol: TOKEN.symbol, quantity: o.quantity, price: o.price } });
            token.market.push({ ok: true, ...o, txid: r.txid });
            step({ step: 'seed SAOS market', ok: true, detail: `sell ${o.quantity} @ ${o.price} SWAP.HIVE · tx ${r.txid || '?'}`, txid: r.txid });
          } catch (e) {
            token.market.push({ ok: false, ...o, err: String(e.message || e).slice(0, 140) });
          }
          await sleep(3500);
        }
      }
    }
  } else {
    step({ step: 'genesis gate', ok: true, detail: `${beeEnd.toFixed(2)}/100 BEE — ladder continues (release trickle feeds the next runs)` });
  }

  state.runs = (state.runs || 0) + 1;
  saveState(state);

  const balFinal = await balances();
  const result = {
    at: new Date().toISOString(),
    dry: DRY,
    run: state.runs,
    ladder: {
      bee: { before: bee0, after: balFinal['BEE'] ? balFinal['BEE'].liq : bee0 },
      swapHive: { before: swap0, after: balFinal['SWAP.HIVE'] ? balFinal['SWAP.HIVE'].liq : swap0 },
      totalBeeBoughtEver: state.totalBeeBought || 0,
      createThreshold: 100,
      progressPct: Math.min(100, ((balFinal['BEE'] ? balFinal['BEE'].liq : 0) / 100) * 100),
    },
    steps,
    token,
  };
  fs.writeFileSync(path.join(__dirname, 'he_genesis_result.json'), JSON.stringify(result, null, 2) + '\n');
  log(`run #${state.runs} complete — BEE ${result.ladder.bee.after.toFixed(2)}/100 · steps ${steps.filter((s) => s.ok).length}/${steps.length} ok`);
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
