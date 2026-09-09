#!/usr/bin/env node
/* yield.cjs — Task 66: YIELD — חלוקת-תשואה ראשונה מעובדה-על-השרשרת.
 *
 * המשפט-הכלכלי: "המערכת משלמת תשואה אמיתית למשתתפים עצמאיים מהעמלות
 * שנלכדו — לפי תרומה-מדודה-מהשרשרת, לא לפי הבטחה". זה ההפך מהנפקה:
 * האוצר מזרים ערך חוצה, מהכנסות-הפעילות, והמקור על-השרשרת.
 *
 * נוסחת-התרומה (מהשרשרת-עצמה):
 *   ops     — כמה פעולות-דקס החייל חתם-עצמו היום (microdex_state, chain-verified)
 *   lp      — מניות-LP בבריכות (dex replay)
 *   fills   — כמה טריידים ביצע כ-taker (dex replay)
 *   score   = ops×1 + lp×4 + fills×2   (LP = מחויבות-הון העמוקה ביותר)
 *
 * בריכת-התשואה: min(30% × עמלות-שנלכדו, 0.008 STEEM) — ממומן-מהכנסות בלבד.
 * חומות: יתרת-נזיל-מעל-רצפה · פעם-ביום (idempotent) · תשלום רק score>0 ·
 * ממו ציבורי saos:yield:<day>:<ops>ops:<lp>lp:<fills>fills · txids מאומתים.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: 'headcorner' });
const LIVE = GATE.live;
const ACCOUNT = 'headcorner';
announceGate(GATE, log);

const OUT = path.join(__dirname, 'yield_state.json');
const LOG = path.join(__dirname, 'yield.log');
const LOCAL_API = 'http://127.0.0.1:3000';
const STEEM_NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://steem.61bts.com'];

const FEE_SHARE = 0.30;      // 30% מהעמלות-שנלכדו חוזרים-למשתתפים
const POOL_CAP = 0.008;      // תקרת-בריכה יומית (STEEM)
const LIQUID_FLOOR = 0.45;   // רצפת-נזיל של האוצר — מתחת לזה לא נוגעים
const TOP_N = 5;             // כמה משתתפים מקבלים
const SKIP = new Set(['ynet', 'powerspan', 'israelnews']); // operator-delegated / battery / non-soldier

function log(msg) {
  const line = '[' + new Date().toISOString() + '] yield: ' + msg;
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

async function verifyTxid(txid) {
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const node of STEEM_NODES) {
      try {
        const r = await rpcNode(node, 'condenser_api.get_transaction', [txid]);
        if (r && r.transaction_id) return new URL(node).hostname;
      } catch (_) {}
    }
    if (attempt < 4) await new Promise((res) => setTimeout(res, 8000));
  }
  return null;
}

async function main() {
  const day = new Date().toISOString().slice(0, 10);
  log('=== YIELD-66 · ' + (LIVE ? 'LIVE' : 'DRY') + ' · ' + day + ' · pool=min(30%×fees,' + POOL_CAP + ') ===');
  const state = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { return {}; } })();
  if (state.day === day && state.done) { log('היום-כבר-חולק (idempotent) — דילוג'); return; }

  // ── 1. הכנסות-מדודות: עמלות-שנלכדו (בריכת-הבסיס + שכבת-העגונים)
  const dex = await localJson('/api/ops/saos/dex?username=' + ACCOUNT);
  const wrapped = await localJson('/api/ops/saos/wrapped');
  const baseFees = (dex.pools || []).reduce((s, p) => s + (p.feesSteem || 0), 0);
  const wrapFees = (wrapped.fees || {}).totalCaptured || 0;
  const feesTotal = r6(baseFees + wrapFees);
  let pool = Math.min(r6(feesTotal * FEE_SHARE), POOL_CAP);
  log('עמלות-שנלכדו: base=' + r6(baseFees) + ' + wrapped=' + r6(wrapFees) + ' = ' + feesTotal + ' STEEM → pool=' + pool);

  // ── 2. יתרת-נזיל של האוצר (חי, מהשרשרת)
  const liquid = (dex.solvency || {}).issuerLiquidSteem;
  if (liquid == null) throw new Error('לא-הצלחתי-למדוד יתרת-נזיל');
  if (liquid - pool < LIQUID_FLOOR) { pool = r6(Math.max(0, liquid - LIQUID_FLOOR)); log('נזיל=' + liquid + ' → pool מוקטן-לרצפה: ' + pool); }
  if (pool < 0.002) { log('בריכה-קטנה-מדי (' + pool + ') — דילוג-כנה'); return; }

  // ── 3. תרומה-מדודה-מהשרשרת
  const md = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'microdex_state.json'), 'utf8')); } catch (_) { return {}; } })();
  const opsBy = md.bySoldier || {};
  const lpBy = new Map();
  for (const p of dex.pools || []) for (const h of p.lp || []) lpBy.set(h.account, r6((lpBy.get(h.account) || 0) + h.shares));
  const fillsBy = {};
  for (const t of dex.trades || []) if (t.taker && t.taker !== ACCOUNT) fillsBy[t.taker] = (fillsBy[t.taker] || 0) + 1;
  const paysBy = {};
  for (const p of dex.payments || []) if (p.from !== ACCOUNT) paysBy[p.from] = r6((paysBy[p.from] || 0) + p.amount);

  const rows = [];
  for (const [name, lp] of lpBy) {
    if (SKIP.has(name)) continue;
    const ops = opsBy[name] || 0;
    const fills = fillsBy[name] || 0;
    const pays = paysBy[name] || 0;
    const score = r6(ops * 1 + lp * 4 + fills * 2 + pays * 10);
    if (score > 0) rows.push({ name, ops, lp, fills, pays, score });
  }
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, TOP_N);
  const sumScore = top.reduce((s, r) => s + r.score, 0);
  if (!top.length || !(sumScore > 0)) { log('אין-תורמים-מדודים — דילוג-כנה'); return; }
  log('תורמים: ' + top.map((r) => '@' + r.name + ' (ops=' + r.ops + ' lp=' + r.lp + ' fills=' + r.fills + ' pay=' + r.pays + ')').join(' · '));

  // ── 4. חלוקה
  const env = loadDotEnv(__dirname);
  const activeWif = env.ACTIVE_WIF || '';
  if (!activeWif) throw new Error('ACTIVE_WIF חסר');
  const paid = {};
  for (const r of top) {
    // STEEM asset = בדיוק 3 ספרות-עשרוניות (תגלית-66: decimals == 3 assert)
    const amt = Math.round(Math.max(0.001, (pool * r.score) / sumScore) * 1000) / 1000;
    if (amt < 0.001) continue;
    const memo = 'saos:yield:' + day + ':' + r.ops + 'ops:' + r.lp + 'lp:' + r.fills + 'fills:score' + r.score.toFixed(2);
    if (!LIVE) { log('[DRY] @' + r.name + ' ← ' + amt.toFixed(3) + ' STEEM · ' + memo); paid[r.name] = { amt, dry: true }; continue; }
    try {
      const conf = await steem.broadcast.sendAsync({
        operations: [['transfer', { from: ACCOUNT, to: r.name, amount: amt.toFixed(3) + ' STEEM', memo }]],
        extensions: [],
      }, [activeWif]);
      paid[r.name] = { amt, memo, txid: (conf && conf.id) || null, verified: false };
      log('@' + r.name + ' ← ' + amt + ' STEEM txid=' + paid[r.name].txid + ' · ' + memo);
      await new Promise((res) => setTimeout(res, 3400));
    } catch (e) { log('@' + r.name + ' FAIL: ' + String((e && e.message) || e).slice(0, 100)); }
  }

  // ── 5. אימות
  for (const [name, rec] of Object.entries(paid)) {
    if (!rec.txid) continue;
    const node = await verifyTxid(rec.txid);
    if (node) { rec.verified = true; rec.node = node; log('@' + name + ' verified ✓ ' + node); }
  }
  state.day = day;
  state.done = LIVE && Object.keys(paid).length > 0; // DRY never marks the day as paid
  state.feesTotal = feesTotal;
  state.pool = pool;
  state.paid = paid;
  state.at = new Date().toISOString();
  state.totalPaid = r6(Object.values(paid).reduce((s, r) => s + (r.amt || 0), 0));
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
  log('=== סיכום: ' + Object.keys(paid).length + ' משתתפים · total=' + state.totalPaid + ' STEEM מתוך עמלות ' + feesTotal + ' ===');
}

main().catch((e) => { log('FATAL ' + String((e && e.message) || e)); process.exit(1); });
