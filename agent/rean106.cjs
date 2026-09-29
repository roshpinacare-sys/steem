#!/usr/bin/env node
/* rean106.cjs — Task 106: poolW-REBUILD על-הליניאגה-החיה + אימות-מול-המצב-בפועל.
 *
 * הממצא-החי (2026-09-06 20:2x): REAN-103-r6/r7 דווחו "applied ok" אבל-האפקט-לא-חי
 * במצב — קריסת-הסשן-הרגה-את-הדמון, הדמון-החדש-עשה-replay-מהג'נזיס (snapshot-אחד
 * שנשחת-באמצע-כתיבה), ה-replay-דחה-ops-אחרי-פערי-הארכיון (703-709) → מצב-רפאים:
 * poolW חזר-ל-µ-אבק (33µWTRX/17µSAOS · px 0.5 מול-אורקל ~430 · סטייה −99.9%).
 * זהו-דפוס-רוח-הרפאים-של-104 — אבל-הפעם-בשער-הפעלה-מחדש.
 *
 * התיקון-הכפול (מדידה-קודם-כל):
 *  A. saosnet.cjs — שרשרת-החזרה root→snapshot→prev→replay + כתיבה-אטומית +
 *     קידום-שורש (state-root.json) — אמנזיית-הפעלה-מחדש נסגרת-מבנית.
 *  B. כאן — בניית-הבריכה-מחדש על-הליניאגה-החיה-הנמדדת: pool_addw חד-צדדי
 *     SAOS לפי-האורקל-החתום (אותה-מתמטיקה-שהוכחה-ב-102/103) · ואז-אימות:
 *     הסטייה-נמדדת-מה-snapshot-החי-אחרי-הבלוק — לא-מהתוכנית.
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
const OUT = path.join(AGENT_DIR, 'rean106_result.json');
// 8-b: חשבון-הפעולה חובה מה-env — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/rean106.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
// LIVE-GATE (Task 28-b): DRY by default — the saosnet beat mutates the live ledger,
// so the shared gate decides whether the child gets --live (--dry always wins). See DAEMONS.md.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
const MISSION_ID = 'REAN-106-pw';

const DEV_OK = 12; // יעד-סובלנות (%)
const MIN_FLOAT_SAOS = 8000; // µ-SAOS מינימום-שנשאר-צף-באוצר אחרי-ההשלמה

const log = (m) => console.log('[rean106] ' + m);
announceGate(GATE, log);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function saosUsd() {
  /* 106 — מיושר-למנוע (grid98 bookFair): fair = 0.5×(lastPrice + nativePoolPx)
   * · sUsd = fair × WSTEEM-חתום. אותה-נגזרת שה-arb אוכף-פר-טיק — אפס-מלחמת-עגנים:
   * המאזן-השעתי-והמנוע-מושכים-לאותו-יעד-במדויק (לקח-r8: שני-נגזרות = משיכה-מתמשכת). */
  const sw = readJSON(SNAP, null); if (!sw || !sw.st) return 0;
  const s = sw.st;
  const last = s.meta.lastPrice ? s.meta.lastPrice / 1e6 : 0;
  const poolPx = (s.pool && s.pool.saos > 0 && s.pool.steem > 0) ? s.pool.steem / s.pool.saos : 0;
  const fair = (last > 0 && poolPx > 0) ? 0.5 * (last + poolPx) : (last || poolPx || 0.017);
  const spx = ((s.assetPrices || {}).WSTEEM || {}).px / 1e9;
  return fair > 0 && spx > 0 ? fair * spx : 0;
}

function measure() {
  const sUsd = saosUsd();
  const sw = readJSON(SNAP, null);
  const s = sw && sw.st;
  if (!s || !sUsd) return { err: 'no-snapshot-or-sUsd' };
  const p = s.poolW;
  if (!p) return { err: 'no-poolW' };
  const px = (((s.assetPrices || {}).WTRX || {}).px || 0) / 1e9;
  if (!px) return { err: 'no-WTRX-oracle' };
  const oracle = px / sUsd;
  const ratio = p.wtrx > 0 ? p.saos / p.wtrx : 0;
  const dev = oracle ? +(((ratio - oracle) / oracle) * 100).toFixed(1) : null;
  const hc = (s.accounts || {})[ACCOUNT] || {};
  return { sUsd, wtrxUsd: px, oracle: +oracle.toFixed(1), a: p.wtrx, b: p.saos, lp: p.lpSupply, ratio: +ratio.toFixed(3), dev, hcSaos: hc.saos || 0, snapHeight: sw.height };
}

async function main() {
  const t0 = Date.now();
  const before = measure();
  log('before: ' + JSON.stringify(before));
  if (before.err) throw new Error(before.err);

  const res = { at: new Date().toISOString(), before, issued: null, mission: null, after: null, allOk: false };

  if (before.dev !== null && Math.abs(before.dev) <= DEV_OK) {
    log('poolW dev ' + before.dev + '% ≤ ' + DEV_OK + '% — already anchored · nothing to do (honest no-op)');
    res.after = before; res.allOk = true;
    fs.writeFileSync(OUT, JSON.stringify(res, null, 2) + '\n');
    return;
  }

  /* מתמטיקת-ההשלמה-החד-צדדית (מוכחת-102): (b + addS)/a = oracle → addS = oracle·a − b
   * יחידות-µ גולמיות בכל-הדרך · שער-אוצר: חייב-להישאר צף ≥ MIN_FLOAT_SAOS */
  const addS = Math.max(0, Math.round(before.oracle * before.a) - before.b);
  if (addS <= 0) { log('addS computed ' + addS + ' — nothing to add (honest no-op)'); res.after = before; res.allOk = before.dev !== null; fs.writeFileSync(OUT, JSON.stringify(res, null, 2) + '\n'); return; }
  if (before.hcSaos - addS < MIN_FLOAT_SAOS) {
    log('TREASURY-GATE: need ' + addS + 'µ but float after would be ' + (before.hcSaos - addS) + 'µ < ' + MIN_FLOAT_SAOS + 'µ — honest abort (the treasury is the constraint, not the plan)');
    res.after = before; res.gate = 'treasury-float';
    fs.writeFileSync(OUT, JSON.stringify(res, null, 2) + '\n');
    return;
  }

  const op = {
    type: 'pool_addw', owner: ACCOUNT,
    amountSaos: addS / 1000, amountWtrx: 0,
    ref: 'rean106:pw:add:1',
    mirror: 'g98-reanchor',
    note: 'REAN-106: בניית-poolW על-הליניאגה-החיה (r6/r7 אבדו-לאמנזיית-הפעלה-מחדש — רישום-כן) → יחס ' + ((before.b + addS) / Math.max(before.a, 1)).toFixed(1) + ' ≈ אורקל ' + before.oracle,
  };
  const pf = readJSON(PENDING, { missions: [] });
  pf.missions = (pf.missions || []).filter((m) => m.id !== MISSION_ID);
  pf.missions.push({ id: MISSION_ID, status: 'pending', issuedAt: new Date().toISOString(), issuer: ACCOUNT, ops: [op] });
  fs.writeFileSync(PENDING, JSON.stringify(pf, null, 2) + '\n');
  log('issued ' + MISSION_ID + ' · addS=' + (addS / 1000) + ' SAOS · target ratio ' + before.oracle);
  res.issued = { addS, oracle: before.oracle };

  /* פעימה-מיידית עם-הקוד-החדש (spawn חדש = הקוד-על-הדיסק, כולל-שרשרת-ההחזרה-106) */
  const r = spawnSync('node', ['saosnet.cjs'].concat(DRY ? [] : ['--live']), { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
  log('beat exit=' + r.status + (r.stderr ? ' · stderr: ' + String(r.stderr).slice(0, 120) : ''));

  let st = null;
  for (let i = 0; i < 6; i++) {
    await sleep(4000);
    st = (readJSON(PENDING, { missions: [] }).missions || []).find((x) => x.id === MISSION_ID);
    if (st && (st.status === 'applied' || st.status === 'rejected' || st.status === 'already-applied')) break;
    spawnSync('node', ['saosnet.cjs'].concat(DRY ? [] : ['--live']), { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
  }
  res.mission = st ? { status: st.status, results: st.results || [] } : { status: 'missing' };

  /* אימות-האמת: המדידה-מה-snapshot-החי-אחרי-הבלוק (לא-מהתוכנית) */
  await sleep(2000);
  const after = measure();
  res.after = after;
  res.allOk = !!(after && after.dev !== null && Math.abs(after.dev) <= DEV_OK);
  res.summaryHe = 'REAN-106 poolW: ' + (res.mission.status || '?') + ' · dev ' + (before.dev ?? '?') + '%→' + (after.dev ?? '?') + '% · oracle ' + before.oracle + ' · allOk=' + res.allOk;
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2) + '\n');
  log('after: ' + JSON.stringify({ dev: after.dev, a: after.a, b: after.b, ratio: after.ratio }));
  log(res.summaryHe);
  console.log('[rean106] ms=' + (Date.now() - t0));
}

main().catch((e) => { console.error('[rean106] FAIL: ' + (e && e.message)); process.exit(1); });
