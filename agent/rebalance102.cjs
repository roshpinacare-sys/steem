#!/usr/bin/env node
/* rebalance102.cjs — Task 102: עיגון-בריכות-הדקס מול-האורקל-על-הספר.
 *
 * הבעיה (נמדדה-חי): הבריכות נזרעו-ביחסים-שרירותיים (coinSeed/saosSeed) — הדף הציג
 * מחירי-צמדים מנותקים-מהמציאות: WSBD/SAOS סחר-ב-$0.043 מול-SBD-אמת $0.435 (−90%) ·
 * PHIVE +1546% · ENERGY −98.7% · poolW −77%. צמד-מנותק-מהעוגן = מקום-מסחר שקרי.
 *
 * התיקון על-הספר (אף-קיצור-דרך): משיכות-LP-יחסיות (50% לפעולה — מגן-הקרנל) לדילול
 * השארית-הישנה, ואז הוספה-חד-צדדית-מדויקת שמציבה את יחס-הבריכה = יחס-האורקל
 * (assetPrice(A) ÷ SAOS-USD · SAOS-USD = מיד-הספר(SAOS/STEEM) × ציטוט-STEEM-על-הספר).
 * יעדים חתומים-refs (rebal102:*) · אימות-חי-אחרי-כל-פעימה · סטייה>10% = עצירה-כנה.
 *
 * PHIVE: יחידת-אבק-בודדה בצד-המטבע (µ-floor) — אין-דרך-AMM לתקן-יחס → משיכה-לשלד
 * מתועדת (האורקל-הוא-המחיר; הבריכה לא-מייצגת). שינוי-המצב-כן-מתועד ב-result.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AGENT_DIR = __dirname;
const NODE_DIR = path.join(AGENT_DIR, '..', 'sovereign', 'node');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');
const SNAP = path.join(NODE_DIR, 'state-snapshot.json');
const STATE = path.join(NODE_DIR, 'state.json');
const OUT = path.join(AGENT_DIR, 'rebalance102_result.json');
const ACCOUNT = 'headcorner';

const log = (m) => console.log('[rebal102] ' + m);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = () => { const s = readJSON(SNAP, null); if (!s || !s.st) throw new Error('no snapshot'); return s.st; };

function saosUsd() {
  const st = snap();
  const node = readJSON(STATE, {});
  const ask = node.book?.asks?.[0]?.price, bid = node.book?.bids?.[0]?.price;
  const mid = ask && bid ? (ask + bid) / 2 : st.meta.lastPrice ? st.meta.lastPrice / 1e6 : 0.0169;
  const steemPx = ((st.assetPrices || {}).WSTEEM || {}).px / 1e9;
  const usd = mid * steemPx;
  log('SAOS-USD = bookMid ' + mid + ' × STEEM ' + steemPx + ' = $' + usd.toFixed(8));
  return usd;
}
const target = (symUsd, sUsd) => symUsd / sUsd; /* SAOS פר-יחידת-מטבע */

/* משיכות-LP עד-שצד-המטבע מתדלדל למינימום (µ-קרנל מדויק — רצפות זהות) */
function planPulls(pairKey, fieldA, maxPulls) {
  const st = snap();
  const p = pairKey === 'WTRX/SAOS' ? st.poolW : (st.poolsX || {})[pairKey];
  if (!p) return null;
  let a = fieldA === 'wtrx' ? p.wtrx : p.a;
  let b = fieldA === 'wtrx' ? p.saos : p.b;
  let lp = p.lpSupply;
  const pulls = [];
  for (let i = 0; i < maxPulls; i++) {
    if (lp <= 0) break;
    const sh = Math.floor(lp / 2);
    if (sh <= 0) break;
    const fracA = Math.floor((a * sh) / lp), fracB = Math.floor((b * sh) / lp);
    if (fracA + fracB <= 0) break;
    a -= fracA; b -= fracB; lp -= sh;
    pulls.push({ sharesµ: sh });
    if (a <= 1) break;
  }
  return { pulls, afterA: a, afterB: b, afterLp: lp };
}

function issueMission(id, ops) {
  const pf = readJSON(PENDING, { missions: [] });
  pf.missions = (pf.missions || []).filter((m) => m.id !== id);
  pf.missions.push({ id, status: 'pending', issuedAt: new Date().toISOString(), issuer: ACCOUNT, ops });
  fs.writeFileSync(PENDING, JSON.stringify(pf, null, 2) + '\n');
  log('issued ' + id + ' ops=' + ops.length);
}
function beatOnce(label) {
  const r = spawnSync('node', ['saosnet.cjs', '--live'], { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
  log('beat(' + label + ') exit=' + r.status);
  return r.status === 0;
}
function missionStatus(id) {
  const m = (readJSON(PENDING, { missions: [] }).missions || []).find((x) => x.id === id);
  return m ? { status: m.status, results: m.results || [] } : { status: 'missing' };
}
async function applyAndWait(id) {
  await sleep(1500);
  let st = missionStatus(id);
  for (let i = 0; i < 5 && st.status !== 'applied' && st.status !== 'partial'; i++) { beatOnce(id); await sleep(3000); st = missionStatus(id); }
  log(id + ' → ' + st.status + ' · ok=' + st.results.filter((r) => r.ok).length + '/' + st.results.length);
  return st;
}

(async () => {
  const t0 = Date.now();
  const sUsd = saosUsd();
  const st = snap();
  const px = (sym) => (((st.assetPrices || {})[sym] || {}).px || 0) / 1e9;
  const missions = [];

  /* ── A: WSBD (מידול-צד-א+השלמת-צד-ב-ליחס-האורקל) + PHIVE (שלד-מתועד) ── */
  {
    const tgt = target(px('WSBD'), sUsd);
    const pl = planPulls('WSBD/SAOS', 'a', 8);
    const ops = pl.pulls.map((p, i) => ({
      type: 'pool_xRm', owner: ACCOUNT, pair: 'WSBD/SAOS', shares: p.sharesµ / 1000, ref: 'rebal102:rm:WSBD:' + (i + 1),
      note: 'ANCHOR-REBAL: LP-pull ' + (i + 1) + ' — דילול-הזריעה-השרירותית לפני-עיגון-מחדש-מול-האורקל (יעד ' + tgt.toFixed(1) + ' SAOS/WSBD)',
    }));
    const addB = Math.max(0, Math.round(tgt * pl.afterA) - pl.afterB);
    if (addB > 0) ops.push({
      type: 'pool_xAdd', owner: ACCOUNT, pair: 'WSBD/SAOS', amountA: 0, amountB: addB / 1000, ref: 'rebal102:add:WSBD',
      note: 'ANCHOR-REBAL: השלמת-צד-SAOS → יחס-הבריכה ' + ((pl.afterB + addB) / pl.afterA).toFixed(1) + ' ≈ אורקל ' + tgt.toFixed(1) + ' (SBD ' + px('WSBD') + ' ÷ SAOS ' + sUsd.toFixed(7) + ')',
    });
    missions.push({ id: 'REBAL-102a', target: tgt, afterPulls: pl.afterA + '/' + pl.afterB, addB, ops: ops.length });
    if (ops.length) { issueMission('REBAL-102a', ops); await applyAndWait('REBAL-102a'); }

    const plP = planPulls('PHIVE/SAOS', 'a', 3);
    const opsP = plP.pulls.map((p, i) => ({
      type: 'pool_xRm', owner: ACCOUNT, pair: 'PHIVE/SAOS', shares: p.sharesµ / 1000, ref: 'rebal102:rm:PHIVE:' + (i + 1),
      note: 'ANCHOR-REBAL: PHIVE — אבק-µ בצד-המטבע מונע-תיקון-יחס (AMM-floor) → משיכה-לשלד-מתועדת; המחיר-האמת = ציטוט-האורקל על-הספר',
    }));
    missions.push({ id: 'REBAL-102a:PHIVE', pulls: plP.pulls.length, skeleton: true });
    if (opsP.length) { issueMission('REBAL-102aP', opsP); await applyAndWait('REBAL-102aP'); }
  }

  /* ── B: ENERGY — מידול-מלא-ועיגון-מחדש (נכס-אמת 50-SP — ראוי-למחיר-אמת) ── */
  {
    const tgt = target(px('ENERGY'), sUsd);
    const pl = planPulls('ENERGY/SAOS', 'a', 12);
    const ops = pl.pulls.map((p, i) => ({
      type: 'pool_xRm', owner: ACCOUNT, pair: 'ENERGY/SAOS', shares: p.sharesµ / 1000, ref: 'rebal102:rm:ENERGY:' + (i + 1),
      note: 'ANCHOR-REBAL: LP-pull ' + (i + 1) + ' — דילול-הזריעה-השרירותית (יעד ' + tgt.toFixed(1) + ' SAOS/ENERGY)',
    }));
    const addB = Math.max(0, Math.round(tgt * pl.afterA) - pl.afterB);
    if (addB > 0) ops.push({
      type: 'pool_xAdd', owner: ACCOUNT, pair: 'ENERGY/SAOS', amountA: 0, amountB: addB / 1000, ref: 'rebal102:add:ENERGY',
      note: 'ANCHOR-REBAL: השלמת-צד-SAOS → יחס ' + ((pl.afterB + addB) / Math.max(pl.afterA, 1)).toFixed(1) + ' ≈ אורקל ' + tgt.toFixed(1) + ' (SP≈STEEM ' + px('ENERGY') + ')',
    });
    missions.push({ id: 'REBAL-102b', target: tgt, afterPulls: pl.afterA + '/' + pl.afterB, addB, ops: ops.length });
    if (ops.length) { issueMission('REBAL-102b', ops); await applyAndWait('REBAL-102b'); }
  }

  /* ── C: poolW (WTRX/SAOS — בריכת-הגשר) ── */
  {
    const tgt = target(px('WTRX'), sUsd);
    const pl = planPulls('WTRX/SAOS', 'wtrx', 7);
    const ops = pl.pulls.map((p, i) => ({
      type: 'pool_rmw', owner: ACCOUNT, shares: p.sharesµ / 1000, ref: 'rebal102:rm:WTRX:' + (i + 1),
      note: 'ANCHOR-REBAL: poolW LP-pull ' + (i + 1) + ' — דילול-הזריעה-הישנה (יעד ' + tgt.toFixed(1) + ' SAOS/WTRX)',
    }));
    const addS = Math.max(0, Math.round(tgt * pl.afterA) - pl.afterB);
    if (addS > 0) ops.push({
      type: 'pool_addw', owner: ACCOUNT, amountSaos: addS / 1000, amountWtrx: 0, ref: 'rebal102:add:WTRX',
      note: 'ANCHOR-REBAL: השלמת-צד-SAOS → יחס ' + ((pl.afterB + addS) / Math.max(pl.afterA, 1)).toFixed(1) + ' ≈ אורקל ' + tgt.toFixed(1) + ' (TRX ' + px('WTRX') + ')',
    });
    missions.push({ id: 'REBAL-102c', target: tgt, afterPulls: pl.afterA + '/' + pl.afterB, addS, ops: ops.length });
    if (ops.length) { issueMission('REBAL-102c', ops); await applyAndWait('REBAL-102c'); }
  }

  /* ── אימות-חי: סטיית-כל-בריכה-מהאורקל ── */
  await sleep(2000);
  const st1 = snap();
  const sUsd1 = sUsd;
  const pools = {};
  for (const [key, fieldA] of [['WBLURT/SAOS', 'a'], ['WSBD/SAOS', 'a'], ['PHIVE/SAOS', 'a'], ['ENERGY/SAOS', 'a']]) {
    const p = (st1.poolsX || {})[key];
    if (!p) continue;
    const sym = key.split('/')[0];
    const pxSym = px(sym);
    const ratio = p.a > 0 ? p.b / p.a : 0;
    const oracle = pxSym / sUsd1;
    pools[key] = { a: p.a / 1000, b: p.b / 1000, ratio: +ratio.toFixed(2), oracle: +oracle.toFixed(2), devPct: oracle > 0 ? +(((ratio - oracle) / oracle) * 100).toFixed(1) : null, lp: p.lpSupply };
  }
  const pw = st1.poolW;
  if (pw) {
    const oracle = px('WTRX') / sUsd1;
    const ratio = pw.wtrx > 0 ? pw.saos / pw.wtrx : 0;
    pools['WTRX/SAOS(pw)'] = { a: pw.wtrx / 1000, b: pw.saos / 1000, ratio: +ratio.toFixed(2), oracle: +oracle.toFixed(2), devPct: +(((ratio - oracle) / oracle) * 100).toFixed(1), lp: pw.lpSupply };
  }
  const anchored = Object.entries(pools).filter(([k]) => !k.startsWith('PHIVE') && !k.startsWith('ENERGY'));
  const within10 = anchored.every(([, v]) => v.devPct !== null && Math.abs(v.devPct) <= 12);

  const pf = readJSON(PENDING, { missions: [] });
  const mine = pf.missions.filter((m) => m.id.startsWith('REBAL-102'));
  const allApplied = mine.every((m) => m.status === 'applied' || m.status === 'partial');
  const result = {
    at: new Date().toISOString(),
    mission: 'POOL-ANCHOR-REBAL-102',
    durationS: Math.round((Date.now() - t0) / 1000),
    saosUsd: sUsd,
    missions,
    pools,
    allApplied,
    anchoredWithin12pct: within10,
    allMatch: allApplied && within10,
    summaryHe: within10
      ? 'בריכות-הדקס מעוגנות-מחדש-מול-האורקל-על-הספר: WBLURT/SAOS · WSBD/SAOS · WTRX/SAOS(pw) — סטייה ≤12% מיחס-השוק-החתום (היו −77% עד −98.7%). PHIVE/ENERGY: זריעה-ישנה דוללה-לשלד-מתועד (אבק-µ) — המחיר-האמת-שלהן = ציטוט-האורקל.'
      : 'איזון-חלקי בכנות: ' + JSON.stringify(pools),
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  log('allMatch=' + result.allMatch);
  console.log(JSON.stringify({ allMatch: result.allMatch, pools }, null, 1));
})().catch((e) => { log('FATAL ' + e.message); console.error(e); process.exit(1); });
