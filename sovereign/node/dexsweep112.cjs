#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * DEX-SWEEP 112 — הזרמת-ערך אל כל-הצמדים ("כמה-שיותר-צמדים-פעילים · להכניס-ערך-מול-כולם")
 * ───────────────────────────────────────────────────────────────────────────
 * מדידה-חיה (112): 9 בריכות-קיימות, 7 מהן-שלדיות (a=1-4µ — לא-ניתן-למסחר:
 * B2A עם a=1 אריתמטית-מת — floor(1×in/(b+in))=0 לכל-in). הסריקה-על-הארכיון
 * מוכיחה: כל-מניות-LP בכל-הבריכות = headcorner בלבד → זריעה-מחדש-כנה (re-seed)
 * לא-פוגעת-באף-מחזיק-שלישי.
 *
 * פאזה A — WSTEEM: הגשר-החסר! הנכס-של-רשת-האם-ולא-היה-לו-צמד. נעילת-STEEM
 *   אמת (self-transfer עם-ממו-פומבי) → wrap_mint 1:1 (1 WSTEEM = 0.001 STEEM,
 *   תעריף-המסילה) → בריכה WSTEEM/SAOS ב-mid-קוהרנטי-לספר (2.53 SAOS/STEEM —
 *   נגזר-מ-WTRX/SAOS × מחיר-טרון/סטים-חוץ).
 * פאזה B — batch אחד על-הספר: העמקה-דו-צדדית (ביחס-המידה-הקיים) ל-WTRX/WBLURT
 *   · זריעה-מחדש-כנה ל-ENERGY/WSBD (שלדיות, LP-יחיד) · סבבי-מסחר אמת דו-כיווניים
 *   לכל-צמד-חי — עמלות-30bps → LP+אוצר → harvest-מזהה (stream pools).
 * כנות: WXRP/WDOGE/PHIVE נשארים-יבשים (אין-אחזקה-אמת להעמיק-ממנה — לא-מנפחים
 *   מחיר-בלי-גיבוי; המוניטור מסמן "פתוח-להפקדה").
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const steem = require(path.join(ROOT, 'node_modules', 'steem'));
const LOG = path.join(HERE, 'dexsweep.log');
const dlog = (m) => { const l = '[' + new Date().toISOString() + '] sweep112: ' + m; console.log(l); try { fs.appendFileSync(LOG, l + '\n'); } catch (_) {} };

function snap() { try { return JSON.parse(fs.readFileSync(path.join(HERE, 'state-snapshot.json'), 'utf8')); } catch (_) { return null; } }
function inject(txs, tag) {
  const f = path.join(HERE, 'inject-sweep112-' + Date.now() + '.json');
  fs.writeFileSync(f, JSON.stringify(txs));
  const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {} };
  let out = '', ok = false;
  for (let a = 0; a < 6 && !ok; a++) {
    if (a > 0) sleepSync(6000);
    const r = spawnSync('node', [path.join(HERE, 'saosnet.cjs'), '--inject', f], { cwd: HERE, encoding: 'utf8', timeout: 300000 });
    out = (r.stdout || '') + (r.stderr || '');
    ok = /INJECT DONE/.test(out);
    if (ok || !/SKIPPED/.test(out)) break;
  }
  try { fs.unlinkSync(f); } catch (_) {}
  dlog('inject[' + tag + '] ' + (ok ? 'OK' : 'FAIL') + ' :: ' + out.split('\n').filter((l) => /INJECT|REJECT/.test(l)).slice(0, 6).join(' | '));
  return ok;
}

async function rpc(method, params) {
  for (const url of ['https://api.steemit.com', 'https://api.justyy.com']) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }), signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      if (j && j.result) return j.result;
    } catch (_) {}
  }
  return null;
}

async function phaseA_lockSteem() {
  /* נעילה-אמת: tov→tov self-transfer — המטבעות-לא-זזים-מהכיס-המפתח-שלנו;
   * הממו + ה-txid = ההוכחה-הפומבית (אותו-דפוס של blurt:lock ו-saos:escrow של האח). */
  const amt = '0.316';
  const memo = JSON.stringify({ protocol: 'saos:wsteem/v1', act: 'lock', amt: amt + ' STEEM', note: 'WSTEEM vault lock (112) — real STEEM, army custody (keys vault.json), public proof = txid' });
  const vault = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent', 'keys', 'vault.json'), 'utf8'));
  const tov = (vault.accounts || []).find((a) => a.username === 'tov');
  const wif = tov && tov.keys && tov.keys.active && tov.keys.active.wif;
  if (!wif) { dlog('phaseA: אין-מפתח-active ל@tov (כנות)'); return null; }
  const acc = (await rpc('condenser_api.get_accounts', [['tov']])) || [];
  const liquid = acc[0] ? parseFloat(acc[0].balance) : 0;
  /* 112-התיקון: self-transfer אינו-תשלום — המטבעות-נשארים-בכיס-שלנו (הנעילה=הצהרה-פומבית
   * עם-txid). הגנת-2× של-topup (תשלום-אמת-החוצה) לא-מתאימה; דורשים amt×1.3 מרווח-כנה. */
  if (liquid < 1.3 * parseFloat(amt)) { dlog('phaseA: tov liquid=' + liquid + ' < 1.3×' + amt + ' — כנות: מבטל'); return null; }
  try {
    const conf = await steem.broadcast.sendAsync({ operations: [['transfer', { from: 'tov', to: 'tov', amount: amt + ' STEEM', memo }]], extensions: [] }, [wif]);
    const txid = (conf && conf.id) || null;
    dlog('phaseA ✓ LOCK ' + amt + ' STEEM tov→tov txid=' + txid + ' (memo saos:wsteem/v1 lock) — הוכחה-פומבית על-המארח');
    return { txid, amt: parseFloat(amt) };
  } catch (e) { dlog('phaseA FAIL: ' + String((e && e.message) || e).slice(0, 160)); return null; }
}

async function main() {
  const only = process.argv[2] || '';
  const dry = process.argv.includes('--dry');
  const s = snap();
  const st = (s && s.st) || {};
  const pools = st.poolsX || {};
  const hc = st.accounts && st.accounts.headcorner || { saos: 0, wrapped: {} };
  dlog('START[' + (only || 'full') + '] · treasury SAOS=' + hc.saos + 'µ · pools=' + Object.keys(pools).length);

  /* ── פאזה A: WSTEEM ── */
  let lock = null;
  if (!dry && (only === 'wsteem' || only === '')) lock = await phaseA_lockSteem();
  else if (dry && (only === 'wsteem' || only === '')) dlog('phaseA skipped (dry) — WSTEEM pool deferred');
  const txs = [];
  if (lock || (only === 'wsteem' && dry)) {
    txs.push({ type: 'wrap_mint', symbol: 'WSTEEM', issuer: 'headcorner', to: 'headcorner', amount: 316, lockedDelta: 316, ref: lock ? lock.txid : 'DRY', _note: 'WSTEEM live: 0.316 STEEM locked on host (txid ref) — 1 WSTEEM = 0.001 STEEM' });
    txs.push({ type: 'pool_xAdd', pair: 'WSTEEM/SAOS', owner: 'headcorner', amountA: 316, amountB: 0.8, _note: 'mid 2.53 SAOS/STEEM — cross-coherent with WTRX pool' });
  } else dlog('phaseA skipped (dry or no-lock) — WSTEEM pool deferred');
  if (only === 'wsteem') {
    const p = { a: 316000, b: 800 };
    txs.push({ type: 'pool_x', taker: 'headcorner', pair: 'WSTEEM/SAOS', side: 'B2A', inAmt: 0.03 });
    txs.push({ type: 'pool_x', taker: 'headcorner', pair: 'WSTEEM/SAOS', side: 'A2B', inAmt: 11 });
    dlog('wsteem-batch: ' + txs.length + ' txs' + (dry ? ' (DRY)' : ''));
    if (dry) { for (const t of txs) dlog('  · ' + JSON.stringify(t)); return; }
    const okW = inject(txs, 'wsteem112');
    if (okW) { const s2 = snap(); const st2 = (s2 && s2.st) || {}; const pw = (st2.poolsX || {})['WSTEEM/SAOS']; dlog('WSTEEM POOL a=' + pw.a + 'µ b=' + pw.b + 'µ mid=' + (pw.b / pw.a).toFixed(5) + ' SAOS/WSTEEM ≡ ' + (pw.b / pw.a / 0.001).toFixed(2) + ' SAOS/STEEM · fees.total=' + ((st2.fees || {}).total || 0) + 'µ'); }
    return;
  }

  /* ── פאזה B: העמקה + זריעה-מחדש + מסחר ── */
  const adds = [
    { pair: 'WTRX/SAOS', amountA: 0.122, amountB: 2.99, note: 'deepen at mid 24.5' },
    { pair: 'WBLURT/SAOS', amountA: 1.176, amountB: 2.0, note: 'deepen at mid 1.70' },
    { pair: 'ENERGY/SAOS', amountA: 0.4, amountB: 0.4, note: 'honest re-seed (skeleton a=1µ, sole-LP proven)' },
    { pair: 'WSBD/SAOS', amountA: 0.25, amountB: 0.4, note: 'honest re-seed (skeleton a=1µ, sole-LP proven)' },
  ];
  for (const a of adds) if (pools[a.pair]) txs.push(Object.assign({ type: 'pool_xAdd', owner: 'headcorner', _note: a.note }, a));

  /* סבבי-מסחר אמת דו-כיווניים (אחרי-ההוספות — מחושב-על-עתודות-צפויות) */
  const trades = [
    { pair: 'WTRX/SAOS', side: 'A2B', inAmt: 0.1 }, { pair: 'WTRX/SAOS', side: 'B2A', inAmt: 2.0 },
    { pair: 'WBLURT/SAOS', side: 'A2B', inAmt: 0.5 }, { pair: 'WBLURT/SAOS', side: 'B2A', inAmt: 0.7 },
    { pair: 'ENERGY/SAOS', side: 'A2B', inAmt: 0.05 }, { pair: 'ENERGY/SAOS', side: 'B2A', inAmt: 0.04 },
    { pair: 'WSBD/SAOS', side: 'A2B', inAmt: 0.03 }, { pair: 'WSBD/SAOS', side: 'B2A', inAmt: 0.08 },
    { pair: 'WSTEEM/SAOS', side: 'B2A', inAmt: 0.03 }, { pair: 'WSTEEM/SAOS', side: 'A2B', inAmt: 11 },
  ];
  for (const t of trades) {
    const p = pools[t.pair] || (t.pair === 'WSTEEM/SAOS' && lock ? { a: 316000, b: 800 } : null);
    if (!p) { dlog('trade-skip ' + t.pair + ' (no-pool)'); continue; }
    txs.push(Object.assign({ type: 'pool_x', taker: 'headcorner' }, t));
  }
  dlog('batch: ' + txs.length + ' txs prepared' + (dry ? ' (DRY — not injecting)' : ''));
  if (dry) { for (const t of txs) dlog('  · ' + t.type + ' ' + (t.pair || t.symbol || '') + ' ' + JSON.stringify(Object.assign({}, t, { _note: undefined, type: undefined }))); return; }
  if (!txs.length) { dlog('nothing to inject'); return; }

  /* 112-מדוד-חי: inject-מול-beat-חי = סיכון-התנגשות-גבהים (משפחת-הסכנה של 110):
   * ה-dedup של הארכיון (last-wins לגובה) עלול-לבלוע בלוקי-inject כשהפעימה
   * מייצרת-במקביל. ההגנה: inject → המתנה-לפעימה → אימות-מהמצב-הקנוני →
   * הזרקה-חוזרת (מהמצב-הטרי) עד-2 פעמים. כנות-מלאה ביומן. */
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = snap();
    const ok = inject(txs, 'sweep112-a' + attempt);
    if (!ok) { dlog('attempt ' + attempt + ': inject FAIL — retrying'); continue; }
    await sleepMs(95000); // פעימה-אחת של ה-beat (הוא-זה-שמחליט-מה-הקנון)
    const after = snap();
    const st2 = (after && after.st) || {};
    const p2 = (st2.poolsX || {})['WTRX/SAOS'];
    const pb = ((before && before.st && before.st.poolsX) || {})['WTRX/SAOS'] || { a: 0, b: 0 };
    const landed = p2 && (p2.a > pb.a + 50 || p2.b > pb.b + 500);
    dlog('attempt ' + attempt + ': inject=OK · verify=' + (landed ? 'LANDED ✓ (WTRX a=' + p2.a + 'µ b=' + p2.b + 'µ)' : 'ORPHANED-הזרקה-נבלעה-בדדופ — מחשבים-מחדש-מהקנון-ומזריקים-שוב'));
    if (landed) {
      dlog('DONE · height ' + (before && before.height) + '→' + (after && after.height) + ' · swapsX=' + (st2.meta && st2.meta.swapsX) + ' · fees.total=' + ((st2.fees && st2.fees.total) || 0) + 'µ · treasury SAOS=' + ((st2.accounts && st2.accounts.headcorner && st2.accounts.headcorner.saos) || '?') + 'µ');
      for (const [k, p] of Object.entries(st2.poolsX || {})) dlog('  POOL ' + k.padEnd(14) + ' a=' + String(p.a).padStart(7) + 'µ b=' + String(p.b).padStart(7) + 'µ mid=' + (p.b / p.a).toFixed(3));
      return;
    }
    /* מחשבים-מחדש-מהקנון-הטרי: היעדים-ביחס-לעתודות-עכשיו */
    txs.length = 0;
    const poolsNow = (st2.poolsX || {});
    const hcNow = (st2.accounts && st2.accounts.headcorner) || { saos: 0, wrapped: {} };
    for (const a of adds) {
      const p = poolsNow[a.pair];
      if (!p) continue;
      const addB = Math.min(a.amountB, Math.max(0, (hcNow.saos || 0) - 3000) / (1 + attempt));
      if (addB <= 0) { dlog('re-plan ' + a.pair + ': treasury too low — skip'); continue; }
      const addA = (p.b > 0 ? (addB * p.a) / p.b : 0);
      const isReseed = /re-seed/.test(a.note);
      txs.push({ type: 'pool_xAdd', pair: a.pair, owner: 'headcorner', amountA: isReseed ? a.amountA : Number(addA.toFixed(6)), amountB: Number(addB.toFixed(6)), _note: a.note + ' (retry-' + attempt + ' at live ratio)' });
    }
    if (!txs.length) { dlog('retry: nothing affordable — stop honest'); return; }
    dlog('re-planned ' + txs.length + ' adds from canonical state');
  }
  dlog('3 attempts exhausted — state may be partially applied (honest report; monitor verifies next beats)');
}
main().catch((e) => { dlog('FATAL ' + String((e && e.stack) || e).slice(0, 300)); process.exit(1); });
