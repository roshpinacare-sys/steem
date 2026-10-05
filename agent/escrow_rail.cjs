#!/usr/bin/env node
/**
 * escrow_rail.cjs — Task 44 SCI: native Steem ESCROW rail, end-to-end.
 *
 * Proves SAOS can operate a TRUSTLESS payment rail with the chain's own
 * escrow primitive — no third party, no trust, pure protocol:
 *
 *   1. escrow_transfer  @headcorner → @<buyer>, agent @<arbiter>
 *                       (0.100 STEEM locked, fee 0.001 STEEM)
 *   2. escrow_approve   buyer approves            (their active key)
 *   3. escrow_approve   arbiter approves          (their active key)
 *   4. escrow_release   sender releases 0.100 STEEM to the buyer
 *
 * Every step is an ON-CHAIN op verifiable via get_account_history. Keys are
 * read locally from agent/.env (sender) and agent/keys/vault.json (army).
 * NOTHING is ever logged except pubkeys/txids.
 *
 * Usage: node escrow_rail.cjs [--amount 0.100]
 * Output: agent/escrow_result.json
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
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> (in agent/.env) — node agent/escrow_rail.cjs — no default acting account (8-b · docs/117o-KEY-INCIDENT.md)'); process.exit(1); }
const STEEM_RPC = process.env.RPC_URL || 'https://api.steemit.com';
steem.api.setOptions({ url: STEEM_RPC });

function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE, log);


function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 25000 },
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
    req.on('timeout', () => req.destroy(new Error('rpc timeout 25s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/** Load army accounts from vault.json → {name, activeWif, memoWif, pub} */
function loadArmy() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || [])
      .filter((a) => a.username && a.keys && a.keys.active && a.keys.active.wif)
      .map((a) => ({
        name: String(a.username).toLowerCase(),
        activeWif: a.keys.active.wif,
        postingWif: (a.keys.posting && a.keys.posting.wif) || '',
      }));
  } catch (_) {
    return [];
  }
}

async function broadcast(ops, wifs) {
  if (stasisStop('escrow-rail')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
  const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, wifs);
  return (conf && conf.id) || null;
}

async function verifyOpInHistory(opName, match, txidHint) {
  // read-side proof: the op must be visible in public history
  const hist = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, -1, 100], id: 1 });
  for (const [, e] of hist) {
    if (e.op[0] !== opName) continue;
    const v = e.op[1];
    if (match(v)) return { txid: e.trx_id || txidHint || '', found: true };
  }
  return { found: false };
}

async function main() {
  const amountArg = process.argv.indexOf('--amount');
  const amount = amountArg > -1 ? Math.max(0.001, parseFloat(process.argv[amountArg + 1]) || 0.1) : 0.1;
  const escrowId = (Date.now() % 900000000) + 100000000;

  console.log('═'.repeat(74));
  console.log('SAOS ESCROW RAIL · @' + ACCOUNT + ' · escrow_id=' + escrowId + ' · amount=' + amount + ' STEEM');
  console.log('═'.repeat(74));
  if (DRY) { log('[DRY] LIVE-GATE — escrow rail broadcasts real ops — nothing broadcast'); return; }

  const army = loadArmy();
  if (army.length < 2) {
    throw new Error('escrow rail needs ≥2 army accounts (buyer + arbiter) — connect more accounts first');
  }
  const [buyer, arbiter] = army;
  const activeWif = ENV.ACTIVE_WIF || '';
  if (!activeWif) throw new Error('ACTIVE_WIF missing in agent/.env — cannot sign escrow_transfer');

  // sanity: sender liquid balance must cover amount + fee
  const [accArr] = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 1 });
  const liquid = parseFloat(String(accArr.balance).split(' ')[0]);
  if (liquid < amount + 0.001) {
    throw new Error('insufficient liquid STEEM (' + accArr.balance + ') for escrow ' + amount + ' + fee 0.001');
  }

  const meta = JSON.stringify({ protocol: 'saos/v1', type: 'escrow-rail', escrowId });
  const now = Date.now();
  const ratification = new Date(now + 2 * 3600 * 1000).toISOString().slice(0, 19);
  const expiration = new Date(now + 72 * 3600 * 1000).toISOString().slice(0, 19);
  const result = { at: new Date().toISOString(), account: ACCOUNT, escrowId, amount: amount.toFixed(3) + ' STEEM', steps: [], ok: false, buyer: buyer.name, arbiter: arbiter.name };

  // ── 1) escrow_transfer (sender active key) ──
  const step1 = await broadcast(
    [['escrow_transfer', {
      from: ACCOUNT,
      to: buyer.name,
      sbd_amount: '0.000 SBD',
      steem_amount: amount.toFixed(3) + ' STEEM',
      escrow_id: escrowId,
      agent: arbiter.name,
      fee: '0.001 STEEM',
      json_meta: meta,
      ratification_deadline: ratification,
      escrow_expiration: expiration,
    }]],
    [activeWif]
  );
  log('1/4 escrow_transfer  txid=' + step1);
  result.steps.push({ op: 'escrow_transfer', txid: step1, signer: ACCOUNT });

  await sleep(9000);
  // ── 2) buyer approves (buyer active key) ──
  const step2 = await broadcast(
    [['escrow_approve', { from: ACCOUNT, to: buyer.name, agent: arbiter.name, who: buyer.name, escrow_id: escrowId, approve: true }]],
    [buyer.activeWif]
  );
  log('2/4 escrow_approve (buyer @' + buyer.name + ')  txid=' + step2);
  result.steps.push({ op: 'escrow_approve', txid: step2, signer: buyer.name, role: 'buyer' });

  await sleep(9000);
  // ── 3) arbiter approves (arbiter active key) ──
  const step3 = await broadcast(
    [['escrow_approve', { from: ACCOUNT, to: buyer.name, agent: arbiter.name, who: arbiter.name, escrow_id: escrowId, approve: true }]],
    [arbiter.activeWif]
  );
  log('3/4 escrow_approve (arbiter @' + arbiter.name + ')  txid=' + step3);
  result.steps.push({ op: 'escrow_approve', txid: step3, signer: arbiter.name, role: 'arbiter' });

  await sleep(9000);
  // ── 4) escrow_release → funds land with the buyer (sender active key) ──
  const step4 = await broadcast(
    [['escrow_release', {
      from: ACCOUNT,
      to: buyer.name,
      agent: arbiter.name,
      who: ACCOUNT,
      receiver: buyer.name,
      escrow_id: escrowId,
      sbd_amount: '0.000 SBD',
      steem_amount: amount.toFixed(3) + ' STEEM',
    }]],
    [activeWif]
  );
  log('4/4 escrow_release → @' + buyer.name + '  txid=' + step4);
  result.steps.push({ op: 'escrow_release', txid: step4, signer: ACCOUNT, receiver: buyer.name });

  // ── read-side verification from PUBLIC history ──
  await sleep(6000);
  const seen = { transfer: null, approveBuyer: null, approveArbiter: null, release: null };
  const hist = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, -1, 100], id: 1 });
  for (const [, e] of hist) {
    const [op, v] = e.op;
    if (op === 'escrow_transfer' && Number(v.escrow_id) === escrowId) seen.transfer = e.trx_id;
    if (op === 'escrow_approve' && Number(v.escrow_id) === escrowId && v.who === buyer.name) seen.approveBuyer = e.trx_id;
    if (op === 'escrow_approve' && Number(v.escrow_id) === escrowId && v.who === arbiter.name) seen.approveArbiter = e.trx_id;
    if (op === 'escrow_release' && Number(v.escrow_id) === escrowId && v.receiver === buyer.name) seen.release = e.trx_id;
  }
  const allSeen = Object.values(seen).every(Boolean);
  result.verified = seen;
  result.ok = allSeen;
  fs.writeFileSync(path.join(__dirname, 'escrow_result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('─'.repeat(74));
  if (allSeen) {
    console.log('VERDICT: ESCROW RAIL PROVEN — 4/4 ops live on-chain ✅ (transfer → 2 approvals → release)');
  } else {
    console.log('VERDICT: ops missing in history: ' + JSON.stringify(seen) + ' ❌');
  }
  process.exit(allSeen ? 0 : 1);
}

main().catch((e) => {
  console.error('escrow_rail fatal:', e.message);
  try {
    fs.writeFileSync(path.join(__dirname, 'escrow_result.json'), JSON.stringify({ at: new Date().toISOString(), ok: false, error: String(e.message || e).slice(0, 300) }, null, 2));
  } catch (_) { /* non-fatal */ }
  process.exit(2);
});
