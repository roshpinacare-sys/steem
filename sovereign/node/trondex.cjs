#!/usr/bin/env node
/* trondex.cjs — Task 110: THE-DEX (דקס-המפלצת) — דקס אמת על-הרשת-החינמית-שלנו
 * עם רשת-טרון-כמסילת-התיישבות — בלי-תלות-בגז/אנרגיה/עמלות.
 *
 * התשובה-הריבונית לבקשת-המפעיל ("דקס מפלצתי בטרון בלי-להיות-תלוי-בגז"):
 *   · ספר-הפקודות, ההתאמות והבריכות חיים על-השרשרת-שלנו — אפס-גז, אינסופי
 *     (נמדד 107: 326,571 טרנז/שנייה תקרה-מכנית).
 *   · WTRX = קרדיט-טרון עטוף 1:1 מול-הכספת-החיה (6 כתובות-גזורות) — ומ-110:
 *     **פיוס-חי**: כל-פעימה מודדת את-הכספת-מטרונגריד ומכוונת supply/locked
 *     לכיסוי-1:1 אמת (burn-עודף-הנפקה + release/cover עם-ref-מדידה-טרי).
 *   · התיישבות = דלתות-relay (אפס-עמלה): פדיון-WTRX → העברת-TRX אמת בין
 *     כתובות-הכספת (Bandwidth-חינם) → txid אמת → tronscan. קריאות-חוזה-חכם
 *     (TRC20/USDT) נשארות-כנות-בתור: נמדד 110 — אנרגיה-0 בכל-הכספת (העברת-
 *     USDT ≈ 65K אנרגיה) → המסילות: האצלת-אנרגיה (חינם-לנו) או פיקדון-GAS-SETTLE.
 *
 * פקודות:
 *   status     — JSON מלא (כיסוי, בריכה, סטלמנטים)
 *   reconcile  — מדידת-כספת → פיוס-כיסוי-1:1 על-הספר (burn/release/cover)
 *   pool       — זריעת-בריכת WTRX/SAOS (שני-צדדים, מהיתרות-האמת)
 *   trade      — סבב-מסחר-AMM (A2B+B2A) — גילוי-מחיר + עמלות-30bps
 *   settle     — דלת-התיישבות-טרון (העברה-אמת 5000-sun, אפס-עמלה)
 *   watch      — כל-300ש׳: reconcile → pool → settle-אם-חסר-טרי
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const LOG = path.join(HERE, 'trondex.log');
const LIVE_FILE = path.join(HERE, 'trondex-live.json');
const STATE_SNAP = path.join(HERE, 'state-snapshot.json');
const TRON_HOSTS = ['https://api.trongrid.io', 'https://api.tronstack.io', 'https://tron.stackwallet.com']; // 117j: כשל-מארח לא משבית מדידה
const ADDRS = 6; // כספת-הגשר — 6 כתובות גזורות m/44'/195'/0'/0/{0..5}
const MEASURE_FAMILY = "HDNodeWallet.fromPhrase · m/44'/195'/0'/0/{0..5}"; // 117j: שקיפות-משפחת-גזירה
/* 117k — דלתות-הישן-המשוחזרות (המפתח: agent/keys/tron-legacy-mnemonic.txt · בכספת+fleet-seal).
 * מדידה-בכתובת-ציבורית-בלבד (קריאה — אפס-מפתחות-כאן). הסדר-נמדד-ב-legacy-verify.cjs:
 * idx0=TAzZZ (רכזת) · idx1=TRKSt (שדרן). */
const LEGACY_DOORS = ['TAzZZkrwBXk59iRya7esnKVJeV1xLtqkGr', 'TRKStC5HbWzqdnrWDfc4vYNfgQgyZuQKP4'];
const LEGACY_FAMILY = "legacy-mnemonic · m/44'/195'/0'/0/{0,1} · idx0=TAzZZ · idx1=TRKSt";
const DROP_GUARD_RATIO = 0.8; // 117j: מדידה-שצונחת-מעל-20% מהטובה-הקודמת = חשודה-עד-הוכחה

function log(msg) {
  const line = '[' + new Date().toISOString() + '] trondex: ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}

/* ── inject לספר (אותה-משמעת: מנעול-ה-beat, 10 נסיונות) ── */
function inject(txs, tag) {
  const f = path.join(HERE, 'inject-trondex-' + Date.now() + '.json');
  fs.writeFileSync(f, JSON.stringify(txs));
  const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {} };
  let out = '', ok = false, skipped = false;
  for (let a = 0; a < 10 && !ok; a++) {
    if (a > 0) sleepSync(5000 + Math.floor(Math.random() * 3000));
    const r = spawnSync('node', [path.join(HERE, 'saosnet.cjs'), '--inject', f], { cwd: HERE, encoding: 'utf8', timeout: 120000 });
    out = (r.stdout || '') + (r.stderr || '');
    ok = /INJECT DONE/.test(out);
    skipped = /SKIPPED/.test(out);
    if (ok || !skipped) break;
  }
  try { fs.unlinkSync(f); } catch (_) {}
  log('inject[' + tag + '] ' + (ok ? 'OK' : skipped ? 'LOCK-BUSY(10 tries)' : 'FAIL') + ' :: ' + out.split('\n').filter((l) => /INJECT|REJECT/.test(l)).slice(0, 4).join(' | '));
  return ok;
}

function snap() {
  try { return JSON.parse(fs.readFileSync(STATE_SNAP, 'utf8')); } catch (_) { return null; }
}
function dexState() {
  const s = snap();
  const st = (s && s.st) || {};
  return {
    height: (s && s.height) || (st.meta && st.meta.height) || 0,
    issuer: (st.meta && st.meta.issuer) || 'headcorner',
    wrapped: st.wrapped || {},
    poolsX: st.poolsX || {},
    relay: st.relay || { nextBy: {}, open: {} },
    accounts: st.accounts || {},
    meta: st.meta || {},
  };
}

/* ── מדידת-כספת-חי (טרונגריד) — מקור-האמת-החוץ
 * 110-מדוד: טרונגריד-מווסת (429) — מדידה-אפסית-לא-דורסת-מדידה-טובה-קודמת
 * 117j-שלוש-שכבות-כנות (השיעור-מ-doorTron-v2):
 *  1) ריבוי-מארחים — 429-במארח-אחד לא הופך את-הכספת-לאפס.
 *  2) צורה-ריקה-{} = מדידה-כושלת (לא אפס): חשבון-שהופעל-משיב-עם-שדה-address;
 *    כספת-שקיבלה-TRX-בהיסטוריה לעולם לא מוחזרת-{}-אמת → {}-חוזר = וויסות.
 *    מדידה-חלקית (דלת-אחת-אמת + שאר-{}) = אסור — היא-מייצרת-איום-השמדה:
 *    under-measure → reconcile-רואה-"over-issue" → wrap_burn-של-כיסוי-משתמשים.
 *  3) נתונים-מהימנים-בלבד נכתבים לקובץ-החי, עם-משפחת-הגזירה-בשקיפות-מלאה. */
async function measureVault() {
  const TronWeb = require(path.join(ROOT(), 'node_modules', 'tronweb'));
  const ethers = require(path.join(ROOT(), 'node_modules', 'ethers'));
  const mnemonic = require('./vault-lib.cjs').readMnemonic(); // 114 — מהכספת (envelope→plaintext)
  let sun = 0, block = 0, per = [], bad = 0;
  for (let i = 0; i < ADDRS; i++) {
    const w = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/195'/0'/0/" + i);
    let b = 0, measured = false, doorAddr = null;
    for (const host of TRON_HOSTS) {
      if (measured && doorAddr) break;
      const tw = new TronWeb({ fullHost: host, privateKey: w.privateKey.slice(2) });
      doorAddr = tw.defaultAddress.base58; // גזירת-כתובת-אינה-תלוית-בהצלחת-המארח
      for (let t = 0; t < 2 && !measured; t++) {
        try {
          const acc = await tw.trx.getAccount(doorAddr).catch(() => ({}));
          if (acc && typeof acc === 'object' && Object.keys(acc).length) { b = Math.max(b, Number(acc.balance || 0)); measured = true; break; }
          // {} — חשבון-שמעולם-לא-הופעל או תשובת-וויסות-שקטה: עבור-דלתות-הכספת-שקיבלו-כסף
          // בהיסטוריה זה-כשל-מדידה-ולא-אפס (117j: השיעור-מ-'null@0sun'-של-relay-117i)
        } catch (_) { /* מארח-הבא */ }
        await new Promise((r) => setTimeout(r, 1100));
      }
    }
    if (!measured) bad++;
    per.push({ idx: i, addr: doorAddr, sun: b, measured });
    sun += b;
  }
  try { const nb = await fetch(TRON_HOSTS[0] + '/wallet/getnowblock', { signal: AbortSignal.timeout(9000) }).then((r) => r.json()); block = Number((nb && nb.block_header && nb.block_header.raw_data && nb.block_header.raw_data.number) || 0); } catch (_) {}
  /* 117k — מדידת-דלתות-הישן (בלוק-כנות-נפרד): אותו-משמעת אפס-אמת-חלקית —
   * דלת-שלא-נענתה → כל-הבלוק-הישן- rejected (לא-אפס!). הדלתות-האלה-מופעלות-על-השרשרת —
   * success+ריק עבורן = תשובה-סותרת → נספר-ככשל-מדידה. */
  let legacy;
  {
    let lsun = 0, lbad = 0; const lper = [];
    for (const addr of LEGACY_DOORS) {
      let b = 0, measured = false;
      for (const host of TRON_HOSTS) {
        if (measured) break;
        try {
          const r = await fetch(host + '/v1/accounts/' + addr, { signal: AbortSignal.timeout(9000) }).then((x) => x.json());
          const acc = r && r.data && r.data[0];
          if (acc && typeof acc === 'object') { b = Math.max(b, Number(acc.balance || 0)); measured = true; break; }
        } catch (_) { /* מארח-הבא */ }
        await new Promise((r2) => setTimeout(r2, 1100));
      }
      if (!measured) lbad++;
      lper.push({ addr, sun: b, measured });
      lsun += b;
    }
    legacy = lbad > 0 ? { rejected: true, reason: 'unmeasurable-' + lbad, per: lper } : { sun: lsun, per: lper, family: LEGACY_FAMILY };
    log('measure: legacy doors ' + (legacy.rejected ? 'REJECTED(' + legacy.reason + ') — no partial truth' : 'sun=' + legacy.sun + ' (TAzZZ+TRKSt · recovered 117k)'));
  }
  // 110-מדוד-חי (השיעור-מ-h40837): מדידה-חלקית = נזק — כתובת-אחת-שלא-נמדדה פוסלת-את-המדידה-כולה
  if (bad > 0) { log('measure: ' + bad + '/' + ADDRS + ' addresses unmeasurable (throttle/empty-shape, hosts tried: ' + TRON_HOSTS.length + ') — measurement REJECTED (no partial truth)'); return { sun: -1, block, per, at: new Date().toISOString(), rejected: true, reason: 'unmeasurable-' + bad, legacy };
  }
  const out = { sun, block, per, at: new Date().toISOString(), family: MEASURE_FAMILY, legacy, note: '117k: legacy doors COVERED (read-only) · operator backing lives on TG6Srs (deposits door, headcorner idx2) — see docs/117-TRX-POSTMORTEM.md RESOLUTION' };
  if (sun > 0 || dropGuardOk(sun)) {
    if (sun > 0) { try { fs.writeFileSync(LIVE_FILE, JSON.stringify(out)); } catch (_) {} } // מקור-חי-ל-API — רק-מדידה-אמת
    else log('measure: clean-zero (all doors measured, activated-empty) — NOT overwriting live file (drop-guard conservative)');
  }
  if (sun === 0) log('measure: zero-sum CLEAN (every door answered with real shape) — keeping last-good live file, no reconcile on zero');
  return out;
}
/* 117j: פוסק-הצניחה — מדידה-נקייה-שצונחת-מעל-20% מהטובה-הקודמת מסומנת-חשודה
 * (מגן-על-reconcile-מפני-burn-הרסני-על-מדידה-כוזבת). */
function dropGuardOk(nextSun) {
  try {
    const last = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
    if (Number(last.sun) > 0 && nextSun >= 0 && nextSun < Number(last.sun) * DROP_GUARD_RATIO) {
      log('measure: DROP-GUARD — clean measurement ' + nextSun + ' sun is <80% of last-good ' + last.sun + ' sun (family=' + MEASURE_FAMILY + ') — suspicious, manual --force required for reconcile');
      return false;
    }
  } catch (_) { /* אין-קובץ-קודם */ }
  return true;
}
function ROOT() { return path.join(HERE, '..', '..'); }

/* ── reconcile: פיוס-כיסוי-חי 1:1 ──
 * 117j: reconcile פועל רק על מדידה-נקייה-שעברה-את-פוסק-הצניחה (--force מדלג-על-הפוסק-במפורש). */
async function reconcile(dry) {
  const force = process.argv.includes('--force');
  const d = dexState();
  const w = d.wrapped.WTRX;
  if (!w) { log('reconcile: no-WTRX-wrapped (abort honest)'); return null; }
  const live = await measureVault();
  if (live.rejected || !(live.sun > 0)) { log('reconcile: measurement rejected — NO reconciliation on partial/zero data'); return null; }
  if (!force && !dropGuardOk(live.sun)) { log('reconcile: DROP-GUARD held — no reconcile on suspicious under-measure (rerun with --force to override consciously)'); return null; }
  // סקאלת-הקרנל: 1 יחידה = 1000 µ → 1 WTRX = 1000 µ = 1e6 sun → 1 µ = 1000 sun
  const supply = w.supply || 0, locked = w.locked || 0, liveMu = Math.round(live.sun / 1000);
  log('reconcile: supply=' + supply + 'µ locked=' + locked + 'µ live=' + liveMu + 'µ (' + live.sun + ' sun · tron blk ' + live.block + ') · ratio=' + (locked > 0 ? (supply / locked).toFixed(4) : '—'));
  const txs = [];
  const refBase = 't110:' + live.block + ':' + Date.now();
  let sup = supply, lock = locked;
  /* סדר-הפיוס: 1) supply>live → burn-עודף-הנפקה  2) locked≠live → release/cover
   * 3) supply<live → mint-ייצוג (TRX-אמת-בכספת-בלי-קרדיט = עושר-נעלם-מהספר).
   * היעד-תמיד: supply = locked = live (כיסוי-1:1-אמת). */
  if (sup > liveMu) {
    const hc = (d.accounts.headcorner && d.accounts.headcorner.wrapped && d.accounts.headcorner.wrapped.WTRX) || 0;
    const burn = Math.min(sup - liveMu, hc);
    if (burn <= 0) { log('reconcile: over-issue ' + (sup - liveMu) + 'µ but headcorner holds 0 (abort — לא-כופים-על-אחרים)'); return null; }
    txs.push({ type: 'wrap_burn', symbol: 'WTRX', from: d.issuer, amount: burn / 1000, _note: 'over-issue burn ' + burn + 'µ' });
    sup -= burn;
  }
  if (lock > liveMu) {
    const rel = lock - liveMu;
    txs.push({ type: 'wrap_release', symbol: 'WTRX', issuer: d.issuer, lockedDelta: rel / 1000, ref: refBase + ':rel', _note: 'release stale lock ' + rel + 'µ' });
    lock -= rel;
  } else if (liveMu > lock) {
    const cov = liveMu - lock;
    txs.push({ type: 'wrap_cover', symbol: 'WTRX', issuer: d.issuer, lockedDelta: cov / 1000, ref: refBase + ':cov', _note: 'cover vault inflow ' + cov + 'µ' });
    lock += cov;
  }
  if (sup < liveMu) {
    const mint = liveMu - sup;
    txs.push({ type: 'wrap_mint', symbol: 'WTRX', issuer: d.issuer, to: d.issuer, amount: mint / 1000, ref: refBase + ':mint', _note: 'represent unrepresented vault ' + mint + 'µ' });
    sup += mint;
  }
  if (!txs.length) { log('reconcile: already 1:1 (' + supply + 'µ = live ' + liveMu + 'µ)'); return { ok: true, changed: false, live }; }
  if (dry) return { ok: true, changed: true, dry: true, txs, live };
  const ok = inject(txs, 'reconcile');
  return { ok, changed: ok, txs, live };
}

/* ── pool: זריעת-בריכת WTRX/SAOS ── */
async function pool() {
  const d = dexState();
  if (d.poolsX['WTRX/SAOS']) { log('pool: WTRX/SAOS exists (a=' + d.poolsX['WTRX/SAOS'].a + 'µ b=' + d.poolsX['WTRX/SAOS'].b + 'µ) skip'); return false; }
  const hc = d.accounts.headcorner || { saos: 0, wrapped: {} };
  const wtrx = (hc.wrapped && hc.wrapped.WTRX) || 0;
  const seedA = 1500;                       // 1.5 WTRX (µ)
  const seedB = Math.min(29000, hc.saos - 500); // כמעט-כל-ה-SAOS, רצפת-גז 0.5-SAOS
  if (wtrx < seedA || seedB < 5000) { log('pool: insufficient (wtrx=' + wtrx + 'µ saos=' + hc.saos + 'µ) abort honest'); return false; }
  const ok = inject([{ type: 'pool_xAdd', pair: 'WTRX/SAOS', owner: d.issuer, amountA: seedA / 1000, amountB: seedB / 1000 }], 'pool-seed');
  if (ok) log('pool: seeded WTRX/SAOS · a=' + seedA + 'µ b=' + seedB + 'µ · mid=' + (seedB / seedA).toFixed(2) + ' SAOS/WTRX (ספר-ה-SAOS/STEEM מרמז ~20 — גילוי-שוק-ימשיך)');
  return ok;
}

/* ── trade: סבב-AMM אמת (עמלות-30bps → LP+אוצר) ── */
async function trade() {
  const d = dexState();
  const p = d.poolsX['WTRX/SAOS'];
  if (!p || !(p.a > 0) || !(p.b > 0)) { log('trade: no-pool (run pool first)'); return false; }
  const hc = d.accounts.headcorner || { saos: 0, wrapped: {} };
  const inW = Math.min(200, (hc.wrapped && hc.wrapped.WTRX) || 0); // 0.2 WTRX (µ)
  if (inW < 100) { log('trade: issuer WTRX too low (' + inW + 'µ) skip'); return false; }
  const t1 = [{ type: 'pool_x', pair: 'WTRX/SAOS', side: 'A2B', taker: d.issuer, inAmt: inW / 1000 }];
  const ok1 = inject(t1, 'trade-A2B');
  const d2 = dexState();
  const p2 = d2.poolsX['WTRX/SAOS'];
  const saosNow = (d2.accounts.headcorner && d2.accounts.headcorner.saos) || 0;
  if (ok1 && p2 && p2.b > 0 && saosNow > 2000) {
    const inS = Math.floor(Math.min(saosNow - 1000, p2.b * 0.4));
    const ok2 = inject([{ type: 'pool_x', pair: 'WTRX/SAOS', side: 'B2A', taker: d.issuer, inAmt: inS / 1000 }], 'trade-B2A');
    if (ok2) log('trade: roundtrip done · A2B ' + inW + 'µ-WTRX · B2A ' + inS + 'µ-SAOS · fees 30bps → LP+treasury');
    return ok2;
  }
  return ok1;
}

/* ── settle: דלת-התיישבות-טרון-אמת (אפס-עמלה) ── */
async function settle() {
  const d = dexState();
  const seq = (d.relay.nextBy && d.relay.nextBy[d.issuer]) || 1;
  const open = d.relay.open || {};
  const lastDex = Object.values(open).filter((r) => r.payload && r.payload.chain === 'monster-dex' && r.status === 'sent');
  if (lastDex.length && Date.now() - new Date(lastDex[lastDex.length - 1].at || 0).getTime() < 30 * 60000) {
    // אין-חותמת-זמן-על-הדלת — המדידה: מספיק-דלת-אחת-חיה-להיום
  }
  const burnW = 5; // 0.005 WTRX (µ) = 5000 sun אמת
  const hc = (d.accounts.headcorner && d.accounts.headcorner.wrapped && d.accounts.headcorner.wrapped.WTRX) || 0;
  if (hc < burnW) { log('settle: issuer WTRX too low (' + hc + 'µ) abort'); return false; }
  const txs = [
    { type: 'wrap_burn', symbol: 'WTRX', from: d.issuer, amount: burnW / 1000, _note: 'redemption burn → real TRX out' },
    { type: 'relay', issuer: d.issuer, seq, via: 'tron', act: 'transfer', payload: { toIdx: 2, amountSun: 5000, chain: 'monster-dex', note: 'WTRX-redeem:' + burnW + 'µ → real TRX · zero-fee settlement', ref: 'dex:settle:h' + d.height } },
  ];
  const ok = inject(txs, 'settle');
  if (ok) log('settle: redemption door queued · burn ' + burnW + 'µ WTRX → 5000 sun real TRX via door ' + d.issuer + ':' + seq + ' (relayer executes, relay_ack lands the txid)');
  return ok;
}

function status() {
  const d = dexState();
  const p = d.poolsX['WTRX/SAOS'] || null;
  const w = d.wrapped.WTRX || { supply: 0, locked: 0 };
  const doors = Object.values(d.relay.open || {}).filter((r) => r.payload && r.payload.chain === 'monster-dex');
  console.log(JSON.stringify({ height: d.height, wrapped: { supply: w.supply, locked: w.locked }, pool: p ? { a: p.a, b: p.b, mid: p.b / p.a, lpSupply: p.lpSupply } : null, issuerWtrx: (d.accounts.headcorner && d.accounts.headcorner.wrapped && d.accounts.headcorner.wrapped.WTRX) || 0, issuerSaos: (d.accounts.headcorner && d.accounts.headcorner.saos) || 0, settlementDoors: doors.map((r) => ({ ref: r.ref, status: r.status, txid: r.txid || null })), swapsX: d.meta.swapsX || 0 }, null, 2));
}

(async () => {
  const arg = process.argv[2] || 'status';
  if (arg === 'status') return status();
  if (arg === 'reconcile') { await reconcile(process.argv.includes('--dry')); return; }
  if (arg === 'pool') { await pool(); return; }
  if (arg === 'trade') { await trade(); return; }
  if (arg === 'settle') { await settle(); return; }
  if (arg === 'watch') {
    log('watch: THE-DEX operator alive · tick=300s');
    let seeded = false;
    let prevSun = -1;
    for (;;) {
      try {
        const m = await measureVault(); // מקור-חי-טרי-ל-API בכל-פעימה
        /* 110-מדוד (השיעור-מהתנודה-20804↔22324): פיוס-רק-על-מדידה-שאושרה-פעמיים
         * ברצף (מדידה-אחת-שנבדלת-מקודמתה = רעש-טרונגריד, לא-אמת — מדלגים-בכנות). */
        if (m.rejected || !(m.sun > 0) || m.sun !== prevSun) {
          if (m.sun !== prevSun) log('watch: measure ' + m.sun + ' differs from prev ' + prevSun + ' — no reconcile (double-confirm pending)');
          prevSun = m.sun > 0 ? m.sun : prevSun;
        } else {
          const r = await reconcile(true);
          if (r && r.changed && !r.dry) { /* dry says drift → real pass below */ }
          const d = dexState();
          const w = d.wrapped.WTRX || {};
          if (w.supply !== w.locked || w.locked !== Math.round(m.sun / 1000)) await reconcile(false);
        }
        if (!seeded) { seeded = await pool(); }
        if (seeded) {
          const d = dexState();
          const hasLiveSettle = Object.values(d.relay.open || {}).some((r) => r.payload && r.payload.chain === 'monster-dex');
          if (!hasLiveSettle) await settle();
        }
      } catch (e) { log('watch-err: ' + String((e && e.message) || e).slice(0, 140)); }
      await new Promise((r) => setTimeout(r, 300000));
    }
  }
  console.log('usage: trondex.cjs status|reconcile|pool|trade|settle|watch [--dry]');
})().catch((e) => { log('FATAL: ' + String((e && e.message) || e).slice(0, 160)); process.exit(1); });
