#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * THE-SHIELD (117l) — מנוע-ההגנה רב-שרשרתי · מגן-הגנבים
 *
 * המנדט (מהמפעיל): "כשאנחנו מחוברים לכל הרשתות — אקסטרה להבין פישינג,
 * טוקנים מתחזים, וכל מה שמסכן אותנו על רשתות חכמות — שלא נשתמש בטעות
 * בקוד זדוני. חדשנות + יכולות + הגנה מגנבים."
 *
 * מודל-האיום (ממומש כאן, לא רק במסמך):
 *   T1 טוקן-מתחזה   — שם/סימול מפורסם מחוזה-זר (USDT מזויף) · דצימלים-חריגים
 *   T2 חוזה-זדוני   — פונקציות-טיהור ב-bytecode: mint/setOwner/blacklist/pause
 *   T3 חיקוי-דלת    — vanity-gen של קידומת/ראש+זנב של 8 הדלתות (עוקץ-העברה)
 *                     base58check שובר החלפות-תו-בודד — לכן האמת היא חיקוי-תצוגה
 *   T4 אישור-לא-מוגבל — approve(max) / setApprovalForAll = דלת-כיס-פתוחה
 *   T5 ממו-פישינג   — URL מחוץ-לרשימה · מילות-גיוס · חיקוי-מותג · צורת-סודות
 *   T6 רעש-מהירות   — relay-spam ששורף רוחב-פס/אנרגיה מהדלתות שלנו
 *
 * דוקטרינות:
 *   · אין-אמת-חלקית — מה שלא נמדד לא נקרא "נקי" (measured:false → WARN כנה)
 *   · ריבוי-מארחים — 3 מארחי TRON, כשל-מארח לא משבית מדידה
 *   · אפס-מפתחות — המגן לעולם לא קורא כספת/מפתח/מנמוניק (רק נתוני-רשת ציבוריים)
 *   · למידה-עצמית — כל-BLOCK נחרט לרשימת-אסורים מקומית; כל-אירוע ל-audit JSONL
 *   · פסיקה-גלויה — ALLOW(0..19)/WARN(20..59)/BLOCK(60+) עם נימוקים
 *
 * שימוש (CLI):
 *   check-token <contract> · check-address <addr> · guard <to> [data] [value]
 *   scan-memo <text> · velocity · posture · selftest
 *   learn-deny <addr> / learn-allow <addr> · watch (לולאת-10-דק')
 * ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dns').setDefaultResultOrder('ipv4first'); // HE lesson: family-4 first

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const BS58 = require(path.join(ROOT, 'node_modules', 'bs58'));
const { keccak256 } = require(path.join(ROOT, 'node_modules', 'ethers'));

const STATE_FILE = path.join(HERE, 'security-state.json');
const EVENTS_FILE = path.join(HERE, 'security-events.jsonl');
const HOSTS = ['https://api.trongrid.io', 'https://api.tronstack.io', 'https://tron.stackwallet.com'];
const TIMEOUT = 9000;

/* ── דלתות-המערכת (זהות-ציבורית בלבד — מה-broker /doors · אין-סוד-כאן) ── */
const OUR_DOORS = [
  'TVkH6fqiaRj2k4MEkd8Rdefqod1D5zkhjL', // sov:0 (issuer)
  'TUoMhUdfTYwPknq24gcwBGm3g2dq5bi18Z', // sov:1
  'TXXkRxu16hf7LEdwsy5vEa7rhpBoUg5MgJ', // sov:2
  'THRkKer9SvTWsYFHAmFQSh62xDopTNuxgL', // sov:3
  'TVjbwPF3jvdXiGqXxeHySnsynkLhugN2YK', // sov:4
  'TSwMTSv6z33b6LKW274Zm8zV4zfUPrpxR3', // sov:5
  'TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr', // legacy:0
  'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4', // legacy:1
];
/* דלתות-הרישום (12 סוכנים · מתוך-wallets-registry.json — כתובות-ציבוריות-בלבד;
 * המגן מגן-גם-עליהן מפישינג-חיקוי · TG6Srs = דלת-ההפקדות-הרשמית) */
const REGISTRY_DOORS = [
  'TT7whWFon5EdDVFUBUUP9EY6y3VCtL7Bre',
  'TMaxNtRVdBmXyQUdsHFRaAm1jPpFAG9d7K',
  'TG6SrsMJjRqnqAyYM8kGZu1rgkpsgizKEn',
  'TQErSnQCdTTtL3Tf8KiX2FxFhbhYQCDx3F',
  'TJ57aAHB44NiwT8up5y7P3Fcfko6vbcbYK',
  'TJg2YiPuczmz72nJq5tmT2vrod5BDgZDmS',
  'TNgaDWYknRz46deiLkXdUXhn3gjcobnxhE',
  'TL7EvaXWtYQwuQdEDpkgGJCryY8t5PRzwH',
  'TBR2ffp74mp9oUinrA4BbjKKTttFr5Ng2u',
  'TLDEWjWWyTCWrtaEk9CmJG68NgPMjKLuZp',
  'TDCXLokdY1PGjKEMtWG7we9Dt8279hF46m',
  'TVESRr1TX1RaKzsN6TKszutJBFDPEGPx1e',
];
const ALL_PROTECTED = [...OUR_DOORS, ...REGISTRY_DOORS];
const OUR_EXACT = new Set(ALL_PROTECTED);

/* ── רישום-קאנוני: טוקנים-ותיקים-מוכרים על TRON (הכתובת-היא-האמת, לא-השם) ── */
const KNOWN_TOKENS = {
  TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t: { name: 'Tether USD', symbol: 'USDT', decimals: 6, note: 'canonical-TRON-USDT' },
  TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8: { name: 'USD Coin', symbol: 'USDC', decimals: 6, note: 'canonical-TRON-USDC' },
  TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9: { name: 'Bitcoin', symbol: 'TBTC', decimals: 8, note: 'canonical-TRON-TBTC' },
};

/* ── שמות/סימולים מפורסמים = מגנט-חיקויים (מציג-אותם-מבלי-להיות-הקאנון = חשוד) ── */
const FAMOUS_NAMES = ['USDT', 'USDC', 'TETHER', 'USD', 'ETH', 'BTC', 'WBTC', 'DAI', 'BUSD', 'SOL', 'TRX', 'BNB', 'PEPE', 'SHIB', 'DOGE', 'WETH'];

/* ── פונקציות-סיכון (סלקטורים מחושבים בזמן-ריצה — בלי טבלאות-מיושנות) ── */
const DANGER_FNS = [
  'mint(address,uint256)', 'setOwner(address)', 'setOwners(address[])', 'transferOwnership(address)',
  'blacklist(address)', 'addBlackList(address)', 'removeBlackList(address)', 'pause()',
  'setTaxes(uint256,uint256)', 'setFees(uint256,uint256)', 'setMaxTxAmount(uint256)',
  'setFeeWallet(address)', 'setSwapEnabled(bool)', 'updateFee(address)',
];
const SEL = {};
for (const f of DANGER_FNS) SEL[f] = keccak256(Buffer.from(f)).slice(2, 10);

const SEL_TRANSFER = 'a9059cbb';        // transfer(address,uint256)
const SEL_TRANSFERFROM = '23b872dd';   // transferFrom(address,address,uint256)
const SEL_APPROVE = '095ea7b3';        // approve(address,uint256)
const SEL_SETAPPROVEALL = 'a22cb465';  // setApprovalForAll(address,bool)
const APPROVE_ALL_LIMIT = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';

/* ── נורמליזציית-הטעיות (confusables): המתחזים-אוהבים С-רוסית ו-ɑ-יוונית ── */
const CONFUSABLES = { 'ɑ': 'a', 'а': 'a', 'ｅ': 'e', 'е': 'e', 'Ϲ': 'C', 'С': 'C', 'Ⅽ': 'C', 'Ѕ': 'S', 'ѕ': 's', 'ԁ': 'd', 'ο': 'o', 'о': 'o', 'ρ': 'p', 'р': 'p', 'І': 'I', 'і': 'i', '０': '0', 'Ο': 'O', 'О': 'O', 'Τ': 'T', 'Т': 'T', 'Χ': 'X', 'Х': 'X', 'Η': 'H', 'Н': 'H', 'Κ': 'K', 'К': 'K', 'Μ': 'M', 'М': 'M', 'Β': 'B', 'В': 'B', 'Ε': 'E', 'Е': 'E', 'Ζ': 'Z', 'З': 'Z' };
function normText(s) {
  let t = String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  let out = '';
  for (const ch of t) out += CONFUSABLES[ch] || ch;
  return out.replace(/[^A-Z0-9]/g, '');
}

/* ── מרחק-לוונשטיין ── */
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function verdictOf(score) { return score >= 60 ? 'BLOCK' : score >= 20 ? 'WARN' : 'ALLOW'; }

/* ── מצב-למידה-עצמית + אודיט ── */
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return { deny: [], allow: [], stats: { checks: 0, blocks: 0, warns: 0 }, velocity: [] }; } }
function saveState(st) { try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 1)); } catch (_) {} }
function isDenied(addr) { return loadState().deny.includes(addr); }
function isAllowed(addr) { return loadState().allow.includes(addr); }
function event(kind, detail, verdict) {
  try { fs.appendFileSync(EVENTS_FILE, JSON.stringify({ at: new Date().toISOString(), kind, verdict, ...detail }) + '\n'); } catch (_) {}
  const st = loadState();
  st.stats = st.stats || {};
  st.stats.checks = (st.stats.checks || 0) + 1;
  if (verdict === 'BLOCK') st.stats.blocks = (st.stats.blocks || 0) + 1;
  if (verdict === 'WARN') st.stats.warns = (st.stats.warns || 0) + 1;
  saveState(st);
}

/* ── קורא-רב-מארחים ── */
async function rpc(method, params) {
  let lastErr = null;
  for (const host of HOSTS) {
    try {
      const r = await fetch(host + '/wallet/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params || {}), signal: AbortSignal.timeout(TIMEOUT) });
      const j = await r.json().catch(() => null);
      if (j && !j.error) return j;
      lastErr = new Error('bad-shape:' + method);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all-hosts-failed:' + method);
}

/* ── כתובת-טרון: תקפות + checksum מלא ── */
function validTronAddr(addr) {
  if (typeof addr !== 'string' || addr[0] !== 'T' || addr.length !== 34) return false;
  try {
    const raw = BS58.decode(addr);
    if (raw.length !== 25 || raw[0] !== 0x41) return false;
    const payload = raw.subarray(0, 21), chk = raw.subarray(21);
    const h = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
    return chk.equals(h.subarray(0, 4));
  } catch (_) { return false; }
}
function ethToTron(hexAddr) {
  const payload = Buffer.concat([Buffer.from([0x41]), Buffer.from(String(hexAddr).replace(/^0x/, ''), 'hex')]);
  const h = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest();
  return BS58.encode(Buffer.concat([payload, h.subarray(0, 4)]));
}

/* ═══ T1+T2 — בדיקת-טוקן ═══ */
async function checkToken(addr) {
  const reasons = [];
  if (!validTronAddr(addr)) return { verdict: 'BLOCK', score: 100, measured: true, reasons: ['invalid-address'], kind: 'token' };
  if (KNOWN_TOKENS[addr]) {
    const k = KNOWN_TOKENS[addr];
    const v = { verdict: 'ALLOW', score: 0, measured: true, reasons: ['canonical:' + k.symbol + ' (' + k.note + ')'], token: k, kind: 'token' };
    event('token', { addr }, v.verdict); return v;
  }
  if (isDenied(addr)) reasons.push('learned-denylist');
  if (isAllowed(addr)) reasons.push('learned-allowlist(known-safe-history)');

  let name = '', symbol = '', decimals = -1, bytecode = '', measured = true;
  try {
    const ti = await rpc('trc20/gettokeninfo', { id: addr, visible: true });
    if (ti && typeof ti.name === 'string') { name = ti.name; symbol = ti.symbol || ''; decimals = Number(ti.decimals || 0); }
  } catch (e) { measured = false; }
  try {
    const ct = await rpc('getcontract', { address: addr, visible: true });
    if (ct && typeof ct.bytecode === 'string') bytecode = ct.bytecode;
  } catch (e) { /* bytecode עודף-מידע, לא-קריטי */ }

  if (!measured) {
    const v = { verdict: 'WARN', score: 40, measured: false, reasons: ['unmeasurable(3-hosts) — לא-קריא ולא-מוכר — יחס-כחשוד-עד-הוכחה (אין-אמת-חלקית)'], kind: 'token' };
    event('token', { addr }, v.verdict); return v;
  }

  const isToken = symbol !== '' || name !== '';
  const nName = normText(name), nSym = normText(symbol);
  const famHit = isToken ? FAMOUS_NAMES.filter((f) => nSym === f || nName === f || (nSym.length > 1 && lev(nSym, f) <= 2) || (nName.length > 3 && lev(nName, f) <= 2)) : [];
  if (famHit.length) reasons.push('mimicry: name/symbol≈' + famHit.join(',') + ' ואינו-הרישום-הקאנוני (T1)');

  const dangerHits = bytecode ? DANGER_FNS.filter((fn) => bytecode.includes(SEL[fn])) : [];
  if (dangerHits.length) reasons.push('bytecode-danger(' + dangerHits.length + '): ' + dangerHits.slice(0, 4).join(',') + ' …(T2)');

  let score = 0;
  if (famHit.length) score += 60;
  if (dangerHits.length) score += Math.min(45, dangerHits.length * 15);
  if (isToken && decimals > 18) { score += 20; reasons.push('decimals=' + decimals + ' חריג'); }
  if (isDenied(addr)) score = Math.max(score, 70);
  const verdict = verdictOf(score);
  const v = { verdict, score, measured: true, reasons: reasons.length ? reasons : ['no-red-flags(שם-לא-מפורסם · בלי-פונקציות-סיכון שזוהו)'], name, symbol, kind: 'token' };
  if (verdict === 'BLOCK') { const st = loadState(); if (!st.deny.includes(addr)) { st.deny.push(addr); saveState(st); } }
  event('token', { addr, name, symbol }, verdict);
  return v;
}

/* ═══ T3 — בדיקת-כתובת ═══ */
async function checkAddress(addr) {
  const reasons = [];
  if (!validTronAddr(addr)) return { verdict: 'BLOCK', score: 100, measured: true, reasons: ['invalid-tron-address (checksum נכשל — טעות-אדם או תחבולה)'], kind: 'address' };
  if (OUR_EXACT.has(addr)) { const v = { verdict: 'ALLOW', score: 0, measured: true, reasons: ['own-door (הדלת שלנו)'], kind: 'address' }; event('address', { addr }, v.verdict); return v; }

  /* חיקוי-דלת: base58check שובר החלפות-1-3-תווים — התבניות-האמת:
   * (א) קידומת-זהה ≥6 (vanity-gen של הראש) · (ב) ראש≥4+זנב≥3 (הצגת 'TVkH…kjL') · (ג) lev קטן */
  let best = { d: 99, door: null, prefix: 0, suffix: 0, rank: -1 };
  for (const d of ALL_PROTECTED) {
    const dd = lev(addr, d);
    let p = 0; while (p < 34 && addr[p] === d[p]) p++;
    let s = 0; while (s < 34 - p && addr[33 - s] === d[33 - s]) s++;
    const rank = (dd <= 3 ? 1000 : 0) + (p >= 6 ? 500 : 0) + (p >= 4 && s >= 3 ? 400 : 0);
    if (rank > best.rank) best = { d: dd, door: d, prefix: p, suffix: s, rank };
  }
  const mimic = best.door && best.door !== addr && (best.d <= 3 || best.prefix >= 6 || (best.prefix >= 4 && best.suffix >= 3));
  if (mimic) reasons.push('door-mimic: דמיון-חריג לדלת ' + best.door.slice(0, 10) + '… (lev=' + best.d + ' · prefix=' + best.prefix + ' · suffix=' + best.suffix + ') — תבנית-עוקץ-העברה (T3)');
  if (isDenied(addr)) reasons.push('learned-denylist');
  if (isAllowed(addr)) reasons.push('learned-allowlist(known-safe-history)');

  /* מוניטין-חיצוני best-effort — כשל-שירות ≠ כשל-הכתובת */
  let rep = { measured: false, note: 'unmeasured' };
  try {
    const r = await fetch('https://apilist.tronscanapi.com/api/security/account/data?address=' + addr, { signal: AbortSignal.timeout(6000) });
    const j = await r.json().catch(() => null);
    if (j && (j.fraudAccount || j.isScamAccount || (Array.isArray(j.label) && j.label.length))) { rep = { measured: true, note: 'external-fraud-flag', flags: j.label || null }; reasons.push('external-reputation: דגל-הונאה מ-TronScan (T3)'); }
    else if (j) rep = { measured: true, note: 'external-clean(no-flags)' };
  } catch (_) { rep = { measured: false, note: 'reputation-service-unreachable' }; }

  let score = 0;
  if (mimic) score += 80;
  if (isDenied(addr)) score = Math.max(score, 70);
  if (rep.measured && rep.note === 'external-fraud-flag') score = Math.max(score, 75);
  if (score === 0) { score = 25; reasons.push('unknown-address(לא-שלנו · לא-מדורג) — נדרש-מפעיל-לאישור-יעד-חדש'); }
  const verdict = verdictOf(score);
  const v = { verdict, score, measured: true, reputation: rep, reasons, kind: 'address' };
  if (verdict === 'BLOCK') { const st = loadState(); if (!st.deny.includes(addr)) { st.deny.push(addr); saveState(st); } }
  event('address', { addr }, verdict);
  return v;
}

/* ═══ T4 — שער-חתימה ═══ */
async function guardTx(tx) {
  const { to, data, value } = tx || {};
  const reasons = [];
  let score = 0;
  const dest = await checkAddress(to);
  if (dest.verdict === 'BLOCK') return { verdict: 'BLOCK', score: 100, measured: true, reasons: ['destination: ' + dest.reasons.join(';')], dest, kind: 'guard' };
  if (dest.verdict === 'WARN') { score += 20; reasons.push('destination-WARN: ' + dest.reasons.join(';')); }

  const hex = String(data || '').replace(/^0x/, '');
  if (hex && hex.length >= 8) {
    const sel = hex.slice(0, 8).toLowerCase();
    if (sel === SEL_APPROVE) {
      const amountHex = hex.slice(8 + 64, 8 + 128).padEnd(64, '0');
      const unlimited = amountHex === APPROVE_ALL_LIMIT || (amountHex.length === 64 && /^[0-9a-f]+$/i.test(amountHex) && BigInt('0x' + amountHex) >= (1n << 255n));
      const spenderTron = ethToTron('0x' + hex.slice(8 + 24, 8 + 64));
      if (unlimited) {
        score += 80;
        reasons.push('UNLIMITED-APPROVE ל-' + spenderTron + ' (T4: דלת-כיס-פתוחה — אסור מקסימום בלי תקרה)');
        const sp = await checkAddress(spenderTron).catch(() => ({ verdict: 'WARN', reasons: ['spender-unmeasurable'] }));
        reasons.push('spender-check: ' + sp.verdict + ' · ' + (sp.reasons || []).join(';'));
      } else reasons.push('approve-with-cap (תקרה מוגדרת — סביר)');
    } else if (sel === SEL_SETAPPROVEALL) {
      score += 70; reasons.push('setApprovalForAll (T4: אישור-גורף-לכל-הנכסים — מסוכן מול מפעיל-לא-מוכר)');
    } else if (sel === SEL_TRANSFER || sel === SEL_TRANSFERFROM) {
      const recTron = ethToTron('0x' + hex.slice(8 + 24, 8 + 64));
      const rec = await checkAddress(recTron).catch(() => ({ verdict: 'WARN', reasons: [] }));
      if (rec.verdict === 'BLOCK') { score += 80; reasons.push('inner-recipient-BLOCK: ' + recTron + ' · ' + rec.reasons.join(';')); }
      else if (rec.verdict === 'WARN') { reasons.push('inner-recipient-WARN: ' + recTron); score = Math.max(score, 20); }
      else reasons.push('inner-recipient: ' + recTron + ' (own-door)');
    } else {
      reasons.push('selector-' + sel + ' (מחוץ-לרשימת-ERC המוכרת — חתימה דורשת-מפעיל)');
      score += 30;
    }
  }
  if (value != null && Number(value) > 500_000_000) { score += 20; reasons.push('value=' + value + ' sun מעל-תקרת-ההגיון (500 TRX)'); }
  const verdict = verdictOf(score);
  const v = { verdict, score, measured: true, reasons, kind: 'guard' };
  event('guard', { to, sel: hex ? hex.slice(0, 8) : null }, verdict);
  return v;
}

/* ═══ T5 — סריקת-ממו ═══ */
const URL_ALLOW = ['steemit.com', 'steemitwallet.com', 'tron.network', 'tronscan.org', 'github.com', 'steem.com'];
const PHISH_WORDS = ['claim', 'airdrop', 'verify your wallet', 'verify-wallet', 'connect wallet', 'free ', 'urgent', 'last chance', 'seed phrase', 'private key', 'mnemonic', 'backup phrase'];
async function scanMemo(text) {
  const t = String(text || '');
  const reasons = [];
  let score = 0;
  const urls = t.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  for (const u of urls) {
    let host = '';
    try { host = new URL(u).hostname.toLowerCase(); } catch (_) { reasons.push('malformed-url:' + u.slice(0, 40)); score += 30; continue; }
    const ok = URL_ALLOW.some((a) => host === a || host.endsWith('.' + a));
    if (!ok) { reasons.push('off-allowlist-url:' + host + ' (T5)'); score += 35; }
    if (/steemit|steemwallet|tron/i.test(host) && !ok) { reasons.push('brand-impersonation-domain:' + host); score += 40; }
  }
  const low = t.toLowerCase();
  for (const w of PHISH_WORDS) if (low.includes(w)) { reasons.push('phish-word:"' + w.trim() + '" (T5)'); score += 15; }
  if (/[0-9a-f]{64}/i.test(t) && /seed|key|mnemonic/i.test(t)) { score += 60; reasons.push('secret-shaped-content (לעולם לא שולחים/מבקשים מפתחות בממו)'); }
  score = Math.min(100, score);
  const verdict = verdictOf(score);
  const v = { verdict, score, measured: true, reasons: reasons.length ? reasons : ['clean-memo'], kind: 'memo' };
  event('memo', { len: t.length, urls: urls.length }, verdict);
  return v;
}

/* ═══ T6 — רעש-מהירות ═══ */
function markActivity(kind, ref) {
  const st = loadState();
  st.velocity = (st.velocity || []).filter((x) => Date.now() - x.at < 3600_000);
  st.velocity.push({ at: Date.now(), kind, ref: ref || null });
  saveState(st);
}
function velocityCheck() {
  const st = loadState();
  const win = (st.velocity || []).filter((x) => Date.now() - x.at < 600_000);
  const n = win.length;
  const reasons = [];
  let score = 0;
  if (n >= 12) { score += 65; reasons.push('velocity=' + n + '/10min (T6: קצב-חריג — relay-spam שורף-רוחב-פס)'); }
  else if (n >= 8) { score += 30; reasons.push('velocity=' + n + '/10min (T6: גבוה — להאט)'); }
  else reasons.push('velocity=' + n + '/10min (תקין)');
  const verdict = verdictOf(score);
  return { verdict, score, measured: true, reasons, kind: 'velocity' };
}

/* ═══ השער-לביצוע-דלת (נקרא מ-relay.cjs לפני כל-חתימה) ═══ */
async function guardRelay(r) {
  const reasons = [];
  const vel = velocityCheck();
  if (vel.verdict === 'BLOCK') return { verdict: 'BLOCK', score: 100, measured: true, reasons: ['velocity: ' + vel.reasons.join(';')] };
  if (vel.verdict === 'WARN') reasons.push('velocity-WARN: ' + vel.reasons.join(';'));
  const memo = await scanMemo(JSON.stringify(r.payload || {}));
  if (memo.verdict === 'BLOCK') return { verdict: 'BLOCK', score: 100, measured: true, reasons: ['payload-memo: ' + memo.reasons.join(';')] };
  if (memo.verdict === 'WARN') reasons.push('payload-memo-WARN: ' + memo.reasons.join(';'));
  const verdict = reasons.some((x) => /WARN/.test(x)) ? 'WARN' : 'ALLOW';
  return { verdict, score: 0, measured: true, reasons };
}

/* ═══ דוח-עמדה ═══ */
async function posture() {
  const st = loadState();
  const lines = [];
  lines.push('THE-SHIELD posture @ ' + new Date().toISOString());
  lines.push('  doors-protected: ' + ALL_PROTECTED.length + ' (8-broker + 12-registry) · hosts: ' + HOSTS.length + ' · danger-fns: ' + DANGER_FNS.length);
  lines.push('  stats: checks=' + (st.stats.checks || 0) + ' blocks=' + (st.stats.blocks || 0) + ' warns=' + (st.stats.warns || 0));
  lines.push('  learned: deny=' + st.deny.length + ' allow=' + st.allow.length);
  const vel = velocityCheck();
  lines.push('  velocity: ' + vel.verdict + ' · ' + vel.reasons.join(';'));
  const usdt = await checkToken('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
  lines.push('  live-probe USDT(canonical): ' + usdt.verdict + ' measured=' + usdt.measured);
  return lines.join('\n');
}

/* ═══ selftest — בדיקות ניצבות מדומיינות (דטרמיניסטי) ═══ */
async function selftest() {
  const results = [];
  const t = (name, cond) => results.push({ name, ok: !!cond });
  /* 1. חיקוי-דלת: מוטציית-BigInt-על-ה-payload + checksum מחושב-מחדש →
   *    כתובת-גיטימית שחולקת-קידומת-ארוכה עם הדלת — תבנית-העוקץ האמת.
   *    (הבנייה-עצמה מוכיחה: base58check שובר החלפות-תו-בודד) */
  const door = OUR_DOORS[0];
  const payload21 = BS58.decode(door).subarray(0, 21);
  let mimicAddr = null;
  for (let i = 1; i <= 5000 && !mimicAddr; i++) {
    const n = BigInt('0x' + payload21.toString('hex')) + BigInt(i);
    const p = Buffer.from(n.toString(16).padStart(42, '0'), 'hex');
    const h = crypto.createHash('sha256').update(crypto.createHash('sha256').update(p).digest()).digest();
    const cand = BS58.encode(Buffer.concat([p, h.subarray(0, 4)])); /* p=0x41+hash20 · +chk4 = 25B */
    if (cand !== door && validTronAddr(cand) && cand.slice(0, 8) === door.slice(0, 8)) mimicAddr = cand;
  }
  t('door-mimic-address-valid-and-constructable', !!mimicAddr && validTronAddr(mimicAddr) && mimicAddr !== door);
  if (mimicAddr) { const r = await checkAddress(mimicAddr); t('door-mimic-BLOCKED', r.verdict === 'BLOCK'); }
  /* 2. כתובת-שלנו → ALLOW(self) */
  const own = await checkAddress(OUR_DOORS[1]); t('own-door-ALLOW', own.verdict === 'ALLOW');
  /* 3. checksum-שגוי → BLOCK */
  const bad = await checkAddress('TVkH6fqiaRj2k4MEkd8Rdefqod1D5zkhjX'); t('bad-checksum-BLOCK', bad.verdict === 'BLOCK');
  /* 4. approve-לא-מוגבל → BLOCK */
  const word = (x) => String(x).padStart(64, '0');
  const spender20 = '0000000000000000000000000000000000000b1';
  const g1 = await guardTx({ to: OUR_DOORS[2], data: SEL_APPROVE + word(spender20) + APPROVE_ALL_LIMIT });
  t('unlimited-approve-BLOCK', g1.verdict === 'BLOCK');
  /* 5. approve-עם-תקרה (100000) → לא-BLOCK */
  const g2 = await guardTx({ to: OUR_DOORS[2], data: SEL_APPROVE + word(spender20) + word('186a0') });
  t('capped-approve-not-BLOCK', g2.verdict !== 'BLOCK');
  /* 6. ממו-פישינג → BLOCK */
  const m1 = await scanMemo('URGENT: claim free airdrop now at https://steemitwallet-claim.xyz/connect');
  t('phish-memo-BLOCK', m1.verdict === 'BLOCK');
  /* 7. ממו-נקי → ALLOW */
  const m2 = await scanMemo('saos:harvest/v1 tick=42 fees=2'); t('clean-memo-ALLOW', m2.verdict === 'ALLOW');
  /* 8. velocity: 13 פעולות בחלון → BLOCK */
  const st0 = loadState(); st0.velocity = [];
  for (let i = 0; i < 13; i++) st0.velocity.push({ at: Date.now() - i * 1000, kind: 'test', ref: 't' + i });
  saveState(st0);
  const vel = velocityCheck(); t('velocity-spam-BLOCK', vel.verdict === 'BLOCK');
  const okAll = results.every((r) => r.ok);
  for (const r of results) console.log('[selftest] ' + (r.ok ? 'PASS' : 'FAIL') + ' · ' + r.name);
  console.log('[selftest] verdict=' + (okAll ? 'ALL-GREEN ' + results.length + '/' + results.length : 'RED') + ' — המגן-מתפקד-כנגד-תבניות-האיום');
  return okAll;
}

/* ═══ CLI ═══ */
async function main() {
  const cmd = process.argv[2];
  const a = process.argv[3];
  if (cmd === 'check-token') return console.log(JSON.stringify(await checkToken(a), null, 1));
  if (cmd === 'check-address') return console.log(JSON.stringify(await checkAddress(a), null, 1));
  if (cmd === 'guard') return console.log(JSON.stringify(await guardTx({ to: a, data: process.argv[4], value: process.argv[5] }), null, 1));
  if (cmd === 'scan-memo') return console.log(JSON.stringify(await scanMemo(process.argv.slice(3).join(' ')), null, 1));
  if (cmd === 'velocity') return console.log(JSON.stringify(velocityCheck(), null, 1));
  if (cmd === 'posture') return console.log(await posture());
  if (cmd === 'selftest') return process.exit(await selftest() ? 0 : 1);
  if (cmd === 'learn-deny') { const st = loadState(); if (!st.deny.includes(a)) st.deny.push(a); saveState(st); return console.log('denied:' + a); }
  if (cmd === 'learn-allow') { const st = loadState(); if (!st.allow.includes(a)) st.allow.push(a); saveState(st); return console.log('allowed:' + a); }
  if (cmd === 'watch') {
    console.log('[shield] watch armed · every 600s');
    for (;;) {
      try { const p = await posture(); console.log(p.split('\n').slice(1).join(' | ')); } catch (e) { console.log('[shield] posture-fail: ' + e.message); }
      await new Promise((r) => setTimeout(r, 600_000));
    }
  }
  console.log('usage: shield.cjs check-token|check-address|guard|scan-memo|velocity|posture|selftest|learn-deny|learn-allow|watch');
}
if (require.main === module) main().catch((e) => { console.error('[shield] fatal: ' + e.message); process.exit(1); });

module.exports = { checkToken, checkAddress, guardTx, scanMemo, guardRelay, velocityCheck, markActivity, validTronAddr, posture, selftest, OUR_DOORS };
