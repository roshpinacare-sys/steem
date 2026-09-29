#!/usr/bin/env node
/**
 * rc_sovereign.cjs — Task 50: RC sovereignty engine.
 * The single-account hard walls on Steem:
 *   (1) 5 custom_json ops per account per BLOCK  (measured, limits.json)
 *   (2) RC regen = f(SP), 5-day full recharge    (protocol)
 * Sovereign answers, all proven on-chain here:
 *   --map         read-only full RC map (treasury + 10 soldiers + Hive) → sustainable throughput table
 *   --salvo       N soldiers each sign ONE tx with 4 compact ops, fired in parallel
 *                 → fleet lands 4N ops in a block while any single account is capped at 5
 *   --batch       one soldier signs ONE tx with 4 ops → get_transaction proof + RC cost per op
 *   --hive-powerup  SWAP.HIVE → hivepegged withdraw → HIVE → transfer_to_vesting → HP
 *                 → measured vesting_shares/maxRc delta (the Hive RC revival)
 * All signing: soldier posting WIFs / headcorner active WIF from agent/.env + keys/vault.json
 * (never logged). Result → rc_sovereign_result.json
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/rc_sovereign.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const https = require('https');
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
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const LIVE = GATE.live;
announceGate(GATE, log);

const MODE = process.argv.includes('--salvo') ? 'salvo' : process.argv.includes('--batch') ? 'batch' : process.argv.includes('--hive-powerup') ? 'hive-powerup' : 'map';
const SALVO_SIZE = parseInt(process.env.SALVO_SIZE || "10", 10);   // 52 — כל-הצי (10×4 = 40 ops/block)
const BATCH_OPS = 4;    // ops inside ONE tx (per-account block budget is 5)

function log(msg) { console.log('[' + new Date().toISOString() + '] rcsovereign: ' + msg); }

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

function rcNow(rc) {
  if (!rc) return null;
  const max = Number(rc.max_rc) || 0;
  const stored = Number(rc.rc_manabar && rc.rc_manabar.current_mana) || 0;
  const lu = Number(rc.rc_manabar && rc.rc_manabar.last_update_time) || 0;
  const now = Math.floor(Date.now() / 1000);
  const cur = Math.min(max, stored + Math.floor(((now - lu) * max) / (5 * 86400)));
  return { max, cur, pct: max ? (cur / max) * 100 : 0 };
}
async function steemRc(name) {
  const r = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [name] }, id: 1 });
  return rcNow(r && r.rc_accounts && r.rc_accounts[0]);
}
function loadVault() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8')); } catch (_) { return { accounts: [] }; }
}
function busOp(poster, payload) {
  return ['custom_json', { required_auths: [], required_posting_auths: [poster], id: 'saos', json: JSON.stringify(payload) }];
}
async function signBroadcastSoldier(postingWif, ops) {
  const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, [postingWif]);
  return (conf && conf.id) || null;
}

/* ---------------- MODE: map (read-only) ---------------- */
async function modeMap() {
  const v = loadVault();
  const names = [ACCOUNT].concat((v.accounts || []).map((a) => a.username).filter((u) => u && u.toLowerCase() !== ACCOUNT));
  const rcRows = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: names }, id: 1 });
  const accRows = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [names], id: 1 });
  const steem = (rcRows.rc_accounts || []).map((r) => {
    const m = rcNow(r);
    const a = (accRows || []).find((x) => x.name === r.account) || {};
    const sp = (Number(String(a.vesting_shares || '0').split(' ')[0]) + Number(String(a.delegated_vesting_shares || '0').split(' ')[0])) / 1e6 * (1) ; // raw VESTS→SP approx uses global ratio; keep VESTS honest too
    return { account: r.account, maxRc: m.max, rcNow: Math.round(m.cur), pct: +m.pct.toFixed(1), vesting: String(a.vesting_shares || ''), delegIn: String(a.delegated_vesting_shares || ''), liquid: String(a.balance || '') };
  });
  let hive = null;
  try {
    const hrc = rcNow((await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [ACCOUNT] }, id: 1 })).rc_accounts[0]);
    const ha = (await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 1 }))[0];
    hive = { maxRc: hrc.max, rcNow: Math.round(hrc.cur), pct: +hrc.pct.toFixed(1), hpVests: String(ha.vesting_shares || ''), hive: String(ha.balance || ''), hbd: String(ha.hbd_balance || '') };
  } catch (_) { /* hive probe optional */ }
  // sustainable throughput: regen/day = max/5 ; cost per compact op measured in batch mode when present
  let costPerCompactOp = null;
  try { const prev = JSON.parse(fs.readFileSync(path.join(__dirname, 'rc_sovereign_result.json'), 'utf8')); if (prev.batch && prev.batch.rcCostPerOp) costPerCompactOp = prev.batch.rcCostPerOp; } catch (_) { /* first run */ }
  const throughput = steem.filter((s) => s.account !== ACCOUNT).map((s) => {
    const regenPerDay = Math.round(s.maxRc / 5);
    return { account: s.account, regenPerDay, opsPerDayCompact: costPerCompactOp ? Math.floor(regenPerDay / costPerCompactOp) : null };
  });
  const result = {
    at: new Date().toISOString(), mode: 'map',
    steem: { accounts: steem, fleetRcNow: steem.filter((s) => s.account !== ACCOUNT).reduce((t, s) => t + s.rcNow, 0), treasuryRcNow: (steem.find((s) => s.account === ACCOUNT) || {}).rcNow || 0 },
    hive,
    throughput: { costPerCompactOp, perDay: throughput, fleetOpsPerDayCompact: costPerCompactOp ? throughput.reduce((t, r) => t + r.opsPerDayCompact, 0) : null, burstOpsPerBlock: (steem.filter((s) => s.account !== ACCOUNT).length) * BATCH_OPS, singleAccountWall: 5 },
  };
  fs.writeFileSync(path.join(__dirname, 'rc_map.json'), JSON.stringify(result, null, 2) + '\n');
  for (const s of steem) log('STEEM @' + s.account.padEnd(14) + ' rc=' + (s.rcNow / 1e9).toFixed(1) + 'G/' + (s.maxRc / 1e9).toFixed(1) + 'G (' + s.pct + '%) liq=' + s.liquid);
  if (hive) log('HIVE  @' + ACCOUNT + ' rc=' + (hive.rcNow / 1e9).toFixed(2) + 'G/' + (hive.maxRc / 1e9).toFixed(2) + 'G (' + hive.pct + '%) hpVests=' + hive.hpVests);
  log('throughput: ' + JSON.stringify(result.throughput.burstOpsPerBlock) + ' ops/block burst vs wall ' + result.throughput.singleAccountWall);
  return result;
}

/* ---------------- MODE: salvo (on-chain) ---------------- */
async function modeSalvo() {
  if (!LIVE) throw new Error('salvo is on-chain — rerun with --live');
  const v = loadVault();
  const members = (v.accounts || []).filter((a) => a.username && a.username.toLowerCase() !== ACCOUNT && a.keys && a.keys.posting && a.keys.posting.wif);
  if (members.length < 2) throw new Error('no soldier posting keys in vault');
  // top-RC soldiers first
  const scored = [];
  for (const m of members.slice(0, SALVO_SIZE + 3)) {
    try { const rc = await steemRc(m.username.toLowerCase()); scored.push({ m, rc }); } catch (_) { /* skip on probe fail */ }
  }
  scored.sort((a, b) => b.rc.pct - a.rc.pct);
  const picked = scored.filter((s) => s.rc.pct >= 85).slice(0, SALVO_SIZE);
  if (picked.length < 2) throw new Error('fewer than 2 soldiers above 85% RC — regen first');
  log('salvo: ' + picked.length + ' soldiers × ' + BATCH_OPS + ' ops = ' + picked.length * BATCH_OPS + ' ops target (single-account wall=5)');

  const t0 = Date.now();
  const fired = picked.map((s, i) => {
    const u = s.m.username.toLowerCase();
    const ops = [];
    for (let k = 0; k < BATCH_OPS; k++) {
      ops.push(busOp(u, { protocol: 'saos/v1', action: 'salvo', gen: 2, soldier: u, part: k + 1 + '/' + BATCH_OPS, salvo: 50, at: new Date().toISOString() }));
    }
    return signBroadcastSoldier(s.m.keys.posting.wif, ops)
      .then((txid) => ({ soldier: u, txid, ms: Date.now() - t0, rcBeforePct: s.rc.pct }))
      .catch((e) => ({ soldier: u, error: String((e && e.message) || e).slice(0, 200) }));
  });
  const results = await Promise.all(fired);
  const ok = results.filter((r) => r.txid);
  log('salvo fired: ' + ok.length + '/' + picked.length + ' txs in ' + (Date.now() - t0) + 'ms');
  if (!ok.length) throw new Error('salvo: all broadcasts failed');

  await new Promise((r) => setTimeout(r, 12000));
  // verify each txid on-chain + group by block
  let maxSameBlock = 0; let maxBlock = null; const byBlock = {};
  for (const r of ok) {
    try {
      const tx = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_transaction', params: [r.txid], id: 1 });
      r.block = tx && tx.block_num;
      r.opsInTx = tx && tx.operations ? tx.operations.length : null;
      if (r.block) { byBlock[r.block] = (byBlock[r.block] || 0) + (r.opsInTx || 0); }
    } catch (e) { r.verifyError = String((e && e.message) || e).slice(0, 120); }
  }
  for (const [b, n] of Object.entries(byBlock)) if (n > maxSameBlock) { maxSameBlock = n; maxBlock = Number(b); }
  // block evidence: count OUR custom_json ops inside the heaviest block
  let blockEvidence = null;
  if (maxBlock) {
    try {
      const blk = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_block', params: [maxBlock], id: 1 });
      const ourNames = new Set(picked.map((p) => p.m.username.toLowerCase()));
      let ourOps = 0; let totalOps = 0;
      for (const tx of (blk && blk.transactions) || []) {
        for (const op of tx.operations || []) {
          const name = Array.isArray(op) ? op[0] : op.type; const body = Array.isArray(op) ? op[1] : op.value;
          totalOps++;
          if (name === 'custom_json' && body && body.id === 'saos') {
            const auths = (body.required_posting_auths || []).concat(body.required_auths || []).map((x) => String(x).toLowerCase());
            if (auths.some((x) => ourNames.has(x))) ourOps++;
          }
        }
      }
      blockEvidence = { block: maxBlock, ourSaosOpsInBlock: ourOps, totalTxOpsInBlock: totalOps };
    } catch (e) { blockEvidence = { error: String((e && e.message) || e).slice(0, 120) }; }
  }
  const singleWall = 5;
  const crossed = blockEvidence && blockEvidence.ourSaosOpsInBlock > singleWall;
  log('salvo: blocks=' + JSON.stringify(byBlock) + ' · maxSameBlock=' + maxSameBlock + (crossed ? ' — WALL CROSSED ×' + (blockEvidence.ourSaosOpsInBlock / singleWall).toFixed(1) : ''));
  return { mode: 'salvo', at: new Date().toISOString(), fired: ok.length, target: picked.length * BATCH_OPS, txs: ok, byBlock, maxSameBlock, maxBlock, blockEvidence, singleWall, crossed: !!crossed, latencyMsMax: Math.max(...ok.map((r) => r.ms)) };
}

/* ---------------- MODE: batch (on-chain, single tx multi-op) ---------------- */
async function modeBatch() {
  if (!LIVE) throw new Error('batch is on-chain — rerun with --live');
  const v = loadVault();
  const members = (v.accounts || []).filter((a) => a.username && a.username.toLowerCase() !== ACCOUNT && a.keys && a.keys.posting && a.keys.posting.wif);
  let best = null;
  for (const m of members) {
    try { const rc = await steemRc(m.username.toLowerCase()); if (!best || rc.pct > best.rc.pct) best = { m, rc }; } catch (_) { /* skip */ }
  }
  if (!best) throw new Error('no soldier available for batch');
  const u = best.m.username.toLowerCase();
  log('batch: @' + u + ' rc=' + best.rc.pct.toFixed(1) + '% — signing ONE tx with ' + BATCH_OPS + ' custom_json ops');
  const ops = [];
  for (let k = 0; k < BATCH_OPS; k++) ops.push(busOp(u, { protocol: 'saos/v1', action: 'batch', gen: 2, soldier: u, part: k + 1 + '/' + BATCH_OPS, at: new Date().toISOString() }));
  const txid = await signBroadcastSoldier(best.m.keys.posting.wif, ops);
  if (!txid) throw new Error('batch: no txid');
  await new Promise((r) => setTimeout(r, 9000));
  // indexer lag is real — poll up to 60s before giving up
  let tx = null;
  for (let i = 0; i < 6 && !tx; i++) {
    tx = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_transaction', params: [txid], id: 1 }).catch(() => null);
    if (!tx) await new Promise((r) => setTimeout(r, 10000));
  }
  const opsInTx = tx && tx.operations ? tx.operations.length : 0;
  const block = tx && tx.block_num;
  const rcAfter = await steemRc(u).catch(() => null);
  const rcCost = rcAfter ? Math.max(0, best.rc.cur - rcAfter.cur) : null;
  log('batch: txid=' + String(txid).slice(0, 16) + '… block=' + block + ' opsInTx=' + opsInTx + ' rcCost≈' + rcCost);
  return {
    mode: 'batch', at: new Date().toISOString(), soldier: u, txid, block, opsInTx, expectedOps: BATCH_OPS,
    verified: opsInTx === BATCH_OPS && !!block,
    rcBefore: Math.round(best.rc.cur), rcAfter: rcAfter ? Math.round(rcAfter.cur) : null,
    rcCost: rcCost, rcCostPerOp: rcCost ? Math.round(rcCost / BATCH_OPS) : null,
  };
}

/* ---------------- MODE: hive-powerup (on-chain, capital → capability) ---------------- */
async function modeHivePowerup() {
  if (!LIVE) throw new Error('hive-powerup moves real capital — rerun with --live');
  if (!ACTIVE_WIF) throw new Error('no ACTIVE_WIF');
  const before = (await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 1 }))[0];
  const rcB = rcNow((await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [ACCOUNT] }, id: 1 })).rc_accounts[0]);
  const heBal = await rpcV4('https://api.hive-engine.com/rpc/contracts', { jsonrpc: '2.0', method: 'find', params: { contract: 'tokens', table: 'balances', query: { account: ACCOUNT, symbol: 'SWAP.HIVE' }, limit: 1 }, id: 1 });
  const swap = heBal && heBal[0] ? parseFloat(heBal[0].balance) : 0;
  if (swap < 0.5) throw new Error('SWAP.HIVE balance ' + swap + ' too small to powerup');
  log('hive-powerup: SWAP.HIVE=' + swap + ' · HP(before)=' + before.vesting_shares + ' · rcMax=' + rcB.max);

  // step 1 — hivepegged withdraw (SWAP.HIVE → HIVE, 0.75% fee honest)
  const dgp1 = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 2 });
  const wOp = ['custom_json', { required_auths: [ACCOUNT], required_posting_auths: [], id: 'ssc-mainnet-hive', json: JSON.stringify({ contractName: 'hivepegged', contractAction: 'withdraw', contractPayload: {} }) }];
  const wTx = { ref_block_num: dgp1.head_block_number & 0xffff, ref_block_prefix: Buffer.from(dgp1.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(dgp1.time + 'Z').getTime() + 60000).toISOString().slice(0, 19), operations: [wOp], extensions: [] };
  const prevChainId = steem.config.get('chain_id');
  steem.config.set('chain_id', 'beeab0de00000000000000000000000000000000000000000000000000000000');
  let wSigned; try { wSigned = steem.auth.signTransaction(wTx, [ACTIVE_WIF]); } finally { steem.config.set('chain_id', prevChainId); }
  await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [wSigned], id: 3 });
  const withdrawTxid = wSigned.transaction_id || null;
  log('withdraw broadcast ✓ txid=' + String(withdrawTxid).slice(0, 16) + '… — waiting for HIVE to land');
  let liquid = 0;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const a = (await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 1 }))[0];
    liquid = parseFloat(String(a.balance).split(' ')[0]);
    if (liquid >= swap * 0.9) break;
  }
  if (liquid < 0.5) throw new Error('withdraw landed but liquid HIVE=' + liquid + ' — aborting powerup');
  const amount = (Math.floor(liquid * 1000) / 1000).toFixed(3);
  log('HIVE landed: ' + liquid + ' — powering up ' + amount + ' HIVE → HP');

  // step 2 — transfer_to_vesting
  const dgp2 = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 4 });
  const pOp = ['transfer_to_vesting', { from: ACCOUNT, to: ACCOUNT, amount: amount + ' HIVE' }];
  const pTx = { ref_block_num: dgp2.head_block_number & 0xffff, ref_block_prefix: Buffer.from(dgp2.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(dgp2.time + 'Z').getTime() + 60000).toISOString().slice(0, 19), operations: [pOp], extensions: [] };
  steem.config.set('chain_id', 'beeab0de00000000000000000000000000000000000000000000000000000000');
  let pSigned; try { pSigned = steem.auth.signTransaction(pTx, [ACTIVE_WIF]); } finally { steem.config.set('chain_id', prevChainId); }
  await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [pSigned], id: 5 });
  const powerupTxid = pSigned.transaction_id || null;
  log('powerup broadcast ✓ txid=' + String(powerupTxid).slice(0, 16) + '…');

  await new Promise((r) => setTimeout(r, 8000));
  const after = (await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 6 }))[0];
  const rcA = rcNow((await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [ACCOUNT] }, id: 7 })).rc_accounts[0]);
  const vestsB = parseFloat(String(before.vesting_shares).split(' ')[0]);
  const vestsA = parseFloat(String(after.vesting_shares).split(' ')[0]);
  const out = {
    at: new Date().toISOString(), mode: 'hive-powerup',
    swapHiveBurned: swap, withdrawTxid, powerupTxid, amountPowered: amount + ' HIVE',
    vestingBefore: vestsB, vestingAfter: vestsA, vestsDelta: +(vestsA - vestsB).toFixed(3),
    rcMaxBefore: rcB.max, rcMaxAfter: rcA.max, rcMaxDelta: rcA.max - rcB.max,
    rcRegenGainPct: rcB.max ? +(((rcA.max - rcB.max) / rcB.max) * 100).toFixed(1) : 0,
    verified: vestsA > vestsB && rcA.max > rcB.max && !!powerupTxid,
  };
  log('verified: vests +' + out.vestsDelta + ' · rcMax ' + (rcB.max / 1e9).toFixed(2) + 'G→' + (rcA.max / 1e9).toFixed(2) + 'G (+' + out.rcRegenGainPct + '%)');
  fs.writeFileSync(path.join(__dirname, 'he_powerup_result.json'), JSON.stringify(out, null, 2) + '\n');
  return out;
}

/* ---------------- main ---------------- */
async function main() {
  const prev = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'rc_sovereign_result.json'), 'utf8')); } catch (_) { return {}; } })();
  let section = null;
  if (MODE === 'map') section = await modeMap();
  else if (MODE === 'salvo') section = await modeSalvo();
  else if (MODE === 'batch') section = await modeBatch();
  else if (MODE === 'hive-powerup') section = await modeHivePowerup();
  const merged = Object.assign({}, prev, { [MODE === 'map' ? 'map' : MODE]: section, lastRun: { mode: MODE, at: new Date().toISOString() } });
  fs.writeFileSync(path.join(__dirname, 'rc_sovereign_result.json'), JSON.stringify(merged, null, 2) + '\n');
  log('done — mode=' + MODE);
}
main().catch((e) => { log('fatal: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
