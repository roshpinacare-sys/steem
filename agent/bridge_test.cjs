#!/usr/bin/env node
/**
 * bridge_test.cjs — Task 34: THE CROSS-CHAIN PROOF.
 *
 * Discovery: headcorner exists on BOTH Steem and Hive (2018 pre-fork account)
 * with IDENTICAL key authorities — the vault posting WIF rules both chains.
 *
 * This script broadcasts a SAOS-1 checkpoint anchor on HIVE: a
 * proof-of-reserve snapshot of the Steem-hosted DEX state that anyone can
 * recompute by replaying Steem history and compare.
 *
 * Sandbox note: node's stack prefers IPv6 and the sandbox IPv6 is broken —
 * all Hive RPC goes through https.request with family:4 (IPv4 forced).
 *
 * Usage: node bridge_test.cjs [--dry]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(__dirname);

const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const POSTING_WIF = process.env.POSTING_WIF || '';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE, log);

const STEEM_RPC = process.env.STEEM_RPC || 'https://api.steemit.com';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
// Hive mainnet chain id (same signing curve/derivation as Steem — different id)
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';

function log(msg) {
  console.log('[' + new Date().toISOString() + '] bridge: ' + msg);
}

/** IPv4-forced JSON-RPC POST (sandbox IPv6 is broken — family:4 required). */
function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname || '/',
        method: 'POST',
        family: 4,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (e) {
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

async function hiveRpc(method, params) {
  return rpcV4(HIVE_RPC, { jsonrpc: '2.0', method, params, id: 1 });
}

async function main() {
  if (!POSTING_WIF) {
    log('no POSTING_WIF in vault');
    process.exit(1);
  }

  // 1) measure the live Steem-hosted DEX state (the thing we anchor)
  const dex = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, -1, 100], id: 1 });
  let newestIdx = 0;
  let newestTxid = '';
  for (const [idx, e] of dex) {
    if (idx > newestIdx) { newestIdx = idx; newestTxid = e.trx_id || ''; }
  }
  const [acc] = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 2 });
  const feed = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_feed_history', params: [], id: 3 });
  let feedSbdPerSteem = null;
  if (feed && feed.current_median_history) {
    feedSbdPerSteem =
      parseFloat(String(feed.current_median_history.base).split(' ')[0]) /
      parseFloat(String(feed.current_median_history.quote).split(' ')[0]);
  }

  let book = null;
  try {
    const res = await fetch((process.env.CONSOLE_URL || 'http://localhost:3000') + '/api/ops/saos/dex?username=' + ACCOUNT, { signal: AbortSignal.timeout(25000) });
    book = await res.json();
  } catch (e) { /* degrade — anchor still carries wallet+idx proof */ }

  const checkpoint = {
    protocol: 'saos/v1',
    action: 'checkpoint',
    account: ACCOUNT,
    chain: 'hive',
    anchor: {
      srcChain: 'steem',
      srcNewestIdx: newestIdx,
      srcNewestTxid: newestTxid,
      steemWallet: acc.balance,
      steemSbd: acc.sbd_balance,
      feedSbdPerSteem: feedSbdPerSteem != null ? Math.round(feedSbdPerSteem * 1e6) / 1e6 : null,
      dex: book && book.ok ? {
        supply: book.mine.saosLiquid + book.mine.saosLocked,
        bestAsk: book.stats.bestAsk,
        bestBid: book.stats.bestBid,
        openOrders: book.stats.openOrders,
        tradesTotal: book.stats.tradesTotal,
        pages: book.pagesScanned,
      } : null,
    },
    time: new Date().toISOString(),
    note: 'SAOS-1 dual-chain anchor: same key rules Steem + Hive. Recompute the Steem replay and compare.',
  };
  log('checkpoint built: steemIdx=' + newestIdx + ' · dexSupply=' + (checkpoint.anchor.dex ? checkpoint.anchor.dex.supply : 'n/a') + ' · bestAsk=' + (checkpoint.anchor.dex ? checkpoint.anchor.dex.bestAsk : 'n/a'));

  if (DRY) {
    log('[DRY] would broadcast to HIVE: ' + JSON.stringify(checkpoint).slice(0, 160) + '…');
    return;
  }

  // 2) build + sign + broadcast on HIVE (IPv4-forced, manual tx, steem-js signer)
  const dgp = await hiveRpc('condenser_api.get_dynamic_global_properties', []);
  const headNum = dgp.head_block_number;
  const headId = dgp.head_block_id;
  const refBlockNum = headNum & 0xffff;
  const refBlockPrefix = parseInt(Buffer.from(headId, 'hex').readUInt32LE(4).toString(10), 10);
  const expiration = new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19);

  steem.config.set('chain_id', HIVE_CHAIN_ID);
  const tx = {
    ref_block_num: refBlockNum,
    ref_block_prefix: refBlockPrefix,
    expiration,
    operations: [
      [
        'custom_json',
        {
          required_auths: [],
          required_posting_auths: [ACCOUNT],
          id: 'saos',
          json: JSON.stringify(checkpoint),
        },
      ],
    ],
    extensions: [],
  };
  const signed = steem.auth.signTransaction(tx, [POSTING_WIF]);
  log('tx signed on HIVE chain_id · expiration=' + expiration);

  const conf = await hiveRpc('condenser_api.broadcast_transaction', [signed]);
  log('ANCHORED ON HIVE ✓ (expiry ' + expiration + ')');
  log('verify in Hive history of @' + ACCOUNT + ' (hiveblocks.com) · checkpoint dexSupply=' + (checkpoint.anchor.dex ? checkpoint.anchor.dex.supply : 'n/a'));
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
