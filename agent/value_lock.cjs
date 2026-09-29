#!/usr/bin/env node
/**
 * value_lock.cjs — Task 53: the value-lock rail, manual/exec path.
 *
 * "איך מייצרים ערך מכל התזוזות — ונועלים יותר ערך בבריכות שלנו":
 *   1. treasury liquid SAOS slice (25%, cap 3, floor 0.05) → pool_add
 *   2. pool_lock 100% — LP moves to the permanent-lock bucket (never removable,
 *      fees keep flowing) — a contract semantic the chains never had.
 *   3. manifest anchored on Hive via the fleet router (1 local action → 2 chains)
 *
 * Shares value_lock_state.json with the daemon loop (20-min freshness guard).
 * The engine (saos-dex.ts + rebuild.cjs) understands pool_lock deterministically.
 *
 * Usage: node value_lock.cjs [--dry]
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/value_lock.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';

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
const CONSOLE = process.env.CONSOLE_URL || 'http://localhost:3000';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE, log);

const STATE_PATH = path.join(__dirname, 'value_lock_state.json');
const RESULT_PATH = path.join(__dirname, 'value_lock_result.json');

function log(msg) { console.log('[' + new Date().toISOString() + '] value_lock: ' + msg); }
const r3 = (x) => Math.round(x * 1000) / 1000;
const r6 = (x) => Math.round(x * 1e6) / 1e6;

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 25000 },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => { try { const json = JSON.parse(buf); resolve(json.result !== undefined ? json.result : json); } catch (e) { reject(e); } });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end(payload);
  });
}

async function main() {
  const state = (() => { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (_) { return { seq: 0, lockedLp: 0, lockedSaosCum: 0, lastAt: null, lastTxid: null, lastHiveTxid: null, lastHiveVia: null, depthBefore: null, depthAfter: null }; } })();
  const result = { at: new Date().toISOString(), mode: DRY ? 'dry' : 'live', steps: [] };
  const step = (s) => { result.steps.push(s); log(JSON.stringify(s).slice(0, 300)); };

  if (!DRY && !POSTING_WIF) { step({ step: 'guard', error: 'no POSTING_WIF' }); fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n'); process.exit(1); }
  if (!DRY && state.lastAt && Date.now() - Date.parse(state.lastAt) < 20 * 60000) {
    step({ step: 'freshness-guard', detail: 'recent lock at ' + state.lastAt + ' — skip (daemon owns the cadence)' });
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // 1) live dex snapshot
  const dex = await fetch(CONSOLE + '/api/ops/saos/dex?username=' + encodeURIComponent(ACCOUNT), { signal: AbortSignal.timeout(40000) }).then((r) => r.json()).catch(() => null);
  if (!dex || dex.ok !== true || !dex.mine) { step({ step: 'dex', error: 'snapshot unavailable' }); fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n'); process.exit(1); }
  const pool = (dex.pools || []).find((p) => p.pair === 'SAOS:STEEM');
  if (!pool || !(pool.lpSupply > 1e-9)) { step({ step: 'pool', error: 'pool not open' }); fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n'); process.exit(1); }
  const liquid = Number(dex.mine.saosLiquid) || 0;
  // 54 — VALUE_LOCK_MAX: one-shot override for deeper locks (default stays 3)
  const capMax = (() => { const n = parseFloat(process.env.VALUE_LOCK_MAX); return Number.isFinite(n) && n > 0 ? n : 3; })();
  const amt = r3(Math.min(liquid * 0.25, capMax));
  const depthBefore = pool.saos;
  step({ step: 'measured', liquid, lockAmt: amt, depthBefore, lpSupply: pool.lpSupply, lockedAlready: pool.locked || 0 });
  if (!(amt >= 0.05)) { step({ step: 'floor', detail: 'below 0.05 floor — nothing to lock' }); fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n'); return; }

  const time = new Date().toISOString();
  const addPayload = { protocol: 'saos/v1', action: 'pool_add', pair: 'SAOS:STEEM', account: ACCOUNT, saosAmt: amt, steemAmt: 0, time };
  const lockPayload = { protocol: 'saos/v1', action: 'pool_lock', pair: 'SAOS:STEEM', account: ACCOUNT, pct: 1, time };
  result.addPayload = addPayload; result.lockPayload = lockPayload;

  if (DRY) {
    step({ step: 'dry', detail: 'would lock ' + amt + ' SAOS at depth ' + depthBefore });
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // 2) Steem broadcast — pool_add + pool_lock in one tx (issuer-signed)
  const busOp = (payload) => ['custom_json', { required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos', json: JSON.stringify(payload) }];
  const conf = await steem.broadcast.sendAsync({ operations: [busOp(addPayload), busOp(lockPayload)], extensions: [] }, [POSTING_WIF]);
  const txid = (conf && conf.id) || null;
  result.txid = txid;
  step({ step: 'steem-broadcast', txid });

  // 3) Hive anchor of the lock manifest via fleet router
  const manifest = { protocol: 'saos/v1', action: 'value_lock', account: ACCOUNT, seq: state.seq + 1, lockedSaos: amt, depthBefore, time, srcTxid: txid, note: 'LP locked permanently — fees keep flowing' };
  let hive = null;
  try {
    const vault = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const soldiers = (vault.accounts || [])
      .filter((a) => a.username && a.keys && a.keys.posting && a.keys.posting.wif && a.username.toLowerCase() !== ACCOUNT)
      .map((a) => ({ u: a.username.toLowerCase(), wif: a.keys.posting.wif }));
    // rc race on Hive — first signer wins, fall through on failure
    for (const s of soldiers) {
      try {
        const dgp = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
        const tx = {
          ref_block_num: dgp.head_block_number & 0xffff,
          ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
          expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
          operations: [['custom_json', { required_auths: [], required_posting_auths: [s.u], id: 'saos', json: JSON.stringify(manifest) }]],
          extensions: [],
        };
        const prev = steem.config.get('chain_id');
        steem.config.set('chain_id', HIVE_CHAIN_ID);
        let signed;
        try { signed = steem.auth.signTransaction(tx, [s.wif]); } finally { steem.config.set('chain_id', prev); }
        await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 2 });
        hive = { account: s.u };
        result.hiveVia = s.u;
        step({ step: 'hive-broadcast', account: s.u });
        break;
      } catch (e) {
        step({ step: 'hive-try-failed', account: s.u, error: String((e && e.message) || e).slice(0, 80) });
        continue;
      }
    }
    if (hive) {
      // visibility check in the signer's history
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const hist = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [hive.account, -1, 10], id: 3 });
          const arr = Array.isArray(hist) ? hist : [];
          for (const [, e] of arr) {
            if (e.op[0] !== 'custom_json' || e.op[1].id !== 'saos') continue;
            try { const pl = JSON.parse(String(e.op[1].json || '{}')); if (pl.time === time) { hive.txid = e.trx_id || null; break; } } catch (_) {}
          }
          if (hive.txid) break;
        } catch (_) {}
      }
      result.hiveTxid = hive.txid || null;
      step({ step: 'hive-verify', txid: hive.txid || 'pending-visibility' });
    }
  } catch (e) {
    step({ step: 'hive-route', error: String((e && e.message) || e).slice(0, 100) });
  }

  // post-lock depth: the engine re-replays from chain history — indexing lags
  // 2-10s behind broadcast, so wait 8s and re-read until depth moves (max 3×8s)
  let depthAfter = null;
  let lockedLp = null;
  let lpSupplyAfter = null;
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 8000));
    const dx = await fetch(CONSOLE + '/api/ops/saos/dex?username=' + encodeURIComponent(ACCOUNT), { signal: AbortSignal.timeout(40000) }).then((r) => r.json()).catch(() => null);
    const p2 = dx && dx.ok ? (dx.pools || []).find((p) => p.pair === 'SAOS:STEEM') : null;
    if (p2 && Math.abs((p2.saos || 0) - depthBefore) > 1e-9) {
      depthAfter = p2.saos;
      lockedLp = r6(p2.locked || 0);
      lpSupplyAfter = p2.lpSupply;
      break;
    }
    if (p2) { depthAfter = p2.saos; lockedLp = r6(p2.locked || 0); lpSupplyAfter = p2.lpSupply; }
  }
  result.depthAfter = depthAfter;
  result.lockedLp = lockedLp;
  result.lpSupplyAfter = lpSupplyAfter;

  // 5) state
  state.seq += 1;
  state.lastAt = time;
  state.lastTxid = txid;
  state.lastHiveTxid = (hive && hive.txid) || state.lastHiveTxid || null;
  state.lastHiveVia = (hive && hive.account) || state.lastHiveVia || null;
  state.lockedSaosCum = r3((state.lockedSaosCum || 0) + amt);
  if (result.lockedLp != null) state.lockedLp = result.lockedLp;
  state.depthBefore = depthBefore;
  state.depthAfter = result.depthAfter;
  try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n'); } catch (_) {}
  result.state = state;
  step({ step: 'state', lockedSaosCum: state.lockedSaosCum, lockedLp: state.lockedLp });
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
  log('DONE — locked ' + amt + ' SAOS · txid ' + (txid || 'n/a').slice(0, 16));
}

main().catch((e) => {
  log('FATAL: ' + String((e && e.message) || e));
  try { fs.appendFileSync(RESULT_PATH, JSON.stringify({ at: new Date().toISOString(), fatal: String((e && e.message) || e) }, null, 2)); } catch (_) {}
  process.exit(1);
});
