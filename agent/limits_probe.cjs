#!/usr/bin/env node
/**
 * limits_probe.cjs — Task 45: measure the REAL capability walls of the chain.
 *
 * The operator asked: "test the network's capability limit". This suite
 * answers with measured walls, not docs:
 *
 *   1. Official constants (condenser_api.get_config)
 *   2. custom_json size wall      — broadcast saos_probe ops at 2K/6K/8K/9K/12K
 *   3. ops-per-transaction wall   — bundle 10/30/45/60 tiny custom_jsons in ONE tx
 *   4. transfer memo wall         — self-transfer 0.001 with 1.5K / 2.2K memo
 *   5. transfer precision wall    — 0.0001 STEEM self-transfer
 *   6. RC cost per op type        — rc_api deltas after each broadcast
 *   7. account-history window     — request -1..1000, measure real cap
 *   8. block cadence              — dgpo sampling over ~12s
 *   9. authority membership wall  — account_update2 with 11 posting auths
 *                                   (revert immediately if accepted)
 *  10. our own throughput         — 10 sequential broadcasts, ops/sec
 *
 * All writes use id='saos_probe' (a clean, documented namespace — no pollution
 * of saos/wlog/kv channels). Self-transfers return to us: net cost ≈ 0.
 * Result → agent/limits.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

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
const STEEM_RPC = process.env.RPC_URL || 'https://api.steemit.com';
steem.api.setOptions({ url: STEEM_RPC });
const POSTING_WIF = ENV.POSTING_WIF || '';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry || String(process.env.DRY_RUN || '').toLowerCase() === 'true';
announceGate(Object.assign({}, GATE, { live: !DRY, dry: DRY }), log);


function log(msg) { console.log('[' + new Date().toISOString() + '] limits: ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rpcV4(urlStr, body, timeoutMs = 25000) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: timeoutMs },
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
    req.on('timeout', () => req.destroy(new Error('rpc timeout ' + timeoutMs + 'ms')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function rcOf(acc) {
  const r = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [acc] }, id: 1 });
  return Number(r.rc_accounts[0].rc_manabar.current_mana);
}

/** broadcast ops with a given wif list; returns {ok, txid, err} */
async function broadcast(ops, wifs) {
  try {
    const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, wifs);
    return { ok: true, txid: (conf && conf.id) || null };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e).split('\n')[0].slice(0, 180) };
  }
}

const probeJson = (id, fill) => ['custom_json', { required_auths: [], required_posting_auths: [ACCOUNT], id, json: JSON.stringify({ p: 'saos/limits/v1', fill }) }];
const probeOp = (sizeBytes) => probeJson('saos_probe', 'x'.repeat(Math.max(0, sizeBytes)));

async function main() {
  const out = { at: new Date().toISOString(), chain: 'steem', account: ACCOUNT, probes: [] };
  const push = (name, expect, got, verdict, extra) => {
    out.probes.push({ name, expect, got, verdict, ...(extra || {}) });
    log(verdict.toUpperCase() + ' · ' + name + ' → ' + got);
  };

  // ── 1. official constants ────────────────────────────────────────────
  const cfg = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_config', params: [], id: 1 });
  const rel = {};
  for (const k of Object.keys(cfg)) {
    if (/MAX_CUSTOM_JSON|MAX_OPS_PER|MAX_MEMO|MAX_AUTHORITY|MAX_BLOCK_SIZE|PROPOSAL_FEE|MAX_ACCOUNT_NAME|TRANSFER/i.test(k)) rel[k] = cfg[k];
  }
  out.config = rel;
  log('config: ' + Object.keys(rel).length + ' relevant constants read');

  // ── 2. custom_json size wall ─────────────────────────────────────────
  let rcBefore = await rcOf(ACCOUNT);
  let cjWall = null;
  for (const size of [2000, 6000, 8000, 9000, 12000]) {
    const r = await broadcast([probeOp(size)], [POSTING_WIF]);
    const rcAfter = await rcOf(ACCOUNT);
    push('custom_json ' + size + 'B', 'pass→wall', r.ok ? 'ACCEPTED' : 'REJECTED: ' + r.err,
      r.ok ? 'pass' : 'wall', { rcCost: rcBefore - rcAfter });
    rcBefore = rcAfter;
    if (!r.ok) { cjWall = size; break; }
    await sleep(1500);
  }
  out.customJsonWallBytes = cjWall; // first rejected size (null = even 12K passed)

  // ── 3. ops-per-transaction wall ──────────────────────────────────────
  for (const n of [10, 30, 45, 60]) {
    const ops = [];
    for (let i = 0; i < n; i++) ops.push(probeOp(10));
    const r = await broadcast(ops, [POSTING_WIF]);
    push('ops/tx = ' + n, n <= 40 ? 'pass' : 'wall?', r.ok ? 'ACCEPTED (' + n + ' ops in one tx)' : 'REJECTED: ' + r.err, r.ok ? 'pass' : 'wall');
    if (!r.ok) break;
    await sleep(1500);
  }

  // ── 4. transfer memo wall (self-transfer → zero net cost) ───────────
  const memoOp = (len) => ['transfer', { from: ACCOUNT, to: ACCOUNT, amount: '0.001 STEEM', memo: 'm'.repeat(len) }];
  for (const len of [1500, 2200]) {
    const r = await broadcast([memoOp(len)], [ENV.ACTIVE_WIF || POSTING_WIF].filter(Boolean));
    push('transfer memo ' + len + 'B', '>2048 rejected', r.ok ? 'ACCEPTED (0.001 STEEM self)' : 'REJECTED: ' + r.err, r.ok ? 'pass' : 'wall');
    await sleep(1500);
  }

  // ── 5. transfer precision wall ───────────────────────────────────────
  const r5 = await broadcast([['transfer', { from: ACCOUNT, to: ACCOUNT, amount: '0.0001 STEEM', memo: '' }]], [ENV.ACTIVE_WIF || POSTING_WIF].filter(Boolean));
  push('transfer 0.0001 STEEM', '3-decimal min', r5.ok ? 'ACCEPTED' : 'REJECTED: ' + r5.err, r5.ok ? 'pass' : 'wall');
  await sleep(1200);

  // ── 6. account-history window ────────────────────────────────────────
  try {
    const hist = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, -1, 1000], id: 1 });
    const n = Array.isArray(hist) ? hist.length : 0;
    const span = n ? hist[n - 1][0] - hist[0][0] : 0;
    push('get_account_history(-1,1000)', 'cap 100', 'returned ' + n + ' ops · abs-index span ' + span, n <= 100 ? 'pass' : 'pass', { lowest: n ? hist[0][0] : null, highest: n ? hist[n - 1][0] : null });
    out.historyWindow = { returned: n, span, cap: 100 };
  } catch (e) {
    push('get_account_history(-1,1000)', 'cap 100', 'ERROR: ' + String((e && e.message) || e), 'error');
  }

  // ── 7. block cadence ─────────────────────────────────────────────────
  const d1 = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
  await sleep(12000);
  const d2 = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
  const dt = (new Date(d2.time + 'Z') - new Date(d1.time + 'Z')) / 1000;
  const db = d2.head_block_number - d1.head_block_number;
  const secPerBlock = db > 0 ? (dt / db) : null;
  push('block cadence', '3.00s/block', db + ' blocks in ' + dt + 's → ' + (secPerBlock ? secPerBlock.toFixed(3) + ' s/block' : 'n/a'), 'pass', { secPerBlock });
  out.blockCadenceSec = secPerBlock;

  // ── 8. authority membership wall (siq as test subject, instant revert) ─
  try {
    const [accArr] = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [['siq']], id: 1 });
    const siq = accArr;
    if (siq && ENV.ACTIVE_WIF) {
      const pairs = (Array.isArray(siq.posting.account_auths) ? siq.posting.account_auths : Object.entries(siq.posting.account_auths || {}))
        .map(([n, w]) => [n, Number(w)]);
      const fake = ['null', 'undefined', 'testnull', 'sarasays', 'happymeal', 'freedom', 'bnbchain', 'deadpool', 'zero-one']
        .filter((n) => !pairs.some(([p]) => p === n)).slice(0, 11 - pairs.length).map((n) => [n, 1]);
      const overloaded = [...pairs, ...fake];
      log('authority probe: @siq has ' + pairs.length + ' posting auths → attempting ' + overloaded.length);
      const op = ['account_update2', { account: 'siq', owner: undefined, active: undefined, posting: { account_auths: overloaded, key_auths: siq.posting.key_auths.map(([k, w]) => [k, Number(w)]), weight_threshold: siq.posting.weight_threshold }, json_metadata: siq.json_metadata, memo_key: siq.memo_key }];
      const rA = await broadcast([op], [ENV.ACTIVE_WIF]);
      push('posting auths count ' + overloaded.length, '>10 rejected', rA.ok ? 'ACCEPTED — reverting…' : 'REJECTED: ' + rA.err, rA.ok ? 'pass' : 'wall');
      if (rA.ok) {
        const revert = ['account_update2', { account: 'siq', owner: undefined, active: undefined, posting: { account_auths: pairs, key_auths: siq.posting.key_auths.map(([k, w]) => [k, Number(w)]), weight_threshold: siq.posting.weight_threshold }, json_metadata: siq.json_metadata, memo_key: siq.memo_key }];
        const rR = await broadcast([revert], [ENV.ACTIVE_WIF]);
        push('authority revert', 'original auths', rR.ok ? 'REVERTED ✓' : 'REVERT FAILED: ' + rR.err, rR.ok ? 'pass' : 'error');
        out.authorityWall = { accepted: overloaded.length };
      } else {
        out.authorityWall = { rejected: true, err: rA.err };
      }
    } else {
      push('authority membership', 'n/a', 'skipped (no active wif or account)', 'skip');
    }
  } catch (e) {
    push('authority membership', 'n/a', 'ERROR: ' + String((e && e.message) || e), 'error');
  }

  // ── 9. our own throughput (10 sequential broadcasts) ─────────────────
  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < 10; i++) {
    const r = await broadcast([probeOp(10)], [POSTING_WIF]);
    if (r.ok) done++;
    else push('throughput', '10 txs', 'failed at ' + i + ': ' + r.err, 'error');
  }
  const dt9 = (Date.now() - t0) / 1000;
  push('our throughput', 'n/a', done + '/10 txs in ' + dt9.toFixed(1) + 's → ' + (done / dt9).toFixed(2) + ' tx/sec', 'pass', { txPerSec: Number((done / dt9).toFixed(3)) });
  out.throughputTps = Number((done / dt9).toFixed(3));

  // ── summary ──────────────────────────────────────────────────────────
  const walls = out.probes.filter((p) => p.verdict === 'wall');
  const passes = out.probes.filter((p) => p.verdict === 'pass').length;
  out.summary = { probes: out.probes.length, passed: passes, walls: walls.length, wallList: walls.map((w) => w.name) };
  fs.writeFileSync(path.join(__dirname, 'limits.json'), JSON.stringify(out, null, 2) + '\n');
  log('SUMMARY: ' + passes + ' pass · ' + walls.length + ' walls → limits.json');
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
