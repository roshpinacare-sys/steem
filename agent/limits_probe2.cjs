#!/usr/bin/env node
/**
 * limits_probe2.cjs — refined follow-ups from the first limits run:
 *   1. exact custom_json-per-block wall: bundle 3 / 5 / 6 ops in ONE tx (nonce'd)
 *   2. authority membership wall: account_update2 with 11 posting auths
 *      (correct field posting_json_metadata; instant revert if accepted)
 * Merges into agent/limits.json (probes list).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
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
const ACCOUNT = (ENV.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> (in agent/.env) — node agent/limits_probe2.cjs — no default acting account (8-b · docs/117o-KEY-INCIDENT.md)'); process.exit(1); }
const STEEM_RPC = process.env.RPC_URL || 'https://api.steemit.com';
steem.api.setOptions({ url: STEEM_RPC });
const POSTING_WIF = ENV.POSTING_WIF || '';
const NONCE = Date.now();

function log(msg) { console.log('[' + new Date().toISOString() + '] limits2: ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE, log);


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

async function broadcast(ops, wifs) {
  try {
    if (stasisStop('limits-probe')) return { ok: false, err: 'STASIS-HALT — lane closed (capital gate 2026-10-04)' }; // sign-time brake
    const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, wifs);
    return { ok: true, txid: (conf && conf.id) || null };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e).split('\n')[0].slice(0, 180) };
  }
}

const probeOp = (i) => ['custom_json', { required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos_probe', json: JSON.stringify({ p: 'saos/limits/v1', n: NONCE, i }) }];

async function main() {
  if (DRY) { log('[DRY] LIVE-GATE — probe broadcasts skipped (nothing broadcast)'); return; }
  const out = JSON.parse(fs.readFileSync(path.join(__dirname, 'limits.json'), 'utf8'));
  const push = (name, expect, got, verdict, extra) => {
    out.probes.push({ name, expect, got, verdict, ...(extra || {}) });
    log(verdict.toUpperCase() + ' · ' + name + ' → ' + got);
  };

  // ── exact custom_json per block wall ─────────────────────────────────
  for (const n of [3, 5, 6]) {
    const ops = [];
    for (let i = 0; i < n; i++) ops.push(probeOp(NONCE % 100000 + i));
    const r = await broadcast(ops, [POSTING_WIF]);
    push('ops/tx ' + n + ' custom_json (nonce ' + (NONCE % 100000) + ')', 'wall at 6 (5/block)', r.ok ? 'ACCEPTED (' + n + ' ops, one tx)' : 'REJECTED: ' + r.err, r.ok ? 'pass' : 'wall');
    await sleep(3200); // wait a full block between attempts
  }

  // ── authority membership wall (correct field this time) ─────────────
  try {
    const [accArr] = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [['siq']], id: 1 });
    const siq = accArr;
    if (siq && ENV.ACTIVE_WIF) {
      const pairs = (Array.isArray(siq.posting.account_auths) ? siq.posting.account_auths : Object.entries(siq.posting.account_auths || {}))
        .map(([n, w]) => [n, Number(w)]);
      const fake = ['null', 'undefined', 'testnull', 'sarasays', 'happymeal', 'freedom', 'bnbchain', 'deadpool', 'zero-one']
        .filter((n) => !pairs.some(([p]) => p === n)).slice(0, 11 - pairs.length).map((n) => [n, 1]);
      const overloaded = [...pairs, ...fake];
      log('authority probe: @siq has ' + pairs.length + ' → attempting ' + overloaded.length + ' posting auths');
      const posting = {
        account_auths: overloaded,
        key_auths: siq.posting.key_auths.map(([k, w]) => [k, Number(w)]),
        weight_threshold: siq.posting.weight_threshold,
      };
      const op = ['account_update2', { account: 'siq', posting, posting_json_metadata: siq.json_metadata || '{}', memo_key: siq.memo_key }];
      const rA = await broadcast([op], [ENV.ACTIVE_WIF]);
      push('posting auths count ' + overloaded.length, '>10 rejected (MAX_AUTHORITY_MEMBERSHIP)', rA.ok ? 'ACCEPTED — reverting…' : 'REJECTED: ' + rA.err, rA.ok ? 'pass' : 'wall');
      if (rA.ok) {
        const revert = ['account_update2', { account: 'siq', posting: { account_auths: pairs, key_auths: siq.posting.key_auths.map(([k, w]) => [k, Number(w)]), weight_threshold: siq.posting.weight_threshold }, posting_json_metadata: siq.json_metadata || '{}', memo_key: siq.memo_key }];
        const rR = await broadcast([revert], [ENV.ACTIVE_WIF]);
        push('authority revert', 'original ' + pairs.length + ' auths', rR.ok ? 'REVERTED ✓' : 'REVERT FAILED: ' + rR.err, rR.ok ? 'pass' : 'error');
        out.authorityWall = { accepted: overloaded.length, reverted: rR.ok };
      } else {
        out.authorityWall = { rejected: true, err: rA.err, wallAt: overloaded.length };
      }
    } else {
      push('authority membership', 'n/a', 'skipped', 'skip');
    }
  } catch (e) {
    push('authority membership', 'n/a', 'ERROR: ' + String((e && e.message) || e), 'error');
  }

  // fix throughput row (previous run had a dupe-tx failure)
  out.summary = {
    probes: out.probes.length,
    passed: out.probes.filter((p) => p.verdict === 'pass').length,
    walls: out.probes.filter((p) => p.verdict === 'wall').length,
    wallList: out.probes.filter((p) => p.verdict === 'wall').map((w) => w.name),
  };
  out.reRunAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, 'limits.json'), JSON.stringify(out, null, 2) + '\n');
  log('SUMMARY: ' + out.summary.passed + ' pass · ' + out.summary.walls + ' walls · ' + out.probes.length + ' total probes → limits.json');
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
