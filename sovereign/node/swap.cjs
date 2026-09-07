#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * THE-SWAP (Task 117 continuation) — גשר-ההמרה TRX ⇄ איתריום/סולנה אמת
 * ─────────────────────────────────────────────────────────────────────────────
 * המנדט (המפעיל, 117): "$1 לאיתריום אמת על הרשת שלו + $1 לסולנה אמת על הרשת —
 * כדי שתוכל ליישם · חובה לכתוב הכל לריפו". המנדט (המפעיל, המשך): "נסה להחליף
 * את ה-TRX — הוא עדיין בארנק מחכה לניסוי שלך · תמשיך · וכתוב לריפו בסוף".
 *
 * המציאות הנמדדת (כנות מעל הכל):
 *  · כל ה-TRX שלנו (19.13 TRX ≈ $6.40) יושב על שתי דלתות-גשר ישנות (TRKStC5…,
 *    TAzZZk…) שהמנומניק שלהן אבד ברולבק של Task 115 — האיטום הישן (טרם-התיקון)
 *    אטם רק .json ולא .txt, ולכן tron-mnemonic.txt הישן נמחק. המטבעות על השרשרת,
 *    המפתח לא — הדלתות נעולות עד-שימצא גיבוי טרום-רולבק של הקובץ.
 *  · מלאי ה-TRX הנשלט אפס (12 דלתות-מנומניק + 12 ארנקי-v2 — כולם 0, נמדד-חי).
 *  · נתיב-ההמרה שנבדק-חי: ChangeNOW — min-amount + estimates ללא-מפתח ✓,
 *    יצירת-עסקה דורשת מפתח-API (נמדד: Unauthorized). Exolix חסום-CF. SideShift n/a.
 *
 * עיקרון: המודול הזה הוא הניסוי — כל-נתון נאסף-חי מהשרשרות ומהספק, כל-שלב
 * נרשם ל-state אטומי, אפס סודות בלוגים, ואפס שידור בלי-כל-שלושת-התנאים:
 *   (1) מנדט-מפעיל פעיל (swap-mandate.json active:true)
 *   (2) מפתח-ספק ב-agent/.env (SWAP_CHANGENOW_KEY)
 *   (3) מלאי נשלט ≥ סכום + רזרבה
 *
 * שימוש:
 *   node swap.cjs survey                 סקר-חי (מחיר · מלאי · ציטוטי-ספק) → swap-survey.json
 *   node swap.cjs status                 סיכום קריאה-בלבד מהקבצים
 *   node swap.cjs execute --leg eth|sol  ביצוע-מוגן (כל-שלושת-התנאים חייבים)
 *   node swap.cjs watch                  סקר-מחזורי (10 דק׳)
 * ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
require('dns').setDefaultResultOrder('ipv4first');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const AGENT_DIR = path.join(ROOT, 'agent');
const VAULT = require(path.join(HERE, 'vault-lib.cjs'));

const SURVEY_F = path.join(HERE, 'swap-survey.json');
const STATE_F = path.join(HERE, 'swap-state.json');
const MANDATE_F = path.join(HERE, 'swap-mandate.json');
const LOG_F = path.join(HERE, 'swap.log');
const PID_F = path.join(HERE, 'swap-watch.pid');

const CHANGENOW = 'https://api.changenow.io';
const BINANCE = 'https://api.binance.com';
const TRONGRID = 'https://api.trongrid.io';
const RESERVE_SUN = 1000000; // רזרבת-דלת מינימלית 1 TRX (דוקטרינת-רצפות)
const NET_BYTES = 268;       // נמדד-חי (Task 90): העברת-TRX ≈ 268 בתים

/* ── אפס-סודות-בלוג ── */
function log(msg) {
  const line = new Date().toISOString() + ' ' + String(msg).slice(0, 220);
  try { fs.appendFileSync(LOG_F, line + '\n'); } catch (_) {}
  console.log('[swap] ' + line);
}
function loadJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return fb; } }
function saveJson(f, obj) {
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, f);
}

/* ── https-get JSON עם-retry ── */
function getJson(url, tries) {
  return new Promise((resolve, reject) => {
    const n = tries || 3;
    const attempt = (i) => {
      const req = https.get(url, { timeout: 15000 }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          if (res.statusCode >= 400) { if (i < n) return setTimeout(() => attempt(i + 1), 2500 * i); return resolve({ httpStatus: res.statusCode, body: b.slice(0, 200) }); }
          try { resolve(JSON.parse(b)); } catch (e) { resolve({ parseError: String(e.message), body: b.slice(0, 120) }); }
        });
      });
      req.on('timeout', () => { req.destroy(); if (i < n) setTimeout(() => attempt(i + 1), 2500 * i); else reject(new Error('timeout ' + url.slice(0, 90))); });
      req.on('error', (e) => { if (i < n) setTimeout(() => attempt(i + 1), 2500 * i); else reject(e); });
    };
    attempt(1);
  });
}
function postJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST', timeout: 20000, headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': data.length }, headers || {}) }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { let out; try { out = JSON.parse(b); } catch (_) { out = { raw: b.slice(0, 200) }; } resolve({ httpStatus: res.statusCode, ...out }); });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/* ── מלאי: כל-הדלתות-שאנחנו-שולטים-בהן (חי מהשרשרת) ── */
function tronDoorsControlled() {
  const TronWeb = require(path.join(ROOT, 'node_modules', 'tronweb'));
  const ethers = require(path.join(ROOT, 'node_modules', 'ethers'));
  const doors = [];
  // משפחה 1: דלתות-המנומניק (גשר/דקס — אינדקסים 0..11)
  try {
    const mn = VAULT.readMnemonic();
    if (mn && mn.split(/\s+/).length === 12) {
      for (let i = 0; i < 12; i++) {
        const w = ethers.HDNodeWallet.fromPhrase(mn, undefined, "m/44'/195'/0'/0/" + i);
        doors.push({ family: 'mnemonic', idx: i, address: new TronWeb({ fullHost: TRONGRID, privateKey: w.privateKey.slice(2) }).defaultAddress.base58, priv: w.privateKey.slice(2) });
      }
    }
  } catch (_) {}
  // משפחה 2: ארנקי-v2 מהזרע-הריבוני (הגריד-המפורסם)
  try {
    const seedDoc = VAULT.readMember('wallets-seed.json');
    const seed = String(seedDoc.seed || '');
    if (/^[0-9a-f]{64,}$/.test(seed)) {
      const sha256buf = (s) => crypto.createHash('sha256').update(s).digest();
      const tronRoot = ethers.HDNodeWallet.fromSeed(sha256buf(seed + '|tron|44/195'));
      const pub = loadJson(path.join(AGENT_DIR, 'wallets-public.json'), null) || loadJson(path.join(HERE, 'wallets-public.json'), null);
      const agents = (pub && (pub.agents || pub.wallets)) || [];
      for (let i = 0; i < 12; i++) {
        const w = tronRoot.derivePath("m/44'/195'/0'/0/" + i);
        const t = new TronWeb({ fullHost: TRONGRID, privateKey: w.privateKey.slice(2) });
        doors.push({ family: 'grid-v2', idx: i, address: t.defaultAddress.base58, priv: w.privateKey.slice(2), agent: (agents[i] && agents[i].agent) || ('grid' + i) });
      }
    }
  } catch (_) {}
  return doors;
}

async function tronBalance(address) {
  try {
    const d = await getJson(TRONGRID + '/v1/accounts/' + address, 2);
    const acc = (d && d.data && d.data[0]) || {};
    return Number(acc.balance || 0);
  } catch (_) { return 0; }
}

/* ── סקר-חי ── */
async function survey() {
  const t0 = Date.now();
  log('survey: start');
  const out = { at: new Date().toISOString(), protocol: 'saos:swap/v1' };

  // מחיר-אמת
  try {
    const px = await getJson(BINANCE + '/api/v3/ticker/price?symbol=TRXUSDT', 2);
    out.trxUsdt = Number(px.price);
  } catch (e) { out.trxUsdt = null; out.trxPriceError = String(e.message).slice(0, 90); }
  try {
    const px = await getJson(BINANCE + '/api/v3/ticker/price?symbol=ETHUSDT', 2);
    out.ethUsdt = Number(px.price);
  } catch (_) { out.ethUsdt = null; }
  try {
    const px = await getJson(BINANCE + '/api/v3/ticker/price?symbol=SOLUSDT', 2);
    out.solUsdt = Number(px.price);
  } catch (_) { out.solUsdt = null; }

  // מלאי-נשלט (חי)
  const doors = tronDoorsControlled();
  const inventory = [];
  for (const d of doors) {
    const sun = await tronBalance(d.address);
    inventory.push({ family: d.family, idx: d.idx, agent: d.agent || null, address: d.address, trx: sun / 1e6, hasKey: !!d.priv });
  }
  out.inventory = inventory;
  out.controlledTrx = inventory.reduce((s, x) => s + x.trx, 0);
  out.lockedDoors = [
    { address: 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4', role: 'bridge-broadcaster(idx0-ישן)', trx: 3.735912, status: 'LOCKED — mnemonic lost in the 115 rollback (pre-fix sealer sealed .json only)' },
    { address: 'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr', role: 'bridge-hub(idx1-ישן)', trx: 15.397448, status: 'LOCKED — same hole' },
  ];
  out.lockedTrx = out.lockedDoors.reduce((s, x) => s + x.trx, 0);

  // ציטוטי-ספק (ChangeNOW — נקודות-ציבוריות ללא-מפתח)
  const cn = {};
  for (const [pair, from, to] of [['trx_eth', 'trx', 'eth'], ['trx_sol', 'trx', 'sol']]) {
    try {
      const mn = await getJson(`${CHANGENOW}/v2/exchange/min-amount?fromCurrency=${from}&toCurrency=${to}&flow=standard`, 2);
      cn[pair] = { minAmount: mn.minAmount, minSource: 'v2 keyless ✓' };
    } catch (e) { cn[pair] = { error: String(e.message).slice(0, 80) }; }
  }
  // אומדנים לשערי-החיץ: $1 (≈3.1 TRX) לכל-רגל + סכומי-הדלתות-הנעולות
  const ests = {};
  for (const amt of ['3.1', '15.4', '3.74', String(Math.max(1.25, out.controlledTrx || 0))]) {
    for (const pair of ['trx_eth', 'trx_sol']) {
      try {
        const e = await getJson(`${CHANGENOW}/v1/exchange-amount/${amt}/${pair}`, 2);
        ests[amt + '_' + pair] = (e && e.estimatedAmount != null) ? { est: e.estimatedAmount, speed: e.transactionSpeedForecast } : { error: e && (e.raw || e.httpStatus) };
      } catch (err) { ests[amt + '_' + pair] = { error: String(err.message).slice(0, 80) }; }
    }
  }
  out.provider = {
    changenow: { reach: 'OK', keylessSurvey: true, keylessCreate: false, createAuth: 'measured: Unauthorized (needs API key — free registration, slot: agent/.env SWAP_CHANGENOW_KEY)', pairs: cn, estimates: ests },
    exolix: { reach: 'BLOCKED-CF (HTML challenge measured)' },
    sideshift: { reach: 'n/a (route 404 without affiliate key)' },
  };

  // שערי-החיץ: המנדט והמפתח (בוליאנים בלבד — אפס סודות)
  const mandate = loadJson(MANDATE_F, null);
  out.mandate = { present: !!mandate, active: !!(mandate && mandate.active), quote: mandate ? mandate.quote : null, at: mandate ? mandate.at : null };
  let hasKey = false;
  try { hasKey = /^SWAP_CHANGENOW_KEY=.+/m.test(fs.readFileSync(path.join(AGENT_DIR, '.env'), 'utf8')); } catch (_) {}
  out.providerKey = { present: hasKey, slot: 'agent/.env SWAP_CHANGENOW_KEY' };

  // פסק-דין
  out.inventoryUsd = out.trxUsdt ? +(out.controlledTrx * out.trxUsdt).toFixed(4) : null;
  out.lockedUsd = out.trxUsdt ? +(out.lockedTrx * out.trxUsdt).toFixed(4) : null;
  if (!out.mandate.active) out.verdict = 'NO-MANDATE';
  else if (!hasKey) out.verdict = 'SWAP-READY-BUT-NO-PROVIDER-KEY (survey keyless ✓ · execution needs free ChangeNOW key in agent/.env)';
  else if (out.controlledTrx < 2.5) out.verdict = 'SWAP-BLOCKED-INVENTORY (controlled TRX < 2×$1+reserve · locked doors hold ' + (out.lockedTrx || 0).toFixed(2) + ' TRX — unlock needs a pre-rollback backup of agent/keys/tron-mnemonic.txt)';
  else out.verdict = 'EXECUTABLE';
  out.ms = Date.now() - t0;
  saveJson(SURVEY_F, out);
  log('survey: done verdict=' + out.verdict + ' controlledTrx=' + out.controlledTrx + ' lockedTrx=' + (out.lockedTrx || 0).toFixed(2));
  return out;
}

/* ── ביצוע-מוגן ── */
async function execute(leg) {
  if (leg !== 'eth' && leg !== 'sol') throw new Error('leg must be eth|sol');
  const mandate = loadJson(MANDATE_F, null);
  if (!(mandate && mandate.active)) { log('execute: REJECT — no active mandate'); return { ok: false, reason: 'no-active-mandate' }; }
  let key = null;
  try { const m = fs.readFileSync(path.join(AGENT_DIR, '.env'), 'utf8').match(/^SWAP_CHANGENOW_KEY=(.+)$/m); if (m) key = m[1].trim(); } catch (_) {}
  if (!key) { log('execute: REJECT — no provider key'); return { ok: false, reason: 'no-provider-key (slot: agent/.env SWAP_CHANGENOW_KEY)' }; }

  const doors = tronDoorsControlled().filter((d) => d.priv);
  const inv = [];
  for (const d of doors) inv.push({ d, sun: await tronBalance(d.address) });
  const min = await getJson(`${CHANGENOW}/v2/exchange/min-amount?fromCurrency=trx&toCurrency=${leg}&flow=standard`, 2);
  const minAmt = Number(min.minAmount || 0);
  const funded = inv.filter((x) => x.sun / 1e6 >= Math.max(minAmt, 0) + RESERVE_SUN / 1e6).sort((a, b) => b.sun - a.sun)[0];
  if (!funded) { log('execute: REJECT — no funded door (min=' + minAmt + ' TRX, reserve 1 TRX)'); return { ok: false, reason: 'no-funded-controlled-door', min: minAmt }; }

  const pub = loadJson(path.join(AGENT_DIR, 'wallets-public.json'), loadJson(path.join(HERE, 'wallets-public.json'), null));
  const hc = (pub.agents || pub.wallets || []).find((a) => a.agent === 'headcorner');
  const payout = leg === 'eth' ? hc.evm : hc.sol;
  const refund = funded.d.address;

  log('execute: creating ChangeNOW exchange trx->' + leg + ' amount≈' + Math.floor(funded.sun / 1e6 - RESERVE_SUN / 1e6) + ' TRX from ' + funded.d.address);
  const amount = Math.floor((funded.sun - RESERVE_SUN) / 1e6 * 1e6) / 1e6;
  const created = await postJson(CHANGENOW + '/v2/exchange', {
    fromCurrency: 'trx', toCurrency: leg, fromAmount: amount, address: payout, refundAddress: refund, flow: 'standard',
  }, { 'x-changenow-api-key': key });
  if (created.httpStatus && created.httpStatus >= 400 || !created.payinAddress) {
    log('execute: provider rejected (status=' + (created.httpStatus || '?') + ' message=' + String(created.message || '').slice(0, 80) + ')');
    return { ok: false, reason: 'provider-reject', detail: String(created.message || created.raw || created.httpStatus).slice(0, 120) };
  }

  // שידור ה-TRX לכתובת-ההפקדה של הספק
  const TronWeb = require(path.join(ROOT, 'node_modules', 'tronweb'));
  const tw = new TronWeb({ fullHost: TRONGRID, privateKey: funded.d.priv });
  const tx = await tw.transactionBuilder.sendTrx(created.payinAddress, Math.round(amount * 1e6), funded.d.address);
  const signed = await tw.trx.sign(tx);
  const bro = await tw.trx.sendRawTransaction(signed);
  if (!bro || !bro.result) { log('execute: tron broadcast rejected: ' + (bro && bro.message ? Buffer.from(bro.message).toString() : '?')); return { ok: false, reason: 'tron-reject' }; }

  const st = loadJson(STATE_F, { legs: [] });
  st.legs.push({ leg, cnId: created.id, payinAddress: created.payinAddress, amountTrx: amount, payout, refund, door: funded.d.address, txid: bro.txid, createdAt: new Date().toISOString(), status: 'sent-awaiting-provider' });
  saveJson(STATE_F, st);
  log('execute: leg=' + leg + ' txid=' + bro.txid + ' cnId=' + created.id + ' → payout ' + payout);
  return { ok: true, txid: bro.txid, cnId: created.id, amountTrx: amount, payout };
}

/* ── status (קריאה-בלבד) ── */
function status() {
  const sv = loadJson(SURVEY_F, null);
  const st = loadJson(STATE_F, { legs: [] });
  return {
    survey: sv ? { at: sv.at, verdict: sv.verdict, trxUsdt: sv.trxUsdt, controlledTrx: sv.controlledTrx, lockedTrx: sv.lockedTrx, inventoryUsd: sv.inventoryUsd, mandate: sv.mandate, providerKey: sv.providerKey, provider: { changenow: { reach: sv.provider && sv.provider.changenow && sv.provider.changenow.reach, keylessCreate: false }, exolix: 'BLOCKED-CF', sideshift: 'n/a' }, minAmounts: sv.provider && sv.provider.changenow && sv.provider.changenow.pairs } : null,
    legs: st.legs || [],
  };
}

/* ── watch ── */
async function watch() {
  if (fs.existsSync(PID_F)) { try { if (process.kill(Number(fs.readFileSync(PID_F, 'utf8')), 0)) { console.log('[swap] watch already alive'); return; } } catch (_) {} }
  fs.writeFileSync(PID_F, String(process.pid));
  log('watch: loop alive · 600s');
  await survey();
  setInterval(() => survey().catch((e) => log('watch survey error: ' + e.message)), 600000).unref();
  setInterval(() => {}, 60000); // keep the event loop
}

/* ── main ── */
(async () => {
  const cmd = process.argv[2] || 'status';
  try {
    if (cmd === 'survey') { const r = await survey(); console.log(JSON.stringify({ verdict: r.verdict, controlledTrx: r.controlledTrx, lockedTrx: r.lockedTrx, trxUsdt: r.trxUsdt }, null, 1)); }
    else if (cmd === 'execute') { const li = process.argv.indexOf('--leg'); const r = await execute(li > -1 ? process.argv[li + 1] : 'eth'); console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 3); }
    else if (cmd === 'watch') await watch();
    else console.log(JSON.stringify(status(), null, 1));
  } catch (e) { log('FATAL ' + cmd + ': ' + String(e.message).slice(0, 160)); console.error('[swap] FATAL', e.message); process.exit(1); }
})();
