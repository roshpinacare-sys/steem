#!/usr/bin/env node
/**
 * cross_shard.cjs — Task 51: cross-chain sharded state.
 *
 * The breakthrough: a single logical object (our world-state manifest) that
 * does NOT reside on any single chain. It is split into N shards; even-index
 * shards are anchored on STEEM (signed by soldiers with their own posting
 * keys), odd-index shards on HIVE (signed by soldiers on Hive — the first
 * soldier signatures ever on that chain). Anyone with public RPC access to
 * both chains can reassemble the object and verify it against the sha256
 * root. Neither chain alone holds the object; no single network can limit
 * us by its per-op size (8192B) — our effective object size is N× that.
 *
 * Modes:
 *   (default)  build manifest + shards, print plan (dry)
 *   --live     actually broadcast all shard ops, then reassemble from both
 *              chains and verify sha256(root) match.
 *
 * Result → cross_shard_result.json
 * All signing from agent/.env + keys/vault.json (never logged).
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
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv);
const LIVE = GATE.live;
announceGate(GATE, log);

const COLLECT = process.argv.includes('--collect'); // reassembly only (shards already on chain)
const OBJ = 'saos_state_51';
const SHARD_TARGET = 650; // bytes per shard payload (op stays << 8192B)

/* Steem signing soldiers (even shards) / Hive signing soldiers (odd shards) —
 * distinct signers so the object spans 6 independent keys across 2 chains. */
// Task 11-c (2026-10-01): tov removed from HIVE_SIGNERS — tov-hive = BLOCKED-NO-KEY
// (owner confirmed no more keys exist — NO economic use; vault material does not control
// tov-hive per fleet_control_audit.json, signing would be doomed). siq is hive-full.
const STEEM_SIGNERS = ['cashmachine', 'lsa', 'siq'];
const HIVE_SIGNERS = ['haran', 'macrame', 'siq'];

function log(msg) { console.log('[' + new Date().toISOString() + '] crossshard: ' + msg); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(typeof json.error === 'string' ? json.error : json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) { reject(new Error('bad rpc response: ' + data.slice(0, 120))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout 20s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/* ------------------------------------------------------------------ *
 * Vault — soldier posting WIFs (dual-chain same-keys)
 * ------------------------------------------------------------------ */
function soldierWif(name) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const acc = (v.accounts || []).find((a) => a.username === name);
    return acc && acc.keys && acc.keys.posting && acc.keys.posting.wif ? acc.keys.posting.wif : null;
  } catch (_) { return null; }
}

/* ------------------------------------------------------------------ *
 * 1) Manifest — the REAL current world state, trimmed to fit
 * ------------------------------------------------------------------ */
function readJson(p) { try { return JSON.parse(fs.readFileSync(path.join(__dirname, p), 'utf8')); } catch (_) { return null; } }

async function fetchLocalApi(pathname, ms) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port: 3000, path: pathname, method: 'GET', family: 4, headers: { 'Accept': 'application/json' }, timeout: ms || 8000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function buildManifestAsync() {
  const wlog = readJson('worldlog.json') || {};
  const fleet = readJson('fleet_state.json') || {};
  const liq = readJson('liq_state.json') || {};
  const dex = readJson('dex_mm_state.json') || {};
  const rcmap = readJson('rc_map.json') || {};
  const ledger = readJson('sovereign_ledger.json') || {};
  const status = readJson('agent-status.json') || {};
  const limits = readJson('limits.json') || {};
  const muster = readJson('muster_result.json') || {};
  const fuel = readJson('fuel_result.json') || {};
  const salvo = readJson('rc_sovereign_result.json') || {};
  const bridge = readJson('bridge_state.json') || {};
  const genesis = readJson('he_genesis_state.json') || {};
  const verify = readJson('verify_last.json') || {};
  const armySeen = readJson('army_seen.json') || {};
  // live on-chain replayed state from the local server (book + pool) — the
  // portable snapshot carries the whole trading world, not just meta
  const dexSnap = await fetchLocalApi('/api/ops/saos/dex?username=headcorner', 9000);
  const liqSnap = await fetchLocalApi('/api/ops/liq', 9000);

  const rcTable = rcmap.steem && Array.isArray(rcmap.steem.accounts)
    ? rcmap.steem.accounts.map((a) => ({ a: a.account, pct: a.pct, maxG: Math.round((Number(a.maxRc) || 0) / 1e9 * 10) / 10 }))
    : [];

  const man = {
    protocol: 'saos/v1',
    obj: OBJ,
    task: 51,
    at: new Date().toISOString(),
    worldlog: { seq: wlog.seq, head: wlog.head, total: wlog.total, lastSteemTxid: wlog.lastSteemTxid, lastHiveTxid: wlog.lastHiveTxid },
    fleet: { idx: fleet.idx, day: fleet.day, pingsToday: fleet.pingsToday, seqBy: fleet.seqBy || {} },
    liq: { day: liq.day, escrowsToday: liq.escrowsToday, lpGranted: liq.lpGranted || {}, escrowedBySoldier: liq.escrowedBySoldier || {} },
    dex: { broadcastsToday: dex.broadcastsToday, fillsToday: dex.fillsToday, lastQuotes: dex.lastQuotes || {} },
    rc: { headcorner: rcTable[0] || null, soldiers: rcTable.slice(1) },
    ledgerHead: ledger.head,
    daemon: { dryRun: status.dryRun === false ? 'live' : 'dry', feed: status.feed || null },
    walls: {
      customJsonWallBytes: limits.customJsonWallBytes || null,
      blockCadenceSec: limits.blockCadenceSec || null,
      authorityWall: limits.authorityWall || null,
      throughputTps: limits.throughputTps || null,
      probes: (limits.probes || []).slice(0, 17).map((w) => ({ n: (w.name || w.id || '?').slice(0, 28), v: String(w.value ?? w.measured ?? w.val ?? '').slice(0, 34) })),
    },
    onchain: {
      muster: { employed: muster.employed, totalEscrow: muster.totalEscrow, waves: (Array.isArray(muster.waves) ? muster.waves : []).slice(-2).map((w) => ({ n: w.n, txids: (w.txids || []).length })) },
      fuel: { spPerSoldier: fuel.spPerSoldier, delegationConfirmed: fuel.delegationConfirmed, capitalTxid: fuel.capital && fuel.capital.txid },
      salvo: { block: salvo.salvo && salvo.salvo.block, opsInBlock: salvo.salvo && salvo.salvo.ourOpsInBlock, txids: ((salvo.salvo && salvo.salvo.txids) || []).slice(-4) },
    },
    bridge: { stage: bridge.stage || bridge.status || null, anchors: bridge.anchors !== undefined ? bridge.anchors : undefined, lastTxid: bridge.lastTxid || undefined },
    genesis: { bee: genesis.bee !== undefined ? genesis.bee : undefined, step: genesis.step || genesis.stage || null, runs: genesis.runs !== undefined ? genesis.runs : undefined, saosCreated: genesis.saosCreated || undefined },
    verify: { verdict: verify.verdict || null, checks: verify.results ? verify.results.length : null },
    army: { seen: Array.isArray(armySeen) ? armySeen.length : (armySeen.seen ? Object.keys(armySeen.seen).length : null) },
    book: dexSnap && dexSnap.book ? { asks: (dexSnap.book.asks || []).slice(0, 12), bids: (dexSnap.book.bids || []).slice(0, 8), bestAsk: dexSnap.bestAsk, bestBid: dexSnap.bestBid, supply: dexSnap.supply } : null,
    pool: liqSnap && liqSnap.pool ? { reserves: liqSnap.pool.reserves, k: liqSnap.pool.k, feeBps: liqSnap.pool.feeBps, feesAccrued: liqSnap.pool.feesAccrued, swaps: liqSnap.pool.swaps, lps: (liqSnap.pool.lps || []).slice(0, 10) } : null,
  };
  let json = JSON.stringify(man);
  if (json.length > 6200) {
    // deterministic trim ladder — keep protocol identity always
    delete man.liq.lpGranted;
    json = JSON.stringify(man);
    if (json.length > 6200) { man.ledgerHead = undefined; json = JSON.stringify(man); }
    if (json.length > 6200) { man.rc = undefined; json = JSON.stringify(man); }
    if (json.length > 6200) { man.dex = undefined; json = JSON.stringify(man); }
    if (json.length > 6200) { man.liq = undefined; json = JSON.stringify(man); }
  }
  return { manifest: man, json };
}

/* ------------------------------------------------------------------ *
 * 2) Broadcast helpers — Steem (soldier posting) + Hive (soldier posting)
 * ------------------------------------------------------------------ */
function busOp(account, payload) {
  return ['custom_json', { required_auths: [], required_posting_auths: [account], id: 'saos', json: JSON.stringify(payload) }];
}

async function steemBroadcastSoldier(account, wif, ops) {
  const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, [wif]);
  return (conf && conf.id) || null;
}

async function hiveBroadcastSoldier(account, wif, ops) {
  const dgp = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: ops,
    extensions: [],
  };
  const prev = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try {
    signed = steem.auth.signTransaction(tx, [wif]);
  } finally {
    steem.config.set('chain_id', prev);
  }
  await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 2 });
  return signed.id || null; // Hive returns/derives id from signed tx
}

/* ------------------------------------------------------------------ *
 * 3) Reassembly from BOTH chains (public history only)
 * ------------------------------------------------------------------ */
const HIST_NODES = [STEEM_RPC, 'https://steemapi.boylikegirl.club', 'https://api.justyy.com'];

async function steemHistory(account, limit) {
  // api.steemit.com load-balances backends that split on history freshness
  // (measured, Task 44) — race nodes, keep the freshest window
  let best = null;
  for (const node of HIST_NODES) {
    try {
      const r = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [account, -1, limit], id: 1 });
      const arr = Array.isArray(r) ? r : [];
      if (arr.length && (!best || arr[arr.length - 1][0] > best[best.length - 1][0])) best = arr;
    } catch (_) { /* node down — next */ }
  }
  return best || [];
}

async function hiveHistory(account, limit) {
  const r = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [account, -1, limit], id: 1 });
  return Array.isArray(r) ? r : [];
}

async function collectShards() {
  const shards = [];
  const seen = new Set();
  async function harvest(chain, accounts) {
    for (const acc of accounts) {
      let hist = [];
      try {
        hist = chain === 'steem' ? await steemHistory(acc, 50) : await hiveHistory(acc, 50);
      } catch (e) { log('history ' + chain + ' @' + acc + ' failed: ' + e.message); continue; }
      for (const [, ev] of hist) {
        try {
          if (!ev || !ev.op || ev.op[0] !== 'custom_json') continue;
          const body = ev.op[1];
          if (body.id !== 'saos') continue;
          const pl = JSON.parse(String(body.json || '{}'));
          if (pl.protocol !== 'saos/v1' || pl.action !== 'shard' || pl.obj !== OBJ) continue;
          if (seen.has(pl.i)) continue;
          if (sha256(String(pl.chunk)) !== pl.sha) { log('shard ' + pl.i + ' sha mismatch — skip'); continue; }
          seen.add(pl.i);
          shards.push({ i: pl.i, n: pl.n, root: pl.root, chunk: pl.chunk, sha: pl.sha, chain, signer: acc, txid: ev.trx_id || null });
        } catch (_) { /* skip */ }
      }
    }
  }
  await harvest('steem', STEEM_SIGNERS);
  await harvest('hive', HIVE_SIGNERS);
  shards.sort((a, b) => a.i - b.i);
  return shards;
}

/* ------------------------------------------------------------------ *
 * MAIN
 * ------------------------------------------------------------------ */
async function main() {
  log('mode=' + (LIVE ? 'LIVE' : 'DRY') + ' · object=' + OBJ);

  // soldiers must exist in vault with posting keys
  const missing = [...STEEM_SIGNERS, ...HIVE_SIGNERS].filter((s) => !soldierWif(s));
  if (missing.length) { log('FATAL: missing posting WIFs in vault: ' + missing.join(',')); process.exit(1); }

  const { manifest, json } = await buildManifestAsync();
  const root = sha256(json);
  const n = Math.ceil(json.length / SHARD_TARGET);
  const shards = [];
  for (let i = 0; i < n; i++) {
    const chunk = json.slice(i * SHARD_TARGET, (i + 1) * SHARD_TARGET);
    shards.push({ i, n, root, chunk, sha: sha256(chunk) });
  }
  log('manifest ' + json.length + 'B · root ' + root.slice(0, 16) + '… · ' + n + ' shards');

  const result = {
    at: new Date().toISOString(),
    mode: LIVE ? 'live' : 'dry',
    obj: OBJ,
    root,
    manifestBytes: json.length,
    shardCount: n,
    manifest,
    shards: [],
    reassembled: false,
    reassembledRootMatch: false,
    bothChains: false,
    firstSoldierHiveSignature: false,
  };

  if (!LIVE && !COLLECT) {
    for (const s of shards) {
      const chain = s.i % 2 === 0 ? 'steem' : 'hive';
      const signer = chain === 'steem' ? STEEM_SIGNERS[Math.floor(s.i / 2) % STEEM_SIGNERS.length] : HIVE_SIGNERS[Math.floor(s.i / 2) % HIVE_SIGNERS.length];
      result.shards.push({ ...s, chain, signer, txid: null });
    }
    log('DRY plan: ' + result.shards.map((s) => '#' + s.i + '→' + s.chain + '@' + s.signer).join(' · '));
    fs.writeFileSync(path.join(__dirname, 'cross_shard_result.json'), JSON.stringify(result, null, 2) + '\n');
    log('dry result written');
    return;
  }

  if (!LIVE) {
    // --collect: shards were broadcast by an earlier --live run; reassemble only
    log('collect-only reassembly for root ' + root.slice(0, 16) + '… (fresh manifest differs — matching on-chain roots instead)');
  }

  // LIVE — broadcast each shard: even → Steem, odd → Hive
  for (const s of shards) {
    if (COLLECT) break; // shards already on chain — reassembly only
    const chain = s.i % 2 === 0 ? 'steem' : 'hive';
    const signer = chain === 'steem' ? STEEM_SIGNERS[Math.floor(s.i / 2) % STEEM_SIGNERS.length] : HIVE_SIGNERS[Math.floor(s.i / 2) % HIVE_SIGNERS.length];
    const wif = soldierWif(signer);
    const payload = { protocol: 'saos/v1', action: 'shard', gen: 2, obj: OBJ, i: s.i, n: s.n, root: s.root, sha: s.sha, chunk: s.chunk, at: new Date().toISOString() };
    const op = busOp(signer, payload);
    try {
      const txid = chain === 'steem'
        ? await steemBroadcastSoldier(signer, wif, [op])
        : await hiveBroadcastSoldier(signer, wif, [op]);
      log('shard #' + s.i + ' → ' + chain + ' @' + signer + ' txid=' + (txid || 'pending-history'));
      result.shards.push({ i: s.i, n: s.n, root: s.root, chunk: s.chunk, sha: s.sha, chain, signer, txid });
    } catch (e) {
      log('shard #' + s.i + ' broadcast FAILED: ' + e.message);
      result.shards.push({ i: s.i, n: s.n, root: s.root, chunk: s.chunk, sha: s.sha, chain, signer, txid: null, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // wait for indexers then reassemble from BOTH chains
  log('waiting 8s for chain indexers…');
  await new Promise((r) => setTimeout(r, 8000));

  let got = [];
  for (let attempt = 0; attempt < 6 && got.length < n; attempt++) {
    got = await collectShards();
    if (got.length < n) { log('attempt ' + (attempt + 1) + ': found ' + got.length + '/' + n + ' shards — retry in 5s'); await new Promise((r) => setTimeout(r, 5000)); }
  }

  // group shards by root — the complete object is the majority group with n parts
  const byRoot = {};
  for (const g of got) {
    byRoot[g.root] = byRoot[g.root] || [];
    byRoot[g.root].push(g);
  }
  const complete = Object.entries(byRoot).find(([_, arr]) => arr.length === n) || Object.entries(byRoot).sort((a, b) => b[1].length - a[1].length)[0];
  const objRoot = complete ? complete[0] : null;
  const parts = complete ? complete[1].sort((a, b) => a.i - b.i) : [];
  const idxSet = new Set(parts.map((p) => p.i));
  const joined = parts.map((p) => p.chunk).join('');
  const okAll = parts.length === n && idxSet.size === n;
  result.root = objRoot || result.root;
  result.shards = parts;
  result.reassembled = okAll;
  result.reassembledRootMatch = okAll && sha256(joined) === objRoot;
  result.bothChains = new Set(parts.map((g) => g.chain)).size === 2;
  result.firstSoldierHiveSignature = parts.some((g) => g.chain === 'hive');
  result.reconstructedBytes = joined.length;

  log('REASSEMBLY: ' + parts.length + '/' + n + ' shards · steem=' + parts.filter((g) => g.chain === 'steem').length + ' hive=' + parts.filter((g) => g.chain === 'hive').length + ' · root=' + (objRoot || 'none').slice(0, 16) + '…');
  log('root match=' + result.reassembledRootMatch + ' · bothChains=' + result.bothChains + ' · firstSoldierHiveSignature=' + result.firstSoldierHiveSignature);

  fs.writeFileSync(path.join(__dirname, 'cross_shard_result.json'), JSON.stringify(result, null, 2) + '\n');
  log('result → cross_shard_result.json');
  if (!result.reassembledRootMatch) process.exit(2);
}

main().catch((e) => { log('FATAL ' + (e.message || e)); process.exit(1); });
