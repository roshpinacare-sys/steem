#!/usr/bin/env node
/**
 * perf_bench.cjs — Task 51: measured performance — the numbers that make us
 * faster than the networks we build on.
 *
 * Measured here (all real, no simulation claims):
 *   1. RPC RACE       — our multi-endpoint query racing (4 Steem nodes ×2
 *                       rounds) vs single-node baseline latency.
 *   2. ENGINE OPS/SEC — the sovereign runner's deterministic AMM+ledger
 *                       engine running REAL pool math on LIVE reserves at
 *                       zero RC / zero network cost (local execution layer).
 *   3. INCLUSION LATENCY — live fleet tx broadcast → visible on-chain, both
 *                       chains (Steem soldier + Hive soldier), measured.
 *   4. ANCHOR         — sha256 digest of the whole benchmark report anchored
 *                       on-chain (custom_json saos/v1 action=perf) so the
 *                       benchmark itself is verifiable on the chain.
 *
 * Result → perf_bench_result.json
 * Signing: soldier posting WIFs from keys/vault.json, headcorner posting
 * from agent/.env (never logged).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const steem = require('steem');

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

const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const POSTING_WIF = process.env.POSTING_WIF || '';
const RPC_ENDPOINTS = [STEEM_RPC, 'https://steemapi.boylikegirl.club', 'https://api.justyy.com', 'https://api.steem.fans'];
const STEEM_PROBE_SOLDIER = 'wic';
const HIVE_PROBE_SOLDIER = 'wog';

function log(msg) { console.log('[' + new Date().toISOString() + '] perfbench: ' + msg); }
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv);
const DRY = GATE.dry;
announceGate(GATE, log);

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
const r3 = (v) => Number(Number(v).toFixed(3));
const r6 = (v) => Number(Number(v).toFixed(6));

function rpcV4(urlStr, body, timeoutMs) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: timeoutMs || 15000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(typeof json.error === 'string' ? json.error : json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) { reject(new Error('bad rpc: ' + data.slice(0, 100))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function soldierWif(name) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const acc = (v.accounts || []).find((a) => a.username === name);
    return acc && acc.keys && acc.keys.posting && acc.keys.posting.wif ? acc.keys.posting.wif : null;
  } catch (_) { return null; }
}

function fetchLocalApi(pathname, ms) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port: 3000, path: pathname, method: 'GET', family: 4, headers: { Accept: 'application/json' }, timeout: ms || 20000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
    req.end();
  });
}

/* ------------------------------------------------------------------ *
 * 1) RPC race — endpoint latencies
 * ------------------------------------------------------------------ */
async function rpcRace() {
  const table = [];
  for (const ep of RPC_ENDPOINTS) {
    const times = [];
    for (let round = 0; round < 2; round++) {
      const t0 = Date.now();
      try {
        await rpcV4(ep, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 }, 12000);
        times.push(Date.now() - t0);
      } catch (_) { times.push(null); }
    }
    const ok = times.filter((t) => t != null);
    const p50 = ok.length ? ok.slice().sort((a, b) => a - b)[Math.floor(ok.length / 2)] : null;
    table.push({ endpoint: new URL(ep).hostname, p50ms: p50, maxMs: ok.length ? Math.max(...ok) : null, fails: times.filter((t) => t == null).length });
  }
  const okNodes = table.filter((t) => t.p50ms != null);
  const bestSingle = okNodes.length ? Math.min(...okNodes.map((t) => t.p50ms)) : null;
  const t0 = Date.now();
  await Promise.allSettled(RPC_ENDPOINTS.map((ep) => rpcV4(ep, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 }, 12000)));
  const raceMs = Date.now() - t0; // racing = wait for FIRST useful answer (all in parallel)
  return { table, bestSingleMs: bestSingle, raceAllMs: raceMs };
}

/* ------------------------------------------------------------------ *
 * 2) Engine throughput — deterministic AMM+ledger on live reserves, zero RC
 * ------------------------------------------------------------------ */
function engineBench(reserves) {
  const N = 2000;
  let saos = reserves.saos || 9.305, steem = reserves.steem || 0.159264, k = saos * steem;
  const feeBps = 30;
  let digest = '';
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) {
    // deterministic pseudo-trade sizing from digest chain (no RNG dependency)
    digest = sha256(digest + ':' + i);
    const seed = parseInt(digest.slice(0, 8), 16) / 0xffffffff;
    const inAmt = r6(0.01 + seed * 0.5);
    const withFee = r6(inAmt * (1 - feeBps / 10000));
    // sell_saos: SAOS in → STEEM out
    const out = r6((steem * withFee) / (saos + withFee));
    saos = r3(saos + inAmt);
    steem = r6(steem - out);
    // counter-cycle buy to stay around the anchor point
    const back = r6(inAmt * 0.98);
    const withFeeB = r6(back * (1 - feeBps / 10000));
    const outS = r3((saos * withFeeB) / (steem + withFeeB));
    steem = r6(steem + back);
    saos = r3(saos - outS);
    k = saos * steem; // invariant tracked
  }
  const t1 = process.hrtime.bigint();
  const elapsedMs = Number(t1 - t0) / 1e6;
  const opsPerSec = Math.round((N * 2) / (elapsedMs / 1000));
  const usPerOp = Math.round((elapsedMs * 1000) / (N * 2));
  return { iterations: N, swapsComputed: N * 2, elapsedMs: Math.round(elapsedMs * 100) / 100, opsPerSec, usPerOp, finalK: k, r3Digest: digest.slice(0, 12) };
}

/* ------------------------------------------------------------------ *
 * 3) Inclusion latency — live broadcast → visible, both chains
 * ------------------------------------------------------------------ */
function busOp(account, payload) {
  return ['custom_json', { required_auths: [], required_posting_auths: [account], id: 'saos', json: JSON.stringify(payload) }];
}

async function steemInclusionLatency(soldier) {
  const wif = soldierWif(soldier);
  const t0 = Date.now();
  const payload = { protocol: 'saos/v1', action: 'perf_probe', gen: 2, chain: 'steem', t0: new Date(t0).toISOString(), note: 'inclusion-latency probe' };
  const conf = await steem.broadcast.sendAsync({ operations: [busOp(soldier, payload)], extensions: [] }, [wif]);
  const txid = (conf && conf.id) || null;
  if (!txid) return { chain: 'steem', soldier, txid: null, error: 'no txid from confirmation' };
  // poll multi-node history for the op; latency = block_time − t0 (authoritative,
  // independent of indexer lag). get_transaction on api.steemit.com lags badly
  // for fresh txs (Unknown Transaction even after inclusion — measured).
  const nodes = [STEEM_RPC, 'https://steemapi.boylikegirl.club', 'https://api.justyy.com'];
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    for (const node of nodes) {
      try {
        const hist = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [soldier, -1, 10], id: 1 });
        for (const [, ev] of hist || []) {
          if (!ev || ev.op[0] !== 'custom_json' || ev.op[1].id !== 'saos') continue;
          let pl;
          try { pl = JSON.parse(String(ev.op[1].json || '{}')); } catch (_) { continue; }
          if (pl.t0 === payload.t0 && ev.trx_id) {
            const lat = Date.parse(ev.timestamp || ev.block_time) - t0;
            return { chain: 'steem', soldier, txid: ev.trx_id, block: ev.block, latencyMs: lat, method: 'history-scan(block_time)' };
          }
        }
      } catch (_) { /* next node */ }
    }
  }
  return { chain: 'steem', soldier, txid, error: 'not visible within 90s across 3 nodes' };
}

async function hiveInclusionLatency(soldier) {
  const wif = soldierWif(soldier);
  const t0 = Date.now();
  const dgp = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
  const payload = { protocol: 'saos/v1', action: 'perf_probe', gen: 2, chain: 'hive', t0: new Date(t0).toISOString(), note: 'inclusion-latency probe' };
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [busOp(soldier, payload)],
    extensions: [],
  };
  const prev = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try { signed = steem.auth.signTransaction(tx, [wif]); } finally { steem.config.set('chain_id', prev); }
  await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 2 });
  // steem-js does not derive an id for Hive txs — locate via history scan;
  // latency = block_time − t0 (authoritative)
  const deadlineH = Date.now() + 90000;
  while (Date.now() < deadlineH) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const hist = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [soldier, -1, 10], id: 1 });
      for (const [, ev] of hist || []) {
        if (!ev || ev.op[0] !== 'custom_json' || ev.op[1].id !== 'saos') continue;
        let pl;
        try { pl = JSON.parse(String(ev.op[1].json || '{}')); } catch (_) { continue; }
        if (pl.t0 === payload.t0 && ev.trx_id) {
          const lat = Date.parse(ev.timestamp || ev.block_time) - t0;
          return { chain: 'hive', soldier, txid: ev.trx_id, block: ev.block, latencyMs: lat, method: 'history-scan(block_time)' };
        }
      }
    } catch (_) { /* retry */ }
  }
  return { chain: 'hive', soldier, txid: null, error: 'not visible in history within 90s' };
}

/* ------------------------------------------------------------------ *
 * MAIN
 * ------------------------------------------------------------------ */
async function main() {
  log('benchmark starting — all measurements real');

  // 1. RPC race
  const rpcRaceRes = await rpcRace();
  log('RPC race: best single=' + rpcRaceRes.bestSingleMs + 'ms · 4-node race=' + rpcRaceRes.raceAllMs + 'ms');
  for (const t of rpcRaceRes.table) log('  ' + t.endpoint + ' p50=' + t.p50ms + 'ms fails=' + t.fails);

  // 2. Engine throughput on LIVE reserves
  const liq = await fetchLocalApi('/api/ops/liq', 20000);
  const reserves = liq && liq.pool && liq.pool.reserves ? { saos: Number(liq.pool.reserves.saos), steem: Number(liq.pool.reserves.steem) } : { saos: 9.305, steem: 0.159264 };
  const engine = engineBench(reserves);
  log('engine: ' + engine.swapsComputed + ' AMM swaps in ' + engine.elapsedMs + 'ms → ' + engine.opsPerSec + ' ops/sec (' + engine.usPerOp + 'µs/op) · zero RC');

  // 3. Inclusion latency both chains (fresh fleet signatures)
  const incl = { steem: null, hive: null };
  if (DRY) log('[DRY] LIVE-GATE — inclusion-latency probes + on-chain anchor skipped (nothing broadcast)');
  const [steemRes, hiveRes] = DRY ? [{ chain: 'steem', error: 'DRY (live-gate)' }, { chain: 'hive', error: 'DRY (live-gate)' }] : await Promise.all([
    steemInclusionLatency(STEEM_PROBE_SOLDIER).catch((e) => ({ chain: 'steem', error: e.message })),
    hiveInclusionLatency(HIVE_PROBE_SOLDIER).catch((e) => ({ chain: 'hive', error: e.message })),
  ]);
  incl.steem = steemRes; incl.hive = hiveRes;
  log('inclusion: steem=' + (steemRes.latencyMs != null ? steemRes.latencyMs + 'ms blk ' + steemRes.block : (steemRes.error || '?')) + ' · hive=' + (hiveRes.latencyMs != null ? hiveRes.latencyMs + 'ms blk ' + hiveRes.block : (hiveRes.error || '?')));

  // 4. Anchor the benchmark digest on-chain (headcorner posting)
  const report = {
    at: new Date().toISOString(),
    rpc: rpcRaceRes,
    engine,
    inclusion: incl,
    reservesUsed: reserves,
  };
  const digest = sha256(JSON.stringify(report));
  let anchor = null;
  if (DRY) {
    anchor = { digest, error: 'DRY (live-gate) — nothing broadcast' };
  } else if (POSTING_WIF) {
    try {
      const payload = {
        protocol: 'saos/v1', action: 'perf', gen: 2,
        digest,
        engineOpsSec: engine.opsPerSec,
        inclusionSteemMs: incl.steem && incl.steem.latencyMs != null ? incl.steem.latencyMs : null,
        inclusionHiveMs: incl.hive && incl.hive.latencyMs != null ? incl.hive.latencyMs : null,
        rpcBestMs: rpcRaceRes.bestSingleMs, rpcRaceMs: rpcRaceRes.raceAllMs,
        at: report.at,
      };
      const conf = await steem.broadcast.sendAsync({ operations: [busOp('headcorner', payload)], extensions: [] }, [POSTING_WIF]);
      anchor = { txid: (conf && conf.id) || null, digest };
      log('benchmark anchored on-chain txid=' + anchor.txid);
    } catch (e) { log('anchor failed: ' + e.message); anchor = { digest, error: e.message }; }
  } else {
    anchor = { digest, error: 'no POSTING_WIF in env' };
    log('anchor skipped — no posting WIF');
  }

  const result = { ...report, anchor };
  fs.writeFileSync(path.join(__dirname, 'perf_bench_result.json'), JSON.stringify(result, null, 2) + '\n');
  log('result → perf_bench_result.json');
}

main().catch((e) => { log('FATAL ' + (e.message || e)); process.exit(1); });
