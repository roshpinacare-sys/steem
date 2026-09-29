#!/usr/bin/env node
/* merchant.cjs — Task 67: מסילת-הסוחר — האימפריה מוכרת סחורה ב-STEEM אמיתי.
 *
 * החומה-שנשברת: עד-היום המערכת לכדה עמלות (ערך-מהספר) אבל לא מכרה סחורה
 * (ערך-משירות). עכשיו: כל אחד-על-השרשרת יכול לקנות SAOS ב-transfer אמיתי:
 *
 *   transfer STEEM → headcorner, memo: saos:buy:SAOS:<qty-רצוי>
 *
 * הלולאה סורקת את ההיסטוריה, מתמחרת מהספר-החי (bestAsk), מוסרת את הסחורה
 * (custom_json saos/v1 transfer — חינם-RC), ומוציאה קבלה-ציבורית
 * (action receipt עם ref=txid-הקנייה). מרווח: הפער-בין הספר למסירה
 * נשאר-באוצר — הכנסה-אמיתית-נמדדת-ב-STEEM נטו.
 *
 * חומות: ≤3 מכירות/פעימה · תקרת-מסירה 0.2 SAOS/קנייה (ברזל) · מינימום 0.01
 * SAOS · idempotent לפי txid-קנייה (state + סריקת-היסטוריה — השרשרת היא הפנקס).
 */
'use strict';
// 8-b: חשבון-הפעולה = האוצר (מפתחותיו ב-.env) — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/merchant.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT }); // 8-b: השער נעוץ בחשבון-הפעולה מה-env — לא בשם-קבוע
const LIVE = GATE.live;
announceGate(GATE, log);

const OUT = path.join(__dirname, 'merchant_state.json');
const LOG = path.join(__dirname, 'merchant.log');
const LOCAL_API = 'http://127.0.0.1:3000';
const STEEM_NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://steem.61bts.com'];

const MAX_SALES_PER_BEAT = 3;  // חומת-פעימה
const DELIVER_CAP = 0.2;       // תקרת-מסירה-ברזל לקנייה (SAOS)
const DELIVER_MIN = 0.01;      // מינימום-מסירה
const PAGE_SIZE = 100;
const MAX_PAGES = 4;           // ~400 ops אחרונים — מספיק לכיסוי-הזמנות-חיות
// שער-הולדת-המסילה: הזמנות-קודמות-מומשו-דרך-מסחר-הממו-של-Task-62 — לא-נוגעים
const MERCHANT_GENESIS = '2026-09-04T23:00:00Z';

function log(msg) {
  const line = '[' + new Date().toISOString() + '] merchant: ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}
const r3 = (n) => Math.round(n * 1000) / 1000;
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

const busOp = (payload, signer) => ['custom_json', {
  required_auths: [], required_posting_auths: [signer], id: 'saos',
  json: JSON.stringify(Object.assign({ protocol: 'saos/v1', time: new Date().toISOString() }, payload)),
}];

async function main() {
  const t0 = Date.now();
  log('=== MERCHANT-67 · ' + (LIVE ? 'LIVE' : 'DRY') + ' · מסילת-סוחר: saos:buy:SYMBOL:QTY ===');

  // ── שוק-חי: מחיר-מכירה = bestAsk של הספר (האוצר מוכר-בספר, לא-מתחתיו)
  const dex = await localJson('/api/ops/saos/dex?username=' + ACCOUNT);
  const bestAsk = (dex.stats || {}).bestAsk;
  if (!(bestAsk > 0)) throw new Error('אין-bestAsk — אין-תמחור-אמין');
  const treasuryFree = r3((dex.mine || {}).saosLiquid || 0);
  log('שוק: bestAsk=' + bestAsk + ' · treasury-SAOS-חופשי=' + treasuryFree);

  // ── סריקת-הזמנות: transfers-נכנסים עם ממו saos:buy:SYMBOL[:QTY]
  // api.steemit.com round-robins בין-replicas-עם-lag-לא-אחיד (תגלית-31/67) —
  // page-0 נרוץ-במקביל-מול-3-צמתים ונחזיק-את-הטרי-ביותר; אם-הכל-נפל — fallback-רציף
  let lowest = -1;
  const orders = [];
  const seenIdx = new Set();
  let pagesDone = 0;
  let winner = STEEM_NODES[0];
  const ingest = (raw) => {
    for (const [idx, e] of raw) {
      if (seenIdx.has(idx)) continue;
      seenIdx.add(idx);
      if (lowest === -1 || idx < lowest) lowest = idx;
      const [type, v] = e.op || [];
      if (type !== 'transfer') continue;
      if (String(v.to || '').toLowerCase() !== ACCOUNT) continue;
      const memo = String(v.memo || '');
      if (!memo.startsWith('saos:buy:')) continue;
      const parts = memo.split(':');
      const symbol = (parts[2] || '').toUpperCase();
      if (symbol !== 'SAOS') continue; // v1: SAOS-בלבד — הרחבה-לעגונים-בעתיד
      const unit = String(v.amount || '').split(' ')[1] || '';
      if (unit !== 'STEEM') continue;
      const sent = parseFloat(String(v.amount || '').split(' ')[0]) || 0;
      const wanted = parts[3] ? (parseFloat(parts[3]) || 0) : 0;
      if (!(sent > 0)) continue;
      if (e.timestamp && e.timestamp < MERCHANT_GENESIS) continue; // לפני-המסילה — מומשו-ב-62
      orders.push({ buyer: String(v.from || '').toLowerCase(), sent, wanted, txid: e.trx_id, at: e.timestamp, memo: memo.slice(0, 80) });
    }
  };
  {
    let freshest = null;
    let newestIdx = -1;
    const raced = await Promise.allSettled(
      STEEM_NODES.map(async (u) => ({ u, entries: await rpcNode(u, 'condenser_api.get_account_history', [ACCOUNT, -1, PAGE_SIZE]) }))
    );
    for (const r of raced) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value) || !r.value.length) continue;
      const newest = r.value.reduce((m, [idx]) => Math.max(m, idx), -1);
      if (newest > newestIdx) { newestIdx = newest; freshest = r.value; winner = r.u; }
    }
    if (!freshest) {
      // fallback-ריבוני: ניסיון-יחיד-חוזר-על-הצומת-הראשי — תקלה-רגעית-לא-עוצרת-את-השירות
      const retry = await rpcNode(winner, 'condenser_api.get_account_history', [ACCOUNT, -1, PAGE_SIZE]).catch(() => null);
      if (Array.isArray(retry) && retry.length) { freshest = retry; }
    }
    if (freshest) { pagesDone++; ingest(freshest); }
  }
  for (let p = 1; p < MAX_PAGES && lowest > 0; p++) {
    const start = lowest - 1;
    const raw = await rpcNode(winner, 'condenser_api.get_account_history', [ACCOUNT, start, PAGE_SIZE]).catch(() => null);
    if (!Array.isArray(raw) || !raw.length) { log('scan page ' + p + ': ' + (raw ? 'empty' : 'RPC-FAIL')); break; }
    pagesDone++;
    ingest(raw);
  }
  log('הזמנות-חיות-מהשרשרת: ' + orders.length + ' · (scan: pages=' + pagesDone + ' scanned=' + seenIdx.size + ')');

  const state = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { return { fulfilled: {}, sales: [], revenue: 0 }; } })();
  state.fulfilled = state.fulfilled || {};
  state.sales = state.sales || [];
  state.revenue = state.revenue || 0;

  // idempotence-כפולה: state + סריקת-מסירות-קודמות-על-השרשרת (ref=sale:<txid>)
  let lowest2 = -1;
  const seen2 = new Set();
  for (let p = 0; p < MAX_PAGES && (lowest2 === -1 || lowest2 > 0); p++) {
    const start = lowest2 === -1 ? -1 : lowest2 - 1;
    const raw = await rpcNode(STEEM_NODES[0], 'condenser_api.get_account_history', [ACCOUNT, start, PAGE_SIZE]).catch(() => null);
    if (!Array.isArray(raw) || !raw.length) break;
    for (const [idx, e] of raw) {
      if (seen2.has(idx)) continue;
      seen2.add(idx);
      if (lowest2 === -1 || idx < lowest2) lowest2 = idx;
      const [type, v] = e.op || [];
      if (type !== 'custom_json' || (v && v.id) !== 'saos') continue;
      let pl = null; try { pl = JSON.parse(v.json); } catch (_) {}
      if (pl && pl.protocol === 'saos/v1' && pl.action === 'transfer' && typeof pl.ref === 'string' && pl.ref.startsWith('sale:')) {
        state.fulfilled[pl.ref.slice(5)] = pl.txid || e.trx_id || true;
      }
    }
  }

  let fired = 0;
  for (const o of orders) {
    if (fired >= MAX_SALES_PER_BEAT) break;
    if (state.fulfilled[o.txid]) continue;
    // תמחור: מסירה = min(רצוי, sent/bestAsk, תקרה) — רצפת 0.01
    const affordable = o.sent / bestAsk;
    let qty = r3(Math.min(o.wanted > 0 ? o.wanted : affordable, affordable, DELIVER_CAP));
    if (qty < DELIVER_MIN) qty = Math.min(DELIVER_MIN, affordable >= DELIVER_MIN ? DELIVER_MIN : 0);
    if (!(qty >= DELIVER_MIN)) { log('@' + o.buyer + ' sent ' + o.sent + ' — מתחת-למינימום-מסירה (qty=' + qty + ') · דילוג-כנה'); state.fulfilled[o.txid] = 'below-min'; continue; }
    if (treasuryFree < qty + 0.5) { log('אוצר-לא-מספיק-חופשי (' + treasuryFree + ' < ' + qty + ') — דילוג-בטוח'); continue; }
    const revenue = r6(qty * bestAsk); // ערך-המסירה במחיר-הספר; היתר = מרווח-האוצר
    if (!LIVE) { log('[DRY] @' + o.buyer + ' ← ' + qty + ' SAOS (paid ' + o.sent + ' STEEM @ ' + bestAsk + ') ref=sale:' + o.txid.slice(0, 12)); fired++; continue; }
    try {
      const conf = await steem.broadcast.sendAsync({
        operations: [
          busOp({ action: 'transfer', account: ACCOUNT, to: o.buyer, amount: qty, ref: 'sale:' + o.txid, price: bestAsk }, ACCOUNT),
          busOp({ action: 'receipt', ref: o.txid, buyer: o.buyer, symbol: 'SAOS', qty, price: bestAsk, paid: o.sent, at: new Date().toISOString() }, ACCOUNT),
        ],
        extensions: [],
      }, [loadDotEnv(__dirname).POSTING_WIF]);
      const txid = (conf && conf.id) || null;
      state.fulfilled[o.txid] = txid || true;
      state.sales.push({ at: new Date().toISOString(), buyer: o.buyer, sent: o.sent, qty, price: bestAsk, revenue, buyTxid: o.txid, txid, verified: false });
      state.revenue = r6(state.revenue + o.sent);
      log('@' + o.buyer + ' ✓ מסירה ' + qty + ' SAOS (paid ' + o.sent + ' STEEM) txid=' + txid + ' · ref=sale:' + o.txid.slice(0, 12));
      fired++;
      await new Promise((res) => setTimeout(res, 3400));
    } catch (e) {
      log('@' + o.buyer + ' FAIL: ' + String((e && e.message) || e).slice(0, 110));
    }
  }

  // אימות-מכירות-פתוחות
  for (const s of state.sales) {
    if (s.verified || !s.txid) continue;
    const node = await verifyTxid(s.txid);
    if (node) { s.verified = true; s.node = node; log('sale verified ✓ @' + s.buyer + ' ' + node); }
  }

  state.beats = (state.beats || 0) + 1;
  state.at = new Date().toISOString();
  state.ms = Date.now() - t0;
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
  log('=== סיכום: sales=' + state.sales.length + ' · revenue=' + state.revenue + ' STEEM · beats=' + state.beats + ' (' + state.ms + 'ms) ===');
}

/* ── Task 67 — בדיקת-ביקוש-עצמי: חייל-משלם STEEM נזיל-אמיתי (מהתשואה-שקיבל!)
 * עבור SAOS — המעגל-הכלכלי-המלא: עמלות→תשואה→חייל→קנייה→הכנסה-לאוצר.
 * שימוש: node merchant.cjs --buy --soldier cashmachine --steem 0.001 --qty 0.05 */
async function selfDemand() {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf('--' + name);
    return i > 0 ? process.argv[i + 1] : dflt;
  };
  const soldier = String(arg('soldier', 'cashmachine')).toLowerCase();
  const steemAmt = parseFloat(arg('steem', '0.001')) || 0.001;
  const qty = parseFloat(arg('qty', '0.05')) || 0.05;
  if (LIVE) {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const acc = (v.accounts || []).find((a) => String(a.username).toLowerCase() === soldier);
    const wif = acc && acc.keys && acc.keys.active && (acc.keys.active.wif || acc.keys.active);
    if (!wif) throw new Error('active-WIF חסר ל-' + soldier);
    const memo = 'saos:buy:SAOS:' + qty;
    const conf = await steem.broadcast.sendAsync({
      operations: [['transfer', { from: soldier, to: ACCOUNT, amount: steemAmt.toFixed(3) + ' STEEM', memo }]],
      extensions: [],
    }, [wif]);
    log('self-demand ✓ @' + soldier + ' paid ' + steemAmt.toFixed(3) + ' STEEM txid=' + conf.id + ' · ' + memo);
    return;
  }
  log('[DRY] self-demand @' + soldier + ' ' + steemAmt + ' STEEM → saos:buy:SAOS:' + qty);
}

const buyIdx = process.argv.indexOf('--buy');
if (buyIdx > 0) {
  selfDemand().catch((e) => { log('FATAL ' + String((e && e.message) || e)); process.exit(1); });
} else {
  main().catch((e) => { log('FATAL ' + String((e && e.message) || e)); process.exit(1); });
}
