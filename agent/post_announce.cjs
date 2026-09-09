#!/usr/bin/env node
/**
 * post_announce.cjs — sovereign publish of the SAOS-1 protocol announcement.
 *
 * Task 33: the operator connected the main key once; the vault (agent/.env)
 * holds the posting WIF — from here on the empire speaks for itself.
 *
 * Flow:
 *   1. Build the op from LIVE chain data via the local console preview API
 *      (action=saos_announce — same builder the browser button uses).
 *   2. Idempotence: if today's permlink already exists on-chain, skip.
 *   3. Sign locally with the vault posting WIF (steem-js) and broadcast
 *      straight to RPC. The WIF never leaves this machine.
 *
 * Usage: node post_announce.cjs [--dry]   (console API must be up on :3000)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const TO_HIVE = process.argv.includes('--hive');

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
const DRY = process.argv.includes('--dry');
const CONSOLE = process.env.CONSOLE_URL || 'http://localhost:3000';

function log(msg) {
  const line = '[' + new Date().toISOString() + '] announce: ' + msg;
  console.log(line);
}

async function main() {
  if (!POSTING_WIF) {
    log('no POSTING_WIF in vault — cannot speak for the empire');
    process.exit(1);
  }

  // 1) build op from live data (same builder the console button uses)
  let preview;
  try {
    const res = await fetch(CONSOLE + '/api/ops/tx/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ACCOUNT, action: 'saos_announce' }),
      signal: AbortSignal.timeout(30000),
    });
    preview = await res.json();
  } catch (e) {
    log('console API unreachable: ' + String((e && e.message) || e));
    process.exit(1);
  }
  if (!preview || preview.ok !== true || !Array.isArray(preview.ops) || preview.ops.length === 0) {
    log('preview failed: ' + ((preview && preview.error) || 'no ops'));
    process.exit(1);
  }

  const commentOp = preview.ops.find((op) => op[0] === 'comment');
  if (!commentOp) {
    log('preview has no comment op');
    process.exit(1);
  }
  const permlink = String(commentOp[1].permlink || '');
  const bodyLen = String(commentOp[1].body || '').length;
  log('op built: permlink=' + permlink + ' · body=' + bodyLen + ' chars · role=' + preview.requiredRole);

  // 2) idempotence — already published today? (chain-aware)
  try {
    let content;
    if (TO_HIVE) {
      content = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_content', params: [ACCOUNT, permlink], id: 3 });
    } else {
      content = await withTimeout(steem.api.getContentAsync(ACCOUNT, permlink), 15000, 'get_content');
    }
    if (content && content.author === ACCOUNT && String(content.permlink) === permlink) {
      log('already published' + (TO_HIVE ? ' on HIVE' : '') + ': ' + permlink + ' (created ' + content.created + ') — skip');
      return;
    }
  } catch (e) {
    /* not found = fresh post — continue */
  }

  if (DRY) {
    log('[DRY] would broadcast comment ' + permlink + (TO_HIVE ? ' → HIVE' : ''));
    return;
  }

  // 3) sign locally, broadcast to RPC — keys stay in the vault
  try {
    if (TO_HIVE) {
      await hiveBroadcastOps(preview.ops);
      log('PUBLISHED on-chain → HIVE: permlink=' + permlink);
      log('url: https://peakd.com/saos/@' + ACCOUNT + '/' + permlink);
      return;
    }
    const conf = await withTimeout(
      steem.broadcast.sendAsync({ operations: preview.ops, extensions: [] }, [POSTING_WIF]),
      30000,
      'announce_broadcast'
    );
    log('PUBLISHED on-chain: txid=' + ((conf && conf.id) || 'n/a') + ' · permlink=' + permlink);
    log('url: https://steemit.com/saos/@' + ACCOUNT + '/' + permlink);
  } catch (e) {
    log('broadcast FAILED: ' + String((e && e.message) || e).slice(0, 200));
    process.exit(1);
  }
}

function withTimeout(promise, ms, tag) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(tag + ' timeout ' + ms + 'ms')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
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

/** Build + sign + broadcast on HIVE with the same vault posting WIF. */
async function hiveBroadcastOps(ops) {
  const dgp = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: ops,
    extensions: [],
  };
  const prevChainId = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try {
    signed = steem.auth.signTransaction(tx, [POSTING_WIF]);
  } finally {
    steem.config.set('chain_id', prevChainId);
  }
  await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 2 });
  return true;
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e));
  process.exit(1);
});
