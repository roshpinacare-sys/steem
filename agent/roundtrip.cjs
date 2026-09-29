#!/usr/bin/env node
/* roundtrip.cjs — Task 66: ROUNDTRIP — מחזור-חיים מלא של עגון חוצה-שרשראות.
 *
 * האימות-המאתגר: לא רק הנפקה — גם מסחר, פדיון ושחרור. שרשרת-שבע-חוליות
 * על שתי רשתות, כל חוליה txid מאומת, שימור 1:1 נמדד מה-replay:
 *
 *   H1 (Hive)   lock      — self-transfer 0.002 HIVE memo saos:xlock:PHIVE:0.002:rt66
 *   S1 (Steem)  mint      — PHIVE +0.002, ref=H1-txid (saos.wrap/v1)
 *   S2 (Steem)  pay       — @haran משלם אשראי לאוצר עבור 0.001 PHIVE (saos/v1 — פרימיטיב-66)
 *   S3 (Steem)  fill      — @haran חוצה את ה-ask (משלוח-נכס, saos.wrap/v1, payRef=S2)
 *   S4 (Steem)  burn      — @haran שורף 0.001 PHIVE (דורש-החזקה-מה-replay!)
 *   H2 (Hive)   unlock    — self-transfer 0.001 HIVE memo saos:xunlock:PHIVE:<S4-txid>
 *   S5 (Steem)  unlock-ack— הכרזת-השחרור על האוטובוס, ref=H2-txid
 *
 * שימור בסוף: locked 0.003 − unlocked 0.001 = 0.002 = supply (0.003 − burn 0.001).
 * חומות: 3.4 שניות בין-ops · DRY כברירת-מחדל (--live) · idempotent לפי state+שרשרת.
 */
'use strict';
// 8-b: חשבון-הפעולה = המפעיל (מפתחותיו ב-.env) — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/roundtrip.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const steem = require('steem');
const { Client, PrivateKey } = require('@hiveio/dhive');

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT }); // 8-b: השער נעוץ בחשבון-הפעולה מה-env — לא בשם-קבוע
const LIVE = GATE.live;
announceGate(GATE, log);

const OUT = path.join(__dirname, 'roundtrip_state.json');
const LOG = path.join(__dirname, 'roundtrip.log');
const LOCAL_API = 'http://127.0.0.1:3000';
const RT = 'rt66';
const LOCK_AMT = 0.002;   // HIVE נעול-חדש
const TRADE_AMT = 0.001;  // חלק-המסחר/פדיון
const STEEM_NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://steem.61bts.com'];
const HIVE_NODES = ['https://api.openhive.network', 'https://api.hive.blog'];

function log(msg) {
  const line = '[' + new Date().toISOString() + '] roundtrip: ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}
const r6 = (n) => Math.round(n * 1e6) / 1e6;

function loadDotEnv(dir) {
  const p = path.join(dir, '.env');
  const out = {};
  try {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
  return out;
}

function loadVault() {
  // ACCOUNT (AGENT_ACCOUNT) = המפעיל — מפתחותיו ב-.env (מחוץ-ל-git); החיילים בכספת
  const env = loadDotEnv(__dirname);
  const activeWif = env.ACTIVE_WIF || '';
  const postingWif = env.POSTING_WIF || '';
  if (!activeWif || !postingWif) throw new Error(ACCOUNT + ' active/posting missing in .env');
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
  const haran = (v.accounts || []).find((a) => String(a.username).toLowerCase() === 'haran');
  if (!haran || !haran.keys || !haran.keys.posting || !haran.keys.posting.wif) throw new Error('vault: haran posting missing');
  return {
    activeWif,
    postingWif,
    haranPostingWif: haran.keys.posting.wif,
  };
}

async function localJson(p) {
  const res = await fetch(LOCAL_API + p);
  if (!res.ok) throw new Error('local api ' + p + ' → ' + res.status);
  return res.json();
}

function rpcNode(node, method, params) {
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  const u = new URL(node);
  return new Promise((resolve, reject) => {
    const req = require('https').request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc')); resolve(j.result); }
        catch (_) { reject(new Error('bad rpc')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}

async function verifySteem(txid) {
  // Task 66 — תגלית-חיה: get_transaction עצמו יכול-לפגר שניות-עד-דקות בצומת
  // (ההיפוך-של-תגלית-65) — ניסיון-חוזר על הצמתים לפני-כניעה-כנה
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const node of STEEM_NODES) {
      try {
        const r = await rpcNode(node, 'condenser_api.get_transaction', [txid]);
        if (r && r.transaction_id) return { node: new URL(node).hostname, block: r.block || r.block_num || null };
      } catch (_) {}
    }
    if (attempt < 4) await new Promise((res) => setTimeout(res, 8000));
  }
  return null;
}

async function verifyHive(txid) {
  for (const node of HIVE_NODES) {
    try {
      const r = await rpcNode(node, 'condenser_api.get_transaction', [txid]);
      if (r && r.transaction_id) return { node: new URL(node).hostname, block: r.block_num || (r.block && r.block.block_num) || null, memo: extractMemo(r) };
    } catch (_) {}
  }
  return null;
}
function extractMemo(t) {
  try {
    for (const op of t.operations || []) {
      if (op[0] === 'transfer') return String(op[1].memo || '');
    }
  } catch (_) {}
  return '';
}

const busOp = (payload, signer, protocol) => ['custom_json', {
  required_auths: [], required_posting_auths: [signer], id: 'saos',
  json: JSON.stringify(Object.assign({ protocol, time: new Date().toISOString() }, payload)),
}];

const hiveBroadcast = async (ops, key) => {
  const hive = new Client([HIVE_NODES[0]]);
  const conf = await hive.broadcast.sendOperations(ops, PrivateKey.fromString(key));
  return (conf && conf.id) || null;
};

async function main() {
  const t0 = Date.now();
  log('=== ROUNDTRIP-66 · ' + (LIVE ? 'LIVE' : 'DRY') + ' · מחזור-חיים מלא: lock→mint→pay→fill→burn→unlock→ack ===');
  const keys = loadVault();

  // ── שוק-חי: ה-ask של PHIVE (מה-replay) והאשראי של @haran (מה-replay הבסיסי)
  const wrapped = await localJson('/api/ops/saos/wrapped');
  const phive = (wrapped.assets || []).find((a) => a.symbol === 'PHIVE');
  if (!phive) throw new Error('PHIVE asset not found in wrapped replay');
  const ask = ((phive.book || {}).asks || []).find((o) => o.owner === ACCOUNT && o.remaining >= TRADE_AMT - 1e-9);
  if (!ask) throw new Error('אין-ask של PHIVE פנוי לאוצר — הפעימה-הבאה תנסה שוב (ה-beat מציב asks)');
  const price = ask.price;
  const cost = r6(price * TRADE_AMT);
  const dex = await localJson('/api/ops/saos/dex?username=' + ACCOUNT);
  const haranBal = (dex.balances || []).find((b) => b.account === 'haran');
  const haranCredit = haranBal ? haranBal.credit : 0;
  if (haranCredit < cost + 0.002) throw new Error('אשראי-@haran מספיק? ' + haranCredit + ' < ' + (cost + 0.002));
  log('שוק: oid=' + ask.oid + ' price=' + price + ' cost=' + cost + ' · haran-credit=' + haranCredit + ' · supply=' + phive.supply + ' locked=' + (phive.backing || {}).lockedHive);

  const state = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { return { steps: {} }; } })();
  const st = state.steps;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── H1 · Hive lock
  if (!st.h1 || !st.h1.txid) {
    const memo = 'saos:xlock:PHIVE:' + LOCK_AMT.toFixed(3) + ':' + RT;
    if (!LIVE) { log('[DRY] H1 lock ' + LOCK_AMT + ' HIVE'); st.h1 = { dry: true }; }
    else {
      const txid = await hiveBroadcast([['transfer', { from: ACCOUNT, to: ACCOUNT, amount: LOCK_AMT.toFixed(3) + ' HIVE', memo }]], keys.activeWif);
      st.h1 = { txid, memo };
      log('H1 lock ✓ ' + LOCK_AMT + ' HIVE txid=' + txid);
    }
    saveState(state); await wait(3400);
  }
  if (st.h1 && st.h1.txid && !st.h1.verified) {
    const v = await verifyHive(st.h1.txid);
    if (v) { st.h1.verified = true; st.h1.node = v.node; st.h1.block = v.block; log('H1 verified ✓ ' + v.node + ' blk=' + v.block + ' memo="' + v.memo + '"'); saveState(state); }
  }

  // ── S1 · Steem mint (ref = H1 txid)
  if (!st.s1 || !st.s1.txid) {
    if (!st.h1 || !st.h1.verified) throw new Error('H1 לא-מאומת — עוצר (שימור לפני-הכל)');
    const payload = { action: 'mint', symbol: 'PHIVE', amount: LOCK_AMT, account: ACCOUNT, ref: st.h1.txid, backing: { lockedHive: LOCK_AMT, mode: 'full', chain: 'hive', refs: 'hive-self-lock' } };
    if (!LIVE) { log('[DRY] S1 mint ' + LOCK_AMT + ' PHIVE ref=' + st.h1.txid); st.s1 = { dry: true }; }
    else {
      const conf = await steem.broadcast.sendAsync({ operations: [busOp(payload, ACCOUNT, 'saos.wrap/v1')], extensions: [] }, [keys.postingWif]);
      st.s1 = { txid: (conf && conf.id) || null, amount: LOCK_AMT, ref: st.h1.txid };
      log('S1 mint ✓ ' + LOCK_AMT + ' PHIVE txid=' + st.s1.txid);
    }
    saveState(state); await wait(3400);
  }
  if (st.s1 && st.s1.txid && !st.s1.verified) { const v = await verifySteem(st.s1.txid); if (v) { st.s1.verified = true; st.s1.node = v.node; log('S1 verified ✓ ' + v.node); saveState(state); } }

  // ── S2 · pay — @haran משלם אשראי לאוצר (פרימיטיב-ההסדרה של 66)
  if (!st.s2 || !st.s2.txid) {
    const payload = { action: 'pay', account: 'haran', to: ACCOUNT, amount: cost, ref: RT + ':' + ask.oid };
    if (!LIVE) { log('[DRY] S2 pay ' + cost + ' credit haran→' + ACCOUNT); st.s2 = { dry: true }; }
    else {
      const conf = await steem.broadcast.sendAsync({ operations: [busOp(payload, 'haran', 'saos/v1')], extensions: [] }, [keys.haranPostingWif]);
      st.s2 = { txid: (conf && conf.id) || null, amount: cost, from: 'haran', to: ACCOUNT };
      log('S2 pay ✓ ' + cost + ' credit haran→' + ACCOUNT + ' txid=' + st.s2.txid);
    }
    saveState(state); await wait(3400);
  }
  if (st.s2 && st.s2.txid && !st.s2.verified) { const v = await verifySteem(st.s2.txid); if (v) { st.s2.verified = true; st.s2.node = v.node; log('S2 verified ✓ ' + v.node); saveState(state); } }

  // ── S3 · fill — @haran חוצה את ה-ask (משלוח הנכס; payRef קושר את התשלום)
  if (!st.s3 || !st.s3.txid) {
    if (!st.s2 || !st.s2.verified) throw new Error('S2 (pay) לא-מאומת — עוצר (תשלום-לפני-משלוח)');
    const payload = { action: 'fill', oid: ask.oid, taker: 'haran', amount: TRADE_AMT, payRef: st.s2.txid, pair: 'PHIVE:STEEM' };
    if (!LIVE) { log('[DRY] S3 fill ' + TRADE_AMT + ' PHIVE ← ' + ask.oid); st.s3 = { dry: true }; }
    else {
      const conf = await steem.broadcast.sendAsync({ operations: [busOp(payload, 'haran', 'saos.wrap/v1')], extensions: [] }, [keys.haranPostingWif]);
      st.s3 = { txid: (conf && conf.id) || null, oid: ask.oid, amount: TRADE_AMT, taker: 'haran', payRef: st.s2.txid };
      log('S3 fill ✓ ' + TRADE_AMT + ' PHIVE haran←' + ask.oid + ' txid=' + st.s3.txid);
    }
    saveState(state); await wait(3400);
  }
  if (st.s3 && st.s3.txid && !st.s3.verified) { const v = await verifySteem(st.s3.txid); if (v) { st.s3.verified = true; st.s3.node = v.node; log('S3 verified ✓ ' + v.node); saveState(state); } }

  // ── S4 · burn — @haran פודה (דורש-החזקה-מה-replay!)
  if (!st.s4 || !st.s4.txid) {
    if (!st.s3 || !st.s3.verified) throw new Error('S3 (fill) לא-מאומת — עוצר (אי-אפשר לשרוף מה שלא-נרכש)');
    const payload = { action: 'burn', symbol: 'PHIVE', amount: TRADE_AMT, account: 'haran', ref: RT + ':' + st.s3.txid };
    if (!LIVE) { log('[DRY] S4 burn ' + TRADE_AMT + ' PHIVE by haran'); st.s4 = { dry: true }; }
    else {
      const conf = await steem.broadcast.sendAsync({ operations: [busOp(payload, 'haran', 'saos.wrap/v1')], extensions: [] }, [keys.haranPostingWif]);
      st.s4 = { txid: (conf && conf.id) || null, amount: TRADE_AMT, by: 'haran', ref: st.s3.txid };
      log('S4 burn ✓ ' + TRADE_AMT + ' PHIVE by haran txid=' + st.s4.txid);
    }
    saveState(state); await wait(3400);
  }
  if (st.s4 && st.s4.txid && !st.s4.verified) { const v = await verifySteem(st.s4.txid); if (v) { st.s4.verified = true; st.s4.node = v.node; log('S4 verified ✓ ' + v.node); saveState(state); } }

  // ── H2 · Hive unlock (ref = burn txid)
  if (!st.h2 || !st.h2.txid) {
    if (!st.s4 || !st.s4.verified) throw new Error('S4 (burn) לא-מאומת — עוצר (פדיון-לפני-שחרור)');
    const memo = 'saos:xunlock:PHIVE:' + TRADE_AMT.toFixed(3) + ':' + RT + ':' + st.s4.txid;
    if (!LIVE) { log('[DRY] H2 unlock ' + TRADE_AMT + ' HIVE'); st.h2 = { dry: true }; }
    else {
      const txid = await hiveBroadcast([['transfer', { from: ACCOUNT, to: ACCOUNT, amount: TRADE_AMT.toFixed(3) + ' HIVE', memo }]], keys.activeWif);
      st.h2 = { txid, memo, ref: st.s4.txid };
      log('H2 unlock ✓ ' + TRADE_AMT + ' HIVE txid=' + txid);
    }
    saveState(state); await wait(3400);
  }
  if (st.h2 && st.h2.txid && !st.h2.verified) {
    const v = await verifyHive(st.h2.txid);
    if (v) {
      st.h2.verified = true; st.h2.node = v.node; st.h2.block = v.block;
      st.h2.memoOnChain = v.memo || '';
      log('H2 verified ✓ ' + v.node + ' blk=' + v.block + ' memo="' + String(v.memo).slice(0, 60) + '"');
      saveState(state);
    }
  }

  // ── S5 · unlock-ack על האוטובוס (ref = H2 txid)
  if (!st.s5 || !st.s5.txid) {
    if (!st.h2 || !st.h2.verified) throw new Error('H2 (unlock) לא-מאומת — עוצר');
    const payload = { action: 'unlock', symbol: 'PHIVE', amount: TRADE_AMT, ref: st.h2.txid, by: ACCOUNT };
    if (!LIVE) { log('[DRY] S5 unlock-ack ref=' + st.h2.txid); st.s5 = { dry: true }; }
    else {
      const conf = await steem.broadcast.sendAsync({ operations: [busOp(payload, ACCOUNT, 'saos.wrap/v1')], extensions: [] }, [keys.postingWif]);
      st.s5 = { txid: (conf && conf.id) || null, amount: TRADE_AMT, ref: st.h2.txid };
      log('S5 unlock-ack ✓ txid=' + st.s5.txid);
    }
    saveState(state); await wait(3400);
  }
  if (st.s5 && st.s5.txid && !st.s5.verified) { const v = await verifySteem(st.s5.txid); if (v) { st.s5.verified = true; st.s5.node = v.node; log('S5 verified ✓ ' + v.node); saveState(state); } }

  // ── מדידת-שימור מה-replay (עיכוב-אינדקס ידוע — כנות אם עדיין לא נקלט)
  let conservation = null;
  try {
    const w2 = await localJson('/api/ops/saos/wrapped');
    const p2 = (w2.assets || []).find((a) => a.symbol === 'PHIVE');
    if (p2) conservation = {
      supply: p2.supply,
      lockedHive: (p2.backing || {}).lockedHive,
      ratioPct: p2.backingRatioPct,
      redeemed: p2.redeemed,
      unlocked: p2.unlocked,
      holders: (p2.holders || []).map((h) => h.account + ':' + h.balance),
      note: 'replay-lag tolerated — המטריצה מאמתת את השימור בריצה עצמאית',
    };
  } catch (_) {}

  const allVerified = ['h1', 's1', 's2', 's3', 's4', 'h2', 's5'].every((k) => st[k] && st[k].verified);
  state.at = new Date().toISOString();
  state.ms = Date.now() - t0;
  state.allVerified = allVerified;
  state.conservation = conservation;
  state.summary = {
    locked: LOCK_AMT, minted: LOCK_AMT, traded: TRADE_AMT, burned: TRADE_AMT, unlocked: TRADE_AMT,
    steps: ['H1-lock(hive)', 'S1-mint', 'S2-pay', 'S3-fill', 'S4-burn', 'H2-unlock(hive)', 'S5-unlock-ack'],
    txids: Object.fromEntries(['h1', 's1', 's2', 's3', 's4', 'h2', 's5'].map((k) => [k, (st[k] || {}).txid || null])),
  };
  saveState(state);
  log('=== סיכום: allVerified=' + allVerified + ' (' + state.ms + 'ms) — ' + JSON.stringify(state.summary.txids) + ' ===');
}

function saveState(s) { fs.writeFileSync(OUT, JSON.stringify(s, null, 2)); }

main().catch((e) => { log('FATAL ' + String((e && e.message) || e)); process.exit(1); });
