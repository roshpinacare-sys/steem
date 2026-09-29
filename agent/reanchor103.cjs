#!/usr/bin/env node
/* reanchor103.cjs — Task 103: עיגון-מתמשך — המנוע-סוחר-את-הבריכות-החוצה-מהאורקל.
 *
 * הממצא-החי (2026-09-06): REBAL-102 עגן-הכל-ל-±0.1% — תוך-שעות-המנוע-סחר-אותן
 * חזרה-החוצה: WSBD −89.5% · ENERGY −98.7% · poolW −38.9%. עיגון-חד-פעמי לא-מספיק
 * כשיש-מנוע-מסחר-פעיל. התיקון: דיסציפלינת-עיגון-מחזורית (כל-שעה מהלולאה) —
 * אותה-מתמטיקה-שהוכחה-ב-102 (משיכות-LP-יחסיות 50% + השלמה-חד-צדדית-מדויקת),
 * refs חתומי-סבב (rean103:r<N>:*) — אפס-התנגשויות-דדופ · שער-סטייה 5% ·
 * יעד ≤12% · כל-מה-לא-ניתן-לתיקון (אבק-µ בצד-המטבע — PHIVE) נשאר-שלד-מתועד.
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
const OUT = path.join(AGENT_DIR, 'reanchor103_result.json');
const STATE_FILE = path.join(AGENT_DIR, 'reanchor103_state.json');
// 8-b: חשבון-הפעולה חובה מה-env — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/reanchor103.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }

const DEV_ACT = 5;   // מעשה-מעל-סטייה-זו (%)
const DEV_OK = 12;   // יעד-סובלנות (%)
// LIVE-GATE (Task 28-b): DRY by default — beats drive saosnet mutations, so the shared gate
// is required here too (--dry always wins). See DAEMONS.md.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;

const log = (m) => console.log('[rean103] ' + m);
announceGate(GATE, log);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = () => { const s = readJSON(SNAP, null); if (!s || !s.st) throw new Error('no snapshot'); return s.st; };

function saosUsd() {
  const st = snap();
  const node = readJSON(STATE, {});
  const ask = node.book?.asks?.[0]?.price, bid = node.book?.bids?.[0]?.price;
  const mid = ask && bid ? (ask + bid) / 2 : st.meta.lastPrice ? st.meta.lastPrice / 1e6 : 0.0169;
  const steemPx = ((st.assetPrices || {}).WSTEEM || {}).px / 1e9;
  return mid && steemPx ? mid * steemPx : 0;
}

function devOf(key, sUsd) {
  const st = snap();
  const px = (sym) => (((st.assetPrices || {})[sym] || {}).px || 0) / 1e9;
  const isPw = key === 'WTRX/SAOS(pw)';
  const p = isPw ? st.poolW : (st.poolsX || {})[key];
  if (!p || !(p.lpSupply > 0)) return null;
  const a = isPw ? p.wtrx : p.a;
  const b = isPw ? p.saos : p.b;
  const oracle = px(isPw ? 'WTRX' : key.split('/')[0]) / sUsd;
  if (!oracle || !a) return null;
  const ratio = b / a;
  return +(((ratio - oracle) / oracle) * 100).toFixed(1);
}

/* משיכות-LP עד-צד-המטבע-מתדלדל (50%-מגן-קרנל פר-op) */
function planPulls(key, maxPulls) {
  const st = snap();
  const isPw = key === 'WTRX/SAOS(pw)';
  const p = isPw ? st.poolW : (st.poolsX || {})[key];
  if (!p) return null;
  let a = isPw ? p.wtrx : p.a;
  let b = isPw ? p.saos : p.b;
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
  const r = spawnSync('node', ['saosnet.cjs'].concat(DRY ? [] : ['--live']), { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
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
  const stState = readJSON(STATE_FILE, { round: 0 });
  const round = (stState.round || 0) + 1;
  const sUsd = saosUsd();
  if (!sUsd) throw new Error('no SAOS-USD derivable');
  const st = snap();
  const px = (sym) => (((st.assetPrices || {})[sym] || {}).px || 0) / 1e9;

  /* 106 — poolW (WTRX/SAOS(pw)) הוסר-מכאן: ריפוי-ה-LP-pulls (עד a≤1µ) שהוכיח-את-עצמו
   * על-בריכות-הזריעה-הסינתטיות (r102) הרס-את-צד-ה-WTRX-האמיתי של-בריכת-הגשר
   * (r8 מדד: 33µ→2µ WTRX — בריכה-קפואה-באבק מול-מנוע-ה-arb). מ-106: poolW
   * בבעלות-יחידה-של rean106.cjs (ללא-pulls · עוגן-מיושר-למנוע · שער-אוצר-צף). */
  const PAIRS = [
    { key: 'WBLURT/SAOS', sym: 'WBLURT', kind: 'x' },
    { key: 'WSBD/SAOS', sym: 'WSBD', kind: 'x' },
    { key: 'ENERGY/SAOS', sym: 'ENERGY', kind: 'x' },
  ];

  console.log('=== REANCHOR-103 · round ' + round + ' · ' + new Date().toISOString() + (DRY ? ' · DRY' : '') + ' ===');
  console.log('SAOS-USD $' + sUsd.toFixed(8));

  const before = {};
  const acted = [];
  let opsAll = [];
  for (const P of PAIRS) {
    const d0 = devOf(P.key, sUsd);
    before[P.key] = d0;
    if (d0 === null) { console.log('  ' + P.key + ' — no pool / no oracle · skip'); continue; }
    if (Math.abs(d0) <= DEV_ACT) { console.log('  ' + P.key + ' dev ' + d0 + '% ≤ ' + DEV_ACT + '% · already anchored'); continue; }
    const tgt = px(P.sym) / sUsd;
    const pl = planPulls(P.key, 8);
    if (!pl) continue;
    const rmType = P.kind === 'w' ? 'pool_rmw' : 'pool_xRm';
    const addType = P.kind === 'w' ? 'pool_addw' : 'pool_xAdd';
    const ops = pl.pulls.map((p, i) => ({
      type: rmType, owner: ACCOUNT, ...(P.kind === 'w' ? {} : { pair: P.key }), shares: p.sharesµ / 1000,
      ref: 'rean103:r' + round + ':rm:' + P.sym + ':' + (i + 1),
      mirror: 'g98-reanchor',
      note: 'REANCHOR-103 r' + round + ': LP-pull ' + (i + 1) + ' — דילול-הסטייה-שנסחרה (dev היה ' + d0 + '% · יעד ' + tgt.toFixed(1) + ' SAOS/' + P.sym + ')',
    }));
    const isPw = P.kind === 'w';
    const afterA = pl.afterA, afterB = pl.afterB;
    const addS = Math.max(0, Math.round(tgt * afterA) - afterB);
    if (addS > 0) ops.push({
      type: addType, owner: ACCOUNT, ...(isPw ? { amountSaos: addS / 1000, amountWtrx: 0 } : { pair: P.key, amountA: 0, amountB: addS / 1000 }),
      ref: 'rean103:r' + round + ':add:' + P.sym,
      mirror: 'g98-reanchor',
      note: 'REANCHOR-103 r' + round + ': השלמת-צד-SAOS → יחס ' + ((afterB + addS) / Math.max(afterA, 1)).toFixed(1) + ' ≈ אורקל ' + tgt.toFixed(1),
    });
    acted.push({ key: P.key, devBefore: d0, target: +tgt.toFixed(1), pulls: pl.pulls.length, addS });
    opsAll = opsAll.concat(ops);
    console.log('  ' + P.key + ' dev ' + d0 + '% → plan: ' + pl.pulls.length + ' pulls + addS ' + (addS / 1000).toFixed(3));
  }

  let applied = null;
  if (opsAll.length && !DRY) {
    /* מגבלת-הבוס המדודה: ≤12-ops למשימה — שבירה-למנות-חתומות-סבב+חלק */
    const CHUNK = 12;
    const parts = [];
    for (let i = 0; i < opsAll.length; i += CHUNK) parts.push(opsAll.slice(i, i + CHUNK));
    applied = { status: 'applied', results: [] };
    for (let i = 0; i < parts.length; i++) {
      const id = 'REAN-103-r' + round + 'p' + (i + 1);
      issueMission(id, parts[i]);
      const st = await applyAndWait(id);
      applied.status = st.status === 'rejected' && applied.status === 'applied' ? 'partial' : (st.status === 'applied' || st.status === 'partial' ? applied.status : st.status);
      applied.results = applied.results.concat(st.results || []);
    }
  } else if (DRY && opsAll.length) {
    log('DRY — ' + opsAll.length + ' ops planned, not issued');
  }

  await sleep(2000);
  const after = {};
  for (const P of PAIRS) after[P.key] = devOf(P.key, sUsd);
  console.log('dev after: ' + JSON.stringify(after));

  const live = PAIRS.filter((P) => before[P.key] !== null && P.key !== 'WTRX/SAOS(pw)').length;
  const okNow = PAIRS.filter((P) => after[P.key] !== null && Math.abs(after[P.key]) <= DEV_OK).length;
  const result = {
    at: new Date().toISOString(),
    round,
    saosUsd: sUsd,
    devBefore: before,
    devAfter: after,
    acted,
    mission: applied ? { id: 'REAN-103-r' + round, status: applied.status, ok: applied.results.filter((r) => r.ok).length + '/' + applied.results.length } : null,
    dry: DRY,
    anchoredCount: okNow,
    allMatch: okNow >= live && acted.every((a) => Math.abs(after[a.key] ?? 999) <= DEV_OK),
    summaryHe: 'עיגון-מתמשך-סבב ' + round + ': ' + acted.length + ' בריכות-תוקנו · ' + okNow + '/' + live + ' בסטייה ≤' + DEV_OK + '%',
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  stState.round = round;
  stState.lastAt = result.at;
  stState.lastAllMatch = result.allMatch;
  fs.writeFileSync(STATE_FILE, JSON.stringify(stState, null, 2) + '\n');
  log('allMatch=' + result.allMatch + ' · round ' + round + ' recorded');
  console.log(JSON.stringify({ allMatch: result.allMatch, devAfter: after }, null, 1));
})().catch((e) => { log('FATAL ' + e.message); console.error(e); process.exit(1); });
