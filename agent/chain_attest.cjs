#!/usr/bin/env node
/**
 * chain_attest.cjs — Task 82: LIVING-ATTEST — the sovereign network testifies
 * about itself on the living public chains (operator directive: "הפוך את
 * steemit hive למאמתים חיים שלנו שיצליחו להחזיק את הרשת חיה ומתקשרת").
 *
 * What it does:
 *   BROADCAST (every daemon cycle, default 30m):
 *     1. reads sovereign/node/state.json  → height, stateRoot, lastBlockHash
 *     2. git rev-parse --short HEAD       → commit (the code that drives it)
 *     3. builds a tiny custom_json op  id="saos.attest.v1"  (active authority):
 *        {protocol:"saos/v1", action:"chain-attest", at, height, stateRoot,
 *         lastBlockHash, commit, src:"agent"}
 *     4. broadcasts it on Steem + Hive (same scalar, active WIF, local sign)
 *   → Steem/Hive become a permanent, public, third-party-checkable heartbeat
 *     of SAOS-NET. Even if this sandbox is wiped to an old snapshot, the
 *     latest expected height/stateRoot lives ON-CHAIN, forever.
 *
 *   READ (--read, wired into guardian boot when local chain.json is lost):
 *     scans our account history on Steem (+Hive fallback) for the latest
 *     saos.attest.v1 and compares it to the local node state → verdict:
 *       LIVE-CURRENT | LOCAL-BEHIND(pointer written) | ROOT-MISMATCH |
 *       LOCAL-MISSING(pointer) | NO-ATTEST
 *     pointer → sovereign/node/RECOVERY_POINTER.json (public proof of what
 *     the network expects, so a reborn sandbox knows its recovery bar).
 *
 * Usage: node chain_attest.cjs [--dry] [--read] [--quiet]
 * Output: agent/attest_last.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const steem = require('steem');
const {
  rpcV4,
  grapheneBroadcast,
  STEEM_HIST_NODES,
} = require('./anchor.cjs');

const ATTEST_ID = 'saos.attest.v1';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const AGENT_DIR = __dirname;
const ROOT = path.join(AGENT_DIR, '..');
const OUT = path.join(AGENT_DIR, 'attest_last.json');
const POINTER = path.join(ROOT, 'sovereign', 'node', 'RECOVERY_POINTER.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HIVE_RC = require('./hive_rc.cjs'); // 103 — RC-DISCIPLINE: שער-תקציב לרגל-ה-Hive

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

function localNodeState() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'sovereign', 'node', 'state.json'), 'utf8'));
    return {
      height: Number(st.height) || 0,
      stateRoot: String(st.stateRoot || ''),
      lastBlockHash: String(st.lastBlockHash || ''),
      updatedAt: st.updatedAt || null,
    };
  } catch (_) {
    return null; // chain state lost — exactly the case the attest rescues
  }
}

function headCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch (_) {
    return 'unknown';
  }
}

/** Poll account history for our attest custom_json → latest by height.
 *  83-fix: Steem condenser nodes cap get_account_history at 100 ops
 *  (500 → hard error on ALL steem nodes → silent Hive fallback → a stale
 *  attest looked fresh to the CLOUD-HEART judge). Hive takes 500. */
async function readAttestFromChain(endpoint, account, pages, limit) {
  const isHive = endpoint.includes('hive');
  pages = pages || (isHive ? 3 : 8);   // steem: 8×100 = 800 ops window
  limit = limit || (isHive ? 500 : 100);
  let start = -1;
  let best = null;
  for (let p = 0; p < pages; p++) {
    let hist = null;
    try {
      hist = await rpcV4(endpoint, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [account, start, limit], id: 1 });
    } catch (_) { break; }
    if (!Array.isArray(hist) || !hist.length) break;
    let lowest = Infinity;
    for (const [idx, e] of hist) {
      if (idx < lowest) lowest = idx;
      const [type, v] = e.op || [];
      if (type !== 'custom_json' || v.id !== ATTEST_ID) continue;
      try {
        const pl = JSON.parse(String(v.json || '{}'));
        if (pl.protocol !== 'saos/v1' || pl.action !== 'chain-attest') continue;
        const h = Number(pl.height) || 0;
        if (!best || h > best.height) best = { ...pl, txid: e.trx_id || null, chain: endpoint.includes('hive') ? 'hive' : 'steem' };
      } catch (_) { /* skip */ }
    }
    if (lowest === Infinity || lowest <= 1) break;
    start = Math.max(1, lowest - 1); // page further back
  }
  return best;
}

async function readLatestAttest(account) {
  // Steem first (identity chain), Hive as fallback
  for (const node of STEEM_HIST_NODES) {
    try {
      const best = await readAttestFromChain(node, account);
      if (best) return best;
    } catch (_) { /* next node */ }
  }
  try {
    return await readAttestFromChain(HIVE_RPC, account);
  } catch (_) {
    return null;
  }
}

function writePointer(attest, local, verdict) {
  const pointer = {
    at: new Date().toISOString(),
    verdict,
    attest: attest
      ? { height: attest.height, stateRoot: attest.stateRoot, commit: attest.commit, at: attest.at, txid: attest.txid, chain: attest.chain }
      : null,
    local: local ? { height: local.height, stateRoot: local.stateRoot } : null,
    note: 'LIVING-ATTEST: the public chains hold the latest expected SAOS-NET state. '
        + 'Recovery bar = attest.height; blocks are rebuilt from git (sovereign/node/chain.json is committed).',
  };
  try { fs.writeFileSync(POINTER, JSON.stringify(pointer, null, 2) + '\n'); } catch (_) { /* best effort */ }
  return pointer;
}

/** One broadcast: state pulse → Steem + Hive (active authority). */
async function runChainAttest(opts = {}) {
  const dry = !!opts.dry;
  const quiet = !!opts.quiet;
  const ENV = loadDotEnv(AGENT_DIR);
  const ACCOUNT = (ENV.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> (in agent/.env) — node agent/chain_attest.cjs — no default acting account (8-b · docs/117o-KEY-INCIDENT.md)'); process.exit(1); }
  const WIF = ENV.ACTIVE_WIF || '';
  if (!WIF) throw new Error('ACTIVE_WIF missing — chain attestation requires active authority');

  const local = localNodeState();
  if (!local) throw new Error('sovereign/node/state.json unreadable — nothing to attest (guardian will write a pointer)');
  const commit = headCommit();
  const at = new Date().toISOString();

  const payload = {
    protocol: 'saos/v1',
    action: 'chain-attest',
    at,
    height: local.height,
    stateRoot: local.stateRoot,
    lastBlockHash: local.lastBlockHash,
    commit,
    src: 'agent',
  };
  const buildOp = () => ['custom_json', {
    required_auths: [ACCOUNT],
    required_posting_auths: [],
    id: ATTEST_ID,
    json: JSON.stringify(payload),
  }];

  const log = (m) => { if (!quiet) console.log(m); };
  log('chainAttest: h' + local.height + ' · root ' + String(local.stateRoot).slice(0, 12) + '… · commit ' + commit + (dry ? ' · DRY' : ''));

  const txids = {};
  if (dry) {
    log('chainAttest: DRY — would broadcast attest op on steem+hive');
    return { at, height: local.height, stateRoot: local.stateRoot, commit, txids, dry: true };
  }

  // Steem — steem-js native (active WIF)
  try {
    const conf = await steem.broadcast.sendAsync({ operations: [buildOp()], extensions: [] }, [WIF]);
    txids.steem = (conf && conf.id) || null;
  } catch (e) {
    log('chainAttest: steem broadcast FAILED: ' + ((e && e.message) || e).slice(0, 140));
  }

  // Hive — raw Graphene sign with chain_id · 103: שער-RC קודם — אם-הרצפה-לא-נפגשה
  // זה-דילוג-כנה (לא-כשל): אפס-ניסיון-שידור-מיותר · אפס-המתנת-היסטוריה · regen ימלא
  let hiveSkipped = null;
  try {
    let rcSnap = null;
    try { rcSnap = await HIVE_RC.snapshot([ACCOUNT]); } catch (_) { rcSnap = null; }
    if (rcSnap) {
      const g = HIVE_RC.gate(rcSnap, ACCOUNT, 150e6, 'chainAttest-hive');
      if (!g.ok) { hiveSkipped = g.reason; throw Object.assign(new Error('rc-gated: ' + g.reason), { rcGated: true }); }
    }
    await grapheneBroadcast(HIVE_RPC, HIVE_CHAIN_ID, [buildOp()], WIF);
  } catch (e) {
    if (e && e.rcGated) log('chainAttest: hive leg SKIPPED — ' + e.message + ' (regen budget — honest skip, not failure)');
    else log('chainAttest: hive broadcast FAILED: ' + ((e && e.message) || e).slice(0, 140));
  }

  // confirm txids via account history (both chains, matched by payload timestamp).
  // Hive lesson (2026-09-05): the node can return an RC-mana error WHILE the tx
  // is actually applied (RC-regen race) — so a failed broadcast is "uncertain",
  // never "absent". History is the only judge.
  for (const [name, node] of [['steem', STEEM_HIST_NODES[0]], ['hive', HIVE_RPC]]) {
    if (name === 'hive' && hiveSkipped) { txids[name] = null; continue; } // 103 — דילוג-מוצהר: אין-למה-לחפש-מה-שלא-שודר
    if (txids[name] === undefined) txids[name] = null; // broadcast errored → uncertain, let history decide
    for (let i = 0; i < 5 && !txids[name]; i++) {
      await sleep(3000);
      try {
        const best = await readAttestFromChain(node, ACCOUNT, 1, 200);
        if (best && best.at === at) txids[name] = best.txid;
      } catch (_) { /* retry */ }
    }
    if (!txids[name]) txids[name] = null; // confirmed absent (or node history blind) — honest null
  }

  const okChains = Object.entries(txids).filter(([, v]) => !!v).length;
  log('chainAttest: broadcast done — ' + okChains + '/2 chains confirmed'
    + (txids.steem ? ' · steem ' + txids.steem : '') + (txids.hive ? ' · hive ' + txids.hive : ''));

  const result = { at, account: ACCOUNT, height: local.height, stateRoot: local.stateRoot, commit, txids, attestsTotal: 0, hiveSkipped: hiveSkipped || null };
  try {
    try { result.attestsTotal = (JSON.parse(fs.readFileSync(OUT, 'utf8')).attestsTotal || 0) + 1; } catch (_) { /* first */ }
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  } catch (_) { /* non-fatal */ }
  return result;
}

/** Recovery read: latest on-chain attest vs local node state. */
async function readMode() {
  const ENV = loadDotEnv(AGENT_DIR);
  const ACCOUNT = (ENV.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> (in agent/.env) — node agent/chain_attest.cjs — no default acting account (8-b · docs/117o-KEY-INCIDENT.md)'); process.exit(1); }
  const attest = await readLatestAttest(ACCOUNT);
  const local = localNodeState();
  let verdict;
  if (!attest) verdict = 'NO-ATTEST';
  else if (!local) verdict = 'LOCAL-MISSING';
  else if (attest.height > local.height) verdict = 'LOCAL-BEHIND';
  else if (attest.height === local.height && attest.stateRoot !== local.stateRoot) verdict = 'ROOT-MISMATCH';
  else verdict = 'LIVE-CURRENT';
  const pointer = (verdict === 'NO-ATTEST') ? null : writePointer(attest, local, verdict);
  return {
    verdict,
    attest: attest ? { height: attest.height, stateRoot: String(attest.stateRoot).slice(0, 16) + '…', commit: attest.commit, at: attest.at, txid: attest.txid, chain: attest.chain } : null,
    local: local ? { height: local.height, stateRoot: String(local.stateRoot).slice(0, 16) + '…' } : null,
    pointer: pointer ? POINTER : null,
  };
}

module.exports = { runChainAttest, readLatestAttest, ATTEST_ID };

if (require.main === module) {
  const mode = process.argv.includes('--read') ? 'read' : 'broadcast';
  const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
  const GATE = resolveLiveGate(process.argv);
  if (mode !== 'read') announceGate(GATE);
  const p = mode === 'read'
    ? readMode()
    : runChainAttest({ dry: GATE.dry }).then((r) => ({
        verdict: r.dry ? 'DRY' : 'BROADCAST',
        height: r.height,
        txids: r.txids,
      }));
  p.then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((e) => { console.error('chain_attest fatal:', (e && e.message) || e); process.exit(1); });
}
