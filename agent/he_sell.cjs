#!/usr/bin/env node
/**
 * he_sell.cjs — first REAL trade on an EXTERNAL DEX (Hive-Engine sidechain).
 *
 * Sells AFIT into the resting bid (real counterparty, real SWAP.HIVE):
 * dead sidechain assets → liquid SWAP.HIVE, signed by the same vault key.
 *
 * Stealth doctrine: this is a plain market operation — no announcements,
 * no strategy reveals. The proof lives in the sidechain settlement itself.
 *
 * Usage: node he_sell.cjs [--dry] [--qty 9000] [--price 0.0001]
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/he_sell.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}

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
const POSTING_WIF = process.env.POSTING_WIF || '';
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE, log);

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const QTY = argOf('--qty', '9000');
const PRICE = argOf('--price', '0.0001');
const SYMBOL = argOf('--symbol', 'AFIT');

function log(msg) {
  console.log('[' + new Date().toISOString() + '] he-sell: ' + msg);
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

async function main() {
  if (!ACTIVE_WIF) return log('no ACTIVE_WIF — HE sidechain requires active authority (required_auths)');
  if (!/^\d+(\.\d+)?$/.test(QTY) || !/^\d+(\.\d+)?$/.test(PRICE)) return log('bad qty/price');

  // pre-trade recon: best real bid for the symbol
  const bids = await heFind('market', 'buyBook', { symbol: SYMBOL }, 50);
  const rows = (Array.isArray(bids) ? bids : [])
    .map((b) => ({ price: parseFloat(b.price), qty: parseFloat(b.quantity), account: b.account }))
    .filter((b) => b.price > 0 && b.qty > 0)
    .sort((a, b) => b.price - a.price);
  const best = rows[0];
  if (!best) return log('no real bids for ' + SYMBOL + ' — abort');
  log('book: best bid ' + best.price + ' x ' + best.qty + ' by @' + best.account + ' · levels=' + rows.length);
  if (parseFloat(PRICE) > best.price) log('note: price above best bid — order will rest instead of filling');

  const op = [
    'custom_json',
    {
      required_auths: [ACCOUNT],
      required_posting_auths: [],
      id: 'ssc-mainnet-hive',
      json: JSON.stringify({
        contractName: 'market',
        contractAction: 'sell',
        contractPayload: { symbol: SYMBOL, quantity: QTY, price: PRICE },
      }),
    },
  ];

  if (DRY) {
    log('[DRY] would sell ' + QTY + ' ' + SYMBOL + ' @ ' + PRICE + ' (crossing bid ' + best.price + ')');
    return;
  }

  if (stasisStop('he-sell')) return log('STASIS-HALT — capital lane closed (capital gate 2026-10-04) — nothing broadcast'); // sign-time brake

  const dgp = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 2 });
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [op],
    extensions: [],
  };
  const prevChainId = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try {
    signed = steem.auth.signTransaction(tx, [ACTIVE_WIF]);
  } finally {
    steem.config.set('chain_id', prevChainId);
  }
  await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 3 });
  log('broadcast ✓ (active auth) — sell ' + QTY + ' ' + SYMBOL + ' @ ' + PRICE);

  // post-trade settlement verification (HE sidechain is near-instant)
  await new Promise((r) => setTimeout(r, 6000));
  const [bal] = await heFind('tokens', 'balances', { account: ACCOUNT, symbol: 'SWAP.HIVE' }, 1);
  const tokBal = await heFind('tokens', 'balances', { account: ACCOUNT, symbol: SYMBOL }, 1);
  const bidsAfter = await heFind('market', 'buyBook', { symbol: SYMBOL }, 50);
  const bestAfter = (Array.isArray(bidsAfter) ? bidsAfter : [])
    .map((b) => ({ price: parseFloat(b.price), qty: parseFloat(b.quantity), account: b.account }))
    .filter((b) => b.price > 0 && b.qty > 0)
    .sort((a, b) => b.price - a.price)[0];
  const swapHive = bal ? bal.balance : '0';
  const tokLeft = tokBal && tokBal[0] ? tokBal[0].balance : '?';
  const trades = await heFind('market', 'tradesHistory', { symbol: SYMBOL }, 3);
  const mine = (Array.isArray(trades) ? trades : []).find((t) => t.seller === ACCOUNT);
  log('SETTLED: SWAP.HIVE = ' + swapHive + ' · ' + SYMBOL + ' left = ' + tokLeft + ' · best bid now ' + (bestAfter ? bestAfter.price + ' x ' + bestAfter.qty.toFixed(0) + ' (@' + bestAfter.account + ')' : 'empty') + (mine ? ' · OUR FILL IN TRADES ✓ ' + mine.quantity + ' @ ' + mine.price : ' · (no fill in last 3 trades — order may be resting)'));
  log('EVIDENCE: ' + JSON.stringify({ symbol: SYMBOL, qty: QTY, price: PRICE, swapHive }));
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
