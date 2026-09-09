#!/usr/bin/env node
/**
 * net_kv.cjs — SAOS-KV v1: content-addressed storage ON THE CHAIN.
 *
 * Storage primitive of the smart network: any JSON document, keyed by name,
 * hashed by sha256, chunked across the 8192B custom_json wall (measured in
 * limits.json). Read-back is mandatory: put → read from chain → reassemble
 * → hash-compare. No hash match, no proof.
 *
 *   put: custom_json id='saos_kv' { protocol:'saos-kv/v1', action:'put',
 *         key, part, parts, size, sha256, data }
 *
 * Usage: node net_kv.cjs --put <key> --file <path> | --manifest | --get <key>
 * Result → agent/net_kv_result.json
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const steem = require('steem');

/** direct jsonrpc — steem-js history transport lags on some nodes (measured) */
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
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry || String(process.env.DRY_RUN || '').toLowerCase() === 'true';
announceGate(Object.assign({}, GATE, { live: !DRY, dry: DRY }), log);

const argOf = (name, dflt) => { const i = process.argv.indexOf(name); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };

const MAX_OP_JSON = 8000; // measured wall: 8192 — keep 192B headroom for envelope
const MODE = process.argv.includes('--manifest') ? 'manifest' : (process.argv.includes('--get') ? 'get' : 'put');
const KEY = argOf('--key', null);
const FILE = argOf('--file', null);

function log(msg) { console.log('[' + new Date().toISOString() + '] kv: ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** build the manifest — the network describing itself with LIVE state */
async function buildManifest() {
  const m = { protocol: 'saos-net/v1', doc: 'manifest', account: ACCOUNT, ts: new Date().toISOString() };
  try {
    const dgp = await steem.api.getDynamicGlobalPropertiesAsync();
    m.chainTime = dgp.time; m.headBlock = dgp.head_block_number;
  } catch (_) { /* keep */ }
  try {
    const w = JSON.parse(fs.readFileSync(path.join(__dirname, 'worldlog.json'), 'utf8'));
    m.worldlog = { seq: w.seq, lastHash: w.prev, total: w.total };
  } catch (_) { /* keep */ }
  try {
    const r = JSON.parse(fs.readFileSync(path.join(__dirname, 'net_registry_result.json'), 'utf8'));
    m.registry = { names: Object.keys(r.registry || {}), verified: r.verified };
  } catch (_) { /* keep */ }
  try {
    const l = JSON.parse(fs.readFileSync(path.join(__dirname, 'limits.json'), 'utf8'));
    m.limits = { customJsonWallBytes: l.customJsonWallBytes || 8192, customJsonPerBlock: 5, memoWall: 2048, authorityMax: 40, blockSec: l.blockCadenceSec };
  } catch (_) { /* keep */ }
  try {
    const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'agent-status.json'), 'utf8'));
    m.identity = { evm: st.identity && st.identity.evmAddress, heSwapHive: st.identity && st.identity.heSwapHive };
    m.army = st.army && st.army.size;
  } catch (_) { /* keep */ }
  return m;
}

async function putDoc(key, doc) {
  const json = JSON.stringify(doc);
  const sha = crypto.createHash('sha256').update(json).digest('hex');
  const size = Buffer.byteLength(json);
  // chunk the RAW data; envelope budget per op ≈ MAX_OP_JSON
  const chunkData = Math.max(2000, MAX_OP_JSON - 420);
  const parts = Math.max(1, Math.ceil(size / chunkData));
  log('put "' + key + '" · ' + size + 'B · sha256=' + sha.slice(0, 16) + '… · ' + parts + ' part(s)');
  if (DRY) { log('[DRY] skip broadcast'); return { dry: true, parts, size, sha }; }
  const txids = [];
  for (let p = 0; p < parts; p++) {
    const data = json.slice(p * chunkData, (p + 1) * chunkData);
    const payload = { protocol: 'saos-kv/v1', action: 'put', key, part: p, parts, size, sha256: sha, data };
    const op = ['custom_json', { required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos_kv', json: JSON.stringify(payload) }];
    // wall: ≤5 custom_json per block → single op per broadcast, 3.2s gaps
    const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [POSTING_WIF]);
    txids.push((conf && conf.id) || null);
    log('  part ' + (p + 1) + '/' + parts + ' → txid ' + ((conf && conf.id) || 'n/a'));
    if (p + 1 < parts) await sleep(3400);
  }
  return { key, size, sha256: sha, parts, txids };
}

async function readDoc(key, maxOps = 100) {
  // RPC history indexes lag broadcasts (measured live) — retry until convergence
  for (let attempt = 1; attempt <= 6; attempt++) {
    let hist = [];
    try { hist = await histRpcAll(); } catch (_) { /* retry */ }
    const byPart = {};
    let meta = null;
    for (const [, e] of hist) {
      if (e.op[0] !== 'custom_json' || e.op[1].id !== 'saos_kv') continue;
      try {
        const pl = JSON.parse(e.op[1].json);
        if (pl.action !== 'put' || pl.key !== key) continue;
        byPart[pl.part] = { data: pl.data, txid: e.trx_id };
        meta = { parts: pl.parts, sha256: pl.sha256, size: pl.size };
      } catch (_) { /* next */ }
    }
    if (meta && Object.keys(byPart).length >= meta.parts) {
      const json = Array.from({ length: meta.parts }, (_, i) => byPart[i].data).join('');
      const sha = crypto.createHash('sha256').update(json).digest('hex');
      return {
        key, parts: meta.parts, size: meta.size,
        hashMatch: sha === meta.sha256,
        sha256: sha, expectedSha256: meta.sha256,
        doc: JSON.parse(json),
        txids: Array.from({ length: meta.parts }, (_, i) => byPart[i].txid),
        attempts: attempt,
      };
    }
    if (attempt < 6) await sleep(6000);
  }
  return null;
}

async function main() {
  if (!POSTING_WIF) return log('no POSTING_WIF');
  let result;

  if (MODE === 'get') {
    if (!KEY) return log('--get requires --key');
    const r = await readDoc(KEY);
    result = r || { key: KEY, found: false };
    log(r ? (r.incomplete ? 'READ: incomplete ' + r.have + '/' + r.need : 'READ: hashMatch=' + r.hashMatch) : 'READ: not found');
  } else {
    let key, doc;
    if (MODE === 'manifest') {
      key = argOf('--key', 'saos://manifest');
      doc = await buildManifest();
      log('manifest: ' + JSON.stringify(doc).length + 'B built from live state');
    } else {
      if (!KEY || !FILE) return log('--put requires --key and --file');
      key = KEY;
      doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    }
    const put = await putDoc(key, doc);
    await sleep(4000);
    const back = await readDoc(key);
    result = { at: new Date().toISOString(), put, readBack: back, verified: !!(back && back.hashMatch) };
    log('ROUNDTRIP: ' + (result.verified ? 'VERIFIED ✓ sha256 match on-chain' : (back && back.incomplete ? 'incomplete ' + back.have + '/' + back.need : 'HASH MISMATCH — NOT verified')));
  }

  fs.writeFileSync(path.join(__dirname, 'net_kv_result.json'), JSON.stringify(result, null, 2) + '\n');
  log('→ net_kv_result.json');
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
