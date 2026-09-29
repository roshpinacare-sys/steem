#!/usr/bin/env node
/* fixpw102.cjs — השלמת עיגון poolW: משיכות-LP (pool_rmw — שהיה-חסר-במסילת-המשימות,
 * תוקן-בsaosnet.cjs) + השלמה-מתקנת ליחס-האורקל. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const AGENT_DIR = __dirname;
const NODE_DIR = path.join(AGENT_DIR, '..', 'sovereign', 'node');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');
const SNAP = path.join(NODE_DIR, 'state-snapshot.json');
const STATE = path.join(NODE_DIR, 'state.json');
// 8-b: חשבון-הפעולה חובה מה-env — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/fixpw102.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
// LIVE-GATE (Task 28-b): DRY by default — the saosnet beat mutates the live ledger,
// so the shared gate decides whether the child gets --live (--dry always wins). See DAEMONS.md.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
const log = (m) => console.log('[fixpw] ' + m);
announceGate(GATE, log);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function saosUsd() {
  const st = JSON.parse(fs.readFileSync(SNAP, 'utf8')).st;
  const node = readJSON(STATE, {});
  const ask = node.book?.asks?.[0]?.price, bid = node.book?.bids?.[0]?.price;
  const mid = ask && bid ? (ask + bid) / 2 : st.meta.lastPrice ? st.meta.lastPrice / 1e6 : 0.0169;
  return mid * (((st.assetPrices || {}).WSTEEM || {}).px / 1e9);
}

(async () => {
  const sUsd = saosUsd();
  const st = JSON.parse(fs.readFileSync(SNAP, 'utf8')).st;
  const trxp = ((st.assetPrices || {}).WTRX || {}).px / 1e9;
  const tgt = trxp / sUsd;
  log('target ' + tgt.toFixed(1) + ' SAOS/WTRX (TRX $' + trxp + ' ÷ SAOS $' + sUsd.toFixed(7) + ')');
  const pw = st.poolW;
  let a = pw.wtrx, b = pw.saos, lp = pw.lpSupply;
  const ops = [];
  let i = 0;
  while (a > 1 && i < 8) {
    const sh = Math.floor(lp / 2);
    if (sh <= 0) break;
    const outS = Math.floor((b * sh) / lp), outW = Math.floor((a * sh) / lp);
    if (outS + outW <= 0) break;
    b -= outS; a -= outW; lp -= sh;
    i++;
    ops.push({ type: 'pool_rmw', owner: ACCOUNT, shares: sh / 1000, ref: 'rebal102:rm:WTRX:' + i, note: 'ANCHOR-REBAL: poolW LP-pull ' + i + ' — דילול-הזריעה-הישנה (יעד ' + tgt.toFixed(1) + ' SAOS/WTRX)' });
  }
  const addS = Math.max(0, Math.round(tgt * a) - b);
  if (addS > 0) ops.push({ type: 'pool_addw', owner: ACCOUNT, amountSaos: addS / 1000, amountWtrx: 0, ref: 'rebal102:add:WTRX:2', note: 'ANCHOR-REBAL: השלמה-מתקנת → יחס ' + ((b + addS) / Math.max(a, 1)).toFixed(1) + ' ≈ אורקל ' + tgt.toFixed(1) });
  log('ops=' + ops.length + ' · afterPulls wtrx=' + a + 'µ saos=' + b + 'µ · addS=' + addS + 'µ');
  const pf = readJSON(PENDING, { missions: [] });
  pf.missions = (pf.missions || []).filter((m) => m.id !== 'REBAL-102c2');
  pf.missions.push({ id: 'REBAL-102c2', status: 'pending', issuedAt: new Date().toISOString(), issuer: ACCOUNT, ops });
  fs.writeFileSync(PENDING, JSON.stringify(pf, null, 2) + '\n');
  await sleep(1500);
  const status = () => ((readJSON(PENDING, { missions: [] }).missions || []).find((x) => x.id === 'REBAL-102c2') || {}).status;
  for (let k = 0; k < 5 && status() !== 'applied' && status() !== 'partial'; k++) {
    spawnSync('node', ['saosnet.cjs'].concat(DRY ? [] : ['--live']), { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
    await sleep(3000);
  }
  const st1 = JSON.parse(fs.readFileSync(SNAP, 'utf8')).st;
  const pw1 = st1.poolW;
  const ratio = pw1.wtrx > 0 ? pw1.saos / pw1.wtrx : 0;
  const dev = ((ratio - tgt) / tgt) * 100;
  log('FINAL poolW ratio=' + ratio.toFixed(1) + ' vs oracle ' + tgt.toFixed(1) + ' → dev ' + dev.toFixed(1) + '%');
  const res = readJSON(path.join(AGENT_DIR, 'rebalance102_result.json'), {});
  res.pools = res.pools || {};
  res.pools['WTRX/SAOS(pw)'] = { a: pw1.wtrx / 1000, b: pw1.saos / 1000, ratio: +ratio.toFixed(2), oracle: +tgt.toFixed(2), devPct: +dev.toFixed(1), lp: pw1.lpSupply };
  const anchored = Object.entries(res.pools).filter(([k]) => !k.startsWith('PHIVE'));
  res.anchoredWithin12pct = anchored.every(([, v]) => v.devPct !== null && Math.abs(v.devPct) <= 12);
  res.allMatch = res.anchoredWithin12pct;
  res.completedBy = res.completedBy ? res.completedBy + ' + fixpw102' : 'fixpw102';
  res.summaryHe = res.anchoredWithin12pct
    ? 'בריכות-הדקס מעוגנות-מחדש-מול-האורקל-על-הספר: WBLURT/SAOS · WSBD/SAOS · ENERGY/SAOS · WTRX/SAOS(pw) — סטייה ≤12% מיחס-השוק-החתום (היו −77% עד −98.7%). PHIVE: זריעה-ישנה דוללה-לשלד-מתועד (אבק-µ) — המחיר-האמת = ציטוט-האורקל.'
    : res.summaryHe;
  fs.writeFileSync(path.join(AGENT_DIR, 'rebalance102_result.json'), JSON.stringify(res, null, 2) + '\n');
  log('allMatch=' + res.allMatch);
})().catch((e) => { log('FATAL ' + e.message); console.error(e); process.exit(1); });
