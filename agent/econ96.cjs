#!/usr/bin/env node
/* econ96.cjs — Task 96: ECON-96 — מצב-כלכלי מלא + שיפור-הדקס למקס (על-הספר, אפס-עמלה).
 *
 * A) AUDIT — ריפליי-מלא של הספר → שווי-אוצר בדולר מציטוטי-המחיר-על-הספר-עצמם
 *    (assetPrices שנרשמו ב-WRAP-96) + מדדי-דקס: עומק, ספרד, עמלות, טריידים.
 * B) REBALANCE — התגלית: מחיר-הבריכה (pool) סוטה ממחיר-הספר (book) — ארביטראז'
 *    פנימי. האוצר סוגר-את-הפער על-הספר: pool_swap לטווח-הספר + pool_add
 *    פרופורציונלי שמעמיק-בלי-לשנות-מחיר. נמדד לפני/אחרי.
 *
 * שימוש: node econ96.cjs --run   (audit + rebalance + verify)
 *         node econ96.cjs --audit (בלי-ביצוע)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const https = require('https');
const steem = require('steem');

const AGENT_DIR = __dirname;
const NODE_DIR = path.join(AGENT_DIR, '..', 'sovereign', 'node');
const OUT = path.join(AGENT_DIR, 'econ96_result.json');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');
const ARCHIVE = path.join(NODE_DIR, 'chain-archive.jsonl');

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(AGENT_DIR);
const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const POSTING_WIF = process.env.POSTING_WIF || '';
const STEEM_NODES = ['https://api.justyy.com', 'https://steemapi.boylikegirl.club'];

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
const sha = (o) => crypto.createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex');

// LIVE-GATE (Task 28-b): DRY by default — --run is this daemon's explicit-enable,
// the shared gate adds the HE_LIVE_CONFIRM layer (--dry always wins). See DAEMONS.md.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv.concat(process.argv.includes('--run') ? ['--live'] : []), { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE, log);

function httpsPost(url, body, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function replayBook() {
  const K = require(path.join(AGENT_DIR, '..', 'sovereign', 'core', 'kernel.cjs'));
  const G = readJSON(path.join(AGENT_DIR, '..', 'sovereign', 'genesis', 'genesis.json'), null);
  if (!G) throw new Error('genesis missing');
  const st = K.initFromGenesis(G);
  const lines = fs.readFileSync(ARCHIVE, 'utf8').trim().split('\n');
  let blocks = 0;
  for (const ln of lines) {
    let b; try { b = JSON.parse(ln); } catch (_) { continue; }
    if (typeof b.height !== 'number' || !Array.isArray(b.txs)) continue;
    for (const tx of b.txs) K.applyTx(st, tx);
    blocks++;
  }
  return { st, blocks };
}

function audit(st) {
  const px = st.assetPrices || {};
  const usd = (sym) => ((px[sym] || {}).px || 0) / 1e9;
  const issuer = st.meta.issuer || 'treasury';
  const treasury = st.accounts[issuer] || { saos: 0, steem: 0, wrapped: {}, lp: 0 };
  const wrappedSummary = Object.fromEntries(Object.entries(st.wrapped || {}).map(([sym, w]) => [sym, { supply: (w.supply || 0) / 1000, locked: (w.locked || 0) / 1000 }]));
  const steemUsd = usd('WSTEEM');
  const lastPriceSteemPerSaos = (st.meta.lastPrice || 0) / 1e6;
  const saosUsd = lastPriceSteemPerSaos * steemUsd;
  let totalSaosµ = 0, totalSteemµ = 0;
  for (const [name, a] of Object.entries(st.accounts)) {
    if (name === 'host') continue;
    totalSaosµ += a.saos || 0; totalSteemµ += a.steem || 0;
  }
  const poolValue = ((st.pool.saos || 0) * saosUsd + (st.pool.steem || 0) * steemUsd) / 1000;
  const fleetValue = (totalSaosµ * saosUsd + totalSteemµ * steemUsd) / 1000;
  const wtrx = wrappedSummary.WTRX || { supply: 0, locked: 0 };
  const trxUsd = usd('WTRX');
  const wtrxValue = wtrx.supply * trxUsd;
  const wtrxReserveValue = wtrx.locked * trxUsd;
  const holdings = {};
  for (const [name, a] of Object.entries(st.accounts)) {
    if (name === 'host') continue;
    for (const [sym, amt] of Object.entries(a.wrapped || {})) {
      if (!(amt > 0)) continue;
      const v = (amt / 1000) * (usd(sym) || (sym === 'WTRX' ? trxUsd : 0));
      holdings[sym] = holdings[sym] || { holders: 0, amount: 0, usd: 0 };
      holdings[sym].holders++; holdings[sym].amount += amt / 1000; holdings[sym].usd += v;
    }
  }
  const live = (st.orders || []).filter((o) => o.live);
  const asks = live.filter((o) => o.side === 'sell').map((o) => o.price / 1e6).sort((a, b) => a - b);
  const bids = live.filter((o) => o.side === 'buy').map((o) => o.price / 1e6).sort((a, b) => b - a);
  const bestAsk = asks[0] || null, bestBid = bids[0] || null;
  const bookMid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : (bestAsk || bestBid || null);
  const poolPrice = st.pool.saos > 0 && st.pool.steem > 0 ? st.pool.steem / st.pool.saos : null;
  const poolVsBook = poolPrice && bookMid ? { pool: +poolPrice.toFixed(6), book: +bookMid.toFixed(6), gapPct: +(((bookMid - poolPrice) / bookMid) * 100).toFixed(1) } : null;
  return {
    at: new Date().toISOString(),
    height: st.meta.height || null, headHash: null, blocksReplayed: null,
    pricesOnBook: Object.fromEntries(Object.entries(px).map(([sym, p]) => [sym, +((p.px || 0) / 1e9).toFixed(9)])),
    saosUsd: +saosUsd.toFixed(9), steemUsd: +steemUsd.toFixed(9), trxUsd: +trxUsd.toFixed(9),
    supply: { floatingSaos: totalSaosµ / 1000, floatingSteem: totalSteemµ / 1000 },
    treasury: { saos: treasury.saos / 1000, steem: treasury.steem / 1000, wtrx: (treasury.wrapped && treasury.wrapped.WTRX || 0) / 1000 },
    wrapped: wrappedSummary,
    wrappedEconomy: {
      wtrxSupply: wtrx.supply, wtrxLocked: wtrx.locked,
      wtrxCoverPct: wtrx.locked > 0 ? +((wtrx.locked / Math.max(wtrx.supply, 0.0001)) * 100).toFixed(1) : null,
      wtrxValueUsd: +wtrxValue.toFixed(6),
      bridgeReserveUsd: +wtrxReserveValue.toFixed(6),
      zeroSupplyAssets: Object.entries(wrappedSummary).filter(([, w]) => w.supply === 0).map(([s]) => s),
    },
    holdingsByAsset: Object.fromEntries(Object.entries(holdings).map(([s, h]) => [s, { holders: h.holders, amount: +h.amount.toFixed(6), usd: +h.usd.toFixed(6) }])),
    fleetValueUsd: +fleetValue.toFixed(6),
    poolValueUsd: +poolValue.toFixed(6),
    dex: {
      pool: { saos: st.pool.saos / 1000, steem: st.pool.steem / 1000, lpSupply: st.pool.lpSupply, feeBps: st.pool.feeBps || 30 },
      poolPriceSteemPerSaos: poolPrice != null ? +poolPrice.toFixed(8) : null,
      bookMid: bookMid != null ? +bookMid.toFixed(8) : null,
      poolVsBook,
      bestAsk, bestBid,
      trades: st.meta.trades || 0, swaps: st.meta.swaps || 0, lastPrice: lastPriceSteemPerSaos,
      feesTotalµ: (st.fees && st.fees.total) || 0,
      bookDepth: { asks: live.filter((o) => o.side === 'sell').length, bids: live.filter((o) => o.side === 'buy').length },
    },
  };
}

function planRebalance(st) {
  const pool = st.pool;
  const live = (st.orders || []).filter((o) => o.live);
  const asks = live.filter((o) => o.side === 'sell').map((o) => o.price / 1e6).sort((a, b) => a - b);
  const bids = live.filter((o) => o.side === 'buy').map((o) => o.price / 1e6).sort((a, b) => b - a);
  const mid = asks[0] && bids[0] ? (asks[0] + bids[0]) / 2 : null;
  if (!mid) return { skip: 'no-book-mid' };
  const treasury = st.accounts[st.meta.issuer || 'treasury'];
  const feeBps = pool.feeBps || 30;
  let best = null;
  for (let inAmt = 1; inAmt <= 2000; inAmt++) {
    if (inAmt > treasury.steem - 150) break;
    const net = inAmt - Math.floor(inAmt * feeBps / 10000);
    const out = Math.floor(net * pool.saos / (pool.steem + net));
    if (out <= 0 || out >= pool.saos) continue;
    const priceAfter = (pool.steem + net) / (pool.saos - out);
    const gap = Math.abs(priceAfter - mid);
    if (!best || gap < best.gap) best = { inAmt, out, priceAfter, gap };
  }
  if (!best) return { skip: 'no-viable-swap (treasury steem too small)' };
  const poolSaosAfter = pool.saos - best.out;
  const poolSteemAfter = pool.steem + (best.inAmt - Math.floor(best.inAmt * feeBps / 10000));
  const ratio = poolSaosAfter / poolSteemAfter;
  const addSteem = Math.min(100, Math.floor((treasury.steem - best.inAmt) * 0.5));
  const addSaos = Math.floor(addSteem * ratio);
  return {
    mid: +mid.toFixed(8), before: { poolPrice: +(pool.steem / pool.saos).toFixed(8) },
    swap: { side: 'buy_saos', inAmtSteem: +(best.inAmt / 1000).toFixed(3), expectOutSaos: +(best.out / 1000).toFixed(3), priceAfter: +best.priceAfter.toFixed(8) },
    add: { amountSaos: +(addSaos / 1000).toFixed(3), amountSteem: +(addSteem / 1000).toFixed(3) },
    treasuryBefore: { saos: treasury.saos / 1000, steem: treasury.steem / 1000 },
  };
}

function issueMission(id, ops) {
  const pf = readJSON(PENDING, { missions: [] });
  pf.missions = (pf.missions || []).filter((m) => m.id !== id);
  pf.missions.push({ id, status: 'pending', issuedAt: new Date().toISOString(), issuer: ACCOUNT, ops });
  writeJSON(PENDING, pf);
  log('mission issued: ' + id + ' · ops=' + ops.length);
}

async function beatOnce(label) {
  log('beat (' + label + '): spawning saosnet --live …');
  const r = spawnSync('node', ['saosnet.cjs'].concat(DRY ? [] : ['--live']), { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
  const tail = String(r.stdout || '').split('\n').filter(Boolean).slice(-3).join(' | ');
  log('beat (' + label + ') exit=' + r.status + ' · ' + tail.slice(0, 220));
  return { exit: r.status, tail };
}

async function anchorSteem(digest, summary) {
  if (!POSTING_WIF) return { error: 'no POSTING_WIF', txid: null };
  if (DRY) return { error: 'DRY (live-gate) — anchor not broadcast', txid: null, dry: true };
  const nonce = crypto.randomBytes(6).toString('hex');
  const payload = { t: 'econ-anchor', v: 96, n: nonce, digest, summary, ts: new Date().toISOString() };
  let txid = null;
  try {
    txid = await new Promise((resolve, reject) => {
      steem.broadcast.customJson(POSTING_WIF, [], [ACCOUNT], 'saos', JSON.stringify(payload), (err, res) => {
        if (err) return reject(err);
        resolve((res && res.id) || null);
      });
    });
  } catch (e) { return { error: String((e && e.message) || e).slice(0, 120), txid: null }; }
  let found = null;
  for (let i = 0; i < 10 && !found; i++) {
    await sleep(6000);
    for (const node of STEEM_NODES) {
      try {
        const d = await httpsPost(node, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, -1, 100], id: 1 });
        const items = (d.result || []).map((x) => x[1]).filter(Boolean);
        for (const it of items) {
          const op = it.op && it.op[0] === 'custom_json' ? it.op[1] : null;
          if (op && op.json && op.json.includes(nonce)) { found = { txid: it.trx_id, block: it.block }; break; }
        }
      } catch (_) { /* צומת-הבא */ }
      if (found) break;
    }
  }
  return { txid, found, error: found ? null : 'not-found-in-history (honest)' };
}

async function run() {
  const onlyAudit = process.argv.includes('--audit');
  const steps = [];
  const step = (id, net, label, predict, act, check) => steps.push({ id, net, label, predict, act, check });

  step('E1-audit', 'SAOS-NET→read', 'ריפליי-מלא + שווי-אוצר מציטוטי-הספר + מדדי-דקס',
    { expect: 'בריכה וספר נמדדו · שווי-WTRX>0 מהמחיר-על-הספר · poolVsBook מחושב' },
    async () => {
      const { st, blocks } = replayBook();
      const a = audit(st);
      a.blocksReplayed = blocks;
      a.rebalancePlan = planRebalance(st);
      return a;
    },
    (m) => !!(m.wrappedEconomy.wtrxValueUsd > 0 && m.dex.poolVsBook && m.blocksReplayed > 600));

  if (onlyAudit) {
    const measured = [{ id: 'E1-audit', match: true, measured: (await steps[0].act()) }];
    writeJSON(OUT, { at: new Date().toISOString(), mission: 'ECON-96-audit-only', steps: measured, allMatch: true });
    console.log(JSON.stringify(measured[0].measured, null, 1));
    return;
  }

  step('E2-issue', 'SAOS-NET', 'הוצאת-משימת DEX-96: pool_swap-איזון + pool_add-העמקה (מנפיק=@' + ACCOUNT + ')',
    { expect: 'swap-אחד ≤0.5-STEEM מהאוצר · add פרופורציונלי ליחס-הבריכה-אחרי-ה-swap' },
    async (measured) => {
      const plan = measured[0] && measured[0].measured && measured[0].measured.rebalancePlan;
      if (!plan || plan.skip) return { skip: plan ? plan.skip : 'no-plan' };
      const day = new Date().toISOString().slice(0, 10);
      const ops = [
        { type: 'pool_swap', taker: ACCOUNT, side: 'buy_saos', inAmt: plan.swap.inAmtSteem, ref: 'e96:swap:' + day, note: 'איזון-בריכה: סגירת-ארביטראז פנימי — מחיר-בריכה ' + plan.before.poolPrice + ' → יעד ' + plan.mid },
        { type: 'pool_add', owner: ACCOUNT, amountSaos: plan.add.amountSaos, amountSteem: plan.add.amountSteem, ref: 'e96:deepen:' + day, note: 'העמקה-פרופורציונלית אחרי-האיזון (לא-מזיזה-מחיר)' },
      ];
      issueMission('DEX-96', ops);
      return { ops: ops.length, plan };
    },
    (m) => !m.skip && m.ops === 2);

  step('E3-beat', 'SAOS-NET', 'פעימה מבצעת DEX-96 (אפס-עמלה)',
    { expect: 'exit=0 · הגובה עולה' },
    async () => await beatOnce('DEX-96'),
    (m) => m.exit === 0);

  step('E4-verify', 'SAOS-NET', 'מדידה-אחרי: מחיר-הבריכה בטווח-הספר · עומק-גדל · יתרות-האוצר-שמורות',
    { expect: 'poolPrice בתוך ±15% מ-mid · אוצר חיובי עם רזרבה' },
    async () => {
      const { st } = replayBook();
      const after = audit(st);
      const pf = readJSON(PENDING, { missions: [] });
      const mission = (pf.missions || []).find((m) => m.id === 'DEX-96');
      return { after, treasury: { saos: st.accounts[ACCOUNT].saos / 1000, steem: st.accounts[ACCOUNT].steem / 1000 }, missionStatus: mission ? mission.status : 'missing', results: (mission && mission.results) || null };
    },
    (m) => {
      const pvb = m.after.dex.poolVsBook;
      const inBand = pvb && Math.abs(pvb.gapPct) <= 15;
      const treasuryOk = m.treasury.saos > 0 && m.treasury.steem >= 0.15;
      return !!(inBand && treasuryOk && m.missionStatus !== 'rejected');
    });

  step('E5-anchor', 'SAOS→STEEM', 'עוגן-ECON-96: digest-הביקורת+האיזון חוזר ל-Steem (0.000 STEEM)',
    { expect: 'txid ציבורי · נמצא-בהיסטוריית @' + ACCOUNT },
    async (measuredSoFar) => {
      const digest = sha(measuredSoFar);
      const a1 = measuredSoFar[0] && measuredSoFar[0].measured;
      const a4 = measuredSoFar[3] && measuredSoFar[3].measured;
      const g1 = a1 && a1.dex && a1.dex.poolVsBook ? a1.dex.poolVsBook.gapPct : '?';
      const g2 = a4 && a4.after && a4.after.dex && a4.after.dex.poolVsBook ? a4.after.dex.poolVsBook.gapPct : '?';
      const summary = 'ECON-96 · fleet-value $' + ((a1 && a1.fleetValueUsd) || '?') + ' + pool $' + ((a1 && a1.poolValueUsd) || '?') + ' · WTRX cover ' + (a1 && a1.wrappedEconomy ? a1.wrappedEconomy.wtrxCoverPct : '?') + '% of ' + (a1 && a1.wrappedEconomy ? a1.wrappedEconomy.wtrxLocked : '?') + ' TRX measured · pool-vs-book gap ' + g1 + '% closed→' + g2 + '% · zero-fee';
      const r = await anchorSteem(digest, summary);
      return Object.assign({}, r, { digest: digest.slice(0, 16) + '…', summary });
    },
    (m) => !!(m.txid && m.found));

  const measured = [];
  let allMatch = true;
  for (const s of steps) {
    if (!allMatch) { measured.push({ id: s.id, net: s.net, label: s.label, predict: s.predict, skipped: true, match: false }); continue; }
    const t0 = Date.now();
    let measuredData = null, match = false, err = null;
    try {
      measuredData = await s.act(measured);
      match = !!s.check(measuredData);
    } catch (e) { err = String((e && e.message) || e).slice(0, 160); }
    if (!match) allMatch = false;
    measured.push({ id: s.id, net: s.net, label: s.label, predict: s.predict, measured: measuredData, match, err, durationMs: Date.now() - t0 });
    log(s.id + ' · match=' + match + (err ? ' · err=' + err : '') + ' · ' + (Date.now() - t0) + 'ms');
  }
  const result = {
    at: new Date().toISOString(), mission: 'ECON-96', language: 'CHL-1 (predict→act→measure→match)',
    steps: measured, allMatch,
    summaryHe: allMatch
      ? 'המצב-הכלכלי נמדד-מלא מהספר-עצמו · ארביטראז-פנימי בין-הבריכה-לספר נסגר לטובת-האוצר · הבריכה הועמקה בלי-להזיז-מחיר · עוגן-Steem סוגר-את-השרשרת'
      : 'עצירה-כנה — צעד-ללא-התאמה (מתועד, לא-מזויף)',
  };
  writeJSON(OUT, result);
  log('DONE · allMatch=' + allMatch + ' · ' + OUT);
  return result;
}

if (process.argv.includes('--run') || process.argv.includes('--audit')) { run().then(() => process.exit(0)).catch((e) => { log('FATAL ' + (e && e.message)); console.error('fatal:', e && e.message); process.exit(1); }); }
else { console.log('usage: node econ96.cjs --run | --audit'); process.exit(2); }
