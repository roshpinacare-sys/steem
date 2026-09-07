#!/usr/bin/env node
/* recon104.cjs — Task 104: UNIT-RECON שני — הפעם נגד המצב-החי בפועל.
 *
 * התגלית-החמורה (104): ה-RECON-102 דווח "applied" אבל האפקט שלו אבד — ליניאגת-רוח-רפאים.
 * הארכיון אינו עד-שלם (בלוקים שהחליקו בתקופת-ה-heal) → replay-מלא דוחה את ה-ops
 * (not-holder/under-backed/shares — הבריכות התכווצו) → כל-snapshot שיצא מ-replay-כזה
 * החזיר את הסינתטיקה לערכי-הניפוח (WBTC 59µ/60µ = ×843,000 על-הגב של 0.06-STEEM).
 * הספר-החי הוא-האמת: הפיוס רץ עכשיו נגד המצב-החי-הנמדד (snapshot טרי), עם-refs-חדשים,
 * והאימות-הסופי = מדידת-הספר-עצמו (לא-סטטוס-משימה).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AGENT_DIR = __dirname;
const NODE_DIR = path.join(AGENT_DIR, '..', 'sovereign', 'node');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');
const SNAP = path.join(NODE_DIR, 'state-snapshot.json');
const OUT = path.join(AGENT_DIR, 'recon104_result.json');
const ACCOUNT = 'headcorner';
const RETIRED = ['WBTC', 'WETH', 'WXRP', 'WDOGE'];
const EVIDENCE = {
  WBTC: { coin: 'BTC', collateral: '0.06 STEEM', lockRef: 'b71ca393cb4e2f0a218a2dc3b14a3228f36affc7', mintedTruth: 7e-8 },
  WETH: { coin: 'ETH', collateral: '0.06 STEEM', lockRef: 'b4a0646a83538ad2c9375403e316d019bf575313', mintedTruth: 0.00000236 },
  WXRP: { coin: 'XRP', collateral: '0.04 STEEM', lockRef: '708ea60066f85bcd964322873cfd40f46019007a', mintedTruth: 0.00276884 },
  WDOGE: { coin: 'DOGE', collateral: '0.12 STEEM', lockRef: '08882b0a7eb7271119e1c8a41222da5c444a2a1a', mintedTruth: 0.13103901 },
};
const log = (m) => console.log('[recon104] ' + m);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = () => { const s = readJSON(SNAP, null); if (!s || !s.st) throw new Error('no snapshot'); return s.st; };

/* תכנון-פר-מטבע מהמצב-החי: 2×LP-pull (תקרת-50% קרנלית) → שריפת-מלוא-יתרת-האוצר
 * (כולל-האבק-שחזר-מהבריכה) → שחרור-הנעול-עד-locked=supply. כל-המספרים-ב-µ. */
function planCoin(sym) {
  const st = snap();
  const w = (st.wrapped || {})[sym];
  const pool = (st.poolsX || {})[sym + '/SAOS'];
  const hc = (st.accounts || {})[ACCOUNT] || { wrapped: {} };
  if (!w) return null;
  let lp = pool ? pool.lpSupply : 0, a = pool ? pool.a : 0, b = pool ? pool.b : 0;
  let hcBal = (hc.wrapped || {})[sym] || 0;
  const pulls = [];
  for (let i = 0; i < 2; i++) {
    if (lp <= 0) break;
    const sh = Math.floor(lp / 2);
    if (sh <= 0) break;
    if (sh * 2 > lp) break; /* מגן-over-pull קרנלי */
    const fracA = Math.floor((a * sh) / lp), fracB = Math.floor((b * sh) / lp);
    if (fracA + fracB <= 0) break;
    a -= fracA; b -= fracB; lp -= sh; hcBal += fracA;
    pulls.push({ sharesµ: sh, fracA, fracB });
  }
  const burnµ = hcBal;
  const supplyAfter = w.supply - burnµ;
  const releaseµ = Math.max(0, w.locked - supplyAfter);
  return { sym, before: { supply: w.supply, locked: w.locked, hcBal: (hc.wrapped || {})[sym] || 0, poolA: pool ? pool.a : 0, poolB: pool ? pool.b : 0, lpSupply: pool ? pool.lpSupply : 0 }, pulls, burnµ, supplyAfter, releaseµ };
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
  const pf = readJSON(PENDING, { missions: [] });
  const m = (pf.missions || []).find((x) => x.id === id);
  return m ? { status: m.status, results: m.results || [], error: m.error || null } : { status: 'missing' };
}
async function runMission(id, ops) {
  issueMission(id, ops);
  await sleep(1500);
  let st = missionStatus(id);
  for (let i = 0; i < 5 && st.status !== 'applied' && st.status !== 'partial'; i++) { beatOnce(id); await sleep(3000); st = missionStatus(id); }
  const ok = st.results.filter((r) => r.ok).length;
  log(id + ' status=' + st.status + ' · ok=' + ok + '/' + st.results.length + (st.error ? ' · err=' + st.error : ''));
  return st;
}

(async () => {
  const t0 = Date.now();
  const before = {};
  for (const sym of RETIRED) { const p = planCoin(sym); if (p) before[sym] = p; }

  /* ── משימה א' (WBTC+WETH) ואז ב' (WXRP+WDOGE) — ≤8-ops כ"א ── */
  const missions = [['RECON-104a', ['WBTC', 'WETH']], ['RECON-104b', ['WXRP', 'WDOGE']]];
  const missionOut = {};
  for (const [id, syms] of missions) {
    const ops = [];
    for (const sym of syms) {
      const p = before[sym];
      if (!p) continue;
      p.pulls.forEach((pl, i) => ops.push({
        type: 'pool_xRm', owner: ACCOUNT, pair: sym + '/SAOS', shares: pl.sharesµ / 1000, ref: 'recon104:rm:' + sym + ':' + (i + 1),
        note: 'UNIT-RECON-104 (ghost-lineage redo): LP-pull ' + (i + 1) + '/2 — ' + sym + ' יחידות-בסיס שגויות; הפיוס-הקודם (recon102) אבד-לליניאגה-שבורה',
      }));
      if (p.burnµ > 0) ops.push({
        type: 'wrap_burn', from: ACCOUNT, symbol: sym, amount: p.burnµ / 1000, ref: 'recon104:burn:' + sym,
        note: 'UNIT-RECON-104: שריפת-מלוא-יתרת-האוצר ' + p.burnµ / 1000 + ' ' + sym + ' — המוטבע-האמת ' + EVIDENCE[sym].mintedTruth + ' ' + EVIDENCE[sym].coin + ' מתחת-לרזולוציית-µ (collateral ' + EVIDENCE[sym].collateral + ', lockRef ' + EVIDENCE[sym].lockRef.slice(0, 10) + '…)',
      });
      if (p.releaseµ > 0) ops.push({
        type: 'wrap_release', issuer: ACCOUNT, symbol: sym, lockedDelta: p.releaseµ / 1000, ref: 'recon104:rel:' + sym,
        note: 'UNIT-RECON-104: שחרור-הנעול-עד locked=supply=' + p.supplyAfter + 'µ — רדום-בכנות מול-המצב-החי',
      });
    }
    if (ops.length) missionOut[id] = await runMission(id, ops);
    else missionOut[id] = { status: 'nothing-to-do' };
  }

  /* ── אימות-סופי: הספר-עצמו (snapshot טרי אחרי-הפעימות) ── */
  await sleep(2000);
  const st1 = snap();
  const after = {};
  let allMatch = true;
  for (const sym of RETIRED) {
    const w = (st1.wrapped || {})[sym] || {};
    const ok = (w.supply || 0) <= 5 && (w.supply || 0) === (w.locked || 0);
    if (!ok) allMatch = false;
    after[sym] = { supply: w.supply || 0, locked: w.locked || 0, dormant: ok };
  }
  const result = {
    at: new Date().toISOString(),
    task: '104',
    rootCause: 'recon102 effects lost to ghost lineage — archive gaps (703-709 + slid blocks) make full replay reject the old ops; live state never carried them. Re-applied against LIVE measured state with fresh refs.',
    allMatch,
    retiredDormant: allMatch,
    before, after,
    missions: Object.fromEntries(Object.entries(missionOut).map(([k, v]) => [k, { status: v.status, ok: (v.results || []).filter((r) => r.ok).length, total: (v.results || []).length }])),
    summaryHe: 'פיוס-יחידות שני (104): התגלה שהפיוס-הקודם (102) אבד-לליניאגת-רוח-רפאים — הארכיון אינו-עד-שלם (בלוקים-שהחליקו בתקופת-ה-heal) ולכן-replay-מלא דחה-את-ה-ops-הישנים והחזיר-את-הסינתטיקה לערכי-הניפוח. הפיוס-הזה רץ-נגד-המצב-החי-הנמדד-בפועל (refs-חדשים recon104:*) — ארבעת-הסינתטיקה (WBTC·WETH·WXRP·WDOGE) שרפו-ושוחררו-עד locked=supply=אבק-µ; האימות=מדידת-הספר-עצמו. חמשת-המטבעות-האמיתיים (WTRX·WBLURT·WSBD·PHIVE·ENERGY) אינם-נוגעים.',
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  log('allMatch=' + allMatch + ' · after=' + JSON.stringify(after));
  log('result → ' + OUT + ' · ' + Math.round((Date.now() - t0) / 1000) + 's');
  process.exit(allMatch ? 0 : 2);
})().catch((e) => { log('FATAL ' + ((e && e.message) || e)); process.exit(1); });
