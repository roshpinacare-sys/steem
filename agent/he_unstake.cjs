#!/usr/bin/env node
/**
 * he_unstake.cjs — value unlock: begin unstaking dead-staked sidechain assets.
 *
 * SPORTS 6,115 (bid book has ~51 HIVE depth @ ~0.000111) and WAIV 10
 * (bids ~0.19) sit STAKED — worth ~2.6 HIVE once liquid. Unstake starts
 * the weekly release schedule (typical HE: 25%/week × 4 weeks).
 * Cost: zero ops fees. Risk: none (reversible only via re-stake after).
 *
 * Result → agent/he_unstake_result.json
 *
 * LIVE-GATE (explicit opt-in only — owner decision, Task 24/25-d):
 *   live broadcast requires BOTH: --live flag (or env HE_LIVE=1)
 *   AND env HE_LIVE_CONFIRM=<agent-account-name> matching ACCOUNT.
 *   Otherwise the daemon runs DRY (no signature, no broadcast).
 */
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

const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
// [LIVE-GATE] live is explicit opt-in ONLY (owner decision Task 24 → implemented 25-d):
// requires BOTH (a) --live flag or env HE_LIVE=1, AND (b) env HE_LIVE_CONFIRM=<account>.
const LIVE_REQUESTED = !process.argv.includes('--dry') && (process.argv.includes('--live') || process.env.HE_LIVE === '1');
const LIVE_CONFIRMED = (process.env.HE_LIVE_CONFIRM || '').toLowerCase() === ACCOUNT;
const LIVE = LIVE_REQUESTED && LIVE_CONFIRMED;
const DRY = !LIVE;
if (DRY) {
  console.log('[LIVE-GATE] dry-run default — broadcast requires --live flag (or HE_LIVE=1) AND HE_LIVE_CONFIRM=' + ACCOUNT);
  if (LIVE_REQUESTED && !LIVE_CONFIRMED) console.log('[LIVE-GATE] live requested but HE_LIVE_CONFIRM mismatch — forcing DRY');
} else {
  console.log('[LIVE-GATE] LIVE MODE ENABLED — real broadcast to Hive mainnet (Hive-Engine sidechain ops) as @' + ACCOUNT);
}
const SYMBOLS = (process.argv.find((a) => a.startsWith('--symbols=')) || '--symbols=SPORTS,WAIV')
  .split('=')[1].split(',').map((s) => s.trim()).filter(Boolean);

function log(msg) { console.log('[' + new Date().toISOString() + '] he-unstake: ' + msg); }

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
const heFindOne = (contract, table, query) =>
  rpcV4(HE_RPC, { jsonrpc: '2.0', method: 'findOne', params: { contract, table, query }, id: 1 });

async function heOp(payload, wif) {
  const op = [
    'custom_json',
    {
      required_auths: [ACCOUNT],
      required_posting_auths: [],
      id: 'ssc-mainnet-hive',
      json: JSON.stringify(payload),
    },
  ];
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
    signed = steem.auth.signTransaction(tx, [wif]);
  } finally {
    steem.config.set('chain_id', prevChainId);
  }
  await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 3 });
  return signed.transaction_id || null;
}

async function main() {
  if (!ACTIVE_WIF) return log('no ACTIVE_WIF — HE requires active authority');
  const results = [];

  for (const symbol of SYMBOLS) {
    const bal = await heFindOne('tokens', 'balances', { account: ACCOUNT, symbol });
    if (!bal) { log(symbol + ': no balance row — skip'); continue; }
    const staked = parseFloat(bal.stake || 0);
    if (staked <= 0) { log(symbol + ': stake=0 — skip'); continue; }

    // market context: what this unlocks
    const bids = await heFind('market', 'buyBook', { symbol }, 50);
    const best = (Array.isArray(bids) ? bids : [])
      .map((b) => ({ price: parseFloat(b.price), qty: parseFloat(b.quantity) }))
      .filter((b) => b.price > 0)
      .sort((a, b) => b.price - a.price)[0];
    const unlockVal = best ? staked * best.price : null;

    log(symbol + ': staked=' + staked + ' · best bid=' + (best ? best.price : 'none') +
      (unlockVal != null ? ' · unlock-value≈' + unlockVal.toFixed(4) + ' HIVE' : ''));

    if (DRY) { log('[DRY] would unstake ' + staked + ' ' + symbol); results.push({ symbol, staked, dry: true }); continue; }

    let txid = null;
    try {
      txid = await heOp({ contractName: 'tokens', contractAction: 'unstake', contractPayload: { symbol, quantity: String(staked) } }, ACTIVE_WIF);
      log(symbol + ': unstake broadcast ✓ txid=' + txid);
    } catch (e) {
      log(symbol + ': unstake FAILED — ' + ((e && e.message) || e));
      results.push({ symbol, staked, error: String((e && e.message) || e).slice(0, 160) });
      continue;
    }

    // settlement: pendingUnstake row appears (HE near-instant)
    await new Promise((r) => setTimeout(r, 6000));
    let pending = null;
    try {
      pending = await heFindOne('tokens', 'pendingUnstakes', { account: ACCOUNT, symbol });
    } catch (_) { /* table may differ per token — non-fatal */ }
    const balAfter = await heFindOne('tokens', 'balances', { account: ACCOUNT, symbol });
    results.push({
      symbol,
      stakedBefore: staked,
      txid,
      pendingUnstake: pending ? { quantity: pending.quantity, completeAt: pending.completeAt || undefined } : null,
      stakeAfter: balAfter ? balAfter.stake : null,
      unlockValueHive: unlockVal != null ? Number(unlockVal.toFixed(6)) : null,
      bestBidAtUnstake: best ? best.price : null,
      at: new Date().toISOString(),
    });
  }

  const out = { at: new Date().toISOString(), account: ACCOUNT, results, dry: DRY };
  fs.writeFileSync(path.join(__dirname, 'he_unstake_result.json'), JSON.stringify(out, null, 2) + '\n');
  log('done — ' + results.length + ' symbol(s) → he_unstake_result.json');
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
