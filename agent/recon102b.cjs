#!/usr/bin/env node
/* recon102b.cjs — השלמת UNIT-RECON: משימה ב' (WXRP+WDOGE) + ציטוטי-המשך (WSBD/PHIVE/ENERGY
 * שנפלו "no-symbol" כי-במשימה-ג' הציטוטים-הקדימו-את-הרישומים — לקח-סדר-ops על-הספר). */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const https = require('https');

const AGENT_DIR = __dirname;
const NODE_DIR = path.join(AGENT_DIR, '..', 'sovereign', 'node');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');
const SNAP = path.join(NODE_DIR, 'state-snapshot.json');
const OUT = path.join(AGENT_DIR, 'recon102_result.json');
const ACCOUNT = 'headcorner';
const EVIDENCE = {
  WXRP: { collateral: '0.04 STEEM', lockRef: '708ea60066f85bcd964322873cfd40f46019007a', mintedTruth: 0.00276884, coin: 'XRP' },
  WDOGE: { collateral: '0.12 STEEM', lockRef: '08882b0a7eb7271119e1c8a41222da5c444a2a1a', mintedTruth: 0.13103901, coin: 'DOGE' },
};
const log = (m) => console.log('[recon102b] ' + m);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const snap = () => { const s = readJSON(SNAP, null); if (!s || !s.st) throw new Error('no snapshot'); return s.st; };

function planCoin(sym) {
  const st = snap();
  const w = (st.wrapped || {})[sym];
  const pool = (st.poolsX || {})[sym + '/SAOS'];
  const hc = (st.accounts || {})[ACCOUNT] || { wrapped: {} };
  if (!w || !pool) return null;
  let lp = pool.lpSupply, a = pool.a, b = pool.b, hcBal = hc.wrapped[sym] || 0;
  const pulls = [];
  for (let i = 0; i < 2; i++) {
    if (lp <= 0) break;
    const sh = Math.floor(lp / 2);
    if (sh <= 0) break;
    const fracA = Math.floor((a * sh) / lp), fracB = Math.floor((b * sh) / lp);
    if (fracA + fracB <= 0) break;
    a -= fracA; b -= fracB; lp -= sh; hcBal += fracA;
    pulls.push({ sharesµ: sh });
  }
  const burnµ = hcBal, supplyAfter = w.supply - burnµ;
  return { sym, pulls, burnµ, supplyAfter, releaseµ: Math.max(0, w.locked - supplyAfter) };
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
function cgPrices(ids) {
  return new Promise((resolve) => {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + ids.join(',') + '&vs_currencies=usd';
    const req = https.get(url, { headers: { 'User-Agent': 'saos-recon/102b', Accept: 'application/json' } }, (x) => {
      let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
  });
}
function missionStatus(id) {
  const pf = readJSON(PENDING, { missions: [] });
  const m = (pf.missions || []).find((x) => x.id === id);
  return m ? { status: m.status, results: m.results || [], error: m.error || null } : { status: 'missing' };
}

(async () => {
  const t0 = Date.now();
  /* ── RECON-102b: WXRP + WDOGE ── */
  const ops = [];
  for (const sym of ['WXRP', 'WDOGE']) {
    const p = planCoin(sym);
    if (!p) continue;
    p.pulls.forEach((pl, i) => ops.push({
      type: 'pool_xRm', owner: ACCOUNT, pair: sym + '/SAOS', shares: pl.sharesµ / 1000, ref: 'recon102:rm:' + sym + ':' + (i + 1),
      note: 'UNIT-RECON: LP-pull ' + (i + 1) + '/2 — ' + sym + ' יחידות-בסיס שגויות (ביטחונות-STEEM רשמו-כ-מטבע)',
    }));
    if (p.burnµ > 0) ops.push({
      type: 'wrap_burn', from: ACCOUNT, symbol: sym, amount: p.burnµ / 1000, ref: 'recon102:burn:' + sym,
      note: 'UNIT-RECON: שריפת-מלוא-יתרת-האוצר ' + p.burnµ / 1000 + ' ' + sym + ' — המוטבע-האמת-מהעדות ' + EVIDENCE[sym].mintedTruth + ' ' + EVIDENCE[sym].coin + ' מתחת-לרזולוציית-µ (collateral ' + EVIDENCE[sym].collateral + ')',
    });
    if (p.releaseµ > 0) ops.push({
      type: 'wrap_release', issuer: ACCOUNT, symbol: sym, lockedDelta: p.releaseµ / 1000, ref: 'recon102:rel:' + sym,
      note: 'UNIT-RECON: שחרור-הנעול-הכוזב → locked=supply=' + p.supplyAfter + 'µ — המטבע הופך רדום-בכנות',
    });
  }
  if (ops.length) {
    issueMission('RECON-102b', ops);
    await sleep(1500);
    let st = missionStatus('RECON-102b');
    for (let i = 0; i < 4 && st.status !== 'applied' && st.status !== 'partial'; i++) { beatOnce('102b'); await sleep(3000); st = missionStatus('RECON-102b'); }
    log('RECON-102b status=' + st.status + ' · ok=' + st.results.filter((r) => r.ok).length + '/' + st.results.length);
  }

  /* ── RECON-102c2: ציטוטים-חוזרים (הרישומים-כבר-על-הספר) ── */
  const px = await cgPrices(['tron', 'steem', 'blurt', 'steem-dollars', 'hive']);
  const at = new Date().toISOString();
  const nano = (x) => Math.round(x * 1e9);
  if (px && px['steem-dollars'] && px.hive && px.steem) {
    const ts = at.slice(0, 16).replace(/[-:T]/g, '');
    const quotes = [
      ['WSBD', nano(px['steem-dollars'].usd), 'coingecko:steem-dollars'],
      ['PHIVE', nano(px.hive.usd), 'coingecko:hive'],
      ['ENERGY', nano(px.steem.usd), 'coingecko:steem (SP≈STEEM 1:1)'],
    ].map(([sym, v, src]) => ({ type: 'asset_price', issuer: ACCOUNT, symbol: sym, px: v, unit: 'USD', src, at, ref: 'r102b:px:' + sym + ':' + ts, note: 'oracle quote live ' + v / 1e9 + ' USD' }));
    issueMission('RECON-102c2', quotes);
    await sleep(1500);
    let st = missionStatus('RECON-102c2');
    for (let i = 0; i < 4 && st.status !== 'applied'; i++) { beatOnce('102c2'); await sleep(3000); st = missionStatus('RECON-102c2'); }
    log('RECON-102c2 status=' + st.status + ' · ok=' + st.results.filter((r) => r.ok).length + '/' + st.results.length);
  } else {
    log('oracle unavailable — quotes skipped (honest)');
  }

  /* ── אימות-סופי חי ── */
  await sleep(2000);
  const st1 = snap();
  const RETIRED = ['WBTC', 'WETH', 'WXRP', 'WDOGE'];
  const EVID = {
    WBTC: 7e-8, WETH: 2.36e-6, WXRP: 0.00276884, WDOGE: 0.13103901,
  };
  const final = { wrapped: {}, pools: {}, prices: {} };
  for (const sym of RETIRED) {
    const w = (st1.wrapped || {})[sym] || {};
    const p = (st1.poolsX || {})[sym + '/SAOS'] || {};
    final.wrapped[sym] = { supply: (w.supply || 0) / 1000, locked: (w.locked || 0) / 1000, truthMinted: EVID[sym], dormant: (w.supply || 0) <= 5 };
    final.pools[sym + '/SAOS'] = { a: (p.a || 0) / 1000, b: (p.b || 0) / 1000, lp: p.lpSupply || 0 };
  }
  for (const sym of ['WTRX', 'WBLURT', 'WSBD', 'PHIVE', 'ENERGY', 'WSTEEM']) {
    const q = ((st1.assetPrices || {})[sym]) || null;
    final.prices[sym] = q ? { usd: q.px / 1e9, src: q.src, at: q.at, ref: q.ref } : null;
  }
  const retiredZero = RETIRED.every((sym) => final.wrapped[sym].supply <= 0.005 && final.wrapped[sym].locked <= final.wrapped[sym].supply + 0.001);
  const allRealQuoted = ['WTRX', 'WBLURT', 'WSBD', 'PHIVE', 'ENERGY'].every((s) => final.prices[s]);
  const pf = readJSON(PENDING, { missions: [] });
  const mine = pf.missions.filter((m) => m.id.startsWith('RECON-102'));
  const allApplied = mine.every((m) => m.status === 'applied' || m.status === 'partial');

  const prev = readJSON(OUT, {});
  const result = {
    ...prev,
    at: new Date().toISOString(),
    mission: 'UNIT-RECON-102 (complete)',
    durationS: Math.round((Date.now() - t0) / 1000),
    completedBy: 'recon102b.cjs',
    final,
    retiredDormant: retiredZero,
    allRealAssetsQuoted: allRealQuoted,
    allMatch: allApplied && retiredZero && allRealQuoted,
    summaryHe: (allApplied && retiredZero && allRealQuoted)
      ? 'פיוס-יחידות-בסיס הושלם על הספר עצמו: ארבעת-הסינתטיקה (WBTC·WETH·WXRP·WDOGE) נשרפו-והפכו-רדומים (המוטבע-האמת-מהעדות מתחת-לרזולוציית-µ); חמשת-המטבעות-האמיתיים (WTRX·WBLURT·WSBD·PHIVE·ENERGY) עם-ציטוטי-אורקל-חיים-חתומים על-הספר.'
      : 'פיוס-חלקי בכנות — retiredDormant=' + retiredZero + ' · allRealQuoted=' + allRealQuoted + ' · missions=' + mine.map((m) => m.id + ':' + m.status).join(' · '),
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  log('allMatch=' + result.allMatch);
  console.log(JSON.stringify({ allMatch: result.allMatch, final }, null, 1));
})().catch((e) => { log('FATAL ' + e.message); console.error(e); process.exit(1); });
