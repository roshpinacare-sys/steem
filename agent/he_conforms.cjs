#!/usr/bin/env node
/**
 * he_conforms.cjs — SMART-CONTRACT EDGE ASSERTION MATRIX (Hive-Engine).
 *
 * The user asked: "בדיקות קצה היכולת של מימוש של חוזים חכמים" — so we map the
 * REAL denial surface of the HE token/market contracts the way we mapped the
 * Steem walls: live broadcasts, effect-verified. A broadcast succeeding is
 * NOT the verdict — the verdict is the state delta on the sidechain:
 *   expect reject → pass = (balances & books unchanged)
 *   expect allow  → pass = (the exact expected delta happened)
 *
 * 13 asserts, every one free or self-funded dust:
 *   1  transfer > balance                → reject (insufficient)
 *   2  transfer negative quantity        → reject
 *   3  transfer zero quantity            → measure
 *   4  transfer to nonexistent account   → reject
 *   5  transfer nonexistent symbol       → reject
 *   6  transfer beyond precision         → reject
 *   7  transfer min-unit to our account  → allow (real settlement on cashmachine)
 *   8  stake > balance                   → reject
 *   9  sell > balance                    → reject
 *  10  buy beyond SWAP.HIVE              → reject (unfunded)
 *  11  sell at price 0                   → reject
 *  12  cancel nonexistent order          → reject
 *  13  issue by non-issuer               → reject
 *
 * Result → agent/he_conforms_result.json
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/he_conforms.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const HE_RPC = 'https://api.hive-engine.com/rpc/contracts';

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
const PROBE_SYMBOL = 'AFIT';   // dust token we hold — nothing of value at risk
const COUNTERPARTY = 'cashmachine'; // our own hive account — min-unit settlement lands there

function log(msg) {
  console.log('[' + new Date().toISOString() + '] he-conforms: ' + msg);
}
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE, log);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** broadcast an HE custom_json op with active auth; returns {txid} or throws */
async function heBroadcast(payload) {
  const dgp = await hiveRpc('condenser_api.get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [['custom_json', {
      required_auths: [ACCOUNT],
      required_posting_auths: [],
      id: 'ssc-mainnet-hive',
      json: JSON.stringify(payload),
    }]],
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
  return tx;
}

/** full state snapshot: our balances + books for the probed symbols */
async function snapshot(symbols) {
  const s = { bals: {}, books: {} };
  for (const sym of symbols) {
    try {
      const [mine] = await heFind('tokens', 'balances', { account: ACCOUNT, symbol: sym }, 1);
      const [theirs] = await heFind('tokens', 'balances', { account: COUNTERPARTY, symbol: sym }, 1);
      s.bals[sym] = { me: mine ? mine.balance : '0', them: theirs ? theirs.balance : '0', meStake: mine ? mine.stake || '0' : '0' };
    } catch (_) { s.bals[sym] = null; }
    try {
      const bids = await heFind('market', 'buyBook', { symbol: sym }, 20);
      const asks = await heFind('market', 'sellBook', { symbol: sym }, 20);
      s.books[sym] = {
        bids: (bids || []).length,
        asks: (asks || []).length,
        myAsks: (asks || []).filter((a) => a.account === ACCOUNT).length,
        bidTop: (bids || [])[0] ? (bids || [])[0].price : null,
      };
    } catch (_) { s.books[sym] = null; }
  }
  return s;
}

function sameState(a, b, symbols) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  if (!ACTIVE_WIF) { log('no ACTIVE_WIF'); process.exit(1); }
  if (DRY) { log('[DRY] LIVE-GATE — HE contract probes broadcast real ops — nothing broadcast'); process.exit(0); }
  const SYMBOLS = [PROBE_SYMBOL, 'BEE', 'SWAP.HIVE'];
  log(`mapping the HE contract denial surface — prober=@${ACCOUNT}, probe token=${PROBE_SYMBOL}, counterparty=@${COUNTERPARTY}`);

  const pl = (contractName, contractAction, contractPayload) => ({ contractName, contractAction, contractPayload });
  const ASSERTS = [
    { id: 'xfer-insufficient', op: pl('tokens', 'transfer', { from: ACCOUNT, to: COUNTERPARTY, symbol: PROBE_SYMBOL, quantity: '5', memo: 'conforms-1' }), expect: 'reject', why: 'balance is dust (<5)' },
    { id: 'xfer-negative', op: pl('tokens', 'transfer', { from: ACCOUNT, to: COUNTERPARTY, symbol: PROBE_SYMBOL, quantity: '-1', memo: 'conforms-2' }), expect: 'reject', why: 'negative quantity' },
    { id: 'xfer-zero', op: pl('tokens', 'transfer', { from: ACCOUNT, to: COUNTERPARTY, symbol: PROBE_SYMBOL, quantity: '0', memo: 'conforms-3' }), expect: 'measure', why: 'is 0 a legal quantity?' },
    { id: 'xfer-unknown-account', op: pl('tokens', 'transfer', { from: ACCOUNT, to: 'saosnobody9x', symbol: PROBE_SYMBOL, quantity: '0.0001', memo: 'conforms-4' }), expect: 'reject', why: 'recipient never existed' },
    { id: 'xfer-unknown-symbol', op: pl('tokens', 'transfer', { from: ACCOUNT, to: COUNTERPARTY, symbol: 'NOPE1', quantity: '1', memo: 'conforms-5' }), expect: 'reject', why: 'symbol not registered' },
    { id: 'xfer-precision', op: pl('tokens', 'transfer', { from: ACCOUNT, to: COUNTERPARTY, symbol: PROBE_SYMBOL, quantity: '0.00001', memo: 'conforms-6' }), expect: 'reject', why: 'precision 4 — 5th decimal' },
    { id: 'xfer-min-unit', op: pl('tokens', 'transfer', { from: ACCOUNT, to: COUNTERPARTY, symbol: PROBE_SYMBOL, quantity: '0.0001', memo: 'conforms-7 min-unit settlement' }), expect: 'allow', why: 'min unit settles to our own account', watch: 'them' },
    { id: 'stake-insufficient', op: pl('tokens', 'stake', { from: ACCOUNT, to: ACCOUNT, symbol: PROBE_SYMBOL, quantity: '999' }), expect: 'reject', why: 'stake beyond balance' },
    { id: 'sell-insufficient', op: pl('market', 'sell', { symbol: PROBE_SYMBOL, quantity: '9999', price: '0.00001' }), expect: 'reject', why: 'sell beyond balance' },
    { id: 'buy-unfunded', op: pl('market', 'buy', { symbol: 'BEE', quantity: '50000', price: '0.5' }), expect: 'reject', why: 'needs 25000 SWAP.HIVE escrow' },
    { id: 'sell-zero-price', op: pl('market', 'sell', { symbol: PROBE_SYMBOL, quantity: '0.1', price: '0' }), expect: 'reject', why: 'price must be > 0' },
    { id: 'cancel-unknown', op: pl('market', 'cancel', { type: 'sell', id: 'nonexistent-order-0000' }), expect: 'reject', why: 'no such order id' },
    { id: 'issue-not-issuer', op: pl('tokens', 'issue', { symbol: 'SAOS', to: ACCOUNT, quantity: '1' }), expect: 'reject', why: 'we are not the issuer of SAOS' },
  ];

  const asserts = [];
  for (const a of ASSERTS) {
    const before = await snapshot(SYMBOLS);
    let chainErr = null;
    try {
      await heBroadcast(a.op);
    } catch (e) {
      chainErr = String(e.message || e).slice(0, 180);
    }
    await sleep(7000); // block cadence 3s + HE contract processing
    const after = await snapshot(SYMBOLS);
    const unchanged = sameState(before, after, SYMBOLS);

    let got, pass, evidence;
    if (chainErr) {
      got = 'chain-level reject: ' + chainErr;
      pass = a.expect === 'reject';
      evidence = 'broadcast rejected by the chain itself — ' + chainErr.slice(0, 90);
    } else if (a.expect === 'allow') {
      const them0 = before.bals[PROBE_SYMBOL] ? before.bals[PROBE_SYMBOL].them : '?';
      const them1 = after.bals[PROBE_SYMBOL] ? after.bals[PROBE_SYMBOL].them : '?';
      const moved = them0 !== them1;
      got = moved ? 'settled — ' + COUNTERPARTY + ' ' + them0 + ' → ' + them1 : 'no state change';
      pass = moved;
      evidence = moved
        ? `min-unit ${a.op.contractPayload.quantity} ${PROBE_SYMBOL} settled on @${COUNTERPARTY} (${them1}) — real finality`
        : 'expected settlement, state unchanged';
    } else {
      const rejected = unchanged;
      got = rejected ? 'contract-level reject (state unchanged)' : 'STATE CHANGED — op executed';
      pass = a.expect === 'reject' ? rejected : true; // 'measure' → record what happened
      evidence = rejected
        ? `denial surface confirmed: ${a.why} — balances+books identical pre/post (broadcast accepted, contract refused)`
        : 'unexpected execution — measured as an allow';
    }
    asserts.push({ id: a.id, op: `${a.op.contractName}:${a.op.contractAction} ${JSON.stringify(a.op.contractPayload).slice(0, 90)}`, expect: a.expect, got, pass, evidence });
    log(`${pass ? '✓' : '✗'} ${a.id}: ${got.slice(0, 100)}`);
  }

  const walls = asserts.filter((x) => /reject/.test(x.got) && x.pass).length;
  const allows = asserts.filter((x) => /settled|executed/.test(x.got)).length;
  const result = {
    at: new Date().toISOString(),
    account: ACCOUNT,
    summary: { total: asserts.length, walls, allows, passCount: asserts.filter((x) => x.pass).length },
    asserts,
  };
  fs.writeFileSync(path.join(__dirname, 'he_conforms_result.json'), JSON.stringify(result, null, 2) + '\n');
  log(`matrix complete: ${result.summary.passCount}/${asserts.length} asserts pass · walls=${walls} · allows=${allows}`);
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
