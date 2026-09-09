#!/usr/bin/env node
/* wrap96.cjs — Task 96: TRON-WRAP-ECOSYSTEM — כל-המטבעות-המוכרים של טרון על אותה
 * טכנולוגיה (wrap_mint עם-הוכחת-נעילה), משולבים בגריד ובדקס.
 *
 * העיקרון-הכנה (אחרי-95): רישום-מטבע ≠ הנפקת-ערך. הקרנל op-החדש `asset_list`
 * רושם מטבע-עטוף-מוכר עם חוזה-האם האמיתי שלו על טרון — אבל supply נולד אפס.
 * הדרך-היחידה לאסימונים נשארת wrap_mint עם-ref-נעילה (מגן-under-backed לא זז).
 * הרכבות מוכנות לפיקדונות אמת — בלי-זיוף, בלי-הנפקה-מהאוויר.
 *
 * מקורות-אמת (הכל נמדד-חי, אפס-קידוד-מוצק של עובדות):
 *   · חוזה-מועמד מרישום-CoinGecko (include_platform snapshot שנשמר-מטה בקוד)
 *   · זהות-החוזה מאומתת-חי מול Tronscan (symbol/name/decimals/holders)
 *   · קיום-החוזה נבדק-שנית מול TronGrid mainnet (getaccount → type=Contract +
 *     account_name — getcontractinfo הוסר-מהשירות ב-TronGrid, 404/405)
 *   · מחירים מ-CoinGecko markets (קטגוריית tron-ecosystem) — px בננו-דולר שלם
 *
 * המשימות (כל-אחת ≤12-ops — מגבלת-הפס):
 *   LIST-96  — asset_list ×12 (חוזי-TRC20 מאומתים + WTRX-ילידי + WSTEEM-ילידי)
 *   PRICE-96 — asset_price ×12 (ציטוט-מקור-חתום src+ref+at)
 * הכל אפס-עמלה: על הספר-הריבוני (gas מדידה-בלבד), והעוגן חוזר ל-Steem custom_json.
 *
 * שימוש: node wrap96.cjs --run
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
const OUT = path.join(AGENT_DIR, 'wrap96_result.json');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');

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

function httpsGet(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 SAOS-96', Accept: 'application/json' }, timeout }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('parse: ' + d.slice(0, 100))); } });
    }).on('error', reject).setTimeout(timeout, () => reject(new Error('timeout')));
  });
}
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

/* ── מועמדים: רישום-CoinGecko include_platform (נלקח-חי 2026-09-06; הזהות-עצמה
 *    תאומת-חי מול Tronscan ב-M1 — הקידוד-מטה הוא-רק רשימת-מועמדים, לא-אמת) ── */
const CANDIDATES = [
  { sym: 'WUSDT', cg: 'tether', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', name: 'Tether USD' },
  { sym: 'WUSDC', cg: 'usd-coin', contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', name: 'USD Coin' },
  { sym: 'WUSDD', cg: 'usdd', contract: 'TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz', name: 'Decentralized USD' },
  { sym: 'WTUSD', cg: 'true-usd', contract: 'TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4', name: 'TrueUSD' },
  { sym: 'WJST', cg: 'just', contract: 'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9', name: 'JUST' },
  { sym: 'WSUN', cg: 'sun-token', contract: 'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S', name: 'SUN' },
  { sym: 'WBTT', cg: 'bittorrent', contract: 'TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4', name: 'BitTorrent' },
  { sym: 'WNFT', cg: 'apenft', contract: 'TFczxzPhnThNSqr5by8tvxsdCFRRz6cPNq', name: 'APENFT' },
  { sym: 'WHTX', cg: 'htx-dao', contract: 'TUPM7K8REVzD2UdV4R5fe5M8XbnR2DdoJ6', name: 'HTX DAO' },
  { sym: 'WUSD1', cg: 'usd1-wlfi', contract: 'TPFqcBAaaUMCSVRCqPaQ9QnzKhmuoLR6Rc', name: 'USD1' },
];
const NATIVES = [
  { sym: 'WTRX', chain: 'tron', name: 'TRX native — נעול בכספת-הגשר החיה שלנו (6 כתובות, מדוד 95)' },
  { sym: 'WSTEEM', chain: 'steem', name: 'STEEM native — הצד-המארח של המשק המשוזר' },
];

/* M1 — אימות-חי של כל-חוזה מול Tronscan (זהות) + TronGrid (קיום-חוזה) */
async function verifyContracts() {
  const rows = [];
  for (const c of CANDIDATES) {
    let scan = null, gridOk = null, chainName = null, scanErr = null;
    for (let attempt = 0; attempt < 3 && !scan; attempt++) {
      try {
        const d = await httpsGet('https://apilist.tronscanapi.com/api/token_trc20?contract=' + c.contract + '&limit=3');
        const r = ((d.token_full_list || d.trc20_tokens || d.data || [])[0]) || null;
        if (r) scan = { symbol: r.symbol, name: r.name, decimals: r.decimals, holders: r.holders_count || 0 };
      } catch (e) { scanErr = String(e.message || e).slice(0, 80); }
      if (!scan) await sleep(1500 * (attempt + 1));
    }
    /* TronGrid getcontractinfo הוסר-מהשירות (404/405) — הבדיקה-החלופית:
     * getaccount על כתובת-החוזה → {"account_name":"TetherToken","type":"Contract"}.
     * חשבון-חוזה קיים-תמיד; account_name = שם-החוזה-על-השרשרת (אמת-כפולה עם Tronscan). */
    for (let attempt = 0; attempt < 4 && gridOk === null; attempt++) {
      try {
        const ci = await httpsPost('https://api.trongrid.io/walletsolidity/getaccount', { address: c.contract, visible: true });
        if (ci && ci.Error) throw new Error('trongrid-throttled');
        gridOk = !!(ci && ci.type === 'Contract' && ci.account_name);
        chainName = (ci && ci.account_name) || null;
      } catch (e) {
        if (attempt === 3) gridOk = false;
        else { log('  grid retry ' + c.sym + ' (' + String(e.message || e).slice(0, 50) + ')'); await sleep(4000 * (attempt + 1)); }
      }
    }
    const match = !!(scan && String(scan.symbol).toUpperCase() === c.sym.slice(1));
    rows.push({ sym: c.sym, contract: c.contract, expect: c.name, scan, gridOk, chainName, match, verified: !!(scan && gridOk && match) });
    log('verify ' + c.sym + ' · scan=' + (scan ? scan.symbol : 'FAIL') + ' · grid=' + (gridOk ? chainName : false) + ' · match=' + match);
    await sleep(1500);
  }
  return { rows, verified: rows.filter((r) => r.verified).length, of: rows.length, at: new Date().toISOString() };
}

/* M2 — מחירים אמת: CoinGecko markets (tron-ecosystem) + steem — px בננו-דולר */
async function fetchPrices() {
  let markets = null, lastErr = null;
  for (let attempt = 0; attempt < 4 && !markets; attempt++) {
    try {
      markets = await httpsGet('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=tron-ecosystem&order=market_cap_desc&per_page=25&page=1');
      if (!Array.isArray(markets) || !markets.length) { markets = null; throw new Error('empty markets'); }
    } catch (e) { lastErr = String(e.message || e).slice(0, 80); markets = null; await sleep(2500 * (attempt + 1)); }
  }
  const out = { quotes: {}, src: markets ? 'coingecko:markets:tron-ecosystem' : null, at: new Date().toISOString() };
  if (markets) {
    for (const c of markets) out.quotes[c.id] = { usd: c.current_price, mcap: c.market_cap };
  }
  /* steem מחוץ לקטגוריית-טרון — קריאה-נפרדת */
  try {
    const s = await httpsGet('https://api.coingecko.com/api/v3/simple/price?ids=steem&vs_currencies=usd');
    if (s && s.steem && s.steem.usd) out.quotes.steem = { usd: s.steem.usd, mcap: null };
  } catch (e) { out.steemErr = String(e.message || e).slice(0, 80); }
  out.err = markets ? null : lastErr;
  return out;
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

async function bookScanRefs(refs) {
  const lines = fs.readFileSync(path.join(NODE_DIR, 'chain-archive.jsonl'), 'utf8').trim().split('\n');
  const found = {};
  for (const ln of lines) {
    let b; try { b = JSON.parse(ln); } catch (_) { continue; }
    for (const tx of (b.txs || [])) {
      const r = String(tx.ref || '');
      if (refs.includes(r)) found[r] = { height: b.height, type: tx.type };
    }
  }
  return found;
}

/* M6 — עוגן-Steem custom_json (אפס-עמלה) */
async function anchorSteem(digest, summary) {
  if (!POSTING_WIF) return { error: 'no POSTING_WIF', txid: null };
  if (DRY) return { error: 'DRY (live-gate) — anchor not broadcast', txid: null, dry: true };
  const nonce = crypto.randomBytes(6).toString('hex');
  const payload = { t: 'wrap-anchor', v: 96, n: nonce, digest, summary, ts: new Date().toISOString() };
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
  for (let i = 0; i < 12 && !found; i++) {
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
  const steps = [];
  const step = (id, net, label, predict, act, check) => steps.push({ id, net, label, predict, act, check });

  /* M1 — אימות-חוזות חי */
  step('M1-verify', 'TRON→read', 'אימות-חי: כל-חוזה-מועמד מול Tronscan (זהות) + TronGrid (קיום-חוזה)',
    { expect: '≥8/10 חוזים מאומתים (symbol-match + type=Contract על mainnet) · קריאה-בלבד' },
    async () => await verifyContracts(),
    (m) => m.verified >= 8 && m.of === 10);

  /* M2 — מחירים אמת */
  step('M2-prices', 'FEEDS→read', 'מחירי-שוק אמת (CoinGecko tron-ecosystem + steem) — px ננו-דולר',
    { expect: 'markets אמת עם ≥10 ציטוטים · TRX ו-USDT חייבים-להיות-בהם' },
    async () => {
      const p = await fetchPrices();
      p.hasTrx = !!(p.quotes.tron && p.quotes.tron.usd > 0);
      p.hasUsdt = !!(p.quotes.tether && p.quotes.tether.usd > 0);
      return p;
    },
    (m) => !!(m.src && m.hasTrx && m.hasUsdt && Object.keys(m.quotes).length >= 10));

  /* M3 — הוצאת-המשימות (LIST-96 + PRICE-96) */
  step('M3-issue', 'SAOS-NET', 'הוצאת-משימות TRON-WRAP-96 (asset_list ×≤12 · asset_price ×≤12 · מנפיק=@' + ACCOUNT + ')',
    { expect: '2 משימות פנדינג · ≤12-ops כל-אחת · refs ייחודיים · supply-אפס לכל-רישום-חדש' },
    async (measured) => {
      const ver = measured[0] && measured[0].measured;
      const pr = measured[1] && measured[1].measured;
      if (!ver || !pr) return { error: 'missing prerequisites' };
      const day = new Date().toISOString().slice(0, 10);
      const lists = NATIVES.map((n) => ({
        type: 'asset_list', issuer: ACCOUNT, symbol: n.sym, chain: n.chain, contract: '', decimals: 6,
        ref: 'w96:list:' + n.sym,
        note: n.name,
      }));
      for (const r of ver.rows) {
        if (!r.verified) continue;
        lists.push({
          type: 'asset_list', issuer: ACCOUNT, symbol: r.sym, chain: 'tron', contract: r.contract, decimals: (r.scan.decimals != null ? r.scan.decimals : 6),
          ref: 'w96:list:' + r.sym,
          note: 'TRC20 verified live: ' + String(r.scan.name || '').slice(0, 28) + ' · ' + Number(r.scan.holders || 0).toLocaleString('en-US') + ' holders · chain-name=' + (r.chainName || '?'),
        });
      }
      const prices = [];
      const pxOf = (cgId) => {
        const q = pr.quotes[cgId];
        if (!q || !(q.usd > 0)) return null;
        return Math.round(q.usd * 1e9); // nano-USD שלם
      };
      const pxRows = [['WTRX', 'tron'], ['WSTEEM', 'steem']].concat(ver.rows.filter((r) => r.verified).map((r) => [r.sym, r.cg]));
      for (const [sym, cgId] of pxRows) {
        const px = pxOf(cgId);
        if (!px) { log('price missing (honest): ' + sym + ' — listed without quote'); continue; }
        prices.push({
          type: 'asset_price', issuer: ACCOUNT, symbol: sym, px, unit: 'USD', src: pr.src,
          ref: 'w96:px:' + sym + ':' + day, at: pr.at,
        });
      }
      if (lists.length > 12 || prices.length > 12) return { error: 'ops overflow: lists=' + lists.length + ' prices=' + prices.length };
      issueMission('LIST-96', lists);
      issueMission('PRICE-96', prices);
      return { lists: lists.length, prices: prices.length, symbols: lists.map((o) => o.symbol), priced: prices.map((o) => o.symbol), dropped: ver.rows.filter((r) => !r.verified).map((r) => r.sym + '(' + (r.scan ? 'explorer-symbol=' + r.scan.symbol : 'unreachable') + ')') };
    },
    (m) => !m.error && m.lists >= 10 && m.prices >= 10);

  /* M4 — פעימות: הספר מבצע */
  step('M4-beats', 'SAOS-NET', 'פעימות-הספר מבצעות LIST-96 → PRICE-96 (אפס-עמלה, gas-מדידה-בלבד)',
    { expect: 'exit=0 ×2 · הגובה עולה · אין-FATAL' },
    async () => {
      const b1 = await beatOnce('LIST-96');
      const b2 = await beatOnce('PRICE-96');
      return { b1, b2 };
    },
    (m) => m.b1.exit === 0 && m.b2.exit === 0);

  /* M5 — אימות מהספר-עצמו */
  step('M5-verify', 'SAOS-NET', 'קריאה-חוזרת: refs על הספר + assetMeta/assetPrices במצב-הצומת',
    { expect: 'כל-ה-refs על הספר · assetMetaSummary ≥11 · assetPricesSummary ≥10 · supply=0 לרישומים-החדשים' },
    async () => {
      const nodeSt = readJSON(path.join(NODE_DIR, 'state.json'), {});
      const pf = readJSON(PENDING, { missions: [] });
      const allOps = ((pf.missions || []).filter((m) => ['LIST-96', 'PRICE-96'].includes(m.id)).map((m) => m.ops)).flat();
      const refs = allOps.map((op) => op.ref).filter(Boolean);
      const foundRefs = await bookScanRefs(refs);
      const meta = nodeSt.assetMetaSummary || {};
      const px = nodeSt.assetPricesSummary || {};
      const zeroSupply = Object.entries(nodeSt.wrappedSummary || {}).filter(([k]) => k !== 'WTRX' && k !== 'WSTEEM' && String(k).startsWith('W')).filter(([, v]) => v.supply === 0).map(([k]) => k);
      return {
        found: Object.keys(foundRefs).length, missing: refs.filter((r) => !foundRefs[r]),
        listed: Object.keys(meta).length, priced: Object.keys(px).length,
        meta, px, zeroSupply,
      };
    },
    (m) => m.missing.length === 0 && m.listed >= 11 && m.priced >= 10 && m.zeroSupply.length >= 9);

  /* M6 — עוגן-השרשרת על Steem */
  step('M6-anchor', 'SAOS→STEEM', 'עוגן-WRAP-96: digest-המשימה חוזר ל-Steem כ-custom_json (0.000 STEEM)',
    { expect: 'txid ציבורי · נמצא-בקריאה-חוזרת בהיסטוריית @' + ACCOUNT },
    async (measuredSoFar) => {
      const digest = sha(measuredSoFar);
      const ver = measuredSoFar[0] && measuredSoFar[0].measured;
      const m5 = measuredSoFar[4] && measuredSoFar[4].measured;
      const summary = 'WRAP-96 · ' + (ver ? ver.verified : '?') + '/10 TRC20 contracts live-verified (Tronscan identity + TronGrid on-chain type=Contract) · ' + (m5 ? m5.listed : '?') + ' wrapped assets listed bridge-ready (supply=0, honest) · ' + (m5 ? m5.priced : '?') + ' on-ledger price feeds (nano-USD, signed src+ref) · zero-fee';
      const r = await anchorSteem(digest, summary);
      return Object.assign({}, r, { digest: digest.slice(0, 16) + '…', summary });
    },
    (m) => !!(m.txid && m.found));

  /* ── ביצוע: רק-צעד-שנמדד-מדליק-את-הבא ── */
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
    at: new Date().toISOString(), mission: 'TRON-WRAP-96', language: 'CHL-1 (predict→act→measure→match)',
    steps: measured, allMatch,
    summaryHe: allMatch
      ? 'כל-המטבעות-המוכרים של טרון רשומים על הספר-הריבוני עם חוזה-אם מאומת-חי — supply=0 עד הוכחת-נעילה אמת (אפס-זיוף) · ציטוטי-מחיר חתומים על הספר לדקס ולגריד · עוגן-Steem סוגר-את-השרשרת'
      : 'עצירה-כנה — צעד-ללא-התאמה (מתועד, לא-מזויף)',
  };
  writeJSON(OUT, result);
  log('DONE · allMatch=' + allMatch + ' · ' + OUT);
  return result;
}

if (process.argv.includes('--run')) { run().then(() => process.exit(0)).catch((e) => { log('FATAL ' + (e && e.message)); console.error('fatal:', e && e.message); process.exit(1); }); }
else { console.log('usage: node wrap96.cjs --run'); process.exit(2); }
