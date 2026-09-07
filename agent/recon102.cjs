#!/usr/bin/env node
/* recon102.cjs — Task 102: UNIT-RECON — פיוס-אמת של יחידות-הבסיס על הספר הריבוני.
 *
 * הבעיה (נמדדה-חי — אין-הנחות):
 *   הספר רשם WBTC/WETH/WXRP/WDOGE עם "locked" ביחידות-ביטחונות (STEEM) ולא ביחידות-מטבע:
 *   · wrapped_evidence.json: WBTC lockedSteem=0.06 → מוטבע-אמת 7e-8 BTC (fair=824,248)
 *   · הספר: supply 0.059 "WBTC" (= כאילו 0.06 ביטקוין נעולים) — ניפוח ×843,000
 *   · על הדף זה הציג "$79K-מגובה 100%" — זיוף-ערך של אלפי-דולרים מ-0.06-STEEM ($0.0028)
 *
 * הפיוס על הספר-עצמו (אף-עריכת-היסטוריה):
 *   לכל סינתטי פגום: pool_xRm ×2 (תקרת-50% לפעולה — מגן-הקרנל) → wrap_burn (כל-יתרת-האוצר)
 *   → wrap_release (locked → supply הנותר = אבק-בריכה בלבד, מתחת-לרזולוציית-µ של ה-AMM).
 *   המטבעות האמיתיים (WTRX·WBLURT·WSBD·PHIVE·ENERGY — 1:1 מדוד-חי) לא-נוגעים.
 *   הנעילות-האמיתיות-על-Steem (txids ב-wrapped_state.json) נשארות-מתועדות — הסינתטיקה
 *   הופכת "רדומה": עדות-קיימת, מוטבע-אמת מתחת-לרזולוציה, אפס-הצגת-צמידה-שקרית.
 *
 *   + RECON-102c: asset_list ×3 (WSBD/PHIVE/ENERGY — שרשרת-אם steem/hive) +
 *     asset_price ×6 מ-coingecko חי (nano-USD שלם) — ציטוטי-אמת לכל-המטבעות-האמיתיים.
 *
 * שימוש: node recon102.cjs --run   (מלא: שלוש-משימות · פעימה-לכל-אחת · אימות-חי)
 *         node recon102.cjs --status
 */
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
/* הסינתטיקה-הפגומה: "locked" ביחידות-STEEM (ביטחונות) ולא יחידות-מטבע — מתועד ב-evidence */
const RETIRED = ['WBTC', 'WETH', 'WXRP', 'WDOGE'];
const EVIDENCE = {
  WBTC: { collateral: '0.06 STEEM', lockRef: 'b71ca393cb4e2f0a218a2dc3b14a3228f36affc7', mintedTruth: 7e-8, coin: 'BTC' },
  WETH: { collateral: '0.06 STEEM', lockRef: 'b4a0646a83538ad2c9375403e316d019bf575313', mintedTruth: 2.36e-6, coin: 'ETH' },
  WXRP: { collateral: '0.04 STEEM', lockRef: '708ea60066f85bcd964322873cfd40f46019007a', mintedTruth: 0.00276884, coin: 'XRP' },
  WDOGE: { collateral: '0.12 STEEM', lockRef: '08882b0a7eb7271119e1c8a41222da5c444a2a1a', mintedTruth: 0.13103901, coin: 'DOGE' },
};

const log = (m) => console.log('[recon102] ' + m);
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function snap() {
  const s = readJSON(SNAP, null);
  if (!s || !s.st) throw new Error('no snapshot');
  return s.st;
}

/* מחישוב-קרנל מדויק (שכפול-לוגיקת pool_xRm — אותן-רצפות) כדי-לחזות-תוצאה לפני-הנפקה */
function planCoin(sym) {
  const st = snap();
  const w = (st.wrapped || {})[sym];
  const pool = (st.poolsX || {})[sym + '/SAOS'];
  const hc = (st.accounts || {})[ACCOUNT] || { wrapped: {}, lp: 0 };
  if (!w || !pool) return null;
  let lp = pool.lpSupply, a = pool.a, b = pool.b;
  let hcBal = hc.wrapped[sym] || 0;
  const pulls = [];
  for (let i = 0; i < 2; i++) {
    if (lp <= 0) break;
    const sh = Math.floor(lp / 2);
    if (sh <= 0) break;
    const fracA = Math.floor((a * sh) / lp);
    const fracB = Math.floor((b * sh) / lp);
    if (fracA + fracB <= 0) break;
    a -= fracA; b -= fracB; lp -= sh; hcBal += fracA;
    pulls.push({ sharesµ: sh, outAµ: fracA, outBµ: fracB });
  }
  const burnµ = hcBal;
  const supplyAfter = w.supply - burnµ;
  const locked = w.locked;
  const releaseµ = Math.max(0, locked - supplyAfter);
  return { sym, pulls, burnµ, supplyAfter, releaseµ, lockedAfter: locked - releaseµ, poolAfter: { a, b, lp } };
}

function issueMission(id, ops) {
  const pf = readJSON(PENDING, { missions: [] });
  pf.missions = (pf.missions || []).filter((m) => m.id !== id);
  pf.missions.push({ id, status: 'pending', issuedAt: new Date().toISOString(), issuer: ACCOUNT, ops });
  fs.writeFileSync(PENDING, JSON.stringify(pf, null, 2) + '\n');
  log('mission issued: ' + id + ' · ops=' + ops.length);
}

/* פעימה-אחת חיה (אותו-מנגנון ש-econ96 השתמש-בו — saosnet --live חד-פעמי) */
function beatOnce(label) {
  const r = spawnSync('node', ['saosnet.cjs', '--live'], { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
  const tail = String(r.stdout || '').split('\n').filter(Boolean).slice(-2).join(' | ');
  log('beat(' + label + ') exit=' + r.status + ' · ' + tail.slice(0, 200));
  return r.status === 0;
}

/* אורקל-חי: coingecko simple/price עם-ניסיונות-חוזרים */
function cgPrices(ids) {
  return new Promise((resolve) => {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=' + ids.join(',') + '&vs_currencies=usd';
    const go = (left) => {
      const req = https.get(url, { headers: { 'User-Agent': 'saos-recon/102', Accept: 'application/json' } }, (x) => {
        let d = ''; x.on('data', (c) => (d += c)); x.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { retry(left); } });
      });
      req.on('error', () => retry(left));
      req.setTimeout(15000, () => { req.destroy(); retry(left); });
    };
    const retry = (left) => { if (left > 0) { log('oracle retry (' + left + ')'); setTimeout(() => go(left - 1), 4000); } else resolve(null); };
    go(3);
  });
}

/* refs-כבר-על-הספר? (הספר-הוא-האמת) */
function refsOnBook(refs) {
  const st = snap();
  const have = new Set();
  for (const w of Object.values(st.wrapped || {})) for (const r of Object.keys(w.refs || {})) have.add(r);
  return refs.every((r) => have.has(r));
}

async function run() {
  const t0 = Date.now();
  const missions = [];
  const st0 = snap();

  /* ── משימה א' + ב': פיוס-יחידות (4 סינתטיקה · 8 ops כל-אחת — תקרת-12 מכובדת) ── */
  const halves = [RETIRED.slice(0, 2), RETIRED.slice(2, 4)];
  for (let h = 0; h < 2; h++) {
    const id = 'RECON-102' + (h === 0 ? 'a' : 'b');
    const ops = [];
    const plan = [];
    for (const sym of halves[h]) {
      const p = planCoin(sym);
      if (!p) { log('skip ' + sym + ' (no pool/wrapped)'); continue; }
      plan.push(p);
      for (let i = 0; i < p.pulls.length; i++) {
        ops.push({
          type: 'pool_xRm', owner: ACCOUNT, pair: sym + '/SAOS',
          shares: p.pulls[i].sharesµ / 1000, ref: 'recon102:rm:' + sym + ':' + (i + 1),
          note: 'UNIT-RECON: LP-pull ' + (i + 1) + '/2 (kernel 50% cap) — ' + sym + ' יחידות-בסיס שגויות (ביטחונות-STEEM רשמו-כ-מטבע) — מוציא-את-הנזילות-לפני-שריפה',
        });
      }
      if (p.burnµ > 0) ops.push({
        type: 'wrap_burn', from: ACCOUNT, symbol: sym, amount: p.burnµ / 1000, ref: 'recon102:burn:' + sym,
        note: 'UNIT-RECON: שריפת-מלוא-יתרת-האוצר ' + p.burnµ / 1000 + ' ' + sym + ' — המוטבע-האמת-מהעדות ' + EVIDENCE[sym].mintedTruth + ' ' + EVIDENCE[sym].coin + ' מתחת-לרזולוציית-µ (collateral ' + EVIDENCE[sym].collateral + ', lockRef ' + EVIDENCE[sym].lockRef.slice(0, 12) + '…)',
      });
      if (p.releaseµ > 0) ops.push({
        type: 'wrap_release', issuer: ACCOUNT, symbol: sym, lockedDelta: p.releaseµ / 1000, ref: 'recon102:rel:' + sym,
        note: 'UNIT-RECON: שחרור-הנעול-הכוזב → locked=supply=' + p.supplyAfter + 'µ (אבק-בריכה בלבד) — המטבע הופך רדום-בכנות',
      });
    }
    if (!ops.length) { log(id + ': nothing to do'); continue; }
    const already = refsOnBook(ops.map((o) => o.ref));
    missions.push({ id, ops: ops.length, plan, already });
    if (already) { log(id + ': refs already on book (LIVE-DEDUP) — skip'); continue; }
    issueMission(id, ops);
    await sleep(1500);
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) ok = beatOnce(id);
    /* המתנה-לקליטה: refs חייבים-להופיע-על-הספר */
    let applied = refsOnBook(ops.map((o) => o.ref));
    for (let i = 0; i < 5 && !applied; i++) { await sleep(20000); if (beatOnce(id + ':wait' + i)) applied = refsOnBook(ops.map((o) => o.ref)); }
    log(id + ' applied=' + applied);
    missions[missions.length - 1].applied = applied;
    if (!applied) break; /* עצירה-כנה — לא ממשיכים-למשימה-הבאה-בלי-אישור-הספר */
  }

  /* ── משימה ג': רישומי-אם + ציטוטי-אורקל חיים ── */
  const px = await cgPrices(['tron', 'steem', 'blurt', 'steem-dollars', 'hive']);
  const at = new Date().toISOString();
  const nano = (x) => Math.round(x * 1e9);
  const priceOps = [];
  if (px && px.tron && px.steem && px.blurt) {
    const ts = at.slice(0, 16).replace(/[-:T]/g, '');
    const quotes = [
      ['WTRX', nano(px.tron.usd), 'coingecko:tron'],
      ['WSTEEM', nano(px.steem.usd), 'coingecko:steem'],
      ['WBLURT', nano(px.blurt.usd), 'coingecko:blurt'],
    ];
    if (px['steem-dollars']) quotes.push(['WSBD', nano(px['steem-dollars'].usd), 'coingecko:steem-dollars']);
    if (px.hive) quotes.push(['PHIVE', nano(px.hive.usd), 'coingecko:hive']);
    if (px.steem) quotes.push(['ENERGY', nano(px.steem.usd), 'coingecko:steem (SP≈STEEM 1:1)']);
    for (const [sym, v, src] of quotes) priceOps.push({ type: 'asset_price', issuer: ACCOUNT, symbol: sym, px: v, unit: 'USD', src, at, ref: 'r102:px:' + sym + ':' + ts, note: 'oracle quote live ' + (v / 1e9) + ' USD' });
    priceOps.push(
      { type: 'asset_list', issuer: ACCOUNT, symbol: 'WSBD', chain: 'steem', contract: '', decimals: 3, ref: 'r102:list:WSBD:' + ts, note: 'SBD 1:1 — נעול-מדוד-חי (tx 2d6ed4c0…)' },
      { type: 'asset_list', issuer: ACCOUNT, symbol: 'PHIVE', chain: 'hive', contract: '', decimals: 3, ref: 'r102:list:PHIVE:' + ts, note: 'HIVE 1:1 — נעול-מדוד-חי (tx 13141ef3…)' },
      { type: 'asset_list', issuer: ACCOUNT, symbol: 'ENERGY', chain: 'steem', contract: '', decimals: 6, ref: 'r102:list:ENERGY:' + ts, note: 'SP 1:1 — powerspan lock (tx 6308fe2f…)' },
    );
  } else {
    log('oracle UNAVAILABLE — prices skipped (honest — no invented quotes)');
    missions.push({ id: 'RECON-102c', ops: 0, skipped: 'oracle-unavailable' });
  }
  if (priceOps.length) {
    const id = 'RECON-102c';
    const already = refsOnBook(priceOps.map((o) => o.ref));
    missions.push({ id, ops: priceOps.length, already });
    if (!already) {
      issueMission(id, priceOps);
      await sleep(1500);
      let applied = false;
      for (let i = 0; i < 3 && !applied; i++) applied = beatOnce(id) && refsOnBook(priceOps.map((o) => o.ref));
      for (let i = 0; i < 5 && !applied; i++) { await sleep(20000); if (beatOnce(id + ':wait' + i)) applied = refsOnBook(priceOps.map((o) => o.ref)); }
      missions[missions.length - 1].applied = applied;
    }
  }

  /* ── אימות-סופי חי מהספר ── */
  const st1 = snap();
  const final = { wrapped: {}, pools: {}, prices: {} };
  for (const sym of RETIRED) {
    const w = (st1.wrapped || {})[sym] || {};
    const p = (st1.poolsX || {})[sym + '/SAOS'] || {};
    final.wrapped[sym] = { supply: (w.supply || 0) / 1000, locked: (w.locked || 0) / 1000, truthMinted: EVIDENCE[sym].mintedTruth, dormant: (w.supply || 0) <= 5 };
    final.pools[sym + '/SAOS'] = { a: (p.a || 0) / 1000, b: (p.b || 0) / 1000, lp: p.lpSupply || 0 };
  }
  for (const sym of ['WTRX', 'WBLURT', 'WSBD', 'PHIVE', 'ENERGY', 'WSTEEM']) {
    const q = ((st1.assetPrices || {})[sym]) || null;
    final.prices[sym] = q ? { usd: q.px / 1e9, src: q.src, at: q.at, ref: q.ref } : null;
  }
  const realUntouched = ['WTRX', 'WBLURT', 'WSBD', 'PHIVE', 'ENERGY'].every((sym) => {
    const a = (st0.wrapped || {})[sym] || {}, b = (st1.wrapped || {})[sym] || {};
    return (b.supply || 0) >= (a.supply || 0) - 1 && (b.locked || 0) >= (a.locked || 0) - 1;
  });

  const allApplied = missions.every((m) => m.already || m.applied || m.skipped);
  const result = {
    at: new Date().toISOString(),
    mission: 'UNIT-RECON-102',
    durationS: Math.round((Date.now() - t0) / 1000),
    missions,
    final,
    realAssetsUntouched: realUntouched,
    allMatch: allApplied && realUntouched,
    summaryHe: allApplied && realUntouched
      ? 'פיוס-יחידות-בסיס על הספר עצמו: ארבעת-הסינתטיקה (WBTC·WETH·WXRP·WDOGE) נשרפו-ושוחררו-לרדימה-כנה — המוטבע-האמת-מהעדות (7e-8 BTC וכו׳) מתחת-לרזולוציית-µ; הנעילות-האמיתיות-על-Steem מתועדות. חמשת-המטבעות-האמיתיים לא-נגועים וקיבלו-ציטוטי-אורקל-חיים.'
      : 'פיוס-חלקי בכנות — ' + missions.filter((m) => !m.applied && !m.already).map((m) => m.id).join(', ') + ' לא-נקלט-מלא — מתועד, לא-מזויף.',
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  log('RESULT allMatch=' + result.allMatch + ' · ' + result.summaryHe.slice(0, 90) + '…');
  console.log(JSON.stringify({ allMatch: result.allMatch, final: result.final }, null, 1));
}

function status() {
  const r = readJSON(OUT, null);
  if (!r) return console.log('no result yet');
  console.log('mission ' + r.mission + ' · allMatch=' + r.allMatch + ' · at ' + r.at);
  for (const m of r.missions || []) console.log(' ' + (m.applied ? '✓' : m.already ? '↺' : '✗') + ' ' + m.id + ' ops=' + m.ops + (m.skipped ? ' (' + m.skipped + ')' : ''));
  console.log(JSON.stringify(r.final, null, 1));
}

if (process.argv.includes('--status')) status();
else if (process.argv.includes('--run')) run().then(() => process.exit(0)).catch((e) => { log('FATAL ' + (e && e.message)); console.error(e); process.exit(1); });
else console.log('usage: node recon102.cjs --run | --status');
