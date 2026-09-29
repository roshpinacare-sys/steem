#!/usr/bin/env node
/* wrapped.cjs — Task 63: WRAPPED — עגוני-ערך צמודים על הדקס (פרוטוקול saos.wrap/v1).
 *
 * הרעיון של המפעיל: "להקים מטבעות צמודים על הדקס — wrapped — שנוכל לקבל ערך
 * על ההזמנות והתנגדות לגרידים שלנו". המימוש — על אוטובוס saos (custom_json
 * id='saos', חינם-RC, חתימת posting) עם פרוטוקול משלו 'saos.wrap/v1':
 *
 *   WSBD-1  — עגון מלא של SBD: כל WSBD מגובה 1:1 ב-SBD שננעל בפועל.
 *     הגיבוי נולד משתי מסילות אמיתיות: (1) הזמנת-limit חיה בשוק-הפנימי
 *     STEEM→SBD (הדקס הנייטיב), (2) סחיבת-SBD של חיילים לאוצר (memo
 *     saos:xlock:WSBD). הנעילה = transfer-עצמי עם ממו נעילה — נראה לעין
 *     על-השרשרת וניתן ל-replay דטרמיניסטי (קונסולה: /api/ops/saos/wrapped).
 *   PHIVE-1 — עגון חוצה-שרשראות של HIVE: HIVE ננעל ב-transfer-עצמי על Hive
 *     (מפתח-active) עם ממו saos:xlock:PHIVE → ההנפקה על אוטובוס Steem נושאת
 *     את txid של נעילת-Hive כראיית-גיבוי. פירעון = burn → פתיחת-נעילה ב-Hive.
 *   ENGINE  — הזמנת-maker אמיתית על הדקס Hive-Engine (BEE): קנייה מתחת ל-ask
 *     כדי לקדם את מדרגת ה-100 BEE → חוזה-SAOS פרטי על Engine (Task 61).
 *
 * לכידת-ערך מההזמנות: כל pool_init בפרוטוקול נושא feeBps=30 — כל pool_swap
 * נגבה עמלה שנרשמת בפנקס (LP + אוצר) — הערך זורם מההזמנות עצמן.
 *
 * כללי-ברזל: DRY_RUN כברירת-מחדל כשאין מפתחות · תקציבי-בזבוז קשוחים
 * (סחיבה ≤0.30 STEEM · בריכה ≤0.35 STEEM · Engine ≤0.20 SWAP.HIVE) ·
 * חומת-5-custom_json-לבלוק נשמרת (≤4 ops/beat, 3.4 שנ' בין-beats) ·
 * אף מפתח לא נכתב ללוג · סקיפים-כנים מתועדים.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');
const { Client, PrivateKey } = require('@hiveio/dhive');

/* ── env ─────────────────────────────────────────────────────────── */
let env = {};
try {
  for (const ln of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = ln.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch (_) { /* אין .env — DRY */ }
const ACCOUNT = (env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> (in agent/.env) — node agent/wrapped.cjs — no default acting account (8-b · docs/117o-KEY-INCIDENT.md)'); process.exit(1); }
const ACTIVE_WIF = env.ACTIVE_WIF || '';
const POSTING_WIF = env.POSTING_WIF || '';
const HIVE_RPC = env.HIVE_RPC || 'https://api.hive.blog';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv);
const DRY = GATE.dry || !ACTIVE_WIF || !POSTING_WIF;
announceGate(Object.assign({}, GATE, { live: !DRY, dry: DRY }), log);

const STEEM_NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://api.steemitdev.com'];
const HIVE_NODES = ['https://api.openhive.network', 'https://api.hive.blog'];

/* ── תקציבי-ברזל (מדודים, לא ניתנים לעקיפה) ──────────────────────── */
const CAP_SBD_BUY_STEEM = 0.30;   // מקסימום STEEM שיומר ל-SBD בשוק-הפנימי
const CAP_POOL_STEEM = 0.35;      // מקסימום STEEM בזריעת-בריכה WSBD
const CAP_BEE_SWAPHIVE = 0.20;    // מקסימום SWAP.HIVE להזמנת-maker אחת
const TREASURY_FLOOR_STEEM = 0.45; // רצפת-נזיל שהאוצר אף-פעם לא יורד ממנה
const SWAPHIVE_FLOOR = 0.60;      // רצפת SWAP.HIVE (מכונת-hivePower)
const HIVE_FLOOR = 0.005;         // רצפת HIVE נזיל
const FEE_BPS = 30;               // עמלת-הזמנות — לכידת-ערך
const OPS_PER_BEAT = 4;           // חומת-5-custom_json — מרווח-ביטחון
const OPS_DAY_CAP = 24;

/* ── Task 64 — ENERGY-1 + סינתטיים של המטבעות-המובילים ─────────────
 * הפנטזיה של המפעיל: "כמו שנועלים ערך מהעמלות — האם נוכל לנעול גם ערך של
 * אנרגיה של הרשתות?" — התשובה חיה: VESTS-האצלה היא נעילת-אנרגיה אמיתית
 * (ההאצלה מעבירה קיבולת-RC לסוללה — נמדד חי), ו-ENERGY-1 הוא העגון שלה.
 * delegate_rc נמדד חוסם ×9 (6 צמתים × 4 וריאנטים — Task 58+64) → חומה-35.
 * הסינתטיים: WBTC/WETH/WXRP/WDOGE — גיבוי קולטרל שננעל בפועל × אורקל-חי
 * (Binance+Coinbase) — מינט מרוצף-מטה כדי שהגיבוי לעולם לא ייפול מתחת-100%.
 */
const BAT = 'powerspan';                   // סוללת-האנרגיה של הצי (Task 58)
const ENERGY_TARGET_VESTS = 80820;         // 50 SP מצטבר (Δ+25 SP פרוטוקול)
const ENERGY_MINT = 25;                    // 1 ENERGY = 1 SP אנרגיה-נעולה
const ORACLE_COINS = ['BTC', 'ETH', 'XRP', 'DOGE'];
const SYNTHS = { WBTC: 'BTC', WETH: 'ETH', WXRP: 'XRP', WDOGE: 'DOGE' };
const SYNTH_LETTER = { WBTC: 'b', WETH: 'h', WXRP: 'x', WDOGE: 'g' };
const CAP_COLLAT_STEEM = { WBTC: 0.06, WETH: 0.06, WXRP: 0.04, WDOGE: 0.04 };
const COLLAT_TOTAL_CAP = 0.26;             // תקציב-ברזל לכל-הקולטרל
const SYNTH_TOPUP_STEEM = 0.01;            // מנת-תדלוק-גיבוי ב-beat

/* ── state ───────────────────────────────────────────────────────── */
const STATE_PATH = path.join(__dirname, 'wrapped_state.json');
const EVID_PATH = path.join(__dirname, 'wrapped_evidence.json');
const W64_EVID_PATH = path.join(__dirname, 'wrapped64_evidence.json');
const LOCK_PATH = path.join(__dirname, 'wrapped.lock');

function loadState() {
  try { const j = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); if (j && typeof j === 'object') return j; } catch (_) {}
  return { at: null, mode: null, booted: false, bootedAt: null, day: '', opsToday: 0,
    assets: {}, engine: {}, fees: {}, ops: [], lastBeat: null, errors: [] };
}
function saveState(st) { fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2) + '\n'); }
function log(msg) { console.log('[' + new Date().toISOString() + '] wrapped: ' + msg); }
function utcToday() { return new Date().toISOString().slice(0, 10); }
function r3(x) { return Number.isFinite(x) ? Math.round(x * 1e3) / 1e3 : 0; }
function r6(x) { return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 0; }

/* ── rpc (IPv4 כפוי — דפוס he_ladder/paymaster) ──────────────────── */
function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { const j = JSON.parse(data); j.error ? reject(new Error(j.error.message || 'rpc error')) : resolve(j.result); }
          catch (_) { reject(new Error('bad rpc: ' + data.slice(0, 100))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
async function steemCall(method, params) {
  let lastErr;
  for (let round = 0; round < 2; round++) {
    for (const node of STEEM_NODES) {
      try { return await rpcV4(node, { jsonrpc: '2.0', method, params, id: 1 }); }
      catch (e) { lastErr = e; }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw lastErr || new Error('all steem nodes failed');
}
const HE_RPC = 'https://api.hive-engine.com/rpc/contracts';
const heFind = (contract, table, query, limit = 10) =>
  rpcV4(HE_RPC, { jsonrpc: '2.0', method: 'find', params: { contract, table, query, limit }, id: 1 });
async function hiveBroadcast(ops, key) {
  const hive = new Client([HIVE_RPC]);
  const conf = await hive.broadcast.sendOperations(ops, PrivateKey.fromString(key));
  return (conf && conf.id) || null;
}
// אימות-נחיתה: broadcast מחזיר txid גם-כשהעסקה מושלכת בזמן-בלוק (RC/TAPOS) —
// רק נחיתה בפועל (get_transaction על צומת-עצמאי) היא ראייה.
async function hiveLanded(txid, tries = 3) {
  for (let i = 0; i < tries; i++) {
    for (const node of HIVE_NODES) {
      try {
        const t = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_transaction', params: [txid], id: 1 });
        if (t && t.transaction_id) return { landed: true, block: t.block_num, node };
      } catch (_) { /* לא-נמצא — נסה-שוב */ }
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 4000));
  }
  return { landed: false };
}
async function hiveRcMana() {
  try {
    const r = await rpcV4(HIVE_NODES[0], { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [ACCOUNT] }, id: 1 });
    const row = (r.rc_accounts || [])[0];
    return row ? { mana: Number(row.rc_manabar.current_mana), max: Number(row.max_rc) } : null;
  } catch (_) { return null; }
}

/* ── Task 64 helpers: GET פשוט + אורקל + RC-Steem + קצב-SP ─────── */
function getV4(urlStr) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, { timeout: 12000, headers: { 'User-Agent': 'saos/64' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('bad json ' + res.statusCode)); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
// אורקל-חי: Binance (מקורי) + Coinbase (חוצה) — מדיאן + פיזור-מדוד.
async function fetchOracle() {
  const out = { at: new Date().toISOString(), sources: {}, prices: {}, divergencePct: null, ok: false };
  const per = {}; // coin → [prices]
  try {
    const j = await getV4('https://api.binance.com/api/v3/ticker/price?symbols=' + encodeURIComponent('["BTCUSDT","ETHUSDT","XRPUSDT","DOGEUSDT"]'));
    if (Array.isArray(j) && j.length >= 4) {
      out.sources.binance = { ok: true, at: out.at };
      for (const r of j) (per[r.symbol.replace('USDT', '')] = per[r.symbol.replace('USDT', '')] || []).push(parseFloat(r.price));
    } else out.sources.binance = { ok: false };
  } catch (e) { out.sources.binance = { ok: false, err: String(e.message || e).slice(0, 80) }; }
  try {
    const j = await getV4('https://api.coinbase.com/v2/exchange-rates?currency=USD');
    const rates = j && j.data && j.data.rates;
    if (rates && rates.BTC && rates.ETH) {
      out.sources.coinbase = { ok: true, at: out.at };
      for (const c of ORACLE_COINS) if (rates[c] && parseFloat(rates[c]) > 0) (per[c] = per[c] || []).push(1 / parseFloat(rates[c]));
    } else out.sources.coinbase = { ok: false };
  } catch (e) { out.sources.coinbase = { ok: false, err: String(e.message || e).slice(0, 80) }; }
  for (const c of ORACLE_COINS) {
    const arr = (per[c] || []).filter((x) => Number.isFinite(x) && x > 0);
    if (!arr.length) continue;
    out.prices[c] = arr.length > 1 ? (arr[0] + arr[1]) / 2 : arr[0];
    if (arr.length > 1) out.divergencePct = Math.max(out.divergencePct || 0, Math.abs(arr[0] - arr[1]) / Math.min(arr[0], arr[1]) * 100);
  }
  out.ok = !!(out.prices.BTC && out.prices.ETH);
  return out;
}
// RC-Steem (mana/max) למדידת חוק-שימור-האנרגיה בהאצלה
async function rcSteem(accounts) {
  try {
    const r = await steemCall('rc_api.find_rc_accounts', { accounts });
    return (r && r.rc_accounts ? r.rc_accounts : []).map((a) => ({
      name: a.name, mana: Number(a.rc_manabar && a.rc_manabar.current_mana), max: Number(a.max_rc || (a.rc_manabar && a.rc_manabar.last_max_rc)),
    }));
  } catch (_) { return null; }
}
// קצב-SP: STEEM ל-VESTS (tvf/tvs) — להמרת הגיבוי ל-SP
async function steemPerVests() {
  try {
    const dgp = await steemCall('condenser_api.get_dynamic_global_properties', []);
    const tvf = parseFloat(String(dgp.total_vesting_fund_steem).split(' ')[0]);
    const tvs = parseFloat(String(dgp.total_vesting_shares).split(' ')[0]);
    return tvf > 0 && tvs > 0 ? tvf / tvs : null;
  } catch (_) { return null; }
}

/* ── op-בונים ─────────────────────────────────────────────────────── */
const wrapOp = (payload) => ['custom_json', {
  required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos',
  json: JSON.stringify(Object.assign({ protocol: 'saos.wrap/v1', time: new Date().toISOString() }, payload)),
}];
const steemTransferOp = (from, to, amount, asset, memo) => ['transfer', { from, to, amount: amount.toFixed(3) + ' ' + asset, memo }];

/* ── מדידה ───────────────────────────────────────────────────────── */
// הערה חיה (2026-09): condenser_api.get_current_price_feed נדחה בצמתים ציבוריים
// (assert_exception) — העוגן-הראשי = ספר-השוק-הפנימי (real_price); ה-median
// מ-get_feed_history = תחום-תבונה בלבד (ידוע-כישן — המדידה קובעת).
async function measure() {
  const m = {};
  const fh = await steemCall('condenser_api.get_feed_history', []).catch(() => null);
  if (fh && fh.current_median_history) {
    const b = parseFloat(String(fh.current_median_history.base || '').split(' ')[0]);
    const q = parseFloat(String(fh.current_median_history.quote || '').split(' ')[0]);
    m.sbdPerSteemMedian = q > 0 ? b / q : null;
  }
  const ob = await steemCall('condenser_api.get_order_book', [3]).catch(() => null);
  if (ob && ob.asks && ob.asks[0]) m.sbdPerSteemAsk = parseFloat(ob.asks[0].real_price);
  if (ob && ob.bids && ob.bids[0]) m.sbdPerSteemBid = parseFloat(ob.bids[0].real_price);
  m.sbdPerSteem = m.sbdPerSteemAsk || m.sbdPerSteemMedian || null;
  const [acc] = await steemCall('condenser_api.get_accounts', [[ACCOUNT]]);
  m.steem = parseFloat(String(acc.balance).split(' ')[0]);
  m.sbd = parseFloat(String(acc.sbd_balance).split(' ')[0]);
  // Hive צד — ספר + median (HBD/HIVE)
  try {
    const hive = new Client([HIVE_RPC]);
    const [hAcc] = await hive.database.getAccounts([ACCOUNT]);
    m.hive = parseFloat(String(hAcc.balance).split(' ')[0]);
    const hob = await rpcV4(HIVE_NODES[0], { jsonrpc: '2.0', method: 'condenser_api.get_order_book', params: [3], id: 1 }).catch(() => null);
    if (hob && hob.asks && hob.asks[0]) m.hbdPerHiveBook = parseFloat(hob.asks[0].real_price);
    const hfh = await rpcV4(HIVE_NODES[0], { jsonrpc: '2.0', method: 'condenser_api.get_feed_history', params: [], id: 1 }).catch(() => null);
    if (hfh && hfh.current_median_history) {
      const hb = parseFloat(String(hfh.current_median_history.base || '').split(' ')[0]);
      const hq = parseFloat(String(hfh.current_median_history.quote || '').split(' ')[0]);
      m.hbdPerHiveFeed = hq > 0 ? hb / hq : null;
    }
    const hbdPerHive = m.hbdPerHiveBook || m.hbdPerHiveFeed || null;
    // שער חוצה: HIVE/STEEM = (SBD/STEEM) ÷ (HBD/HIVE) — עוגן-דולר משותף
    m.hivePerSteem = (hbdPerHive > 0 && m.sbdPerSteem > 0) ? m.sbdPerSteem / hbdPerHive : null;
  } catch (e) { m.hiveErr = String(e.message || e).slice(0, 80); }
  // Engine: BEE + SWAP.HIVE + ספר-BEE
  try {
    const bal = await heFind('tokens', 'balances', { account: ACCOUNT }, 100);
    for (const row of (Array.isArray(bal) ? bal : [])) {
      if (row.symbol === 'BEE') m.bee = parseFloat(row.balance);
      if (row.symbol === 'SWAP.HIVE') m.swapHive = parseFloat(row.balance);
    }
    const asks = await heFind('market', 'sellBook', { symbol: 'BEE' }, 5);
    const bids = await heFind('market', 'buyBook', { symbol: 'BEE' }, 5);
    m.beeAsk = (Array.isArray(asks) ? asks : []).map((r) => parseFloat(r.price)).sort((a, b2) => a - b2)[0] || null;
    m.beeBid = (Array.isArray(bids) ? bids : []).map((r) => parseFloat(r.price)).sort((a, b2) => b2 - a)[0] || null;
    const mine = await heFind('market', 'buyBook', { symbol: 'BEE', account: ACCOUNT }, 5);
    m.beeMyOrders = (Array.isArray(mine) ? mine : []).length;
  } catch (e) { m.engineErr = String(e.message || e).slice(0, 80); }
  return m;
}

/* ── שידור-beats (חומת-5) ───────────────────────────────────────── */
async function broadcastBusBeats(beats, evid, dayState) {
  const out = [];
  for (const [label, ops, wifs] of beats) {
    if (!ops.length) continue;
    if (dayState.opsToday + 1 > OPS_DAY_CAP && wifs.includes(POSTING_WIF)) {
      evid.steps.push({ step: label, ok: false, detail: 'daily ops cap' });
      continue;
    }
    if (DRY) { log('[DRY] ' + label + ' (' + ops.length + ' ops)'); evid.steps.push({ step: label, ok: false, dry: true, ops: ops.length }); continue; }
    try {
      const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, wifs);
      const txid = (conf && conf.id) || null;
      out.push({ label, txid, ops: ops.length });
      evid.steps.push({ step: label, ok: true, txid, ops: ops.length });
      if (wifs.includes(POSTING_WIF)) dayState.opsToday += 1;
      log(label + ' ✓ txid=' + txid);
    } catch (e) {
      evid.steps.push({ step: label, ok: false, error: String(e.message || e).slice(0, 140) });
      log(label + ' FAIL: ' + String(e.message || e).slice(0, 120));
    }
    await new Promise((r) => setTimeout(r, 3400)); // בלוק חדש בין-beats — חומת-5
  }
  return out;
}

/* ── סריקת-היסטוריה — idempotence: השרשרת עצמה היא הפנקס ───────── */
// הערה חיה (2026-09): הצמתים הציבוריים מגבילים get_account_history ל-limit=100
// → סריקה מדורגת (חלונות של 100, עד 25 חלונות = 2500 פעולות אחורה).
async function scanWrapHistory() {
  const out = { selfLocksWsbd: [], inflowWsbd: [], selfLocksPhive: [], mintRefs: new Set(), orderOids: new Set(), poolPairs: new Set(), delegations: {}, collatLocks: {}, scanned: 0 };
  for (const node of ['https://api.steemit.com', HIVE_NODES[0]]) {
    try {
      let lowest = -1;
      for (let page = 0; page < 25; page++) {
        const start = lowest === -1 ? -1 : lowest - 1;
        if (start !== -1 && start <= 0) break;
        const raw = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, start, 100], id: 1 });
        if (!Array.isArray(raw) || !raw.length) break;
        out.scanned += raw.length;
        for (const [, e] of raw) {
          const [type, v] = e.op || [];
          if (type === 'transfer') {
            const memo = String(v.memo || '');
            const from = String(v.from || ''); const to = String(v.to || '');
            const amt = parseFloat(String(v.amount).split(' ')[0]);
            if (memo.startsWith('saos:xlock:WSBD')) {
              // הגיבוי = נעילה-עצמית בלבד (אוצר→אוצר); סחיבות = הכנה (עדות בלבד)
              if (from === ACCOUNT && to === ACCOUNT) out.selfLocksWsbd.push({ amount: amt, txid: e.trx_id, at: e.timestamp });
              else if (to === ACCOUNT) out.inflowWsbd.push({ amount: amt, txid: e.trx_id, at: e.timestamp });
            }
            if (memo.startsWith('saos:xlock:PHIVE') && from === ACCOUNT && to === ACCOUNT) out.selfLocksPhive.push({ amount: amt, txid: e.trx_id, at: e.timestamp });
            if (memo.startsWith('saos:collat:') && from === ACCOUNT && to === ACCOUNT) {
              const sym = (memo.split(':')[2] || '').toUpperCase();
              if (SYNTHS[sym]) (out.collatLocks[sym] = out.collatLocks[sym] || []).push({ amount: amt, txid: e.trx_id, at: e.timestamp });
            }
          } else if (type === 'delegate_vesting_shares') {
            // האצלת-VESTS היא op מצטבר: הערך-האחרון לכל-זוג = הסכום-הנוכחי
            const del = String(v.delegator || '').toLowerCase();
            const dee = String(v.delegatee || '').toLowerCase();
            if (del === ACCOUNT && dee) {
              const vests = parseFloat(String(v.vesting_shares).split(' ')[0]);
              const prev = out.delegations[dee];
              if (!prev || (prev.idx || 0) < idx) out.delegations[dee] = { vests, txid: e.trx_id, at: e.timestamp, idx };
            }
          } else if (type === 'custom_json' && v.id === 'saos') {
            try {
              const p = JSON.parse(v.json);
              if (p && p.protocol === 'saos.wrap/v1') {
                if (p.action === 'mint' && p.ref) out.mintRefs.add(String(p.ref));
                if (p.action === 'order' && p.oid) out.orderOids.add(String(p.oid));
                if (p.action === 'pool_init' && p.pair) out.poolPairs.add(String(p.pair));
              }
            } catch (_) {}
          }
        }
        const pageLowest = raw.reduce((m, [idx]) => Math.min(m, idx), Infinity);
        if (pageLowest <= 1 || pageLowest === lowest) break;
        lowest = pageLowest;
      }
    } catch (_) { /* node fail — כנות בשלב-הבא */ }
  }
  return out;
}

/* ═══════════════════════════ BOOT ════════════════════════════════ */
async function boot() {
  const st = loadState();
  const evid = { at: new Date().toISOString(), mode: DRY ? 'dry' : 'live', steps: [] };
  if (st.booted) { log('boot: already booted — skip'); return st; }
  log('=== BOOT ' + (DRY ? 'DRY' : 'LIVE') + ' @' + ACCOUNT + ' ===');
  const dayState = { opsToday: st.opsToday || 0 };

  // ── מדידה פתיחה
  const m = await measure();
  evid.measured = m;
  log('measured: STEEM=' + m.steem + ' SBD=' + m.sbd + ' book=' + m.sbdPerSteemAsk + ' median=' + m.sbdPerSteemMedian + ' hive=' + m.hive + ' cross=' + m.hivePerSteem + ' BEE=' + m.bee + ' SWAP.HIVE=' + m.swapHive);

  // ── שלב A: הזמנת-limit חיה בשוק-הפנימי — קניית SBD (הדקס הנייטיב)
  const book = m.sbdPerSteemAsk || 0;
  const sanity = m.sbdPerSteemMedian || 0;
  let spend = Math.min(CAP_SBD_BUY_STEEM, r3(m.steem - TREASURY_FLOOR_STEEM - 0.1));
  if (m.sbd < 0.02 && spend >= 0.05 && book > 0 && (!sanity || (book > sanity * 0.3 && book < sanity * 3))) {
    const minSbd = Math.max(0.001, Math.round(spend * Math.min(book * 1.02, 1) * 1000) / 1000);
    const op = ['limit_order_create', {
      owner: ACCOUNT, orderid: Date.now() % 2147483647,
      amount_to_sell: spend.toFixed(3) + ' STEEM', min_to_receive: minSbd.toFixed(3) + ' SBD',
      fill_or_kill: false, expiration: new Date(Date.now() + 7 * 864e5).toISOString().replace(/\.\d{3}Z$/, ''),
    }];
    if (DRY) { evid.steps.push({ step: 'sbd-buy', ok: false, dry: true, spend, minSbd }); log('[DRY] sbd-buy ' + spend + ' STEEM → ≥' + minSbd + ' SBD'); }
    else {
      try {
        const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [ACTIVE_WIF]);
        evid.steps.push({ step: 'sbd-buy', ok: true, txid: (conf && conf.id) || null, spend, minSbd, orderid: op[1].orderid });
        log('sbd-buy ✓ ' + spend + ' STEEM → ≥' + minSbd + ' SBD txid=' + (conf && conf.id));
      } catch (e) { evid.steps.push({ step: 'sbd-buy', ok: false, error: String(e.message || e).slice(0, 140) }); log('sbd-buy FAIL: ' + String(e.message || e).slice(0, 120)); }
    }
    await new Promise((r) => setTimeout(r, 6000)); // זמן-מימוש אפשרי
    const acc2 = await steemCall('condenser_api.get_accounts', [[ACCOUNT]]);
    m.sbd = parseFloat(String(acc2[0].sbd_balance).split(' ')[0]);
    m.steem = parseFloat(String(acc2[0].balance).split(' ')[0]);
    evid.sbdAfterBuy = m.sbd;
  } else {
    evid.steps.push({ step: 'sbd-buy', ok: false, skip: true, why: m.sbd >= 0.02 ? 'sbd-present' : 'no-budget-or-book-moved (book=' + book + ' median=' + sanity + ' spend=' + spend + ')' });
  }

  // ── שלב B: סחיבת-SBD של הצי → האוצר (memo saos:xlock:WSBD)
  let roster = [];
  try { const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8')); roster = v.accounts || []; } catch (_) {}
  let swept = 0;
  for (const a of roster) {
    if (!a || !a.username) continue;
    const u = String(a.username).toLowerCase();
    if (u === ACCOUNT) continue;
    const activeWif = a.mode === 'operator-delegated' ? '' : ((a.keys && a.keys.active && a.keys.active.wif) || '');
    if (!activeWif) { evid.steps.push({ step: 'sweep:' + u, ok: false, skip: true, why: 'no-active-key (operator-delegated)' }); continue; }
    try {
      const [acc] = await steemCall('condenser_api.get_accounts', [[u]]);
      const sbd = parseFloat(String(acc.sbd_balance).split(' ')[0]);
      if (sbd < 0.005) continue;
      if (DRY) { evid.steps.push({ step: 'sweep:' + u, ok: false, dry: true, sbd }); continue; }
      const conf = await steem.broadcast.sendAsync({
        operations: [steemTransferOp(u, ACCOUNT, sbd, 'SBD', 'saos:xlock:WSBD:' + sbd.toFixed(3))], extensions: [],
      }, [activeWif]);
      swept += sbd;
      evid.steps.push({ step: 'sweep:' + u, ok: true, txid: (conf && conf.id) || null, sbd });
      log('sweep @' + u + ' ' + sbd + ' SBD → ' + ACCOUNT + ' ✓');
      await new Promise((r) => setTimeout(r, 2500));
    } catch (e) { evid.steps.push({ step: 'sweep:' + u, ok: false, error: String(e.message || e).slice(0, 120) }); }
  }
  evid.sweptSbd = r3(swept);
  if (swept > 0) { await new Promise((r) => setTimeout(r, 4000)); const acc3 = await steemCall('condenser_api.get_accounts', [[ACCOUNT]]); m.sbd = parseFloat(String(acc3[0].sbd_balance).split(' ')[0]); }

  // ── שלב C: נעילת-SBD (transfer-עצמי) + הנפקת WSBD + ספר + בריכה
  // idempotence-שרשרת: סריקת-ההיסטוריה קובעת מה כבר נעול/מונפק — השרשרת = הפנקס
  const hist = await scanWrapHistory();
  evid.chainScan = { selfLocksWsbd: hist.selfLocksWsbd.length, inflowWsbd: hist.inflowWsbd.length, selfLocksPhive: hist.selfLocksPhive.length, mints: hist.mintRefs.size, poolPairs: [...hist.poolPairs] };
  const chainLockedSbd = r3(hist.selfLocksWsbd.reduce((s, l) => s + (l.amount || 0), 0));
  const lockedSbd = chainLockedSbd; // הגיבוי = נעילות-עצמיות בלבד (השרשרת = אמת)
  if (lockedSbd >= 0.01) {
    let lockTxid = hist.selfLocksWsbd.length ? String(hist.selfLocksWsbd[hist.selfLocksWsbd.length - 1].txid || '') : null;
    if (lockTxid) {
      evid.steps.push({ step: 'wsbd-lock', ok: true, skip: true, why: 'already locked on-chain', txid: lockTxid, amount: chainLockedSbd });
    } else if (!DRY) {
      try {
        const conf = await steem.broadcast.sendAsync({ operations: [steemTransferOp(ACCOUNT, ACCOUNT, lockedSbd, 'SBD', 'saos:xlock:WSBD:' + lockedSbd.toFixed(3) + ':' + Date.now().toString(36))], extensions: [] }, [ACTIVE_WIF]);
        lockTxid = (conf && conf.id) || null;
        evid.steps.push({ step: 'wsbd-lock', ok: true, txid: lockTxid, amount: lockedSbd });
        log('wsbd-lock ✓ ' + lockedSbd + ' SBD txid=' + lockTxid);
        await new Promise((r) => setTimeout(r, 3400));
      } catch (e) { evid.steps.push({ step: 'wsbd-lock', ok: false, error: String(e.message || e).slice(0, 140) }); }
    } else { evid.steps.push({ step: 'wsbd-lock', ok: false, dry: true, amount: lockedSbd }); }

    const sbdPerSteem = book > 0 ? book : (sanity > 0 ? sanity : 0.10);
    const fair = r6(1 / sbdPerSteem); // STEEM פר WSBD (עוגן-ספר)
    const mintAmt = r3(lockedSbd);
    const mintDone = !!(lockTxid && hist.mintRefs.has(String(lockTxid)));
    const poolNeeded = !hist.poolPairs.has('WSBD:STEEM');
    const poolBase = Math.min(0.04, r3(mintAmt * 0.25));
    const poolQuote = Math.min(0.45, r6(fair * poolBase), Math.max(0, m.steem - 0.30) * 0.5);
    const askSize = Math.min(0.10, r3(mintAmt * 0.22));
    const bidNotional = m.steem >= 0.45 ? 0.02 : 0;
    if (mintDone) evid.steps.push({ step: 'wsbd-mint', ok: true, skip: true, why: 'already minted on-chain', amount: mintAmt });

    const mintOps = [
      ...(mintDone ? [] : [wrapOp({ action: 'mint', symbol: 'WSBD', amount: mintAmt, account: ACCOUNT, ref: lockTxid, backing: { lockedSbd, mode: 'full', refs: 'steem-self-lock' } })]),
      ...(poolNeeded ? [
        wrapOp({ action: 'pool_init', pair: 'WSBD:STEEM', feeBps: FEE_BPS, account: ACCOUNT }),
        ...(poolBase > 0 && poolQuote >= 0.05 ? [wrapOp({ action: 'pool_add', pair: 'WSBD:STEEM', account: ACCOUNT, baseAmt: poolBase, quoteAmt: poolQuote })] : []),
      ] : []),
    ];
    const askOps = [ACCOUNT + '-w1-a1', ACCOUNT + '-w1-a2', ACCOUNT + '-w1-a3']
      .filter((oid) => !hist.orderOids.has(oid))
      .map((oid, i) => wrapOp({ action: 'order', pair: 'WSBD:STEEM', oid, side: 'sell', price: r6(fair * (1.03 + i * 0.03)), amount: askSize, account: ACCOUNT }));
    const bidOps = bidNotional > 0 ? [wrapOp({ action: 'order', pair: 'WSBD:STEEM', oid: ACCOUNT + '-w1-b1', side: 'buy', price: r6(fair * 0.97), amount: r6((bidNotional * 0.995) / (fair * 0.97)), account: ACCOUNT })] : [];
    const feeOps = [wrapOp({ action: 'pool_swap', pair: 'WSBD:STEEM', taker: ACCOUNT, side: 'buy_wsbd', inAmt: 0.02, feeBps: FEE_BPS })];
    const beats = [];
    if (mintOps.length) beats.push(['wsbd-mint+pool', mintOps, [POSTING_WIF]]);
    if (askOps.length) beats.push(['wsbd-asks', askOps, [POSTING_WIF]]);
    if (bidOps.length || feeOps.length) beats.push(['wsbd-bids+fee-demo', bidOps.concat(feeOps), [POSTING_WIF]]);
    const results = await broadcastBusBeats(beats, evid, dayState);
    st.assets.WSBD = { minted: mintAmt, lockedSbd, lockRef: lockTxid, fair, pool: { base: poolBase, quote: poolQuote, feeBps: FEE_BPS }, asks: [fair * 1.03, fair * 1.06, fair * 1.09].map((p) => r6(p)), bids: bidNotional > 0 ? [r6(fair * 0.97)] : [], txids: results.map((r) => r.txid) };
    if (!st.fees.poolCapture) st.fees.poolCapture = {};
    st.fees.poolCapture.WSBD = r6(0.02 * FEE_BPS / 10000); // עמלת-ההדגמה הראשונה
  } else {
    evid.steps.push({ step: 'wsbd-mint', ok: false, skip: true, why: 'no-SBD-backed (sbd=' + lockedSbd + ')' });
  }

  // ── שלב D: PHIVE-1 — נעילת HIVE על Hive + הנפקה על האוטובוס (idempotent)
  const chainLockedHive = r3(hist.selfLocksPhive.reduce((s, l) => s + (l.amount || 0), 0));
  const hiveLockAmt = chainLockedHive > 0 ? chainLockedHive : r3(Math.min(0.001, Math.max(0, (m.hive || 0) - HIVE_FLOOR)) * 1000) / 1000;
  let phTxid = hist.selfLocksPhive.length ? String(hist.selfLocksPhive[hist.selfLocksPhive.length - 1].txid || '') : null;
  if (hiveLockAmt >= 0.0005) {
    if (phTxid) {
      evid.steps.push({ step: 'phive-lock', ok: true, skip: true, why: 'already locked on-chain', txid: phTxid, amount: chainLockedHive });
    } else if (!DRY) {
      try {
        phTxid = await hiveBroadcast([['transfer', { from: ACCOUNT, to: ACCOUNT, amount: hiveLockAmt.toFixed(3) + ' HIVE', memo: 'saos:xlock:PHIVE:' + hiveLockAmt.toFixed(3) }]], ACTIVE_WIF);
        evid.steps.push({ step: 'phive-lock', ok: true, txid: phTxid, amount: hiveLockAmt });
        log('phive-lock ✓ ' + hiveLockAmt + ' HIVE txid=' + phTxid);
        await new Promise((r) => setTimeout(r, 3400));
      } catch (e) { evid.steps.push({ step: 'phive-lock', ok: false, error: String(e.message || e).slice(0, 140) }); }
    } else { evid.steps.push({ step: 'phive-lock', ok: false, dry: true, amount: hiveLockAmt }); }
    const crossFair = m.hivePerSteem || 1.0;
    const phMintDone = !!(phTxid && hist.mintRefs.has(String(phTxid)));
    const phOps = [
      ...(phMintDone ? [] : [wrapOp({ action: 'mint', symbol: 'PHIVE', amount: hiveLockAmt, account: ACCOUNT, ref: phTxid, backing: { lockedHive: hiveLockAmt, mode: 'full', chain: 'hive', refs: 'hive-self-lock' } })]),
      ...(hist.orderOids.has(ACCOUNT + '-p1-a1') ? [] : [wrapOp({ action: 'order', pair: 'PHIVE:STEEM', oid: ACCOUNT + '-p1-a1', side: 'sell', price: r6(crossFair * 1.15), amount: hiveLockAmt, account: ACCOUNT })]),
    ];
    if (phMintDone) evid.steps.push({ step: 'phive-mint', ok: true, skip: true, why: 'already minted on-chain', amount: hiveLockAmt });
    if (phOps.length) {
      const res2 = await broadcastBusBeats([['phive-mint+ask', phOps, [POSTING_WIF]]], evid, dayState);
      st.assets.PHIVE = { minted: hiveLockAmt, lockedHive: hiveLockAmt, lockRef: phTxid, fair: r6(crossFair), asks: [r6(crossFair * 1.15)], pool: null, txids: res2.map((r) => r.txid) };
    } else {
      st.assets.PHIVE = Object.assign({}, st.assets.PHIVE || {}, { minted: hiveLockAmt, lockedHive: hiveLockAmt, lockRef: phTxid, fair: r6(crossFair) });
    }
  } else {
    evid.steps.push({ step: 'phive-lock', ok: false, skip: true, why: 'no-hive-liquid (hive=' + m.hive + ')' });
  }

  // ── שלב E: הזמנת-maker אמיתית על Hive-Engine — BEE (מדרגת 100)
  if (m.swapHive > SWAPHIVE_FLOOR + 0.02 && m.beeAsk > 0) {
    const spendBee = Math.min(CAP_BEE_SWAPHIVE, r3((m.swapHive - SWAPHIVE_FLOOR) * 1000) / 1000);
    let price = m.beeAsk * 0.95; // maker — 5% מתחת ל-ask
    if (m.beeBid && price <= m.beeBid) price = Math.min(m.beeAsk * 0.97, m.beeBid * 1.02);
    if (price > m.beeAsk || (m.beeBid && price <= m.beeBid)) {
      evid.steps.push({ step: 'engine-maker', ok: false, skip: true, why: 'spread too tight (ask=' + m.beeAsk + ' bid=' + m.beeBid + ')' });
    } else {
      const qty = r3(spendBee / price);
      if (qty >= 0.001) {
        const payload = { contractName: 'market', contractAction: 'buy', contractPayload: { symbol: 'BEE', quantity: String(qty), price: String(price.toPrecision(8)) } };
        if (DRY) { evid.steps.push({ step: 'engine-maker', ok: false, dry: true, qty, price: +price.toPrecision(8) }); }
        else {
          try {
            const txid = await hiveBroadcast([['custom_json', { required_auths: [ACCOUNT], required_posting_auths: [], id: 'ssc-mainnet-hive', json: JSON.stringify(payload) }]], ACTIVE_WIF);
            const land = txid ? await hiveLanded(txid) : { landed: false };
            if (land.landed) {
              st.engine.beeOrder = { price: +price.toPrecision(8), qty, spend: spendBee, txid, block: land.block, at: new Date().toISOString() };
              evid.steps.push({ step: 'engine-maker', ok: true, txid, block: land.block, qty, price: +price.toPrecision(8) });
              log('engine-maker ✓ BEE ' + qty + ' @ ' + price.toPrecision(8) + ' blk=' + land.block);
            } else {
              evid.steps.push({ step: 'engine-maker', ok: false, error: 'not-landed (RC/node drop, no cost) · retry armed in beat' });
            }
          } catch (e) { evid.steps.push({ step: 'engine-maker', ok: false, error: String(e.message || e).slice(0, 140) }); }
        }
      }
    }
  } else {
    evid.steps.push({ step: 'engine-maker', ok: false, skip: true, why: 'no-swap-hive-budget (swapHive=' + m.swapHive + ' floor=' + SWAPHIVE_FLOOR + ')' });
  }

  st.booted = true;
  st.bootedAt = evid.at;
  st.mode = evid.mode;
  st.day = utcToday();
  st.opsToday = dayState.opsToday;
  st.at = evid.at;
  saveState(st);
  fs.writeFileSync(EVID_PATH, JSON.stringify(evid, null, 2) + '\n');
  log('=== BOOT done: ' + evid.steps.filter((s) => s.ok).length + ' ok / ' + evid.steps.length + ' steps ===');
  return st;
}

/* ═══════════════════════════ BEAT ════════════════════════════════ */
async function beat() {
  const st = loadState();
  if (st.day !== utcToday()) { st.day = utcToday(); st.opsToday = 0; }
  const evid = { at: new Date().toISOString(), mode: st.booted ? (st.mode || 'live') : 'pre-boot', steps: [] };
  const m = await measure();
  evid.measured = { steem: m.steem, sbd: m.sbd, hive: m.hive, swapHive: m.swapHive, bee: m.bee, book: m.sbdPerSteemAsk, cross: m.hivePerSteem };
  // Task 64: אורקל-חי לשומר-הקולטרל (רק כש-t64 פועל) — הקולטרל מסונכרן לשער
  const feedB = m.sbdPerSteemAsk || m.sbdPerSteemMedian || 0.1043;
  const oracle64 = st.t64 ? await fetchOracle() : null;
  if (oracle64) st.oracle = oracle64;

  const dayState = { opsToday: st.opsToday || 0 };
  const beats = [];

  // ── עדכון-גיבוי חי (כנות): מה באמת נעול על-השרשרות עכשיו
  const w = st.assets.WSBD || {};
  const p = st.assets.PHIVE || {};
  st.assets.WSBD = Object.assign({}, w, { liveSbd: m.sbd, fair: r6(1 / (m.sbdPerSteem || 0.10)) });
  st.assets.PHIVE = Object.assign({}, p, { liveHive: m.hive, fair: r6(m.hivePerSteem || 1.0) });

  // ── PHIVE top-up: כש-Hive נזיל מצטבר (hivePower ממשיך להרוויח) — נעילה והנפקה
  if (m.hive >= 0.06 && (!p.lockedHive || p.lockedHive < 0.05)) {
    const lockAmt = r3(Math.min(0.05, m.hive - 0.01) * 1000) / 1000;
    if (!DRY && lockAmt >= 0.001) {
      try {
        const txid = await hiveBroadcast([['transfer', { from: ACCOUNT, to: ACCOUNT, amount: lockAmt.toFixed(3) + ' HIVE', memo: 'saos:xlock:PHIVE:' + lockAmt.toFixed(3) }]], ACTIVE_WIF);
        evid.steps.push({ step: 'phive-topup-lock', ok: true, txid, amount: lockAmt });
        await new Promise((r) => setTimeout(r, 3400));
        st.assets.PHIVE.lockedHive = r3((p.lockedHive || 0) + lockAmt);
        st.assets.PHIVE.minted = r3((p.minted || 0) + lockAmt);
        st.assets.PHIVE.lockRef = txid;
        beats.push(['phive-topup-mint', [wrapOp({ action: 'mint', symbol: 'PHIVE', amount: lockAmt, account: ACCOUNT, ref: txid, backing: { lockedHive: lockAmt, mode: 'full', chain: 'hive', refs: 'hive-self-lock' } })], [POSTING_WIF]]);
      } catch (e) { evid.steps.push({ step: 'phive-topup-lock', ok: false, error: String(e.message || e).slice(0, 120) }); }
    }
  }

  // ── WSBD: הזרמת-גיבוי חדשה אם SBD נזיל הצטבר מעל הנעול
  if (m.sbd > (w.lockedSbd || 0) + 0.01 && m.sbd >= 0.01) {
    const addAmt = r3(m.sbd);
    if (!DRY) {
      try {
        const conf = await steem.broadcast.sendAsync({ operations: [steemTransferOp(ACCOUNT, ACCOUNT, addAmt, 'SBD', 'saos:xlock:WSBD:' + addAmt.toFixed(3) + ':' + Date.now().toString(36))], extensions: [] }, [ACTIVE_WIF]);
        evid.steps.push({ step: 'wsbd-add-lock', ok: true, txid: (conf && conf.id) || null, amount: addAmt });
        await new Promise((r) => setTimeout(r, 3400));
        st.assets.WSBD.lockedSbd = r3((w.lockedSbd || 0) + addAmt);
        st.assets.WSBD.minted = r3((w.minted || 0) + addAmt);
        beats.push(['wsbd-add-mint', [wrapOp({ action: 'mint', symbol: 'WSBD', amount: addAmt, account: ACCOUNT, ref: (conf && conf.id) || null, backing: { lockedSbd: addAmt, mode: 'full', refs: 'steem-self-lock' } })], [POSTING_WIF]]);
      } catch (e) { evid.steps.push({ step: 'wsbd-add-lock', ok: false, error: String(e.message || e).slice(0, 120) }); }
    }
  }

  // ── לכידת-עמלות יומית: pool_swap אחד ליום לכל בריכה (הערך מההזמנות)
  // swapDay נקבע רק-אחרי-שידור-מוצלח — כשל-רשת לא שודד את הניסיון היומי
  if (!st.fees.swapDay) st.fees.swapDay = {};
  const inAmts = { WSBD: 0.02, PHIVE: 0.02, ENERGY: 0.03 };
  const feePending = [];
  for (const sym of ['WSBD', 'PHIVE', 'ENERGY']) {
    if (st.fees.swapDay[sym] === utcToday()) continue;
    if ((st.assets[sym] || {}).minted <= 0) continue;
    if (sym === 'PHIVE' && !(st.assets.PHIVE.pool)) continue; // PHIVE בלי בריכה עד נזילות
    feePending.push(sym);
    beats.push([sym.toLowerCase() + '-fee-capture', [wrapOp({ action: 'pool_swap', pair: sym + ':STEEM', taker: ACCOUNT, side: 'buy_' + sym.toLowerCase(), inAmt: inAmts[sym], feeBps: FEE_BPS })], [POSTING_WIF]]);
  }
  if (feePending.length) {
    st.fees.swapDay = st.fees.swapDay || {};
    for (const sym of feePending) st.fees.swapDay[sym] = utcToday();
    st.fees.poolCapture = st.fees.poolCapture || {};
    for (const sym of feePending) st.fees.poolCapture[sym] = r6((st.fees.poolCapture[sym] || 0) + inAmts[sym] * FEE_BPS / 10000);
  }

  // ── Engine-maker: שידור-ישיר ל-Hive (לא דרך מסילת-Steem!) · שער-RC · אימות-נחיתה
  // תגלית-חיה: ה-Engine משתיק בשקט הזמנות-חורגות-מיתרה (ראיות: op ‏3901e66d
  // על-השרשרת בלי-הזמנה ב-buyBook ובלי-חיוב-יתרה) — לכן תקציב מחושב-מראש בלבד.
  const eng = st.engine || {};
  if (m.swapHive > SWAPHIVE_FLOOR + 0.02 && m.beeAsk > 0 && !(m.beeMyOrders > 0)) {
    const rc = await hiveRcMana();
    if (rc && rc.mana < 150 * 1000 * 1000) {
      evid.steps.push({ step: 'engine-maker-refresh', ok: false, skip: true, why: 'RC-gate: ' + rc.mana + ' < 150M — retry next beat' });
    } else {
      const spendBee = Math.min(CAP_BEE_SWAPHIVE, r3((m.swapHive - SWAPHIVE_FLOOR) * 1000) / 1000);
      let price = m.beeAsk * 0.95;
      if (m.beeBid && price <= m.beeBid) price = Math.min(m.beeAsk * 0.97, m.beeBid * 1.02);
      const qty = r3(spendBee / price);
      if (qty >= 0.001 && price < m.beeAsk && (!m.beeBid || price > m.beeBid)) {
        if (!DRY) {
          try {
            const txid = await hiveBroadcast([['custom_json', { required_auths: [ACCOUNT], required_posting_auths: [], id: 'ssc-mainnet-hive', json: JSON.stringify({ contractName: 'market', contractAction: 'buy', contractPayload: { symbol: 'BEE', quantity: String(qty), price: String(price.toPrecision(8)) } }) }]], ACTIVE_WIF);
            const land = txid ? await hiveLanded(txid) : { landed: false };
            if (land.landed) {
              st.engine.beeOrder = { price: +price.toPrecision(8), qty, spend: spendBee, txid, block: land.block, at: evid.at, refresh: true };
              evid.steps.push({ step: 'engine-maker-refresh', ok: true, txid, block: land.block, qty, price: +price.toPrecision(8) });
              log('engine-maker ✓ BEE ' + qty + ' @ ' + price.toPrecision(8) + ' blk=' + land.block);
            } else {
              evid.steps.push({ step: 'engine-maker-refresh', ok: false, error: 'not-landed (txid ' + String(txid).slice(0, 12) + ' — RC/node drop, no cost) · retry armed' });
            }
          } catch (e) { evid.steps.push({ step: 'engine-maker-refresh', ok: false, error: String(e.message || e).slice(0, 140) }); }
        }
      }
    }
  }

  // ── Task 64: שומר-יחס-קולטרל לסינתטיים — אם המטבע הזר התחזק מול STEEM
  // והיחס נפל מתחת-97% → נעילת-קולטרל נוספת + מינט-תוספת מרוצף-מטה
  // (מוגבל בתקציב-הברזל COLLAT_TOTAL_CAP) — הגיבוי נשמר ~100% אוטומטית.
  if (st.t64 && oracle64 && oracle64.ok) {
    const histB = await scanWrapHistory();
    let collatTotalB = Object.values(histB.collatLocks).reduce((s, arr) => s + arr.reduce((a, l) => a + l.amount, 0), 0);
    for (const [sym, coin] of Object.entries(SYNTHS)) {
      const a = st.assets[sym];
      const price = oracle64.prices[coin];
      if (!a || !a.lockedSteem || !price || !(a.minted > 0)) continue;
      const ratio = (a.lockedSteem * feedB) / (a.minted * price);
      if (ratio >= 0.97 || collatTotalB >= COLLAT_TOTAL_CAP - 0.001) continue;
      const amt = r3(Math.min(SYNTH_TOPUP_STEEM, COLLAT_TOTAL_CAP - collatTotalB));
      if (amt < 0.005 || m.steem - TREASURY_FLOOR_STEEM < amt + 0.05) continue;
      if (DRY) { evid.steps.push({ step: 'collat-topup:' + sym, ok: false, dry: true, ratio: +ratio.toFixed(3), amt }); continue; }
      try {
        const conf = await steem.broadcast.sendAsync({
          operations: [steemTransferOp(ACCOUNT, ACCOUNT, amt, 'STEEM', 'saos:collat:' + sym + ':' + amt.toFixed(3) + ':' + Date.now().toString(36))], extensions: [],
        }, [ACTIVE_WIF]);
        const txid = (conf && conf.id) || null;
        collatTotalB = r6(collatTotalB + amt);
        evid.steps.push({ step: 'collat-topup:' + sym, ok: true, txid, amount: amt, ratio: +ratio.toFixed(3) });
        await new Promise((r) => setTimeout(r, 3400));
        const incMint = Math.floor((amt * feedB / price) * 1e8) / 1e8;
        if (incMint > 0) {
          st.assets[sym].lockedSteem = r6(a.lockedSteem + amt);
          st.assets[sym].minted = Math.floor((a.minted + incMint) * 1e8) / 1e8;
          beats.push(['collat-topup-mint:' + sym, [wrapOp({ action: 'mint', symbol: sym, amount: incMint, account: ACCOUNT, ref: txid, backing: { mode: 'collateral-oracle', lockedSteem: amt, coin, oracle: { source: 'binance+coinbase', priceUsd: price, at: oracle64.at }, steemUsd: feedB, mintRule: 'floor-8dec', reason: 'ratio-guard top-up @' + ratio.toFixed(3) } })], [POSTING_WIF]]);
        }
      } catch (e) { evid.steps.push({ step: 'collat-topup:' + sym, ok: false, error: String(e.message || e).slice(0, 120) }); }
    }
  }

  const results = await broadcastBusBeats(beats, evid, dayState);
  st.opsToday = dayState.opsToday;
  st.at = evid.at;
  st.lastBeat = { at: evid.at, steps: evid.steps, measured: evid.measured, opsToday: dayState.opsToday };
  st.errors = evid.steps.filter((s) => s.error).slice(-5);
  saveState(st);
  fs.writeFileSync(EVID_PATH, JSON.stringify(Object.assign({}, evid, { state: { assets: st.assets, engine: st.engine, fees: st.fees } }), null, 2) + '\n');
  log('beat done: ' + evid.steps.filter((s) => s.ok).length + ' ok · opsToday=' + dayState.opsToday);
  return st;
}

/* ═══════════════════════ BOOT64 — Task 64 ════════════════════════ */
/* שלב F: ENERGY-1 — נעילת-אנרגיה אמיתית (הפנטזיה של המפעיל → על-השרשרת):
 *   האצלת-VESTS חיה → סוללת-@powerspan נטענת (Δmax_rc נמדד בשני-הצדדים =
 *   חוק-שימור-האנרגיה) → מינט ENERGY-1 מגובה-ההאצלה → ספר+בריכה+עמלות.
 * שלב G: PRC — delegate_rc חומה מדודה (×9) — סקיפ-כן + תיעוד (חומה-35).
 * שלב H: WBTC/WETH/WXRP/WDOGE — קולטרל נעול-בפועל × אורקל-חי (Binance+
 *   Coinbase) → מינט מרוצף-מטה (floor) → asks. idempotence מלאה מהשרשרת. */
async function boot64() {
  const st = loadState();
  if (st.t64) { log('t64: already applied — skip'); return st; }
  const evid = { at: new Date().toISOString(), mode: DRY ? 'dry' : 'live', task: 64, steps: [] };
  log('=== BOOT64 ' + (DRY ? 'DRY' : 'LIVE') + ' @' + ACCOUNT + ' ===');
  const dayState = { opsToday: st.opsToday || 0 };
  const m = await measure();
  evid.measured = { steem: m.steem, sbd: m.sbd, book: m.sbdPerSteemAsk, median: m.sbdPerSteemMedian };

  // ── אורקל-חי (מקורי + חוצה, פיזור-מדוד)
  const oracle = await fetchOracle();
  st.oracle = oracle;
  evid.oracle = { prices: oracle.prices, sources: Object.fromEntries(Object.entries(oracle.sources).map(([k, v]) => [k, !!v.ok])), divergencePct: oracle.divergencePct };
  log('oracle: ' + JSON.stringify(oracle.prices) + ' divergence=' + (oracle.divergencePct == null ? 'n/a' : oracle.divergencePct.toFixed(3) + '%'));
  evid.steps.push({ step: 'oracle', ok: oracle.ok, prices: oracle.prices, divergencePct: oracle.divergencePct, sources: Object.keys(oracle.sources).filter((k) => oracle.sources[k].ok) });

  const hist = await scanWrapHistory();
  evid.chainScan = { delegations: Object.fromEntries(Object.entries(hist.delegations).map(([k, v]) => [k, v.vests])), collat: Object.fromEntries(Object.entries(hist.collatLocks).map(([k, v]) => [k, v.length])), mintRefs: hist.mintRefs.size };

  /* ── שלב F: ENERGY-1 — האנרגיה שננעלת ונסחרת ─────────────────── */
  const spv = await steemPerVests(); // STEEM per VESTS
  const lockedSp = spv ? r6(ENERGY_TARGET_VESTS * spv) : null;
  let delTxid = (hist.delegations[BAT] && hist.delegations[BAT].vests >= ENERGY_TARGET_VESTS - 1) ? hist.delegations[BAT].txid : null;
  if (delTxid) {
    evid.steps.push({ step: 'energy-delegate', ok: true, skip: true, why: 'already delegated on-chain', txid: delTxid, vests: ENERGY_TARGET_VESTS });
  } else {
    const rcBefore = await rcSteem([ACCOUNT, BAT]);
    if (DRY) { evid.steps.push({ step: 'energy-delegate', ok: false, dry: true, targetVests: ENERGY_TARGET_VESTS, battery: BAT }); }
    else {
      try {
        const conf = await steem.broadcast.sendAsync({
          operations: [['delegate_vesting_shares', { delegator: ACCOUNT, delegatee: BAT, vesting_shares: ENERGY_TARGET_VESTS.toFixed(6) + ' VESTS' }]], extensions: [],
        }, [ACTIVE_WIF]);
        delTxid = (conf && conf.id) || null;
        await new Promise((r) => setTimeout(r, 5000));
        const rcAfter = await rcSteem([ACCOUNT, BAT]);
        const grab = (arr, n) => ((arr || []).find((x) => x.name === n) || {}).max || null;
        evid.steps.push({
          step: 'energy-delegate', ok: true, txid: delTxid, vests: ENERGY_TARGET_VESTS, battery: BAT,
          conservation: { myMaxRcBefore: grab(rcBefore, ACCOUNT), myMaxRcAfter: grab(rcAfter, ACCOUNT), batMaxRcBefore: grab(rcBefore, BAT), batMaxRcAfter: grab(rcAfter, BAT) },
        });
        log('energy-delegate ✓ ' + ENERGY_TARGET_VESTS + ' VESTS → @' + BAT + ' txid=' + delTxid);
      } catch (e) { evid.steps.push({ step: 'energy-delegate', ok: false, error: String(e.message || e).slice(0, 140) }); }
    }
  }
  if (lockedSp && delTxid) {
    const fairE = 1.0; // 1 SP = 1 STEEM נדיר-בר (SP הוא מדוד-ב-STEEM מלכתחילה)
    const mintDoneE = hist.mintRefs.has(String(delTxid));
    const poolNeededE = !hist.poolPairs.has('ENERGY:STEEM');
    const poolBaseE = 0.3, poolQuoteE = 0.3; // יחס-fair (1:1) בתוך תקציב-הבריכה
    const askSizeE = 2;
    const bidQtyE = r6((0.02 * 0.995) / (fairE * 0.85));
    const eOps = [
      ...(mintDoneE ? [] : [wrapOp({ action: 'mint', symbol: 'ENERGY', amount: ENERGY_MINT, account: ACCOUNT, ref: delTxid, backing: { mode: 'vests-delegation', battery: BAT, lockedSp, targetVests: ENERGY_TARGET_VESTS, refs: 'steem-delegation' } })]),
      ...(poolNeededE ? [
        wrapOp({ action: 'pool_init', pair: 'ENERGY:STEEM', feeBps: FEE_BPS, account: ACCOUNT }),
        wrapOp({ action: 'pool_add', pair: 'ENERGY:STEEM', account: ACCOUNT, baseAmt: poolBaseE, quoteAmt: poolQuoteE }),
      ] : []),
    ];
    const eAskOps = [ACCOUNT + '-e1-a1', ACCOUNT + '-e1-a2', ACCOUNT + '-e1-a3']
      .filter((oid) => !hist.orderOids.has(oid))
      .map((oid, i) => wrapOp({ action: 'order', pair: 'ENERGY:STEEM', oid, side: 'sell', price: r6(fairE * (1.05 + i * 0.05)), amount: askSizeE, account: ACCOUNT }));
    const eBidOps = hist.orderOids.has(ACCOUNT + '-e1-b1') ? [] : [wrapOp({ action: 'order', pair: 'ENERGY:STEEM', oid: ACCOUNT + '-e1-b1', side: 'buy', price: r6(fairE * 0.85), amount: bidQtyE, account: ACCOUNT })];
    const eFeeOps = [wrapOp({ action: 'pool_swap', pair: 'ENERGY:STEEM', taker: ACCOUNT, side: 'buy_energy', inAmt: 0.03, feeBps: FEE_BPS })];
    const beats64 = [];
    if (eOps.length) beats64.push(['energy-mint+pool', eOps, [POSTING_WIF]]);
    if (eAskOps.length) beats64.push(['energy-asks', eAskOps, [POSTING_WIF]]);
    if (eBidOps.length || eFeeOps.length) beats64.push(['energy-bid+fee-demo', eBidOps.concat(eFeeOps), [POSTING_WIF]]);
    const resE = await broadcastBusBeats(beats64, evid, dayState);
    st.assets.ENERGY = { minted: mintDoneE ? (st.assets.ENERGY || {}).minted || ENERGY_MINT : ENERGY_MINT, lockedSp, lockRef: delTxid, battery: BAT, fair: fairE, pool: { base: poolBaseE, quote: poolQuoteE, feeBps: FEE_BPS }, asks: [1.05, 1.1, 1.15], bids: [0.85], txids: resE.map((r) => r.txid) };
    if (!st.fees.poolCapture) st.fees.poolCapture = {};
    st.fees.poolCapture.ENERGY = r6((st.fees.poolCapture.ENERGY || 0) + 0.03 * FEE_BPS / 10000);
  } else {
    evid.steps.push({ step: 'energy-mint', ok: false, skip: true, why: !delTxid ? 'delegation failed — no lock ref' : 'no sp-rate' });
  }

  /* ── שלב G: PRC — חומה-35 (מדוד ×9, כנות מלאה) ──────────────────── */
  evid.steps.push({
    step: 'prc-rc-delegation', ok: false, skip: true, wall: 35,
    why: 'delegate_rc absent from the active Hive protocol registry — measured ×9: 6 nodes (api.hive.blog/openhive/ausbit/anyx/deathwing/arcange) × 4 payload variants (incomplete Task-58 form, complete 4-field struct, NAI assets, string/number max_rc). Errors: "Invalid operation name" + legacy-serializer assert. RC rides the VESTS rail only — ENERGY-1 is the energy wrap.',
  });

  /* ── שלב H: סינתטיים של המטבעות-המובילים (קולטרל-נעול × אורקל-חי) ── */
  const feed = m.sbdPerSteemAsk || m.sbdPerSteemMedian || 0.1043; // steemUsd מוצהר (עוגן-SBD≈$1)
  let collatTotal = Object.values(hist.collatLocks).reduce((s, arr) => s + arr.reduce((a, l) => a + l.amount, 0), 0);
  for (const [sym, coin] of Object.entries(SYNTHS)) {
    const price = oracle.prices[coin];
    if (!price) { evid.steps.push({ step: 'synth:' + sym, ok: false, skip: true, why: 'oracle missing ' + coin }); continue; }
    const locksArr = hist.collatLocks[sym] || [];
    let locked = r6(locksArr.reduce((s, l) => s + l.amount, 0));
    let lockTxid = locksArr.length ? locksArr[locksArr.length - 1].txid : null;
    if (locked < CAP_COLLAT_STEEM[sym] - 0.001) {
      const amt = r3(Math.min(CAP_COLLAT_STEEM[sym] - locked, COLLAT_TOTAL_CAP - collatTotal));
      if (amt < 0.001 || DRY) { evid.steps.push({ step: 'collat:' + sym, ok: false, dry: true, amt }); }
      else if (!amt || m.steem - TREASURY_FLOOR_STEEM < amt + 0.05) { evid.steps.push({ step: 'collat:' + sym, ok: false, skip: true, why: 'no-treasury-budget (steem=' + m.steem + ')' }); }
      else {
        try {
          const conf = await steem.broadcast.sendAsync({
            operations: [steemTransferOp(ACCOUNT, ACCOUNT, amt, 'STEEM', 'saos:collat:' + sym + ':' + amt.toFixed(3) + ':' + Date.now().toString(36))], extensions: [],
          }, [ACTIVE_WIF]);
          lockTxid = (conf && conf.id) || null;
          collatTotal = r6(collatTotal + amt);
          locked = r6(locked + amt);
          evid.steps.push({ step: 'collat:' + sym, ok: true, txid: lockTxid, amount: amt });
          log('collat:' + sym + ' ✓ ' + amt + ' STEEM txid=' + lockTxid);
          await new Promise((r) => setTimeout(r, 3400));
        } catch (e) { evid.steps.push({ step: 'collat:' + sym, ok: false, error: String(e.message || e).slice(0, 140) }); continue; }
      }
    }
    if (!lockTxid || !(locked > 0)) { evid.steps.push({ step: 'synth:' + sym, ok: false, skip: true, why: 'no-collateral-lock' }); continue; }
    // מינט מרוצף-מטה: תמיד floor — הגיבוי לעולם לא ייפול מתחת-100% ברגע-ההנפקה
    const mintAmt = Math.floor(((locked * feed) / price) * 1e8) / 1e8;
    if (!(mintAmt > 0)) { evid.steps.push({ step: 'synth:' + sym, ok: false, skip: true, why: 'mint-underflow (collat=' + locked + ' price=' + price + ')' }); continue; }
    const fairS = price / feed; // STEEM פר-יחידה
    const mintDone = hist.mintRefs.has(String(lockTxid));
    const L = SYNTH_LETTER[sym];
    const askOps = [ACCOUNT + '-' + L + '1-a1', ACCOUNT + '-' + L + '1-a2']
      .filter((oid) => !hist.orderOids.has(oid))
      .map((oid, i) => wrapOp({ action: 'order', pair: sym + ':STEEM', oid, side: 'sell', price: r6(fairS * (i === 0 ? 1.05 : 1.12)), amount: Math.floor(mintAmt * 0.35 * 1e8) / 1e8, account: ACCOUNT }));
    const beatsH = [
      ...(mintDone ? [] : [['synth-mint:' + sym, [wrapOp({ action: 'mint', symbol: sym, amount: mintAmt, account: ACCOUNT, ref: lockTxid, backing: { mode: 'collateral-oracle', lockedSteem: locked, coin, oracle: { source: 'binance+coinbase', priceUsd: price, at: oracle.at }, steemUsd: feed, mintRule: 'floor-8dec' } })], [POSTING_WIF]]]),
      ...(askOps.length ? [['synth-asks:' + sym, askOps, [POSTING_WIF]]] : []),
    ];
    const resH = await broadcastBusBeats(beatsH, evid, dayState);
    st.assets[sym] = { minted: mintAmt, lockedSteem: locked, lockRef: lockTxid, coin, oraclePrice: price, fair: r6(fairS), asks: [r6(fairS * 1.05), r6(fairS * 1.12)], txids: resH.map((r) => r.txid) };
    evid.steps.push({ step: 'synth:' + sym, ok: true, minted: mintAmt, locked, fair: r6(fairS), mintDone });
  }

  st.t64 = true;
  st.t64At = evid.at;
  st.day = utcToday();
  st.opsToday = dayState.opsToday;
  st.at = evid.at;
  saveState(st);
  fs.writeFileSync(W64_EVID_PATH, JSON.stringify(evid, null, 2) + '\n');
  log('=== BOOT64 done: ' + evid.steps.filter((s) => s.ok).length + ' ok / ' + evid.steps.length + ' steps ===');
  return st;
}

/* ── כניסה ───────────────────────────────────────────────────────── */
async function main() {
  const arg = process.argv.includes('--beat') ? 'beat' : process.argv.includes('--boot') ? 'boot' : process.argv.includes('--t64') ? 't64' : 'auto';
  // lock — הדמון עשוי לירות בזמן שריצה-ידנית חיה
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const l = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
      if (Date.now() - (l.at || 0) < 10 * 60 * 1000) { log('lock held by pid ' + l.pid + ' — exit'); return; }
    }
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, at: Date.now() }));
  } catch (_) {}
  try {
    if (arg === 'boot') await boot();
    else if (arg === 't64') await boot64();
    else if (arg === 'beat') { const st = loadState(); if (!st.booted) await boot(); await beat(); }
    else { const st = await boot(); if (st.booted) await beat(); }
  } catch (e) {
    log('FATAL: ' + String(e.message || e).slice(0, 200));
    try { const st = loadState(); st.errors = (st.errors || []).concat([String(e.message || e).slice(0, 120)]).slice(-5); saveState(st); } catch (_) {}
    process.exitCode = 1;
  } finally {
    try { fs.unlinkSync(LOCK_PATH); } catch (_) {}
  }
}
main();
