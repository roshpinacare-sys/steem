#!/usr/bin/env node
/* microdex.cjs — Task 65: מיקרו-דקס חתום-חייל — החיילים רצים חזק על הדקס גם במיקרו.
 *
 * החוסם-המבני שנשבר: עד-היום כל פעולות-הדקס היו חתומות-אוצר (relay דרך
 * headcorner) — ריכוז-RC, תקרת-ops יומית, ואפס-ריבונות פר-חייל. עכשיו:
 *   כל חייל חותם-עצמו (posting-WIF שלו) custom_json id='saos' protocol saos/v1
 *   מההיסטוריה-שלו — וה-replay הרב-חשבוני של הדקס (saos-dex.ts) קורא גם אותה.
 *
 * סבב-פעולות (רוטציה לכל חייל, מדוד מהשרשרת-עצמה — השרשרת היא הפנקס):
 *   1. fill    — חייל חוצה הזמנה-מנוחה של אחר (טרייד אמיתי: tradesTotal↑, lastPrice)
 *   2. order   — הזמנת-sell @ fair×1.03 (עומק-asks רב-בעלים)
 *   3. order   — הזמנת-buy @ fair×0.95 מהקרדיט-שנצבר
 *   4. pool_swap — מיקרו-סוואפ דרך הבריכה (עמלות 30bps → LP+אוצר)
 *
 * חומות: ≤3 ops/פעימה · ≤4 ops/חייל/יום (נמדד מההיסטוריה-שלו) ·
 * RC-שער ≥40% · רצפת-SAOS 0.05 · אין self-trade · אין מפתחות בלוג.
 * אימות: כל txid נבדק get_transaction על צומת-עצמאי. DRY כברירת-מחדל (--live).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const LIVE = process.argv.includes('--live');
const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const OUT = path.join(__dirname, 'microdex_state.json');
const LOG = path.join(__dirname, 'microdex.log');
const LOCAL_API = 'http://127.0.0.1:3000';

const OPS_PER_BEAT = 5;        // חומת-פעימה (Task 66 — הרחבה מ-3: עדות-RC מדודה 0.008-0.275%/op)
const OPS_PER_SOLDIER_DAY = 10; // חומת-חייל-יום (Task 66 — הרחבה מ-4: חיילים יושבים על 99.6-99.9% RC,
                                //   רג'ן 5 ימים ≈ 20%/יום — 10 ops ≈ 1%/יום, מרווח-ביטחון ×20)
const RC_GATE_PCT = 40;        // שער-דלק מינימלי לחייל
const SAOS_FLOOR = 0.05;       // רצפת-SAOS לחייל
const CREDIT_FLOOR = 0.002;    // רצפת-קרדיט (לא-נוגעים)
const FILL_AMT_CAP = 0.05;     // מיקרו-fill מקסימלי
const NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://steem.61bts.com'];
const HIVE_NODES = ['https://api.openhive.network', 'https://api.hive.blog'];
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';

function log(msg) {
  const line = '[' + new Date().toISOString() + '] microdex: ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}
const r3 = (n) => Math.round(n * 1000) / 1000;
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const utcToday = () => new Date().toISOString().slice(0, 10);

function loadArmyPosting() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || [])
      .filter((a) => a && a.username && String(a.username).toLowerCase() !== ACCOUNT)
      .map((a) => ({
        username: String(a.username).toLowerCase(),
        postingWif: (a.keys && a.keys.posting && a.keys.posting.wif) || '',
      }))
      .filter((a) => a.postingWif);
  } catch (_) { return []; }
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
    const req = require('https').request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 15000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc')); resolve(j.result); }
        catch (_) { reject(new Error('bad rpc')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}

async function rcPct(name) {
  try {
    const r = await rpcNode(NODES[0], 'rc_api.find_rc_accounts', { accounts: [name] });
    const row = r && r.rc_accounts && r.rc_accounts[0];
    if (!row) return 0;
    return (parseFloat(row.rc_manabar.current_mana) / parseFloat(row.max_rc)) * 100;
  } catch (_) { return 0; }
}

/* כמה ops-דקס אמיתיים החייל כבר חתם היום — השרשרת היא הפנקס (idempotence).
 * fleet_ping אינו פעולת-דקס — לא נספר בתקציב (אחרת הפינגים מרוקנים את המכסה). */
const DEX_ACTIONS = new Set(['order', 'cancel', 'fill', 'pool_add', 'pool_swap', 'pool_remove', 'pool_lock', 'pool_swapw', 'sfill']);
async function soldierOpsToday(name) {
  const cutoff = utcToday();
  const ops = [];
  try {
    const raw = await rpcNode(NODES[0], 'condenser_api.get_account_history', [name, -1, 100]);
    if (Array.isArray(raw)) {
      for (const [, e] of raw) {
        if (!e || !e.timestamp || !e.timestamp.startsWith(cutoff)) continue;
        const [type, v] = e.op || [];
        if (type !== 'custom_json' || v?.id !== 'saos') continue;
        let p = null;
        try { p = JSON.parse(v.json); } catch (_) {}
        if (p && p.protocol === 'saos/v1' && DEX_ACTIONS.has(String(p.action || ''))) ops.push({ action: p.action, txid: e.trx_id });
      }
    }
  } catch (_) {}
  return ops;
}

async function verifyTxid(txid) {
  for (const node of NODES) {
    try {
      const r = await rpcNode(node, 'condenser_api.get_transaction', [txid]);
      if (r && r.transaction_id) return node;
    } catch (_) {}
  }
  return null;
}

/* ── Task 67 — נוכחות-צי-דו-שרשרתית: חייל אחד בכל-פעימה חותם-עצמו על Hive.
 * אותם-מפתחות (secp256k1), חשבונות-צעירים-עם-מכלי-RC-מלאים — האוטובוס
 * קיים-בשתי-השרשראות, חתום-בידי-הצי — לא-על-ידי-האוצר. */
async function hiveRpcCall(method, params) {
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  const u = new URL(HIVE_NODES[0]);
  return new Promise((resolve, reject) => {
    const req = require('https').request({ hostname: u.hostname, path: '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 15000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc')); resolve(j.result); }
        catch (_) { reject(new Error('bad rpc')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}

async function hiveRcPct(name) {
  try {
    const r = await hiveRpcCall('rc_api.find_rc_accounts', { accounts: [name] });
    const row = r && r.rc_accounts && r.rc_accounts[0];
    if (!row) return 0;
    return (parseFloat(row.rc_manabar.current_mana) / parseFloat(row.max_rc)) * 100;
  } catch (_) { return 0; }
}

async function hiveVerifyTxid(txid) {
  for (const node of HIVE_NODES) {
    try {
      const r = await rpcNode(node, 'condenser_api.get_transaction', [txid]);
      if (r && r.transaction_id) return new URL(node).hostname;
    } catch (_) {}
  }
  return null;
}

async function hiveSoldierPing(s) {
  const rc = await hiveRcPct(s.username);
  if (rc < 20) return { skip: 'RC ' + rc.toFixed(0) + '%' };
  const dgp = await hiveRpcCall('condenser_api.get_dynamic_global_properties', []);
  const payload = { protocol: 'saos/v1', action: 'hive_ping', time: new Date().toISOString(), soldier: s.username };
  const op = ['custom_json', { required_auths: [], required_posting_auths: [s.username], id: 'saos', json: JSON.stringify(payload) }];
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [op],
    extensions: [],
  };
  const prev = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try { signed = steem.auth.signTransaction(tx, [s.postingWif]); } finally { steem.config.set('chain_id', prev); }
  await hiveRpcCall('condenser_api.broadcast_transaction', [signed]);
  // התמודדות-עם-עיכוב-אינדוקס: ה-op מזוהה לפי payload.time בהיסטוריה-של-החותם
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const hist = await hiveRpcCall('condenser_api.get_account_history', [s.username, -1, 10]);
      for (const [, e] of hist || []) {
        if ((e.op || [])[0] !== 'custom_json' || e.op[1].id !== 'saos') continue;
        let pl = null; try { pl = JSON.parse(e.op[1].json); } catch (_) {}
        if (pl && pl.time === payload.time) return { txid: e.trx_id || null, time: payload.time };
      }
    } catch (_) {}
  }
  return { txid: null, time: payload.time, pending: true };
}

function busOp(payload, signer) {
  return ['custom_json', {
    required_auths: [],
    required_posting_auths: [signer],
    id: 'saos',
    json: JSON.stringify(Object.assign({ protocol: 'saos/v1', time: new Date().toISOString() }, payload)),
  }];
}

async function main() {
  const day = utcToday();
  const t0 = Date.now();
  log('=== מיקרו-דקס · ' + (LIVE ? 'LIVE' : 'DRY') + ' · walls ' + OPS_PER_BEAT + '/beat · ' + OPS_PER_SOLDIER_DAY + '/soldier/day ===');
  const army = loadArmyPosting();
  if (!army.length) { log('FATAL: אין חיילים עם posting-WIF בכספת'); process.exit(1); }

  // שוק חי מה-replay הרב-חשבוני
  const dex = await localJson('/api/ops/saos/dex?username=' + ACCOUNT);
  if (!dex || dex.ok !== true) throw new Error('dex snapshot failed');
  const stats = dex.stats || {};
  const fair = stats.lastPrice || 0.0179;
  const balBy = new Map((dex.balances || []).map((b) => [b.account, b]));
  const asks = (dex.book && dex.book.asks) || [];
  const bids = (dex.book && dex.book.bids) || [];
  const pool = (dex.pools || []).find((p) => p.pair === 'SAOS:STEEM') || null;
  // GRID-97 — בריכת-הגשר: יתרות-WTRX פר-חייל מהספר-הריבוני (wrappedHolders) —
  // החיילים סוחרים נזילות-הגשר (WTRX↔SAOS) — הקרנל אוכף (not-holder כנה-על-הספר)
  let wtrBy = new Map();
  let poolWLive = null;
  let sovAsks = []; let sovBids = []; let floatBal = new Map();
  try {
    // הספר-הריבוני — קריאה-מקומית-ישירה (אותה-מכונה; ה-API מקנן-שדות ומסנן)
    const sovState = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sovereign', 'node', 'state.json'), 'utf8'));
    const wh = sovState.wrappedHolders || {};
    for (const [n, v] of Object.entries(wh)) wtrBy.set(String(n).toLowerCase(), Number(v) || 0);
    poolWLive = (sovState.grid97 && sovState.grid97.poolW) || null;
    // GRID-97 — סולם-האוצר על-הספר-הריבוני + יתרות-צף — החיילים ממלאים-ישירות (sfill)
    sovAsks = ((sovState.book && sovState.book.asks) || []).filter((a) => a.owner === 'headcorner');
    sovBids = ((sovState.book && sovState.book.bids) || []).filter((b) => b.owner === 'headcorner');
    const fb = sovState.floatBalances || {};
    for (const [n, v] of Object.entries(fb)) floatBal.set(String(n).toLowerCase(), v);
  } catch (_) { /* הספר לא זמין — החריצים-הריבוניים ידלגו בכנות */ }
  log('שוק: fair=' + fair + ' bestAsk=' + stats.bestAsk + ' bestBid=' + stats.bestBid + ' trades=' + stats.tradesTotal + ' pool=' + (pool ? pool.swaps + ' swaps' : 'none') + ' · poolW=' + (poolWLive ? poolWLive.saos.toFixed(2) + 'S/' + poolWLive.wtrx.toFixed(3) + 'W' : 'none'));

  // GRID-97 — sfill: מילוי-ישיר של סולם-האוצר על-הספר-הריבוני.
  // חייל עם-SAOS-ריבוני מוכר-ל-bid-האוצר (−0.4% מהאמצע) · חייל עם-STEEM-ריבוני
  // קונה-מה-ask (+0.4%) — הספרד נתפס-אוצר, הצי מקבל-ביצוע-מיידי, הספר-נסחר.
  // זהות=חתימת-החייל-על-המארח · הקרנל אוכף: self-trade/יתרות/גבהים.
  const sfillPlan = (s) => {
    const fb = floatBal.get(s.username) || { saos: 0, steem: 0 };
    const sBid = sovBids[0]; // ה-bid-הגבוה-של-האוצר (ממוין-מה-API)
    const sAsk = sovAsks[0]; // ה-ask-הנמוך-של-האוצר
    if (sBid && fb.saos >= 0.02) {
      const amt = r3(Math.min(FILL_AMT_CAP, sBid.amount, fb.saos));
      if (amt >= 0.02) return { payload: { action: 'sfill', oid: 'sov:' + sBid.id, taker: s.username, amount: amt, ref: 'md97' }, why: 'sfill ' + amt + ' @' + sBid.price + ' ← headcorner #' + sBid.id };
    }
    if (sAsk && fb.steem >= 0.002) {
      const amt = r3(Math.min(FILL_AMT_CAP, sAsk.amount, (fb.steem - 0.001) / sAsk.price));
      const cost = r6(amt * sAsk.price);
      if (amt >= 0.02 && cost <= fb.steem - 0.001) return { payload: { action: 'sfill', oid: 'sov:' + sAsk.id, taker: s.username, amount: amt, ref: 'md97' }, why: 'sfill ' + amt + ' @' + sAsk.price + ' ← headcorner #' + sAsk.id };
    }
    return null;
  };

  const state = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { return { day: '', beats: 0, opsToday: 0, bySoldier: {}, txids: [], rcCost: [] }; } })();
  if (state.day !== day) { state.day = day; state.opsToday = 0; state.bySoldier = {}; state.txids = []; state.rcCost = []; }
  // Task 66 — מונה-שרשרת-עצמאי לרוטציה-צודקת: כמה ops-דקס כל-חייל חתם היום
  // (נמדד מההיסטוריה-שלו — השרשרת היא הפנקס) — נמדד פעם-אחת-מראש למיון.
  const localBySoldier = {};
  for (const s of army) {
    if (s.username === 'ynet' || s.username === 'powerspan') continue;
    try { localBySoldier[s.username] = (await soldierOpsToday(s.username)).length; } catch (_) { localBySoldier[s.username] = 0; }
  }

  let fired = 0;
  // Task 66 — רוטציה-צודקת: החייל-הפחות-מועסק-היום ראשון (מקומי + שרשרת מאוחדים).
  // לפני-כן שלושת-הראשונים-ברשימה צרכו את כל-הפעימה — 7 חיילים היו בטלים.
  for (const t of state.txids || []) {
    if (t.verified || !t.txid) continue;
    const node = await verifyTxid(t.txid);
    if (node) {
      t.verified = true;
      log('re-verify ✓ @' + t.by + ' ' + t.why + ' txid=' + String(t.txid).slice(0, 12) + '… (' + new URL(node).hostname + ')');
    }
  }
  const armyFair = army.slice().sort((a, b) => {
    const ua = a.username, ub = b.username;
    if (ua === 'ynet' || ua === 'powerspan') return 1;
    if (ub === 'ynet' || ub === 'powerspan') return -1;
    const la = Math.max(state.bySoldier[ua] || 0, localBySoldier[ua] || 0);
    const lb = Math.max(state.bySoldier[ub] || 0, localBySoldier[ub] || 0);
    return la - lb;
  });
  for (const s of armyFair) {
    if (fired >= OPS_PER_BEAT) break;
    if (s.username === 'ynet' || s.username === 'powerspan') continue; // operator-delegated / סוללת-אנרגיה — דילוג-כנה (Task 63/64)
    const rc = await rcPct(s.username);
    if (rc < RC_GATE_PCT) { log('@' + s.username + ' RC ' + rc.toFixed(1) + '% < ' + RC_GATE_PCT + '% — דילוג'); continue; }
    const mine = await soldierOpsToday(s.username);
    // belt+suspenders מול-עיכוב-אינדוקס (תגלית-65: get_transaction חי מיד,
    // get_account_history מפגר דקות-עד-שעות): התקציב = מקסימום השרשרת-והמקומי
    const localToday = state.bySoldier[s.username] || 0;
    const used = Math.max(mine.length, localToday);
    if (used >= OPS_PER_SOLDIER_DAY) { log('@' + s.username + ' מוצה ' + used + '/' + OPS_PER_SOLDIER_DAY + ' — דילוג'); continue; }
    const b = balBy.get(s.username) || { saos: 0, credit: 0, locked: 0 };
    const saosFree = Math.max(0, r3((b.saos || 0) - SAOS_FLOOR));
    const credit = b.credit || 0;

    // רוטציה עם fallback מחזורי (Task 67 — 5 חריצים · GRID-97 — 6):
    // fill → order-sell → pool_swap → order-buy → pool_add → pool_swapw (בריכת-הגשר).
    // מתחילים בפעולה-המסובבת וממשיכים מסביב עד שאחת מתאפשרת מהמאזן-בפועל.
    const rot = (mine.length + state.beats) % 6;
    const plan = [];
    for (let k = 0; k < 6; k++) {
      const r = (rot + k) % 6;
      if (r === 0 && bids.length && saosFree >= 0.02) {
        const bid = bids.find((x) => x.owner !== s.username);
        if (bid) {
          const amt = r3(Math.min(FILL_AMT_CAP, bid.remaining * 0.9, saosFree));
          if (amt >= 0.02) plan.push({ payload: { action: 'fill', oid: bid.oid, taker: s.username, amount: amt, ref: 'md65' }, why: 'fill ' + amt + ' @' + bid.price + ' ← ' + bid.owner });
        }
      }
      if (r === 1 && saosFree >= 0.03) {
        const amt = r3(Math.min(0.04, saosFree));
        plan.push({ payload: { action: 'order', oid: 'md65-' + s.username + '-' + day + '-' + (used + 1), side: 'sell', price: r6(fair * 1.03), amount: amt, account: s.username, ref: 'md65' }, why: 'order-sell ' + amt + ' @' + r6(fair * 1.03) });
      }
      if (r === 2) {
        if (pool && saosFree >= 0.03) {
          const amt = r3(Math.min(0.05, saosFree));
          plan.push({ payload: { action: 'pool_swap', pair: 'SAOS:STEEM', account: s.username, taker: s.username, side: 'sell_saos', inAmt: amt, ref: 'md65' }, why: 'pool_swap ' + amt + ' SAOS→STEEM-credit' });
        } else {
          // GRID-97 — slot-2-ריק (אין-SAOS-מארח) → זרימה-ריבונית: sfill-סולם-אוצר
          const sp = sfillPlan(s);
          if (sp) plan.push(sp);
        }
      }
      if (r === 3) {
        if (credit > CREDIT_FLOOR + 0.002) {
          const spend = r6(credit * 0.85);
          const amt = r3(Math.max(0.02, Math.min(0.2, spend / (fair * 0.95))));
          const cost = r6(amt * fair * 0.95);
          if (cost <= credit - CREDIT_FLOOR) {
            plan.push({ payload: { action: 'order', oid: 'md65-' + s.username + '-' + day + '-' + (used + 1), side: 'buy', price: r6(fair * 0.95), amount: amt, account: s.username, ref: 'md65' }, why: 'order-buy ' + amt + ' @' + r6(fair * 0.95) });
          }
        } else {
          // GRID-97 — slot-3-ריק (אין-קרדיט) → זרימה-ריבונית: sfill
          const sp = sfillPlan(s);
          if (sp) plan.push(sp);
        }
      }
      // Task 67 — חריץ-5: החייל-כספק-נזילות — pool_add חד-צדדי (SAOS-בלבד,
      // מניות-לפי-יחס) — עומק-בריכה רב-בעלים; ה-LP מרוויח עמלות → התשואה-מתגלגלת
      if (r === 4 && pool && saosFree >= 0.05) {
        const amt = r3(Math.min(0.04, saosFree));
        plan.push({ payload: { action: 'pool_add', pair: 'SAOS:STEEM', account: s.username, saosAmt: amt, steemAmt: 0, ref: 'md67' }, why: 'pool_add ' + amt + ' SAOS (LP)' });
      }
      // GRID-97 — חריץ-6: סוחר-הגשר — WTRX↔SAOS על בריכת-הגשר שלנו (נזילות-טרון
      // נסחרת-על-הדקס שלנו). sell_wtrx מיקרו (הקרנל אוכף-יתרה) · buy_wtrx ≥0.34-SAOS
      // משלם-עמלה-אמת (≥1µ) ל-LP+אוצר.
      if (r === 5 && poolWLive) {
        const wtrx = wtrBy.get(s.username) || 0;
        if (wtrx >= 0.004) {
          plan.push({ payload: { action: 'pool_swapw', pair: 'WTRX:SAOS', account: s.username, taker: s.username, side: 'sell_wtrx', inAmt: 0.002, ref: 'md97' }, why: 'pool_swapw 0.002 WTRX→SAOS' });
        } else if (saosFree >= 0.45) {
          plan.push({ payload: { action: 'pool_swapw', pair: 'WTRX:SAOS', account: s.username, taker: s.username, side: 'buy_wtrx', inAmt: 0.35, ref: 'md97' }, why: 'pool_swapw 0.35 SAOS→WTRX' });
        }
      }
      if (plan.length) break;
    }
    // GRID-97 — sfill-fallback אוניברסלי: מילוי-ישיר של סולם-האוצר על-הספר-הריבוני
    if (!plan.length) {
      const sp = sfillPlan(s);
      if (sp) plan.push(sp);
    }
    const pick = plan[0] || null;
    const payload = pick ? pick.payload : null;
    const why = pick ? pick.why : '';
    if (!payload) { log('@' + s.username + ' אין-פעולה מתאימה (saos=' + saosFree + ' credit=' + credit + ' rot=' + rot + ')'); continue; }

    if (!LIVE) { log('[DRY] @' + s.username + ' ' + why); fired++; continue; }
    const rcBefore = rc;
    try {
      const conf = await steem.broadcast.sendAsync({ operations: [busOp(payload, s.username)], extensions: [] }, [s.postingWif]);
      const txid = (conf && conf.id) || null;
      const node = txid ? await verifyTxid(txid) : null;
      fired++;
      state.opsToday += 1;
      state.bySoldier[s.username] = (state.bySoldier[s.username] || 0) + 1;
      if (txid) state.txids.push({ at: new Date().toISOString(), by: s.username, why, txid, verified: !!node });
      log('@' + s.username + ' ✓ ' + why + ' txid=' + txid + (node ? ' (אומת ' + new URL(node).hostname + ')' : ' (ממתין-אינדקס)'));
      const rcAfter = await rcPct(s.username);
      state.rcCost.push({ by: s.username, delta: r3(rcBefore - rcAfter) });
    } catch (e) {
      log('@' + s.username + ' FAIL: ' + String((e && e.message) || e).slice(0, 120));
    }
    await new Promise((r) => setTimeout(r, 3400)); // בלוק-חדש בין-ops — חומת-5
  }

  state.beats = (state.beats || 0) + 1;
  state.lastAt = new Date().toISOString();
  state.ms = Date.now() - t0;

  // ── Task 67 — פעימת-Hive: חייל-אחד-מסובב חותם-עצמו על Hive (נוכחות-דו-שרשרתית)
  // רוטציה-סבלנית: עד-3-מועמדים-מהתור — חייל-ריק-דלק לא גונב-את-הפעימה
  if (!state.hivePings) state.hivePings = [];
  const pingable = armyFair.filter((s) => s.username !== 'ynet' && s.username !== 'powerspan');
  for (let attempt = 0; attempt < 3 && pingable.length; attempt++) {
    const pinger = pingable[(state.beats - 1 + attempt) % pingable.length];
    if (!pinger) break;
    if (!LIVE) break;
    try {
      const r = await hiveSoldierPing(pinger);
      if (r.skip) {
        log('hive-ping @' + pinger.username + ' דילוג: ' + r.skip);
        continue;
      }
      state.hivePings.push({ at: new Date().toISOString(), by: pinger.username, txid: r.txid, verified: !!(r.txid) });
      if (state.hivePings.length > 30) state.hivePings = state.hivePings.slice(-30);
      log('hive-ping ✓ @' + pinger.username + ' txid=' + r.txid + (r.pending ? ' (ממתין-אינדקס)' : ''));
      break;
    } catch (e) {
      log('hive-ping @' + pinger.username + ' FAIL: ' + String((e && e.message) || e).slice(0, 100));
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
  log('סיכום: fired=' + fired + ' opsToday=' + state.opsToday + ' beats=' + state.beats + ' (' + state.ms + 'ms)');
}

main().catch((e) => { log('FATAL ' + String((e && e.message) || e)); process.exit(1); });
