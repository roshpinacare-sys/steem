#!/usr/bin/env node
/**
 * net_registry.cjs — SAOS-Net v1: on-chain network registry.
 *
 * The "smart network on the token" needs a directory: who are the nodes,
 * what can they do, where are they. Instead of DNS/consul, the registry
 * LIVES ON THE CHAIN (custom_json id='saos_net'):
 *
 *   { protocol:'saos-net/v1', action:'register', name:'saos://<name>',
 *     type:'server|agent|service', caps:[...], chains:[...], owner, ts }
 *
 * Resolution rule: latest valid entry per name wins (history is immutable
 * audit). Anyone can read it; every entry is signed by the owner's posting
 * key — the chain itself authenticates registration.
 *
 * Registered topology (real, live):
 *   saos://gateway.hq      server  — this machine (Next.js console + daemon host)
 *   saos://headcorner      hq      — treasury, factory, RC, DEX issuer
 *   saos://<soldier>…      agent   — army nodes (caps: sign, curate, memo-exec, sweep)
 *   saos://bridge.x2       service — Steem→Hive anchor bridge
 *   saos://wlog.global     service — dual-chain hash-chained world journal
 *   saos://dex.saos1       service — SAOS-1/STEEM market maker
 *   saos://kv.store        service — content-addressed on-chain storage
 *   saos://taskq.core      service — mission queue (task→assign→result)
 *
 * Result → agent/net_registry_result.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

/** direct jsonrpc — steem-js history transport lags behind on some nodes (measured) */
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
// api.steemit.com is load-balanced — backends flap on history freshness (measured).
// Race multiple nodes and merge: any backend that resolved our ops counts.
const HIST_NODES = ['https://api.steemit.com', 'https://steemapi.boylikegirl.club', 'https://api.justyy.com'];
async function histRpcAll() {
  const merged = [];
  const seenIdx = new Set();
  for (const node of HIST_NODES) {
    try {
      const r = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, -1, 100], id: 1 });
      for (const e of r || []) {
        if (seenIdx.has(e[0])) continue;
        seenIdx.add(e[0]);
        merged.push(e);
      }
    } catch (_) { /* node down — others cover */ }
  }
  merged.sort((a, b) => a[0] - b[0]);
  return merged;
}

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const ENV = loadDotEnv(__dirname);
const ACCOUNT = (ENV.AGENT_ACCOUNT || 'headcorner').toLowerCase();
steem.api.setOptions({ url: ENV.RPC_URL || 'https://api.steemit.com' });
const POSTING_WIF = ENV.POSTING_WIF || '';
const DRY = String(process.env.DRY_RUN || '').toLowerCase() === 'true';
const VERIFY_ONLY = process.argv.includes('--verify-only');

function log(msg) { console.log('[' + new Date().toISOString() + '] registry: ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadArmy() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || []).filter((a) => a.username).map((a) => ({
      name: String(a.username).toLowerCase(),
      chains: Object.keys(a.chains || { steem: [] }),
      hasActive: !!(a.keys && a.keys.active),
    }));
  } catch (_) {
    return [];
  }
}

async function broadcast(ops, wifs) {
  const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, wifs);
  return (conf && conf.id) || null;
}

const netOp = (payload) => [
  'custom_json',
  { required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos_net', json: JSON.stringify(payload) },
];

async function main() {
  if (!POSTING_WIF) return log('no POSTING_WIF');
  const army = loadArmy();
  const ts = new Date().toISOString();
  const V = 'saos-net/v1';

  const entries = [
    { name: 'saos://gateway.hq', type: 'server', caps: ['console', 'api', 'ui', 'exec', 'signer-host'], chains: ['steem', 'hive'], endpoint: 'caddy-gateway:443', owner: ACCOUNT, ts },
    { name: 'saos://' + ACCOUNT, type: 'hq', caps: ['treasury', 'factory', 'rc-bank', 'dex-issuer', 'escrow-arbiter'], chains: ['steem', 'hive', 'blurt'], owner: ACCOUNT, ts },
    { name: 'saos://bridge.x2', type: 'service', caps: ['anchor', 'checkpoint', 'proof-of-reserve'], chains: ['steem', 'hive'], owner: ACCOUNT, ts },
    { name: 'saos://wlog.global', type: 'service', caps: ['hash-chain', 'parity', 'third-party-verifiable'], chains: ['steem', 'hive'], owner: ACCOUNT, ts },
    { name: 'saos://dex.saos1', type: 'service', caps: ['mm', 'issuance', 'backing-derived-pricing'], chains: ['steem'], owner: ACCOUNT, ts },
    { name: 'saos://kv.store', type: 'service', caps: ['content-addressed', 'chunked', 'roundtrip-verified'], chains: ['steem', 'hive'], owner: ACCOUNT, ts },
    { name: 'saos://taskq.core', type: 'service', caps: ['mission-routing', 'encrypted-transport', 'signed-results'], chains: ['steem'], owner: ACCOUNT, ts },
  ];
  for (const s of army) {
    entries.push({
      name: 'saos://' + s.name,
      type: 'agent',
      caps: ['sign', 'curate', 'memo-exec', 'claim', s.hasActive ? 'active-ops' : 'posting-only'],
      chains: s.chains.length ? s.chains : ['steem'],
      owner: ACCOUNT,
      ts,
    });
  }

  log(VERIFY_ONLY ? 'verify-only: resolving ' + entries.length + ' names' : 'broadcasting ' + entries.length + ' registry entries (5-per-block wall → chunked by 4, measured limits.json)');
  const txids = [];
  if (!VERIFY_ONLY && !DRY) {
    // wall: max 5 custom_json per account per block (measured) — chunk by 4 with 3.2s gaps
    for (let i = 0; i < entries.length; i += 4) {
      const chunk = entries.slice(i, i + 4).map((e) => netOp({ protocol: V, action: 'register', ...e }));
      try {
        const txid = await broadcast(chunk, [POSTING_WIF]);
        txids.push(txid);
        log('chunk ' + (i / 4 + 1) + ': ' + chunk.length + ' entries → txid ' + txid);
      } catch (e) {
        log('chunk failed: ' + String((e && e.message) || e).slice(0, 120));
      }
      if (i + 4 < entries.length) await sleep(3400);
    }
  }

  // ── verify: read back from chain, rebuild registry ───────────────────
  // RPC history indexes lag broadcasts by seconds (measured live) — read
  // with retries until convergence or give up honestly.
  let seen = {};
  let missing = entries.map((e) => e.name);
  for (let attempt = 1; attempt <= 5 && missing.length > 0; attempt++) {
    await sleep(8000);
    let hist = [];
    try { hist = await histRpcAll(); } catch (_) { /* retry */ }
    seen = {};
    for (const [, e] of hist) {
      if (e.op[0] !== 'custom_json' || e.op[1].id !== 'saos_net') continue;
      try {
        const pl = JSON.parse(e.op[1].json);
        if (pl.action === 'register' && pl.name) seen[pl.name] = { ...pl, txid: e.trx_id, block: e.block };
      } catch (_) { /* next */ }
    }
    missing = entries.filter((e) => !seen[e.name]).map((e) => e.name);
    log('verify attempt ' + attempt + ': ' + Object.keys(seen).length + '/' + entries.length + ' resolved');
  }
  const onChain = Object.keys(seen).length;
  const out = {
    at: new Date().toISOString(), protocol: V, entries: entries.length,
    broadcastTxids: txids, onChainResolved: onChain, missing, verified: missing.length === 0,
    registry: seen,
  };
  fs.writeFileSync(path.join(__dirname, 'net_registry_result.json'), JSON.stringify(out, null, 2) + '\n');
  log('VERIFY: ' + onChain + '/' + entries.length + ' names resolved on-chain' + (out.verified ? ' ✓' : ' · missing: ' + missing.join(', ')));
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
