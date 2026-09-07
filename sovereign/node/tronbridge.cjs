#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * TRON-BRIDGE (Task 90) — גשר ריבוני SAOS-NET ⇄ TRON
 * ─────────────────────────────────────────────────────────────────────────────
 * עיקרון (doctrines):
 *  · אף-עסקה-לא-נשדרת בלי בדיקה חיה מול TRON (השרשרת החיה היא האמת — לא קבצים)
 *  · העברה-פנימית בלבד — שתי כתובות נגזרות מאותו vault (אינדקס 0 = שדרן, אינדקס 1 = רכזת);
 *    שום כתובת חיצונית לעולם לא · כיוון מתאזן-אוטומטית כדי שהדלק לא יתרכז ולא ייגמר
 *  · רוחב-פס חינם בלבד — אם אין מספיק רוחב-פס חופשי אצל השדרן → מדלג (אפס שריפת TRX)
 *  · הגבלת קצב: ≤ 1 עוגן / 24 שעות (הארנק אינו "בוס" — אחריות מינימלית בלבד)
 *  · קידומת ה-checkpointHash של SAOS מוצפנת בתוך כמות ה-TRX (sun 7-ספרות אחרונות
 *    של 1.xxxxxx) → הוכחת-קשר ניתנת-לאימות-ציבורי: כל אחד יכול לגזור מה-hash את
 *    הכמות ולהשוות מול העסקה על TRON — ולהפך
 *  · המפתח לעולם לא נכנס ל-log ולא ל-git (agent/keys/ מוגן)
 *
 * שימוש:
 *   node tronbridge.cjs status           בדיקת-מצב קריאה-בלבד
 *   node tronbridge.cjs anchor [--dry]   ניסיון-עוגן אחד (dry = בלי שידור)
 *   node tronbridge.cjs watch            לולאה — ניסיון-עוגן כל 20 דק׳ (מוגבל 2/יום)
 *   node tronbridge.cjs squad [--dry]    (91) טבעת-החיילים: הפעלה-עצמית + טבעת-לפיד אפס-עמלה
 *   node tronbridge.cjs derivatives      (92) ניטור-נגזרות (USDT-TRC20) + פעימה-חיה — קריאה-בלבד
 * ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
require('dns').setDefaultResultOrder('ipv4first'); // HE lesson: family-4 first (anti AggregateError)
const TronWeb = require(path.join(__dirname, '..', '..', 'node_modules', 'tronweb'));

const RPC = 'https://api.trongrid.io';
const KEYFILE = path.join(__dirname, '..', '..', 'agent', 'keys', 'tron-mnemonic.txt');
const VAULT = require(__dirname + '/vault-lib.cjs'); // 114 — הקריאה-דרך-הכספת
const STATEF = path.join(__dirname, 'tron-bridge-state.json');
const NODESTATE = path.join(__dirname, 'state.json');
const DERIVE_PATH = "m/44'/195'/0'/0/0";
const AMOUNT_BASE_SUN = 1000000; // 1 TRX בסיס + שבר-מקודד
const GUARDS = {
  maxPerDay: 12,            // 109: 3→12 — מאגר-מקורות-מלא (a0+a1+סדוגה=6 כתובות × ~2 עוגנים/יום ברוחב-פס-חינם) → סגירת-פער-העוגנים מהירה ×4 · zero-burn נשמר
  minFreeNetBytes: 350,     // רוחב-פס חופשי מינימלי לפני שידור (עסקה ≈268 בתים)
  internalOnly: true,       // לעולם בין כתובות ה-vault בלבד (כולל הסדוגה — כולן נגזרות מאותו mnemonic)
  minBalanceSun: 2000000,   // אף-פעם לא לרוקן מתחת ל-2 TRX (פר-שדרן)
};

/* ─────────────────── SQUAD-RING (Task 91) — הגדרות ───────────────────
 * הרעיון: הכספת מגזרת חיילים דטרמיניסטיים (אינדקסים 2..5) מאותו mnemonic —
 *  · שרשרת-הפעלה עצמית: השדרן מדליק את חייל-2, חייל-2 מממן ומדליק את חייל-3,
 *    חייל-3 → חייל-4, חייל-4 → חייל-5 — המערכת מפיצה את עצמה מניצוץ-אחד.
 *    כל הפעלה שורפת ~1.1 TRX חד-פעמי (עלות-הון, לא עמלה שוטפת) ואחריה כל חייל
 *    מקבל 600B רוחב-פס חינם משלו ליום → שרשרת מכפילת רוחב-פס (N×600B/יום).
 *  · טבעת-לפיד: s2→s3→s4→s5→s2 — כל רגל מקודדת את 6-התווים הראשונים של
 *    ה-txid של הרגל הקודמת בתוך כמות ה-TRX (רגל-1 מקודדת את ה-checkpointHash
 *    האחרון של SAOS) → רשימה-מקושרת ציבורית על TRON, ניתנת-לאימות עצמאי:
 *    כל אחד גוזר מהכמות את קידומת ה-txid הקודם ומשווה ב-TronScan.
 *  · אפס-עמלות: הטבעת כולה ברוחב-הפס החינמי; השריפה היחידה = הפעלות חד-פעמיות.
 *  · הארנק נשאר לא-בוס: כתובות פנימיות בלבד (מאותו vault), מגבלות-יום,
 *    רצפות-יתרה, kill-switch, ושמירת-מצב אטומית אחרי כל רגל (אף-טענה-בלי-רישום). */
const SQUAD_INDICES = [2, 3, 4, 5];
const SQUAD_GUARDS = {
  activationEstimateSun: 1200000, // הערכה-שמרנית: 1.0 הפעלה + 0.1 רוחב-פס + מרווח (נמדד-חי בפועל)
  payerFloorSun: 400000,          // מממן-שרשרת לעולם לא יורד מתחת ל-0.4 TRX
  legFloorSun: 150000,            // שולח-רגל-טבעת: רצפה 0.15 TRX
  legBaseSun: 400000,             // בסיס-לפיד 0.4 TRX + קידומת-מקודדת (0..99,999)
  legFracMod: 100000,
  minFreeNetBytes: 350,           // אותו מגן אפס-שריפה — כל-רגל
  ringsPerDay: 2,
  senderReserveSun: 10000000,     // השדרן לעולם לא יורד מתחת ל-10 TRX במימון-הסדוגה
};
const FUND_PLAN = [8600000, 5800000, 3200000, 1200000]; // sender→s2, s2→s3, s3→s4, s4→s5
const DAY_MS = 24 * 3600 * 1000;

/* ─────────────────── Task 92 — PULSE 24/7 + נגזרות + כיבולת-רוחב-פס ───────────────────
 * · PULSE: קריאת-הבלוק-החי של TRON בכל-פעימה — אינטרליבינג מתמיד בין הספרים,
 *   אפס-עלות (קריאה-בלבד). בספר-שלנו: כל-Δ1200 בלוקי-TRON (≈שעה) נחתם-בלוק-עדות
 *   → ראיה שהרשת-שלנו חיה-ושזורה 24/7 בתוך זרם-הבלוקים של TRON (שלא-תיפול).
 * · נגזרות (USDT-TRC20): ניטור-קריאה-בלבד לכל-הכתובות-הריבוניות — כשייכנס-ערך
 *   (USDT) לאחת-מהן → האירוע-נרשם-אוטומטית. אפס-שריפה: triggerConstantContract.
 * · כיבולת: 6 כתובות × 600B רוחב-פס-חינם/יום ≈ 13-15 עסקאות-אפס-עמלה/יום
 *   (עסקת-transfer נמדדה-חי ≈ 268 בתים — Task 90).
 * · watch-מורחב (92): anchor → confirm → pulse → derivatives → squad אוטומטי
 *   (מימון-מדלג-עצמו כשהכל-מופעל; טבעת-מוגנת-על-ידי quota+bandwidth — כשהרוחב-פס
 *   החינמי-מתאפס-מחדש ב-00:00 UTC → טבעת#2-נורית-אוטומטית: תגובת-שרשרת-מתוכנת). */
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT-TRC20 (mainnet)
const TX_BYTES_EST = 268;                                   // נמדד-חי (90): transfer ≈ 268 בתים
const PULSE_DELTA = 1200;                                   // בלוקי-TRON בין-עדויות-פעימה-על-הספר (≈שעה)

/* ── anti-429: retry with backoff (TronGrid rate-limits unauthenticated reads) ── */
async function withRetry(fn, tries) {
  const n = tries || 4;
  let last;
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const msg = String((e && e.message) || e);
      if (/429|rate|timeout|ECONN|ETIMEDOUT|AggregateError/i.test(msg) && i < n - 1) {
        await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

/* ── state (atomic) ── */
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATEF, 'utf8')); } catch (_) { return null; }
}
function saveState(st) {
  st.updatedAt = new Date().toISOString();
  const tmp = STATEF + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
  fs.renameSync(tmp, STATEF);
}
function pushLog(st, msg) {
  const line = new Date().toISOString() + ' ' + String(msg).slice(0, 180);
  st.log = [line].concat(st.log || []).slice(0, 40);
  console.log('[tron-bridge] ' + line);
}

/* ── wallet: index0 = שדרן, index1 = רכזת — שתיהן מאותו vault ── */
function deriveIndex(mnemonic, idx) {
  const ethers = require('ethers');
  const w = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/195'/0'/0/" + idx);
  const tw = new TronWeb({ fullHost: RPC, privateKey: w.privateKey.slice(2) });
  try { if (typeof tw.setTimeout === 'function') tw.setTimeout(20000); } catch (_) {}
  const addr = tw.defaultAddress && tw.defaultAddress.base58;
  if (!addr || !tw.isAddress(addr)) throw new Error('address derivation failed idx=' + idx);
  return { tw, address: addr };
}
function loadWallet() {
  const mnemonic = VAULT.readMnemonic(); // 114 — מהכספת (envelope→plaintext)
  if (mnemonic.split(' ').length !== 12) throw new Error('mnemonic must be 12 words');
  return { a0: deriveIndex(mnemonic, 0), a1: deriveIndex(mnemonic, 1) };
}

/* ── live reads (the chain is the truth) ── */
async function liveWallet(tw, address) {
  const bal = Number(await withRetry(() => tw.trx.getBalance(address)) || 0);   // sun (0 אם חשבון-לא-קיים)
  let res = {};
  try { res = (await withRetry(() => tw.trx.getAccountResources(address))) || {}; } catch (_) {}
  const freeLimit = Number(res.freeNetLimit || 0);
  const freeUsed = Number(res.freeNetUsed || 0);
  const stakeNet = Number(res.NetLimit || 0);
  const stakeUsed = Number(res.NetUsed || 0);
  return {
    balanceSun: Number(bal || 0),
    balanceTrx: Number(bal || 0) / 1e6,
    freeNetLimit: freeLimit, freeNetUsed: freeUsed,
    freeNetLeft: Math.max(0, freeLimit - freeUsed),
    stakeNetLeft: Math.max(0, stakeNet - stakeUsed),
    netLeft: Math.max(0, freeLimit - freeUsed) + Math.max(0, stakeNet - stakeUsed),
    energyLeft: Math.max(0, Number(res.EnergyLimit || 0) - Number(res.EnergyUsed || 0)),
  };
}

/* ── encoding: cpHash → amountSun (publicly checkable binding) ── */
function encodeAmount(checkpointHash) {
  const frac = parseInt(String(checkpointHash).slice(0, 6), 16) % 1000000;
  return { fractionSun: frac, amountSun: AMOUNT_BASE_SUN + frac };
}
function decodeAmount(amountSun) {
  const frac = Number(amountSun) - AMOUNT_BASE_SUN;
  return { fractionSun: frac, fractionHex: frac.toString(16).padStart(6, '0') };
}

/* ── pick the newest unanchored checkpoint from the LIVE sovereign state ── */
function pickCheckpoint(st) {
  let cps = [];
  try {
    const ns = JSON.parse(fs.readFileSync(NODESTATE, 'utf8'));
    cps = (ns.checkpoints || []).slice().reverse();
  } catch (_) {}
  const anchored = new Set((st.anchors || []).map((a) => a.cpHash));
  return cps.find((c) => c.checkpointHash && !anchored.has(c.checkpointHash)) || null;
}

/* ── ANCHOR ── */
async function anchor(dry) {
  const st = loadState() || { version: 1, guards: GUARDS, anchors: [], log: [] };
  if (process.env.TRON_BRIDGE_OFF) { pushLog(st, 'anchor skipped: TRON_BRIDGE_OFF kill-switch'); saveState(st); return st; }

  const { a0, a1 } = loadWallet();
  st.address = a0.address; st.addressRelay = a1.address;
  st.derivePath = DERIVE_PATH; st.rpc = RPC;

  const w0 = await liveWallet(a0.tw, a0.address);
  const w1 = await liveWallet(a1.tw, a1.address);
  st.wallet = { sender: w0, relay: w1 }; st.lastCheck = new Date().toISOString();
  pushLog(st, 'status: sender ' + w0.balanceTrx.toFixed(6) + ' TRX (freeNet ' + w0.freeNetLeft + 'B) · relay ' + w1.balanceTrx.toFixed(6) + ' TRX (freeNet ' + w1.freeNetLeft + 'B) · anchors ' + (st.anchors || []).length);

  const cp = pickCheckpoint(st);
  if (!cp) { pushLog(st, 'anchor skipped: no unanchored checkpoint'); saveState(st); return st; }

  const daily = (st.anchors || []).filter((a) => a.at && Date.now() - new Date(a.at).getTime() < DAY_MS).length;
  if (daily >= GUARDS.maxPerDay) { pushLog(st, 'anchor skipped: daily limit ' + GUARDS.maxPerDay + '/24h reached'); saveState(st); return st; }

  const { amountSun } = encodeAmount(cp.checkpointHash);
  /* 109 — מאגר-מקורות-מלא (הבטחת-ה-N×600B/יום סוף-סוף-ממומשת לעוגנים):
   * כל-הכתובות-הפנימיות (a0+a1+סדוגה 2..5 — כולן מאותו-vault) נסרקות-חי;
   * משדר-מי-שיש-לו רוחב-פס-חינם ≥ המינימום ויתרה-מעל-הרצפה; רוחב-פס קודם, אחר-כך מאזן.
   * היעד תמיד a0/a1 (יציבות). מגנים-מלאים: internalOnly · zero-burn · רצפות.
   * 107-לימוד נשמר: מקור-עשיר-בלי-רוחב-פס לא תוקע — המאגר פותר-לגמרי. */
  const pool = [{ idx: 0, tw: a0.tw, address: a0.address, w: w0 }, { idx: 1, tw: a1.tw, address: a1.address, w: w1 }];
  try {
    const sq = await squadWallets();
    for (const s of sq) { try { pool.push({ idx: s.idx, tw: s.tw, address: s.address, w: await liveWallet(s.tw, s.address) }); } catch (_) {} }
  } catch (_) { /* אין-סדוגה — a0/a1 לבד (התנהגות-107) */ }
  const need = Math.max(GUARDS.minBalanceSun, amountSun + 1000000);
  const cand = pool.filter((p) => p.w.netLeft >= GUARDS.minFreeNetBytes && p.w.balanceSun >= need);
  cand.sort((x, y) => (y.w.netLeft - x.w.netLeft) || (y.w.balanceSun - x.w.balanceSun));
  const src = cand[0] || null;
  if (!src) { pushLog(st, 'anchor skipped: pool ' + pool.length + ' scanned — no source with free bandwidth (' + GUARDS.minFreeNetBytes + 'B) + balance floor'); saveState(st); return st; }
  const dst = pool.find((p) => p.address !== src.address && p.idx <= 1) || pool.find((p) => p.address !== src.address);
  if (GUARDS.internalOnly && !pool.some((p) => p.address === dst.address)) throw new Error('guard: relay must be internal');
  const sender = { tw: src.tw, address: src.address };
  const relay = { tw: dst.tw, address: dst.address };
  const sw = src.w;
  pushLog(st, 'anchor source: idx' + src.idx + ' (freeNet ' + sw.netLeft + 'B · bal ' + (sw.balanceSun / 1e6).toFixed(3) + ' TRX) → idx' + dst.idx);

  if (dry) {
    st.dryRun = { at: new Date().toISOString(), cpHeight: cp.height, cpHash: cp.checkpointHash, amountSun, from: sender.address, to: relay.address, wouldBroadcast: true };
    pushLog(st, 'DRY-RUN would anchor cp#' + cp.height + ' · idx' + src.idx + '→idx' + dst.idx + ' ' + (amountSun / 1e6).toFixed(6) + ' TRX (encoded ' + decodeAmount(amountSun).fractionHex + ')');
    saveState(st); return st;
  }

  const balBefore = sw.balanceSun;
  const built = await withRetry(() => sender.tw.transactionBuilder.sendTrx(relay.address, amountSun, sender.address), 5);
  const signed = await withRetry(() => sender.tw.trx.sign(built), 2);
  const bRes = await withRetry(() => sender.tw.trx.sendRawTransaction(signed), 5);
  const txid = bRes && (bRes.txid || (bRes.transaction && bRes.transaction.txid));
  if (!bRes || bRes.result !== true || !txid) {
    pushLog(st, 'broadcast FAILED: ' + JSON.stringify(bRes || {}).slice(0, 140));
    saveState(st); return st;
  }
  pushLog(st, 'broadcast ✓ txid=' + txid.slice(0, 18) + '… → confirming');

  /* confirm-poll (chain is the truth) */
  let info = null, block = null, netFee = 0, receipt = null, confirmed = false;
  for (let i = 0; i < 20 && !confirmed; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try { info = await withRetry(() => sender.tw.trx.getTransactionInfo(txid), 2); } catch (_) { info = {}; }

    if (info && info.blockNumber) {
      receipt = info.receipt || {};
      netFee = Number(receipt.net_fee || 0);
      block = Number(info.blockNumber || 0);
      confirmed = String(receipt.result || '') === 'SUCCESS' || String(info.contractRet || '') === 'SUCCESS';
      if (!confirmed) break;
    }
  }
  const lwAfter = await liveWallet(sender.tw, sender.address);
  const rec = {
    cpHeight: cp.height, cpHash: cp.checkpointHash,
    from: sender.address, to: relay.address, dir: 'idx' + src.idx + '→idx' + dst.idx,
    txid, block, netFeeSun: netFee,
    amountSun, fractionHex: decodeAmount(amountSun).fractionHex,
    balanceBeforeSun: balBefore, balanceAfterSun: lwAfter.balanceSun,
    burnSun: Math.max(0, balBefore - lwAfter.balanceSun),
    receipt: receipt ? { result: receipt.result || null } : null,
    verified: confirmed, notedHeight: null,
    at: new Date().toISOString(),
  };
  st.anchors = [rec].concat(st.anchors || []).slice(0, 64);
  st.lastAnchorAt = rec.at;
  pushLog(st, confirmed
    ? 'ANCHOR ✓ cp#' + cp.height + ' → TRON blk ' + block + ' · net_fee=' + netFee + 'sun · burn=' + rec.burnSun + 'sun (proof: receipt)'
    : 'broadcast ok but UNCONFIRMED after poll — stays honest-unverified, txid recorded');
  saveState(st);
  return st;
}

/* ─────────────────── SQUAD-RING (Task 91) — מימוש ─────────────────── */
function encodeLeg(refHex) { /* קידומת-6-תווים → כמות-רגל (0.4..0.499999 TRX) */
  const frac = parseInt(String(refHex).replace(/^0x/, '').slice(0, 6), 16) % SQUAD_GUARDS.legFracMod;
  return SQUAD_GUARDS.legBaseSun + frac;
}
function loadSquad(st) {
  if (!st.squad) st.squad = {
    version: 1, indices: SQUAD_INDICES.slice(), members: [], funding: [], rings: [],
    burnLedger: { activationsSun: 0, netFeeSun: 0, totalSun: 0 }, guards: SQUAD_GUARDS,
  };
  return st.squad;
}
async function squadWallets() { /* כל-הכתובות נגזרות מאותו mnemonic — פנימיות לעולם */
  const mnemonic = fs.readFileSync(KEYFILE, 'utf8').trim().split(/\s+/).join(' ');
  if (mnemonic.split(' ').length !== 12) throw new Error('mnemonic must be 12 words');
  const out = [];
  for (const idx of SQUAD_INDICES) out.push({ idx, ...deriveIndex(mnemonic, idx) });
  return out;
}
async function accountExists(tw, address) {
  try {
    const acc = await withRetry(() => tw.trx.getAccount(address), 2);
    return !!(acc && (acc.address || acc.create_time || Number(acc.balance || 0) > 0));
  } catch (_) { return false; }
}
/* שידור-אחד + אישור-חי (read-back): האמת רק מהשרשרת — תבנית anchor() */
async function sendTrxConfirm(from, to, amountSun, st, tag) {
  const built = await withRetry(() => from.tw.transactionBuilder.sendTrx(to.address, amountSun, from.address), 5);
  const signed = await withRetry(() => from.tw.trx.sign(built), 2);
  const bRes = await withRetry(() => from.tw.trx.sendRawTransaction(signed), 5);
  const txid = bRes && (bRes.txid || (bRes.transaction && bRes.transaction.txid));
  if (!bRes || bRes.result !== true || !txid) {
    pushLog(st, tag + ' broadcast FAILED: ' + JSON.stringify(bRes || {}).slice(0, 120));
    return null;
  }
  pushLog(st, tag + ' broadcast ✓ ' + txid.slice(0, 16) + '… → confirming');
  let info = null, receipt = null, block = null, netFee = 0, confirmed = false;
  for (let i = 0; i < 20 && !confirmed; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try { info = await withRetry(() => from.tw.trx.getTransactionInfo(txid), 2); } catch (_) { info = {}; }
    if (info && info.blockNumber) {
      receipt = info.receipt || {};
      block = Number(info.blockNumber || 0);
      netFee = Number(receipt.net_fee || 0);
      confirmed = String(receipt.result || '') === 'SUCCESS' || String(info.contractRet || '') === 'SUCCESS';
      if (!confirmed) { /* TransferContract: ה-contractRet חי-בעסקה-המלאה */
        try {
          const full = await withRetry(() => from.tw.trx.getTransaction(txid), 2);
          confirmed = String(((full && full.ret && full.ret[0]) || {}).contractRet || '') === 'SUCCESS';
        } catch (_) {}
      }
    }
  }
  return { txid, block, netFee, confirmed, receipt: receipt ? { result: receipt.result || (info && info.contractRet) || null } : null };
}

async function squad(dry) {
  const st = loadState() || { version: 1, guards: GUARDS, anchors: [], log: [] };
  st.guards = GUARDS;
  if (process.env.TRON_BRIDGE_OFF) { pushLog(st, 'squad skipped: TRON_BRIDGE_OFF kill-switch'); saveState(st); return st; }
  const sq = loadSquad(st);
  sq.guards = SQUAD_GUARDS; sq.indices = SQUAD_INDICES.slice();

  const { a0 } = loadWallet();
  const mems = await squadWallets();
  st.squadAddresses = mems.map((m) => m.address);
  GUARDS.internalOnly && mems.forEach((m) => { if (![a0.address, st.addressRelay].includes(m.address) && !String(m.address).startsWith('T')) throw new Error('guard: squad address invalid'); });

  const w0 = await liveWallet(a0.tw, a0.address);
  st.wallet = { ...(st.wallet || {}), sender: w0 }; st.lastCheck = new Date().toISOString();
  sq.members = [];
  for (const m of mems) {
    const w = await liveWallet(m.tw, m.address);
    const exists = w.freeNetLimit > 0 || w.balanceSun > 0 || (await accountExists(m.tw, m.address));
    sq.members.push({ idx: m.idx, address: m.address, activated: exists, balanceSun: w.balanceSun, balanceTrx: w.balanceTrx, freeNetLeft: w.freeNetLeft });
  }
  pushLog(st, 'squad status: ' + sq.members.map((m) => 's' + m.idx + '=' + (m.activated ? m.balanceTrx.toFixed(4) + 'TRX' : 'inactive')).join(' · ') + ' · sender ' + w0.balanceTrx.toFixed(6) + ' TRX');

  if (dry) {
    st.squadDryRun = {
      at: new Date().toISOString(),
      members: sq.members.map((m) => ({ idx: m.idx, address: m.address, activated: m.activated, balanceTrx: m.balanceTrx })),
      plan: FUND_PLAN.map((amount, i) => ({ hop: i + 1, from: i === 0 ? a0.address : mems[i - 1].address, to: mems[i].address, amountTrx: amount / 1e6 })),
      ringPlan: 's2→s3→s4→s5→s2 · כל-רגל 0.4+frac TRX · frac = 6-תווים-ראשונים של prev-txid (רגל-1: checkpointHash)',
      estActivationBurnSun: SQUAD_INDICES.length * SQUAD_GUARDS.activationEstimateSun,
    };
    pushLog(st, 'DRY-RUN squad: ' + FUND_PLAN.map((a, i) => (i === 0 ? 'sender' : 's' + mems[i - 1].idx) + '→s' + mems[i].idx + ' ' + (a / 1e6) + ' TRX').join(' · '));
    saveState(st); return st;
  }

  /* ── PHASE A: שרשרת-הפעלה עצמית (חד-פעמי; כל-חייל-מופעל-מדולג) ── */
  const payers = [a0].concat(mems.slice(0, SQUAD_INDICES.length - 1));
  for (let i = 0; i < mems.length; i++) {
    const m = mems[i];
    const memRec = sq.members.find((x) => x.idx === m.idx);
    if (memRec.activated) { pushLog(st, 'funding skip: s' + m.idx + ' already activated'); continue; }
    const payer = payers[i];
    /* קריאה-חיה-טרייה למשלם — הרשומה-ההתחלתית של חשבון-טרי היא 0B (stale לא-מקובל: השרשרת היא האמת) */
    const pw = await liveWallet(payer.tw, payer.address);
    const payerBal = pw.balanceSun;
    const payerNet = pw.freeNetLeft;
    const amount = FUND_PLAN[i];
    if (payerBal < amount + SQUAD_GUARDS.activationEstimateSun + SQUAD_GUARDS.payerFloorSun) {
      pushLog(st, 'funding skip: s' + m.idx + ' payer balance ' + (payerBal / 1e6).toFixed(3) + ' < need — chain stops honestly');
      break; /* בלי-דלק-למממן-הבא — השרשרת נעצרת בכנות */
    }
    if (payerNet < SQUAD_GUARDS.minFreeNetBytes) { pushLog(st, 'funding skip: payer free bandwidth ' + payerNet + 'B < ' + SQUAD_GUARDS.minFreeNetBytes + 'B'); break; }
    if (i === 0 && payerBal - amount - SQUAD_GUARDS.activationEstimateSun < SQUAD_GUARDS.senderReserveSun) {
      pushLog(st, 'funding skip: sender reserve guard (' + SQUAD_GUARDS.senderReserveSun / 1e6 + ' TRX)'); break;
    }
    const balBefore = payerBal;
    const res = await sendTrxConfirm(payer, m, amount, st, 'funding hop' + (i + 1) + ' s' + (i === 0 ? 0 : mems[i - 1].idx) + '→s' + m.idx);
    if (!res) { saveState(st); return st; } /* שרשרת-שבורה — הפסקה כנה */
    const payerAfter = await liveWallet(payer.tw, payer.address);
    if (i === 0) { w0.balanceSun = payerAfter.balanceSun; }
    else {
      const payerRec = sq.members.find((x) => x.idx === payer.idx);
      if (payerRec) payerRec.balanceSun = payerAfter.balanceSun;
    }
    const burn = Math.max(0, balBefore - payerAfter.balanceSun - amount);
    sq.funding = [{
      from: payer.address, to: m.address, idxTo: m.idx, amountSun: amount,
      txid: res.txid, block: res.block, netFeeSun: res.netFee, burnSun: burn,
      receipt: res.receipt, verified: res.confirmed, notedHeight: null,
      balanceAfterPayerSun: payerAfter.balanceSun, at: new Date().toISOString(),
    }].concat(sq.funding || []).slice(0, 32);
    memRec.activated = true;
    sq.burnLedger.activationsSun += Math.max(0, burn - res.netFee); /* השריפה-הטהורה (ההפעלה) — בלי-הרוחב-פס שנספר-בנפרד */
    sq.burnLedger.netFeeSun += res.netFee;
    sq.burnLedger.totalSun = sq.burnLedger.activationsSun + sq.burnLedger.netFeeSun;
    memRec.balanceSun = (await liveWallet(m.tw, m.address)).balanceSun;
    memRec.balanceTrx = memRec.balanceSun / 1e6;
    pushLog(st, 'funding ✓ s' + m.idx + ' activated · burn=' + (burn / 1e6).toFixed(3) + ' TRX · net_fee=' + res.netFee + 'sun' + (res.confirmed ? '' : ' · UNCONFIRMED-honest'));
    saveState(st); /* אטומי-פר-רגל: אף-עסקה-בלי-רישום */
  }

  /* ── PHASE B: טבעת-הלפיד (רק-אם-כל-החיילים-מופעלים) ── */
  const allAct = sq.members.every((x) => x.activated && x.balanceSun > SQUAD_GUARDS.legBaseSun + SQUAD_GUARDS.legFloorSun);
  /* 93-fix: טבעת-תלויה (0 רגליים) לא תופסת מכסה — רק טיסות-אמת (≥1 רגל) נספרות */
  const rings24 = (sq.rings || []).filter((r) => r.at && Date.now() - new Date(r.at).getTime() < DAY_MS && (r.legs || []).length > 0).length;
  /* 93-fix: טבעת-פתוחה-חלקית (נעצרה-בכנות ע"י מגן רוחב-פס) מושלמת-במקום-ליצור-חדשה — בלי-טבעת-תלויה-לנצח */
  const openRing = (sq.rings || []).find((r) => !r.closed && (r.legs || []).length < mems.length);
  if (!allAct) {
    pushLog(st, 'ring skipped: squad not fully activated/funded (honest — no fake ring)');
  } else if (!openRing && rings24 >= SQUAD_GUARDS.ringsPerDay) {
    pushLog(st, 'ring skipped: daily ring limit ' + rings24 + '/' + SQUAD_GUARDS.ringsPerDay);
  } else {
    let lastCp = null;
    try {
      const ns = JSON.parse(fs.readFileSync(NODESTATE, 'utf8'));
      lastCp = (ns.checkpoints || []).slice(-1)[0] || null;
    } catch (_) {}
    const ref0 = (lastCp && lastCp.checkpointHash) || '000000';
    let ring, startIdx, prevTxid;
    if (openRing) {
      /* השלמת-טבעת-פתוחה (93): ממשיכים-מאיפה-שנעצרנו — אותו-אובייקט, אותו-id */
      ring = openRing;
      startIdx = ring.legs.length;
      prevTxid = startIdx > 0 ? ring.legs[startIdx - 1].txid : null;
      pushLog(st, 'ring#' + ring.id + ' RESUME from leg ' + (startIdx + 1) + '/' + mems.length + ' (93: open-ring completion — no dangling ring) · leg1 links cp#' + (lastCp ? lastCp.height : '?') + ' (' + String(ref0).slice(0, 6) + ')');
    } else {
      ring = {
        id: ((sq.rings || []).reduce((mx, r) => Math.max(mx, r.id || 0), 0)) + 1,
        at: new Date().toISOString(), legs: [], closed: false, zeroFeeAll: false, verified: false,
        burnSun: 0, notedHeight: null,
      };
      startIdx = 0;
      prevTxid = null;
      pushLog(st, 'ring#' + ring.id + ' start · leg1 links SAOS cp#' + (lastCp ? lastCp.height : '?') + ' (' + String(ref0).slice(0, 6) + ')');
      sq.rings = [ring].concat(sq.rings || []).slice(0, 32); /* פעם-אחת — אותו-אובייקט מתעדכן-במקום-עם-כל-רגל */
    }
    for (let i = startIdx; i < mems.length; i++) {
      const from = mems[i], to = mems[(i + 1) % mems.length];
      const ref = i === 0 ? ref0 : prevTxid;
      const amountSun = encodeLeg(ref);
      const fw = await liveWallet(from.tw, from.address); /* קריאה-חיה-טרייה לשולח-הרגל */
      if (fw.balanceSun < amountSun + SQUAD_GUARDS.legFloorSun) { pushLog(st, 'ring leg ' + (i + 1) + ' skipped: balance floor (' + (fw.balanceSun / 1e6).toFixed(3) + ' TRX)'); break; }
      if (fw.freeNetLeft < SQUAD_GUARDS.minFreeNetBytes) { pushLog(st, 'ring leg ' + (i + 1) + ' skipped: free bandwidth guard (' + fw.freeNetLeft + 'B < ' + SQUAD_GUARDS.minFreeNetBytes + 'B — zero-fee guard)'); break; }
      const fRec = sq.members.find((x) => x.idx === from.idx);
      if (fRec) { fRec.balanceSun = fw.balanceSun; fRec.balanceTrx = fw.balanceTrx; fRec.freeNetLeft = fw.freeNetLeft; }
      const res = await sendTrxConfirm(from, to, amountSun, st, 'ring#' + ring.id + ' leg' + (i + 1) + ' s' + from.idx + '→s' + to.idx);
      if (!res) break; /* שרשרת-שבורה — טבעת-חלקית-כנה */
      const fa = await liveWallet(from.tw, from.address);
      ring.legs.push({
        n: i + 1, from: from.address, to: to.address, idxFrom: from.idx, idxTo: to.idx,
        amountSun, linked: { kind: i === 0 ? 'saos-cp' : 'prev-txid', ref },
        txid: res.txid, block: res.block, netFeeSun: res.netFee, receipt: res.receipt,
        verified: res.confirmed, balanceAfterSun: fa.balanceSun, at: new Date().toISOString(),
      });
      prevTxid = res.txid;
      saveState(st); /* אטומי-פר-רגל */
    }
    ring.closed = ring.legs.length === mems.length && String(ring.legs[ring.legs.length - 1].to) === mems[0].address;
    ring.zeroFeeAll = ring.legs.length > 0 && ring.legs.every((l) => l.netFeeSun === 0);
    ring.verified = ring.legs.length > 0 && ring.legs.every((l) => l.verified);
    /* 93-fix: רק-השריפה-של-הרגליים-החדשות-נספרת (טבעת-מושלמת-על-פני-מספר-טיקים לא תיספר-כפול) */
    const newLegsBurnSun = ring.legs.slice(startIdx).reduce((s, l) => s + l.netFeeSun, 0);
    ring.burnSun = ring.legs.reduce((s, l) => s + l.netFeeSun, 0);
    sq.burnLedger.netFeeSun += newLegsBurnSun;
    sq.burnLedger.totalSun = sq.burnLedger.activationsSun + sq.burnLedger.netFeeSun;
    for (const m of mems) { /* יתרות-סוף-טבעת — קריאה-חיה-טרייה לכל-חבר */
      const w = await liveWallet(m.tw, m.address);
      const rec = sq.members.find((x) => x.idx === m.idx);
      if (rec) { rec.balanceSun = w.balanceSun; rec.balanceTrx = w.balanceTrx; rec.freeNetLeft = w.freeNetLeft; }
    }
    pushLog(st, 'RING#' + ring.id + ' ' + ring.legs.length + '/' + mems.length + ' legs · closed=' + ring.closed + ' · zeroFeeAll=' + ring.zeroFeeAll + ' · verified=' + ring.verified + ' · burn=' + (ring.burnSun / 1e6).toFixed(6) + ' TRX');
  }
  saveState(st);
  return st;
}

/* ── PULSE (92): הבלוק-החי-המאושר של TRON — קריאה-בלבד, אפס-עלות ── */
async function tronNow(tw) {
  const b = await withRetry(() => tw.trx.getCurrentBlock(), 3);
  const num = Number((((b || {}).block_header || {}).raw_data || {}).number || ((b || {}).raw_data || {}).number || 0);
  if (!num) throw new Error('pulse: no block number');
  return { tronHeight: num, tronBlockId: String((b && b.blockID) || '').slice(0, 24), at: new Date().toISOString() };
}

/* ── raw-POST ל-TronGrid (92): עוקף שינויי-API-בין-גרסאות-tronweb (triggerConstantContract
 * חסר ב-5.3.4) — קריאת-קריאה-בלבד, אפס-שריפה, משפחה-4 (שיעור-HE) ── */
function tgPost(p, body, timeout = 10000) {
  const payload = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = require('https').request({ hostname: 'api.trongrid.io', path: p, method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout }, (res) => {
      let d = ''; res.on('data', (c) => { d += c; if (d.length > 2e6) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(payload); req.end();
  });
}

/* ── נגזרות (92): יתרת-USDT (TRC-20) — triggerconstantcontract, קריאה-חינם, אף-שידור ── */
async function readUsdt(tw, ownerHex, targetAddress) {
  try {
    const targetHex = tw.address.toHex(targetAddress); /* 41… (42 תווים) */
    const param = '000000000000000000000000' + targetHex; /* מילת-ABI: 22 אפסים + כתובת */
    const r = await withRetry(() => tgPost('/wallet/triggerconstantcontract', {
      owner_address: ownerHex,
      contract_address: tw.address.toHex(USDT_CONTRACT),
      function_selector: 'balanceOf(address)',
      parameter: param,
      visible: false,
    }), 2);
    const hex = r && r.constant_result && r.constant_result[0];
    if (!hex || String(hex).length < 64) return null; /* null = לא-נמדד (כנות, לא-אפס-מזויף) */
    return Number(BigInt('0x' + String(hex)) / 1000000n); /* USDT = 6 ספרות */
  } catch (_) { return null; }
}

/* ── derivativesTick (92): ניטור-נגזרות לכל-הכתובות + כיבולת-רוחב-פס-חינם ── */
async function derivativesTick() {
  const st = loadState() || { version: 1, guards: GUARDS, anchors: [], log: [] };
  const { a0 } = loadWallet();
  const mems = await squadWallets();
  const ownerHex = a0.tw.address.toHex(a0.address);
  const addrs = [
    { role: 'sender', idx: 0, address: a0.address },
    { role: 'relay', idx: 1, address: st.addressRelay || '' },
  ].concat(mems.map((m) => ({ role: 'squad', idx: m.idx, address: m.address })));
  const usdt = [];
  for (const a of addrs) {
    if (!a.address) continue;
    const v = await readUsdt(a0.tw, ownerHex, a.address);
    usdt.push({ role: a.role, idx: a.idx, address: a.address, usdt: v });
    await new Promise((r) => setTimeout(r, 300)); /* anti-429 נימוס */
  }
  const measured = usdt.filter((x) => x.usdt !== null).length;
  st.derivatives = {
    at: new Date().toISOString(), contract: USDT_CONTRACT, readOnly: true,
    usdt, usdtTotal: usdt.reduce((s, x) => s + (x.usdt || 0), 0), measured: measured + '/' + usdt.length,
  };
  st.pulse = await tronNow(a0.tw); /* פעימה-חיה-גם-בין-עוגנים — המדינה-תמיד-טרייה */
  pushLog(st, 'derivatives tick: USDT total ' + st.derivatives.usdtTotal + ' · measured ' + st.derivatives.measured + ' · pulse TRON blk ' + st.pulse.tronHeight);
  saveState(st);
  return st.derivatives;
}

/* ── CONFIRM — אימות-חזרה מהמארח (read-back, keyless truth): עוגן-שלא-אושר → נבדק מול TRON ── */
async function confirmCmd() {
  const st = loadState() || { anchors: [] };
  const { a0 } = loadWallet();
  let changed = 0;
  for (const a of st.anchors || []) {
    if (a.verified && a.block) continue;
    try {
      const info = await withRetry(() => a0.tw.trx.getTransactionInfo(a.txid), 3);
      if (info && info.blockNumber) {
        const receipt = info.receipt || {};
        a.block = Number(info.blockNumber || 0);
        a.netFeeSun = Number(receipt.net_fee || 0);
        /* plain TransferContract: אין receipt.result — האמת ב-ret[0].contractRet של העסקה המלאה */
        let contractRet = String(info.contractRet || receipt.result || '');
        if (!contractRet) {
          try {
            const full = await withRetry(() => a0.tw.trx.getTransaction(a.txid), 2);
            contractRet = String(((full && full.ret && full.ret[0]) || {}).contractRet || '');
          } catch (_) {}
        }
        a.receipt = { result: contractRet || null };
        a.verified = contractRet === 'SUCCESS';
        changed++;
        pushLog(st, 'confirm: txid ' + a.txid.slice(0, 16) + '… → blk ' + a.block + ' net_fee=' + a.netFeeSun + 'sun ret=' + (contractRet || '?') + ' verified=' + a.verified);
      } else {
        pushLog(st, 'confirm: txid ' + a.txid.slice(0, 16) + '… still not in block — stays honest-unverified');
      }
    } catch (e) { pushLog(st, 'confirm ERR: ' + String((e && e.message) || e).slice(0, 100)); }
  }
  /* 91: read-back גם לסדוגה — מימון + רגלי-טבעת שנשדרו-ולא-אושרו */
  try {
    const sq = st.squad;
    if (sq) {
      const recs = [].concat(sq.funding || [], (sq.rings || []).flatMap((r) => r.legs || []));
      for (const rec of recs) {
        if (rec.verified && rec.block) continue;
        try {
          const info = await withRetry(() => a0.tw.trx.getTransactionInfo(rec.txid), 3);
          if (info && info.blockNumber) {
            rec.block = Number(info.blockNumber || 0);
            rec.netFeeSun = Number((info.receipt || {}).net_fee || 0);
            let cr = String(info.contractRet || (info.receipt || {}).result || '');
            if (!cr) {
              try {
                const full = await withRetry(() => a0.tw.trx.getTransaction(rec.txid), 2);
                cr = String(((full && full.ret && full.ret[0]) || {}).contractRet || '');
              } catch (_) {}
            }
            rec.receipt = { result: cr || null };
            rec.verified = cr === 'SUCCESS';
            changed++;
            pushLog(st, 'squad confirm: ' + rec.txid.slice(0, 16) + '… → blk ' + rec.block + ' net_fee=' + rec.netFeeSun + 'sun ret=' + (cr || '?') + ' verified=' + rec.verified);
          }
        } catch (e) { pushLog(st, 'squad confirm ERR: ' + String((e && e.message) || e).slice(0, 100)); }
      }
      for (const r of sq.rings || []) {
        r.zeroFeeAll = (r.legs || []).length > 0 && (r.legs || []).every((l) => l.netFeeSun === 0);
        r.verified = (r.legs || []).length > 0 && (r.legs || []).every((l) => l.verified);
        r.closed = (r.legs || []).length === (sq.indices || []).length;
      }
    }
  } catch (e) { pushLog(st, 'squad confirm skip: ' + String((e && e.message) || e).slice(0, 90)); }
  if (changed) saveState(st);
  console.log(JSON.stringify({ changed, anchors: (st.anchors || []).length }));
}

/* ── WATCH (92-מורחב) — לולאת-תגובות-שרשרת אוטומטית: הרשת-שלנו מזיזה את TRON ──
 * סדר-קבוע בכל-פעימה (כל 20 דק׳):
 *   1. anchor     — עוגן-checkpoint חדש (כמות≡hash, ≤2/יום, אפס-שריפה)
 *   2. confirm    — read-back לכל-txid (השרשרת-החיה-היא-האמת)
 *   3. pulse+deriv — פעימה-חיה + ניטור-נגזרות (קריאה-בלבד)
 *   4. squad      — מימון-מדלג-עצמו; טבעת-לפיד אוטומטית כשיש-quota+bandwidth
 *     → אחרי-איפוס-הרוחב-הפס-החינמי (00:00 UTC) טבעת-חדשה-נורית-מעצמה:
 *       תגובת-שרשרת מתוכננת — הרשת-מחזקת-את-עצמה-בלי-מגע-יד ── */
async function watch() {
  const TICK = 20 * 60 * 1000;
  console.log('[tron-bridge] watch loop started (92) · every ' + TICK / 60000 + 'min · guards ' + JSON.stringify(GUARDS));
  const step = async (name, fn) => {
    try { return await fn(); } catch (e) {
      const st = loadState() || { anchors: [] };
      pushLog(st, name + ' ERR: ' + String((e && e.message) || e).slice(0, 120));
      try { saveState(st); } catch (_) {}
      return null;
    }
  };
  for (;;) {
    await step('watch-anchor', () => anchor(false));
    await step('watch-confirm', () => confirmCmd());
    await step('watch-pulse+deriv', () => derivativesTick());
    await step('watch-squad', () => squad(false));
    await new Promise((r) => setTimeout(r, TICK));
  }
}

/* ── STATUS ── */
async function status() {
  const st = loadState() || { version: 1, guards: GUARDS, anchors: [], log: [] };
  const { a0, a1 } = loadWallet();
  st.address = a0.address; st.addressRelay = a1.address;
  st.rpc = RPC; st.derivePath = DERIVE_PATH; st.guards = GUARDS;
  const w0 = await liveWallet(a0.tw, a0.address);
  const w1 = await liveWallet(a1.tw, a1.address);
  st.wallet = { sender: w0, relay: w1 }; st.lastCheck = new Date().toISOString();
  const cp = pickCheckpoint(st);
  st.nextCandidate = cp ? { cpHeight: cp.height, cpHash: cp.checkpointHash, encoded: encodeAmount(cp.checkpointHash) } : null;
  /* 92: pulse + נגזרות + כיבולת — כל-הערך-הנגזר-מהכתובות-הריבוניות */
  st.pulse = await tronNow(a0.tw).catch(() => null);
  const squadAddrs = st.squadAddresses || [];
  const liveAddrs = 2 + squadAddrs.length; /* שדרן + רכזת + סדוגה */
  st.capacity = { addresses: liveAddrs, dailyFreeBytes: liveAddrs * 600, estFreeTxPerDay: Math.floor((liveAddrs * 600) / TX_BYTES_EST), txBytesMeasured: TX_BYTES_EST };
  try { await derivativesTick(); } catch (_) {}
  const sq = st.squad;
  const squadSummary = sq ? {
    members: (sq.members || []).map((m) => ({ idx: m.idx, address: m.address, activated: !!m.activated, balanceTrx: m.balanceTrx })),
    activated: (sq.members || []).filter((m) => m.activated).length + '/' + (sq.indices || []).length,
    funding: (sq.funding || []).length,
    rings: (sq.rings || []).length,
    ringsClosed: (sq.rings || []).filter((r) => r.closed && r.verified).length,
    zeroFeeLegs: (sq.rings || []).reduce((s, r) => s + (r.legs || []).filter((l) => l.netFeeSun === 0).length, 0),
    legsTotal: (sq.rings || []).reduce((s, r) => s + (r.legs || []).length, 0),
    burnLedger: sq.burnLedger || null,
  } : null;
  saveState(st);
  console.log(JSON.stringify({
    address: a0.address, relay: a1.address,
    balanceTrx: [w0.balanceTrx, w1.balanceTrx],
    freeNet: [w0.freeNetLeft + '/' + w0.freeNetLimit, w1.freeNetLeft + '/' + w1.freeNetLimit],
    anchors: (st.anchors || []).length, nextCandidate: st.nextCandidate,
    squad: squadSummary,
    pulse: st.pulse, derivatives: st.derivatives || null, capacity: st.capacity,
  }, null, 2));
}

async function main() {
  if (process.argv.includes('anchor')) return void (await anchor(process.argv.includes('--dry')));
  if (process.argv.includes('squad')) return void (await squad(process.argv.includes('--dry')));
  if (process.argv.includes('confirm')) return confirmCmd();
  if (process.argv.includes('derivatives')) return void console.log(JSON.stringify(await derivativesTick(), null, 2));
  if (process.argv.includes('watch')) return watch();
  return status();
}
main().catch((e) => { console.error('[tron-bridge] FATAL ' + String((e && e.message) || e)); process.exit(1); });
