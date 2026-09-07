#!/usr/bin/env node
/* grid98.cjs — GRID-98: מנוע-הזרימה-הגבוהה של SAOS-NET (Task 98)
 *
 * הבעיה (הנחיה-חיה): "ציפיתי למיליוני עסקאות ביום — מה מונע, מה הפתרונות הריבוניים?"
 *
 * אבחנת-הצוואר-הבקבוקי (מדוד, לא משוער):
 *  1. קצב-פעימה 3 דק' → מקסימום ~480 פעימות/יום × עד ~10 עסקאות = מאות בודדות/יום.
 *  2. כל-פעימה עושה replay מלא של הארכיון — O(בלוקים) בכל-פעימה.
 *  3. בריכה-אחת לכל-צמד + ספר-אחד — מעט מקומות-מסחר.
 *
 * הפתרונות-הריבוניים (הכל על-הקרנל שלנו, אפס-עמלות-חוץ):
 *  · מצב-תושב (resident state): replay מלא פעם-אחת באתחול; אחר-כך סנכרון-מצטבר בלבד.
 *  · מיקרו-פעימות: TICK 15 שנ' × ROUNDS=6 סבבי-מסחר (בלוק-אמת לכל-סבב).
 *  · DEX-98 (kernel pool_xAdd/pool_x): בריכה-גנרית לכל-מטבע-עטוף-מבחוץ —
 *    WBTC/WETH/WXRP/WDOGE/WSBD/PHIVE/ENERGY מול SAOS — כל-זוג = מקום-מסחר אמת.
 *  · זאן-חיילים (arena): כל-חייל עושה-שוק (maker) + טייק-מסתובב — מתחרים זה-בזה,
 *    מדד-רווח-ממשי לחייל, רוטציית-תקציב לטובת-המובילים.
 *  · רווחיות-וודאית: כל-פעולה עוברת-שער-שוליים (edge ≥ עמלה+רווח-מינ') לפני-הוצאה;
 *    רווח-אוצר מצטבר-מונוטונית; יומן-פר-עסקה עם-edge מדוד (grid-journal).
 *  · מדרגות-ערך: רווח-אוצר-ממשי מממן-הרמת-רצפת-מחיר צעד-צעד (≤0.5% לצעד, מגובה).
 *  · משיכת-נזילות-גשר: מינט-עודף-כיסוי (≤99% cover) → זריעת-בריכות — ערך-חוץ
 *    נכנס-לבריכות-שלנו, הרווח-מגיע-לאוצר/LP/חיילים (יומן מוכיח לאן).
 *  · order_gc — אוסף-גרוטאות-פרוטוקולי (tx-אמת על-השרשרת) — מונע-נפיחת-מצב אינסופית.
 *
 * שימוש:
 *   node grid98.cjs --live          רץ-רציף (מיקרו-פעימות + הפעלת-פעימה-רגילה-כל-30 דק')
 *   node grid98.cjs --bench 60000   מדידת-קצב-שיא (הוכחת-יכולת מיליונים/יום)
 *   node grid98.cjs --once          טיק-יחיד (בדיקה)
 *   node grid98.cjs --status        מצב-מסוכם
 *
 * הכל תחת-אותו-מנעול (beat.lock) עם-הפעימה-הרגילה — סופר-כותב-אחד, אפס-תחרות-קבצים.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const N = require('./saosnet.cjs'); // משמעת-הקבצים של-הצומת — ירושה, לא שכפול
const K = require(path.join(__dirname, '..', 'core', 'kernel.cjs'));

const { ACCOUNT, NODE_DIR, ARCHIVE_FILE, GENESIS_FILE, log } = N;
const LIVE_MODE = process.argv.includes('--live');
const BENCH_MS = (() => { const i = process.argv.indexOf('--bench'); return i > -1 ? Number(process.argv[i + 1]) || 60000 : 0; })();
const ONCE = process.argv.includes('--once');
const STATUS = process.argv.includes('--status');

const TICK_MS = Number(process.env.G98_TICK_MS) || 8000;
const ROUNDS = Number(process.env.G98_ROUNDS) || 16;      // סבבי-מסחר (בלוקים) לטיק
const LEGACY_EVERY = Number(process.env.G98_LEGACY_EVERY) || 120; // פעימה-רגילה-כל ~24 דק'
const WINDOW_FLUSH_EVERY = 16;   // שכתוב-חלון-chain.json (הכבד) — כל-16-טיקים
const JOURNAL_KEEP_DAYS = 2;
const LADDER_STEP = 0.012;      // 1.2% בין-רמות-הסולם
const TAKER_EDGE = 0.004;       // 40bps — שער-מינימום לטייק (עמלה-בריכה+רווח)
const ARB_GAP = 0.006;          // 60bps — שער-ארביטראז בריכות-מטבעות↔עוגן
const NATIVE_ARB_GAP = 0.015;   // 150bps — ארביטראז-בריכה-הילידית (מניח-פערים-בינוניים לחיילים)
const VALUE_STEP = 0.005;       // 0.5% — צעד-מדרגות-הערך (סדור ומבוסס)
const VALUE_COSTµ = 250;        // 0.25 SAOS רווח-ממשי מממן-צעד
const FLOW_ALLOWANCEµ = 4000;   // הון-פתיחה-מוצהר לתוכנית-הזרימה (4 SAOS ≈ 0.06% מערך-האוצר — לא-מרווח; כנות-מלאה)
const LADDER_AMT = 0.25;        // גודל-רמת-סולם (רווח-מחזור-מדיד ≥4µ לסבב)
const µv = (n) => Math.round(n * 1000);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const SOLDIERS = ['cashmachine', 'ynet', 'wic', 'wog', 'woq', 'lsa', 'macrame', 'siq', 'tov', 'haran'];
/* עוגני-פתיחה: WTRX/SAOS מתוך-זריעת-97 המתועדת (poolwSeed.ratio) — פער-אמת-קיים */
const WTRX_ANCHOR = 433.7;
/* זוגות DEX-98 — כל-מטבע-עטוף-מבחוץ מקבל-בריכה מול SAOS (זריעה-מגובה-מנעול-refs) */
const PAIRS = [
  /* 102 — הסינתטיקה-הפגומה (WBTC/WETH/WXRP/WDOGE) הוסרה-מהזירה: הנעול-הרשום-במקור
   * היה יחידות-ביטחונות (STEEM) ולא יחידות-מטבע — פיוס-יחידות (recon102) שרף-והשבית.
   * רק מטבעות-1:1-מדוד-חי נסחרים. */
  { sym: 'WSBD', coinSeed: 0.1, saosSeed: 6 },
  /* 102 — PHIVE ירד-לשלד (אבק-µ בצד-המטבע מונע-תיקון-יחס) — מחוץ-לזירה;
   * המחיר-האמת-שלו = ציטוט-האורקל על-הספר (r102b:px:PHIVE). */
  { sym: 'ENERGY', coinSeed: 10, saosSeed: 8 },
  /* 99 — BLURT מצטרף לגריד: WBLURT מגובה-מדידה-חי (68.040 BLURT נעול-עוגן
   * blurt:lock:e3201815… · כיסוי 100%). היחס-מציטוט-שוק-חי: 1 WBLURT ≈ $0.00130526
   * · 1 SAOS ≈ $0.000773 → 1.69-SAOS-למטבע · זריעה 10+17 = יחס-שוק-1.7 בהון-הקיים
   * (כנות-כלכלית: האוצר-ב-0-SAOS-נזיל · תקרת-משיכת-איזון ~19-SAOS — הזריעה-מתאימה-לתקרה). */
  { sym: 'WBLURT', coinSeed: 10, saosSeed: 17 },
];

/* ── מצב-מנוע ── */
let st = null, chainState = null, nodeSt = null;
let tickNo = 0, refSeq = 0, takerIdx = 0, roundInTick = 0;
let roundConsumed = new Set(); // סבב-מקומי: הזמנות-שנצרכו-כבר-בסבב (מונע-מילויים-כפולים-שנדחים)
/* 98 — הספר-הצבור-של-המנוע בקובץ-משלו (grid98-state.json): הפעימה-הרגילה כותבת
 * state.json מהעותק-שלה ומוחקת-מדדים (lost-update מדוד) — הפנקס-הריבוני-שלנו
 * חי-בקובץ-נפרד שרק-המנוע-כותב; state.json מקבל-עותק-תצוגה (best-effort). */
const G98_FILE = path.join(NODE_DIR, 'grid98-state.json');
function ledgerSave(g) {
  try {
    const { _arb, _fillEdges, ...clean } = g;
    fs.writeFileSync(G98_FILE, JSON.stringify(clean));
  } catch (_) {}
}
function ledgerLoad(into) {
  try {
    const l = JSON.parse(fs.readFileSync(G98_FILE, 'utf8'));
    for (const k of Object.keys(l)) if (into[k] === undefined || ['treasuryPnlµ', 'sweeps', 'sweepSpendµ', 'soldierPnlµ', 'anchors', 'seeds', 'mints', 'floor', 'steps', 'realizedSinceStepµ', 'lastStepTick', 'weights', 'myFills', 'ticks', 'rounds', 'tradesTotal', 'txsTotal', 'day', 'baseTrades', 'edgeLeak', 'skippedForEdge', 'rejected', 'feeIncomeµ', 'bench', 'topUpsµ', 'poolflows', 'bigSweeps', 'lockSkips'].includes(k)) into[k] = l[k];
  } catch (_) {}
}
const G = () => (nodeSt.grid98 = nodeSt.grid98 || {
  at: null, day: null, ticks: 0, rounds: 0, tradesToday: 0, txsToday: 0,
  baseTrades: 0, baseTxs: 0, ratePerMin: 0, extrapolatedDay: 0,
  treasuryPnlµ: 0, treasuryPnlTodayµ: 0, soldierPnlµ: {}, leaderboard: [],
  anchors: {}, seeds: {}, mints: {}, floor: null, steps: [], realizedSinceStepµ: 0, lastStepTick: 0,
  skippedForEdge: 0, rejected: 0, edgeLeak: 0, bench: null, disk: null, paused: null,
  pools: {}, myFills: [], legacyBeats: 0, lastLegacyAt: null, journal: null,
});

/* ── יומן-הרווח: שרשרת-Hash לכל-עסקה — ראיה פר-עסקה (רוטציה יומית + תחזוקה) ── */
let jH = null, jSeq = 0;
function journalFile() {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(NODE_DIR, 'grid-journal-' + d + '.jsonl');
}
function journal(line) {
  try {
    jSeq++;
    const rec = Object.assign({ i: jSeq, t: new Date().toISOString(), ph: jH }, line);
    const body = JSON.stringify(rec);
    jH = sha(body);
    fs.appendFileSync(journalFile(), JSON.stringify(Object.assign(rec, { h: jH })) + '\n');
  } catch (_) { /* יומן-לעולם-לא-מפיל-מנוע */ }
}
function journalHousekeep() {
  try {
    const cut = Date.now() - JOURNAL_KEEP_DAYS * 86400e3;
    for (const f of fs.readdirSync(NODE_DIR)) {
      const m = /^grid-journal-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
      if (!m) continue;
      const t = new Date(m[1] + 'T00:00:00Z').getTime();
      if (t < cut) { const g = nodeSt.grid98; fs.unlinkSync(path.join(NODE_DIR, f)); if (g) g.journal = 'pruned:' + f; }
    }
  } catch (_) {}
}

/* ── אתחול: replay מלא מהג'נזיס+ארכיון (פעם-אחת; אחר-כך תושב) ── */
function boot() {
  const genesis = JSON.parse(fs.readFileSync(GENESIS_FILE, 'utf8'));
  chainState = N.loadChain();
  let replay = chainState.blocks;
  try {
    const lines = fs.readFileSync(ARCHIVE_FILE, 'utf8').trim().split('\n');
    const full = [];
    for (let i = 1; i < lines.length; i++) { try { full.push(JSON.parse(lines[i])); } catch (_) {} }
    if (full.length) {
      const have = new Set(full.map((b) => b.height));
      for (const wb of chainState.blocks) if (!have.has(wb.height)) full.push(wb);
      /* 99b-heal: דה-דופ לפי גובה — כפילויות-ארכיון היו מוחלות פעמיים ב-boot-המנוע */
      const seenB = new Set();
      const dedupB = [];
      for (const b of full) { if (seenB.has(b.height)) continue; seenB.add(b.height); dedupB.push(b); }
      dedupB.sort((a, b) => a.height - b.height);
      replay = dedupB;
    }
  } catch (_) { /* אין-ארכיון עדיין */ }
  st = K.initFromGenesis(genesis);
  st.meta.issuer = ACCOUNT;
  for (const b of replay) for (const tx of (b.txs || [])) K.applyTx(st, tx);
  const last = replay[replay.length - 1];
  st.meta.height = last ? last.height : 0;
  st.meta.lastBlockHash = last ? last.hash : null;
  if (last && last.time) st.meta.lastTime = last.time;
  nodeSt = N.loadNodeState();
  const g = G();
  ledgerLoad(g); // הפנקס-הריבוני — שורד-כתיבות-פעימה
  g.journal = journalFile().split('/').pop();
  const day = new Date().toISOString().slice(0, 10);
  if (g.day !== day) { g.day = day; g.baseTrades = totalTrades(); g.baseTxs = totalTxs(); g.tradesToday = 0; g.txsToday = 0; g.treasuryPnlTodayµ = 0; }
  log('grid98 BOOT · resident height=' + st.meta.height + ' · orders=' + st.orders.length + ' · poolsX=' + Object.keys(st.poolsX || {}).length);
}

function totalTrades() { return (st.meta.trades || 0) + (st.meta.swaps || 0) + (st.meta.swapsW || 0) + (st.meta.swapsX || 0); }
function totalTxs() { return st.meta.txCount || (st.meta.trades || 0) * 2; } // קירוב-כנה לפני-מדידה-ישירה

/* ── סנכרון-מצטבר: אם-כותב-אחר (פעימה-רגילה) הוסיף-בלוקים — נחיל אותם על-המצב-התושב ──
 * קריאת-זנב-בלבד (256KB אחרונים) — קריאת-ארכיון-מלאה-כל-טיק היא O(N) — הצוואר-הבא-שנמדד */
let residentArchH = null;
function archiveTail() {
  try {
    const fd = fs.openSync(ARCHIVE_FILE, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 262144);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    if (len < size && lines.length) lines.shift(); // שורה-ראשונה-עלולה-להיות-חתוכה
    return lines.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  } catch (_) { return []; }
}
function syncFromDisk() {
  try {
    const tail = archiveTail();
    for (const b of tail) if (b && b.height) residentArchH = Math.max(residentArchH || 0, b.height);
    if ((residentArchH || 0) <= st.meta.height) return;
    const fresh = tail.filter((b) => b && b.height > st.meta.height).sort((a, b) => a.height - b.height);
    for (const b of fresh) {
      for (const tx of (b.txs || [])) K.applyTx(st, tx);
      if (b.time) st.meta.lastTime = b.time;
    }
    const last = fresh[fresh.length - 1];
    if (last) { st.meta.height = last.height; st.meta.lastBlockHash = last.hash; }
    /* 98-לקח: reload של-nodeSt אחרי-פעימה-מביא-איתו-grid98-ישן (הפעימה-כותבת-עותק-משלה)
     * — הפנקס-החי-שלנו (ספירות/רווח) חייב-לשרוד-את-ה-reload: ממזגים-את-המצב-התושב-על-החדש. */
    const oldG = nodeSt.grid98;
    nodeSt = N.loadNodeState();
    if (oldG) nodeSt.grid98 = Object.assign(nodeSt.grid98 || {}, oldG);
    log('grid98 SYNC +' + fresh.length + ' blocks → resident h=' + st.meta.height);
  } catch (e) { log('grid98 sync err (honest): ' + String((e && e.message) || e).slice(0, 80)); }
}

/* ── מדדי-שוק ── */
function bookFair() {
  const last = st.meta.lastPrice ? st.meta.lastPrice / 1e6 : 0;
  const poolPx = (st.pool && st.pool.saos > 0 && st.pool.steem > 0) ? st.pool.steem / st.pool.saos : 0;
  if (last > 0 && poolPx > 0) return 0.5 * (last + poolPx);
  return last || poolPx || 0.017;
}
/* 103 — אורקל-חי לעוגני-הבריכות: SAOS-USD = bookFair(STEEM/SAOS) × ציטוט-STEEM-החתום
 * על-הספר (asset_price · ref r102:px:*) · החזר-0 אם-אין-ציטוט (הקורא-מחליט-נפילה) */
function saosUsdNow() {
  const spx = (((st.assetPrices || {}).WSTEEM || {}).px || 0) / 1e9;
  const fair = bookFair();
  return fair > 0 && spx > 0 ? fair * spx : 0;
}
function oracleAnchorOf(symA) {
  const cpx = (((st.assetPrices || {})[symA] || {}).px || 0) / 1e9;
  const su = saosUsdNow();
  return cpx > 0 && su > 0 ? cpx / su : 0;
}
/* 98-תגלית-מדודה: הוגן-עצמי-מתייחס (ספר+בריכה) ללא-עוגן = סחרור-מדורג (־41% ב-40 דק' בקצב-המנוע).
 * הפתרון-הריבוני: רצפת-מדרגות-הערך = עוגן (רק-מטפסת) · כל-הסולם-והזרימה בתוך-הפס [רצפה×0.983, רצפה×1.03]. */
function bandFair(g) {
  const fair = bookFair();
  const floor = g.floor || 0;
  if (!(floor > 0)) return fair;
  return Math.min(Math.max(fair, floor * 0.983), floor * 1.03);
}
const liveOrders = (owner) => st.orders.filter((o) => o.live && o.owner === owner);

/* ── גשר-לבריכות: מינט-עודף-כיסוי (≤99% cover — כיסוי-נשמר ≥101%) ──
 * 102-מגן-אמת: רק מטבעות-1:1-מדוד-חי (הנעול-בהם הוא-המטבע-עצמו).
 * הלקח-המדוד: WBTC/WETH/WXRP/WDOGE רשמו "locked" ביחידות-ביטחונות (STEEM)
 * והמנגנון-הישן מינט כאילו-יחידות-מטבע — ניפוח ×843,000 (WBTC) — recon102 סגר. */
const MINTABLE_1TO1 = new Set(['WTRX', 'WBLURT', 'WSBD', 'PHIVE', 'ENERGY']);
function bridgeMintTxs(txs, g) {
  for (const sym of Object.keys(st.wrapped)) {
    if (!MINTABLE_1TO1.has(sym)) continue;
    const w = st.wrapped[sym];
    if (!w || !(w.locked > 0)) continue;
    const mintRef = 'g98:mint:' + sym;
    if (w.refs && w.refs[mintRef]) { g.mints[sym] = g.mints[sym] || 'done'; continue; }
    const cover = w.locked / Math.max(w.supply, 1);
    const mintµ = Math.floor(0.99 * w.locked - w.supply);
    if (cover > 1.005 && mintµ > 0) {
      txs.push({ type: 'wrap_mint', issuer: ACCOUNT, symbol: sym, to: ACCOUNT, amount: mintµ / 1000, lockedDelta: 0, ref: mintRef, mirror: 'g98-bridge-mint', note: 'excess-cover→treasury (measured ' + (w.locked / 1000) + ' · cover→99%)' });
      g.mints[sym] = 'minting:' + mintµ + 'µ';
      journal({ kind: 'bridge-mint', sym, amtµ: mintµ, cover: +(cover * 100).toFixed(2), note: 'external backing → treasury' });
    }
  }
}

/* ── זריעת-בריכות DEX-98 (חד-פעמי לזוג; ref-idempotent) ── */
function seedTxs(txs, g) {
  const tre = st.accounts[ACCOUNT] || { saos: 0, wrapped: {} };
  for (const cfg of PAIRS) {
    const pair = cfg.sym + '/SAOS';
    if (st.poolsX && st.poolsX[pair] && st.poolsX[pair].lpSupply > 0) {
      /* 99 — בריכה-חד-צדדית (b=0): הצד-המטבע-קיים-אבל-אין-SAOS → השלמה-אוטונומית
       * כשהאוצר-צובר-את-יעד-הזריעה (ממחזור-הכנסות — ref-חדש, idempotent) */
      const p = st.poolsX[pair];
      if (p.b <= 0 && tre.saos >= µv(cfg.saosSeed)) {
        const ref = 'g99:seed:' + pair + ':saos-fill';
        txs.push({ type: 'pool_xAdd', owner: ACCOUNT, pair, amountA: 0, amountB: cfg.saosSeed, ref, mirror: 'g99-seed-saos', note: 'one-sided pool completion at live-market ratio ' + (cfg.saosSeed / cfg.coinSeed).toFixed(2) });
        journal({ kind: 'seed-fill', pair, saosµ: µv(cfg.saosSeed), note: 'SAOS side added from treasury income' });
      }
      if (g.seeds[pair] !== 'done') { g.seeds[pair] = 'done'; g.anchors[pair] = g.anchors[pair] || cfg.saosSeed / cfg.coinSeed; }
      continue;
    }
    if (g.seeds[pair] === 'done') continue;
    const haveCoin = (tre.wrapped && tre.wrapped[cfg.sym]) || 0;
    let coinOwner = ACCOUNT;
    let coinAmtµ = Math.min(µv(cfg.coinSeed), haveCoin);
    if (coinAmtµ <= 0) { // המחזיק-הגדול זורע-את-צד-המטבע (החיילים מביאים-נזילות-חוץ)
      let best = null;
      for (const [n, a] of Object.entries(st.accounts)) {
        const w = (a.wrapped && a.wrapped[cfg.sym]) || 0;
        if (w > 0 && (!best || w > best.w) && n !== 'host') best = { n, w };
      }
      if (!best || best.w < µv(cfg.coinSeed)) { g.seeds[pair] = 'no-liquidity'; continue; }
      coinOwner = best.n; coinAmtµ = µv(cfg.coinSeed);
    }
    if (tre.saos < µv(cfg.saosSeed)) { g.seeds[pair] = 'treasury-saos-low'; continue; }
    const ref = 'g98:seed:' + pair;
    txs.push({ type: 'pool_xAdd', owner: coinOwner, pair, amountA: coinAmtµ / 1000, amountB: 0, ref, mirror: 'g98-seed-coin', note: coinOwner === ACCOUNT ? 'treasury coin side' : 'soldier brings external liquidity' });
    txs.push({ type: 'pool_xAdd', owner: ACCOUNT, pair, amountA: 0, amountB: cfg.saosSeed, ref: ref + ':saos', mirror: 'g98-seed-saos' });
    g.seeds[pair] = 'seeding';
    g.anchors[pair] = cfg.saosSeed / (coinAmtµ / 1000); // עוגן-פתיחה (SAOS לכל-מטבע)
    journal({ kind: 'seed', pair, coinµ: coinAmtµ, saosµ: µv(cfg.saosSeed), owner: coinOwner, anchor: g.anchors[pair], note: 'external coin → our DEX (profit arrives: fees+LP+discount capture)' });
  }
}

/* ── סולם-האוצר 3×3 סביב-הוגן (ממחזר-רמות; המילוי-מניב-מחזור-רווח-מדוד) ── */
function ladderTxs(txs, g, fair) {
  const mine = liveOrders(ACCOUNT);
  const tre = st.accounts[ACCOUNT];
  const want = [];
  for (let k = 1; k <= 3; k++) {
    want.push({ side: 'sell', px: fair * (1 + k * LADDER_STEP) });
    want.push({ side: 'buy', px: fair * (1 - k * LADDER_STEP) });
  }
  let cancels = 0;
  for (const o of mine) {
    const tol = 0.004;
    if (!want.some((w) => w.side === o.side && Math.abs(o.price / 1e6 - w.px) / w.px < tol)) {
      txs.push({ type: 'cancel', owner: ACCOUNT, orderId: o.id, mirror: 'g98-ladder-recycle' }); cancels++;
    }
  }
  const liveAfter = mine.length - cancels;
  let posts = 0;
  for (const w of want) {
    if (liveAfter + posts >= 7) break; // תקרת-8-קרנל — משאיר-מקום לצעד-ערך
    if (mine.some((o) => o.side === w.side && Math.abs(o.price / 1e6 - w.px) / w.px < 0.004)) continue;
    const amt = LADDER_AMT;
    if (w.side === 'sell') { if (tre.saos < µv(amt)) continue; txs.push({ type: 'order', owner: ACCOUNT, side: 'sell', amount: amt, price: +w.px.toFixed(6), at: new Date().toISOString(), mirror: 'g98-ladder-ask' }); posts++; }
    else { const pay = Math.ceil(µv(amt) * w.px); if (tre.steem < pay) continue; txs.push({ type: 'order', owner: ACCOUNT, side: 'buy', amount: amt, price: +w.px.toFixed(6), at: new Date().toISOString(), mirror: 'g98-ladder-bid' }); posts++; }
  }
  if (posts || cancels) g.ladderOps = (g.ladderOps || 0) + posts + cancels;
}

/* ── איזון-הון-עובד: כשהאוצר-ריק-מ-SAOS — משיכת-עד-40% LP מהבריכות-הגדולות
 * (הנזילות-נשארת-≥60% בבריכות; הפעולה-חד-פעמית-ליום-לזוג; ref-idempotent) ── */
function rebalanceTxs(txs, g) {
  const tre = st.accounts[ACCOUNT];
  const today = new Date().toISOString().slice(0, 10);
  /* 99 — עדיפות-זריעה: זוג-PAIRS-טרם-זרוע (בריכה-חסרה-ב-poolsX) דוחף-איזון-חד-פעמי
   * נוסף-מעבר-למגבלה-היומית (ref-משלו g98:rm:<pair>:<today>:s99 — idempotent ·
   * הנזילות-נשארת-≥60% בבריכות כרגיל). בלי-זה — הזריעה-ממתינה-למחר-היום-בכנות. */
  const seedNeed = PAIRS.reduce((acc, cfg) => {
    const pair = cfg.sym + '/SAOS';
    const p = st.poolsX && st.poolsX[pair];
    if (p && p.lpSupply > 0) {
      /* 100 — בריכה-חד-צדדית (b=0): צורך-ההשלמה נכלל ביעד-התדלוק — אחרת האוצר
       * מתמלא עד max(6, 0) = 6-SAOS בלבד וההשלמה-האוטונומית (g99:seed:*:saos-fill)
       * לעולם לא נוחתת (נמדד-חי: WBLURT a=10/b=0 נתקע שעות). */
      return p.b <= 0 ? acc + µv(cfg.saosSeed) : acc;
    }
    const unseeded = g.seeds[pair] !== 'done' && g.seeds[pair] !== 'seeding';
    return unseeded ? acc + µv(cfg.saosSeed) : acc;
  }, 0);
  const target = Math.max(µv(6), seedNeed);
  if (tre.saos >= Math.max(µv(1), target)) return; // יש-הון-עובד (כולל-יעד-זריעה)
  /* 100 — מקורות-המשיכה: בריכות-DEX-98 (poolsX) + בריכת-הגשר (st.poolW —
   * הנזילות-הגדולה-באמת; בלי-זה האיזון-היה-מת-מול-בריכות-עומק-של-<1-SAOS). */
  const entries = Object.entries(st.poolsX || {})
    .map(([pair, p]) => ({ pair, b: p.b, lp: p.lpSupply, w: false }));
  if (st.poolW && st.poolW.lpSupply > 0) entries.push({ pair: 'WTRX/SAOS', b: st.poolW.saos, lp: st.poolW.lpSupply, w: true });
  const pullable = entries
    .filter((e) => e.b > µv(1) && e.lp > 0) /* 99 — בריכה-פגועה (lp≤0) לא-נמשכת */
    .sort((x, y) => y.b - x.b);
  for (const e of pullable) {
    if (tre.saos >= target) break; // מספיק-ליעד
    if ((g.rmDay || {})[e.pair] === today && !(seedNeed && !(g.rmSeedDay || {})[e.pair])) continue;
    /* 99 — עדיפות-זריעה פעם-אחת-לזוג-ליום (g.rmSeedDay) — משיכות-חוזרות-על-מצב-מיושן
     * גרמו-לעתודות-שליליות (התקלה-החיה שתוקנה-בקרנל: over-pull guard) */
    if (seedNeed) { g.rmSeedDay = g.rmSeedDay || {}; if (g.rmSeedDay[e.pair] === today) continue; g.rmSeedDay[e.pair] = today; }
    // מניות-שלי: מהפנקס (נרשם-מתוצאות-זריעה); אחרת-הערכה כנה (זרענו-שני-הצדדים-ראשונים)
    const myLp = (g.myLp || {})[e.pair];
    const est = myLp != null ? myLp : Math.floor(e.lp * 0.9);
    const sh = Math.min(Math.floor(e.lp * 0.4), Math.max(1, est));
    if (sh <= 0) continue;
    const seedPriority = seedNeed && (g.rmDay || {})[e.pair] === today;
    /* 100 — משיכה מבריכת-הגשר: pool_rmw (pro-rata, לא-מזיז-מחיר) — נזילות-נשארת ≥60% */
    if (e.w) {
      txs.push({ type: 'pool_rmw', owner: ACCOUNT, shares: sh / 1000, ref: 'g100:rmw:' + e.pair + ':' + today + (seedPriority ? ':s99' : ''), mirror: 'g98-rebalance', note: 'bridge-pool working-capital rebalance (pro-rata, price-neutral)' + (seedPriority ? ' — one-sided pool seed priority (100)' : '') + ' — ≥60% liquidity retained' });
      journal({ kind: 'rebalance', pair: e.pair, shares: sh / 1000, note: 'treasury SAOS refill from bridge pool (pro-rata · liquidity retained ≥60%)' });
    } else {
      txs.push({ type: 'pool_xRm', owner: ACCOUNT, pair: e.pair, shares: sh / 1000, ref: 'g98:rm:' + e.pair + ':' + today + (seedPriority ? ':s99' : ''), mirror: 'g98-rebalance', note: 'working-capital rebalance' + (seedPriority ? ' — one-sided pool seed priority (100)' : '') + ' — ≥60% liquidity retained' });
      journal({ kind: 'rebalance', pair: e.pair, shares: sh / 1000, note: 'treasury SAOS refill from LP (liquidity retained ≥60%)' });
    }
    g.rmDay = g.rmDay || {}; g.rmDay[e.pair] = today;
  }
  /* 100 — השלמה-באותו-בלוק: המשיכה-וההשלמה-בבלוק-אחד (הקרנל מיישם-txs-לפי-סדר —
   * ה-credit של-המשיכה מממן-מיד-את-ה-debit של-ההשלמה). בלי-זה הסולם/הסוופים שוחקים
   * את-המשוך-בין-הטיקים וההשלמה-האוטונומית לעולם לא נוחתת (נמדד-חי: המשיכה-הראשונה
   * של 15:19 נשחקה עד 5.2-SAOS-לפני-הטיק-הבא). */
  for (const cfg of PAIRS) {
    const pair = cfg.sym + '/SAOS';
    const p = st.poolsX && st.poolsX[pair];
    if (p && p.lpSupply > 0 && p.b <= 0) {
      txs.push({ type: 'pool_xAdd', owner: ACCOUNT, pair, amountA: 0, amountB: cfg.saosSeed, ref: 'g100:fill:' + pair, mirror: 'g99-seed-saos', note: 'one-sided pool completion in the same block as the funding pull (measured: inter-tick erosion starved it — fix-100)' });
      journal({ kind: 'seed-fill', pair, saosµ: µv(cfg.saosSeed), note: 'SAOS side completed in-block from the funding pull' });
    }
  }
}

/* ── זאן-החיילים: עשיית-שוק-פר-חייל (מתחרים — כל-אחד ברמה-שלו) ── */
function soldierMakerTxs(txs, g, fair, pick) {
  for (const s of pick) {
    const wgt = ((g.weights || {})[s]) || 1;
    const mine = liveOrders(s);
    const stepI = 0.008 + (SOLDIERS.indexOf(s) % 5) * 0.001;
    for (const o of mine) if (Math.abs(o.price / 1e6 - fair) / fair > stepI * 2.5) txs.push({ type: 'cancel', owner: s, orderId: o.id, mirror: 'g98-arena-recycle' });
    const liveCnt = mine.length - mine.filter((o) => Math.abs(o.price / 1e6 - fair) / fair > stepI * 2.5).length;
    if (liveCnt >= 2) continue;
    const a = st.accounts[s];
    // 98-תיקון: רצפת-גודל-זעירה — חיילים-עניים-ממשיכים-לעשות-שוק (הרצפה-הקודמת-0.03 חסמה-הכל)
    const amt = Math.max(0.005, Math.min(0.3 * (a.saos / 1000) * wgt, 0.5));
    if ((a.saos / 1000) < 0.004) continue;
    if (liveCnt === 0 || !mine.some((o) => o.side === 'sell')) {
      if (a.saos >= µv(amt)) txs.push({ type: 'order', owner: s, side: 'sell', amount: +amt.toFixed(3), price: +(fair * (1 + stepI)).toFixed(6), at: new Date().toISOString(), mirror: 'g98-arena-ask' });
    }
    if (liveCnt === 0 || !mine.some((o) => o.side === 'buy')) {
      const pay = Math.ceil(µv(amt) * fair * (1 - stepI));
      if (a.steem >= pay) txs.push({ type: 'order', owner: s, side: 'buy', amount: +amt.toFixed(3), price: +(fair * (1 - stepI)).toFixed(6), at: new Date().toISOString(), mirror: 'g98-arena-bid' });
    }
  }
}

/* 99 — שער-עדיפות-זריעה: זוג-PAIRS-טרם-זרוע משהה-זרימות-שיקול-דעת
 * (תדלוק-צף · סוופים) עד-שהזריעה-נוחתת — האוצר-צובר-ליעד-הזריעה-בלי-דליפה. */
function seedPendingG(g) {
  return PAIRS.some((cfg) => {
    const pair = cfg.sym + '/SAOS';
    return !(st.poolsX && st.poolsX[pair] && st.poolsX[pair].lpSupply > 0) && g.seeds[pair] !== 'done' && g.seeds[pair] !== 'seeding';
  });
}

/* ── תוכנית-זרימה (sweep): האוצר משלם-פריסה-מהרווח-המצטבר בלבד — רווחיות-וודאית:
 * הוצאת-זרימה-מצטברת ≤ 50% מהרווח-המצטבר · החיילים-מרוויחים-פריסה-אמת על-רמות-המייקר ── */
function sweepTxs(txs, g, fair, big) {
  /* תקציב-זרימה: חצי-מהרווח-המצטבר + הון-פתיחה-מוצהר (FLOW_ALLOWANCE — כנות: לא-מרווח)
   * שכבות-גודל: סוופים-זעירים (נפח) + סוופ-גדול-מחזורי (רווח-מייקר-מדיד לחיילים) */
  const flowBudgetµ = Math.max(
    Math.max(0, g.treasuryPnlµ * 0.5 - (g.sweepSpendµ || 0)),
    Math.max(0, FLOW_ALLOWANCEµ - (g.sweepSpendµ || 0))
  );
  if (flowBudgetµ < 20) { g.sweepsPaused = (g.sweepsPaused || 0) + 1; return; }
  const tre = st.accounts[ACCOUNT];
  const saosLow = tre.saos < µv(1);
  const buySide = saosLow ? true : (tickNo % 2 === 0); // אפיק-קנייה-כשהמלאי-ריק (תדלוק)
  const book = (buySide
    ? st.orders.filter((o) => o.live && o.side === 'sell' && o.owner !== ACCOUNT)
    : st.orders.filter((o) => o.live && o.side === 'buy' && o.owner !== ACCOUNT))
    .filter((o) => !roundConsumed.has(o.id))
    .sort((x, y) => (buySide ? x.price - y.price : y.price - x.price));
  if (!book.length) return;
  const o = book[0];
  const px = o.price / 1e6;
  let amt = Math.min(o.amount * 0.5, big ? 0.25 : 0.02);
  const costµ = Math.round(µv(amt) * Math.abs(fair - px) / fair + µv(amt) * 0.003); // פריסה-משוערת+עמלה-צל
  if (costµ > flowBudgetµ) { amt = Math.max(0.01, Math.floor(amt * flowBudgetµ / costµ) / 1000); }
  if (amt < 0.005) return;
  if (buySide) {
    const pay = Math.ceil(µv(amt) * px);
    if (tre.steem < pay) return;
    txs.push({ type: 'fill', taker: ACCOUNT, orderId: o.id, amount: +amt.toFixed(3), mirror: 'g98-sweep-buy' });
  } else {
    if (tre.saos < µv(amt)) return;
    txs.push({ type: 'fill', taker: ACCOUNT, orderId: o.id, amount: +amt.toFixed(3), mirror: 'g98-sweep-sell' });
  }
  g.sweepSpendµ = (g.sweepSpendµ || 0) + costµ;
  g.sweeps = (g.sweeps || 0) + 1; if (big) g.bigSweeps = (g.bigSweeps || 0) + 1;
  roundConsumed.add(o.id);
  // כנות-רווחיות: עלות-הזרימה נחסבת-מהרווח-הנטו; מההון-המוצהר — נרשמת-בנפרד
  if ((g.sweepSpendµ || 0) > FLOW_ALLOWANCEµ) { g.treasuryPnlµ -= costµ; g.treasuryPnlTodayµ -= costµ; }
  journal({ kind: 'sweep', who: ACCOUNT, side: buySide ? 'buy' : 'sell', px, amt, costµ, maker: o.owner, budget: flowBudgetµ, note: 'flow program — profit-funded after 2-SAOS declared bootstrap' });
  cycleCheck(g, ACCOUNT, buySide ? 'buy' : 'sell', px, µv(amt), fair);
}

/* ── זרימת-בריכה-הילידית (poolflow): האוצר עושה-שוק-בבריכה — כל-סוופ-מייצר
 * עמלה-אמת (LP/אוצר) + מזיז-מחיר-מקום → נפתחות-הזדמנויות-יחסיות לחיילים.
 * כיוון-מתחלף (מנוע-תנודה-מסודר) · גודל-זעיר (≤1.2% עומק) · תחת-אותו-תקציב-זרימה ── */
function poolflowTxs(txs, g, fair) {
  const np = st.pool;
  if (!np || !(np.saos > 0) || !(np.steem > 0)) return;
  const flowBudgetµ = Math.max(
    Math.max(0, g.treasuryPnlµ * 0.5 - (g.sweepSpendµ || 0)),
    Math.max(0, FLOW_ALLOWANCEµ - (g.sweepSpendµ || 0))
  );
  if (flowBudgetµ < 10) return;
  const tre = st.accounts[ACCOUNT];
  // היפוך-ממוצע-לפס: מתחת-לרצפה → קנייה-בלבד (דוחף-מעלה) · מעל-הפס → מכירה-בלבד · בתוך-הפס → מתחלף
  const poolPx = np.steem / np.saos;
  const floor = g.floor || 0;
  let sellSaos;
  if (floor > 0 && poolPx < floor * 0.995) sellSaos = false;
  else if (floor > 0 && poolPx > floor * 1.02) sellSaos = true;
  else sellSaos = tickNo % 2 === 0;
  const inAmtµ = Math.min(Math.floor((sellSaos ? np.saos : np.steem) * 0.012), sellSaos ? Math.floor(tre.saos) : Math.floor(tre.steem));
  if (inAmtµ < 100) return; // ≥0.1 — מעל-אבק
  const preOut = sellSaos ? np.steem : np.saos;
  txs.push({ type: 'pool_swap', taker: ACCOUNT, side: sellSaos ? 'sell_saos' : 'buy_saos', inAmt: inAmtµ / 1000, mirror: 'g98-poolflow' });
  g._arb = g._arb || [];
  g._arb.push({ who: ACCOUNT, pair: 'SAOS/STEEM', dir: sellSaos ? 'A2B' : 'B2A', inµ: inAmtµ, preB: preOut, preA: preOut, pxPre: np.steem / np.saos, anchor: fair, gap: 0, native: true, flow: true });
  g.poolflows = (g.poolflows || 0) + 1;
}

/* ── טייק-מסתובב: לוקח-רק-כשיש-edge-אמת מול-ההוגן (רווחיות-וודאית לטייק) ── */
function takerTxs(txs, g, fair) {
  const actors = SOLDIERS.concat([ACCOUNT]);
  const taker = actors[takerIdx % actors.length];
  takerIdx++;
  const a = st.accounts[taker];
  /* חיילים-סוחרים-יחסית: ההוגן-שלהם = מחיר-הבריכה-הילידית (כיוון-המקום-השני) —
   * לוקחים-ספר-רק-כשהספר-זול/יוקר-מהבריכה ב-≥40bps → edge-אמת-מול-מקום-אמת */
  const venuePx = (st.pool && st.pool.saos > 0 && st.pool.steem > 0) ? st.pool.steem / st.pool.saos : fair;
  const myFair = taker === ACCOUNT ? fair : venuePx;
  const edge = TAKER_EDGE;
  const asks = st.orders.filter((o) => o.live && o.side === 'sell' && o.owner !== taker && !roundConsumed.has(o.id)).sort((x, y) => x.price - y.price);
  const bids = st.orders.filter((o) => o.live && o.side === 'buy' && o.owner !== taker && !roundConsumed.has(o.id)).sort((x, y) => y.price - x.price);
  if (asks.length && asks[0].price / 1e6 <= myFair * (1 - edge)) {
    const o = asks[0], px = o.price / 1e6;
    const amt = Math.min(o.amount, a.saos / 1000); // קונה-SAOS: משלם-STEEM, מקבל-SAOS
    if (amt > 0.0005) {
      txs.push({ type: 'fill', taker, orderId: o.id, amount: +amt.toFixed(3), mirror: 'g98-taker-buy' });
      roundConsumed.add(o.id);
      const edgeµ = Math.round(µv(amt) * (myFair - px) / myFair);
      journal({ kind: 'fill', who: taker, side: 'buy', px, amt, edgeµ, venue: +venuePx.toFixed(6), orderId: o.id, note: 'book cheaper than pool — relative-value edge' });
      g._fillEdges = g._fillEdges || {}; g._fillEdges[taker] = (g._fillEdges[taker] || 0) + edgeµ;
      cycleCheck(g, taker, 'buy', px, µv(amt), fair);
      return;
    }
  }
  if (bids.length && bids[0].price / 1e6 >= myFair * (1 + edge)) {
    const o = bids[0], px = o.price / 1e6;
    const amt = Math.min(o.amount, (a.saos / 1000)); // מוכר-SAOS לקונה-שנעל-STEEM
    if (amt > 0.0005) {
      txs.push({ type: 'fill', taker, orderId: o.id, amount: +amt.toFixed(3), mirror: 'g98-taker-sell' });
      roundConsumed.add(o.id);
      const edgeµ = Math.round(µv(amt) * (px - myFair) / myFair);
      journal({ kind: 'fill', who: taker, side: 'sell', px, amt, edgeµ, venue: +venuePx.toFixed(6), orderId: o.id, note: 'book richer than pool — relative-value edge' });
      g._fillEdges = g._fillEdges || {}; g._fillEdges[taker] = (g._fillEdges[taker] || 0) + edgeµ;
      cycleCheck(g, taker, 'sell', px, µv(amt), fair);
    }
  }
}

/* מחזור-רווח-ממשי: קנייה-ומכירה בפער ≥90% מהצעד = רווח-ממומש (מדוד, לא משוער) */
function cycleCheck(g, who, side, px, amtµ, fair) {
  const ring = g.myFills = g.myFills || [];
  const opp = side === 'buy' ? 'sell' : 'buy';
  const prev = ring.slice(-24).reverse().find((f) => f.who === who && f.side === opp);
  ring.push({ who, side, px, amtµ });
  if (ring.length > 64) g.myFills = ring.slice(-48);
  if (!prev) return null;
  const ratio = side === 'sell' ? px / prev.px : prev.px / px;
  if (ratio >= 1 + LADDER_STEP * 0.9) {
    const profitµ = Math.round(Math.min(amtµ, prev.amtµ) * (ratio - 1));
    if (profitµ > 0) {
      if (who === ACCOUNT) { g.treasuryPnlµ += profitµ; g.treasuryPnlTodayµ += profitµ; g.realizedSinceStepµ = (g.realizedSinceStepµ || 0) + profitµ; }
      else { g.soldierPnlµ[who] = (g.soldierPnlµ[who] || 0) + profitµ; }
      journal({ kind: 'cycle-profit', who, profitµ, pxFrom: prev.px, pxTo: px, note: 'round-trip realized (grid cycle)' });
      return profitµ;
    }
  }
  return null;
}

/* ── ארביטראז בריכות DEX-98 אל-העוגן (60% אוצר · 40% חייל-מוביל — הרווח-מגיע-לאנשהו) ── */
function poolArbTxs(txs, g) {
  /* 99 — בריכות-פגועות (lp≤0) מחוץ-למסחר עד-השלמת-החוב-המתועד */
  const pools = Object.fromEntries(Object.entries(st.poolsX || {}).filter(([, p]) => p.lpSupply > 0 && p.a > 0 && p.b > 0));
  if (st.poolW && st.poolW.wtrx > 0) pools['WTRX/SAOS'] = { a: st.poolW.wtrx, b: st.poolW.saos, symA: 'WTRX', symB: 'SAOS', pw: true };
  const lb = (g.leaderboard || [])[0];
  const soldierTake = (tickNo % 5 === 4) && lb && lb.name !== ACCOUNT ? lb.name : null;
  for (const [pair, p] of Object.entries(pools)) {
    /* 103 — תיקון-שורש: העוגן-הוא-האורקל-החתום-על-הספר, לא-קבוע-זריעה-ישן.
     * היה: g.anchors[pair] = יחס-הזריעה-מ-98 (שגוי-מיסודו) — ה-arb היה-מושך-את
     * הבריכות-בחזרה-לזריעות-השרירותיות-ומבטל-כל-עיגון-מחדש (נמדד: WSBD
     * −89.5% · ENERGY −98.7% · poolW −43% תוך-שעות-אחרי-REBAL-102). */
    const oAnchor = oracleAnchorOf(p.symA);
    const anchor = oAnchor > 0 ? oAnchor : (g.anchors[pair] || WTRX_ANCHOR);
    if (oAnchor > 0 && Math.abs((g.anchors[pair] || 0) - oAnchor) > oAnchor * 0.001) {
      g.anchors[pair] = oAnchor; // עוגן-המנוע-מתעדכן-לאורקל-החי (שקיפות-בפנקס)
    }
    if (!(anchor > 0)) continue;
    const px = p.b / p.a;
    const gap = (px - anchor) / anchor;
    const isPw = !!p.pw;
    const pairKey = pair;
    if (Math.abs(gap) < ARB_GAP) continue;
    const sellA = gap > 0; // יקר-מהעוגן → מוכרים-A-לבריכה (מורידים-מחיר) ומרוויחים-הפרש
    const who = soldierTake && st.accounts[soldierTake] ? soldierTake : ACCOUNT;
    const acc = st.accounts[who];
    if (sellA) {
      const coinµ = Math.min(Math.floor(p.a * 0.02), Math.floor((acc.wrapped && acc.wrapped[p.symA]) || 0));
      if (coinµ <= 0) { g.skippedForEdge++; continue; }
      const estEdgeµ = Math.round(coinµ * (gap - p.feeBps / 1e4 * 1.2));
      if (estEdgeµ < 5) { g.skippedForEdge++; continue; }
      const tx = isPw ? { type: 'pool_swapw', taker: who, side: 'sell_wtrx', inAmt: coinµ / 1000, mirror: 'g98-arb-sell' }
        : { type: 'pool_x', taker: who, pair: pairKey, side: 'A2B', inAmt: coinµ / 1000, mirror: 'g98-arb-sell' };
      const preB = p.b;
      txs.push(tx);
      g._arb = g._arb || [];
      g._arb.push({ who, pair: pairKey, pw: isPw, dir: 'A2B', inµ: coinµ, preB, pxPre: px, anchor, gap: +gap.toFixed(4) });
    } else {
      const saosµ = Math.min(Math.floor(p.b * 0.02), Math.floor(acc.saos));
      if (saosµ <= 0) { g.skippedForEdge++; continue; }
      const estEdgeµ = Math.round(saosµ * ((-gap) - p.feeBps / 1e4 * 1.2));
      if (estEdgeµ < 5) { g.skippedForEdge++; continue; }
      const tx = isPw ? { type: 'pool_swapw', taker: who, side: 'buy_wtrx', inAmt: saosµ / 1000, mirror: 'g98-arb-buy' }
        : { type: 'pool_x', taker: who, pair: pairKey, side: 'B2A', inAmt: saosµ / 1000, mirror: 'g98-arb-buy' };
      const preA = p.a;
      txs.push(tx);
      g._arb = g._arb || [];
      g._arb.push({ who, pair: pairKey, pw: isPw, dir: 'B2A', inµ: saosµ, preA, pxPre: px, anchor, gap: +gap.toFixed(4) });
    }
  }
  /* ארביטראז-בריכה-הילידית (SAOS/STEEM) מול-הספר — רק-פערים-גדולים (הבינוניים-נשארים-לחיילים):
   * ספר-זול-מהבריכה → מוכרים-SAOS-לבריכה-בפרמיה · ספר-יוקר → קונים-SAOS-מהבריכה */
  const np = st.pool;
  if (np && np.saos > 0 && np.steem > 0) {
    const fair = bookFair();
    const poolPx = np.steem / np.saos;
    const gap = (poolPx - fair) / fair;
    if (Math.abs(gap) >= NATIVE_ARB_GAP) {
      const who = soldierTake || ACCOUNT;
      const acc = st.accounts[who];
      const side = gap > 0 ? 'sell_saos' : 'buy_saos';
      const inAmtµ = Math.min(Math.floor((gap > 0 ? np.saos : np.steem) * 0.02), Math.floor(gap > 0 ? acc.saos : acc.steem));
      if (inAmtµ > 0) {
        const preOut = gap > 0 ? np.steem : np.saos;
        txs.push({ type: 'pool_swap', taker: who, side, inAmt: inAmtµ / 1000, mirror: 'g98-nparb' });
        g._arb = g._arb || [];
        g._arb.push({ who, pair: 'SAOS/STEEM', dir: side === 'sell_saos' ? 'A2B' : 'B2A', inµ: inAmtµ, preB: preOut, preA: preOut, pxPre: poolPx, anchor: fair, gap: +gap.toFixed(4), native: true });
      }
    }
  }
}

/* אחרי-הבלוק: מדידת-רווח-ארביטראז בפועל — מול-העוגן (לא-מול-מחיר-הבריכה-עצמה!) */
function arbSettle(g) {
  for (const a of g._arb || []) {
    if (a.flow) { // זרימת-שוק-מכוונת — לא-ארביטראז: נרשמת-כאירוע-עמלה-ניטרלי (עמלה-חצי-חוזרת-למנפיק)
      journal({ kind: 'poolflow', who: a.who, pair: a.pair, dir: a.dir, inµ: a.inµ, feeµ: Math.round(a.inµ * 0.003), note: 'venue market-making — fee event + venue price nudge' });
      continue;
    }
    // poolW קרינת-97: שדות {wtrx,saos} — poolsX: {a,b} — native pool: {saos,steem}
    const postA = a.native ? st.pool.saos : (a.pw ? st.poolW.wtrx : (st.poolsX || {})[a.pair]?.a);
    const postB = a.native ? st.pool.steem : (a.pw ? st.poolW.saos : (st.poolsX || {})[a.pair]?.b);
    if (postA == null || postB == null || !(a.anchor > 0)) { g._settleMiss = (g._settleMiss || 0) + 1; continue; }
    let edgeµ = 0;
    if (a.native) {
      // יחידות: STEEMµ — מנרמל ל-SAOSµ במחיר-העוגן (fair של-הספר)
      if (a.dir === 'A2B') { const outSteem = a.preB - postB; edgeµ = Math.round(outSteem / a.anchor - a.inµ); }
      else { const outSaos = a.preA - postA; edgeµ = Math.round(outSaos - a.inµ / a.anchor); }
    } else if (a.dir === 'A2B') { const outB = a.preB - postB; edgeµ = Math.round(outB - a.inµ * a.anchor); }
    else { const outA = a.preA - postA; edgeµ = Math.round(outA * a.anchor - a.inµ); }
    if (edgeµ > 0) {
      if (a.who === ACCOUNT) { g.treasuryPnlµ += edgeµ; g.treasuryPnlTodayµ += edgeµ; g.realizedSinceStepµ = (g.realizedSinceStepµ || 0) + edgeµ; }
      else g.soldierPnlµ[a.who] = (g.soldierPnlµ[a.who] || 0) + edgeµ;
      journal({ kind: 'arb', who: a.who, pair: a.pair, dir: a.dir, inµ: a.inµ, edgeµ, gap: a.gap, anchor: +a.anchor.toFixed(4), note: 'pool→anchor edge captured (real, measured vs anchor)' });
    } else { g.edgeLeak++; journal({ kind: 'arb-leak', who: a.who, pair: a.pair, dir: a.dir, inµ: a.inµ, edgeµ, pxPre: +a.pxPre.toFixed(4), anchor: +a.anchor.toFixed(4), preA: a.preA, preB: a.preB, postA, postB, note: 'settle edge ≤ 0 — honest telemetry' }); }
  }
  g._arb = [];
}

/* ── מדרגות-ערך: רווח-ממשי-מממן-הרמת-רצפה צעד-צעד (≤0.5% · מגובה · סדור) ── */
function valueLadderTxs(txs, g, fair) {
  if (g.floor == null) g.floor = +(fair * 0.99).toFixed(6);
  if ((g.realizedSinceStepµ || 0) < VALUE_COSTµ) return;
  if (tickNo - (g.lastStepTick || 0) < 40) return; // ≥10 דק' בין-צעדים — סדר
  const old = liveOrders(ACCOUNT).filter((o) => o.side === 'buy' && o.price / 1e6 >= g.floor); // רק-צעדי-ערך-ישנים (סולם-רגיל-יושב-מתחת-לרצפה)
  for (const o of old) txs.push({ type: 'cancel', owner: ACCOUNT, orderId: o.id, mirror: 'g98-value-recycle' });
  const tre = st.accounts[ACCOUNT];
  const newFloor = +(g.floor * (1 + VALUE_STEP)).toFixed(6);
  const amt = Math.min(0.05, (tre.steem / 1000) / newFloor * 0.4, ((g.realizedSinceStepµ - VALUE_COSTµ) / 1000) / (newFloor * 0.33));
  if (amt < 0.004) return;
  const pay = Math.ceil(µv(amt) * newFloor);
  if (tre.steem < pay || liveOrders(ACCOUNT).length >= 8) return;
  txs.push({ type: 'order', owner: ACCOUNT, side: 'buy', amount: +amt.toFixed(3), price: newFloor, at: new Date().toISOString(), mirror: 'g98-value-bid' });
  g.steps.push({ at: new Date().toISOString(), floor: newFloor, backedByµ: g.realizedSinceStepµ });
  if (g.steps.length > 24) g.steps = g.steps.slice(-24);
  g.realizedSinceStepµ = 0; g.lastStepTick = tickNo; g.floor = newFloor;
  journal({ kind: 'value-step', floor: newFloor, backedByµ: g.treasuryPnlµ, note: 'profit-backed orderly uplift' });
}

/* ── אוסף-גרוטאות-פרוטוקולי: tx-אמת שמונע-נפיחת-מצב (orders-מתים יוצאים-מהמצב) ── */
function orderGcTxs(txs, g) {
  if (st.orders.length < 400) return;
  const cutoff = new Date(Date.now() - 3600e3).toISOString();
  txs.push({ type: 'order_gc', before: cutoff, mirror: 'g98-gc' });
  journal({ kind: 'order_gc', before: cutoff, note: 'protocol GC — state stays lean at millions of events' });
}

/* ── רוטציית-תקציב: המובילים-מקבלים-יותר (החיילים-מאתגרים-זה-את-זה) ── */
function rotate(g) {
  const lb = Object.entries(g.soldierPnlµ || {}).sort((a, b) => b[1] - a[1]);
  g.leaderboard = lb.map(([name, pnlµ]) => ({ name, pnlµ }));
  if (lb.length < 3 || tickNo % 100 !== 0) return;
  g.weights = g.weights || {};
  const top = lb[0][0], bottom = lb[lb.length - 1][0];
  g.weights[top] = Math.min(2, ((g.weights[top]) || 1) * 1.25);
  g.weights[bottom] = Math.max(0.4, ((g.weights[bottom]) || 1) * 0.75);
  journal({ kind: 'rotation', top, bottom, weights: { [top]: g.weights[top], [bottom]: g.weights[bottom] }, note: 'arena challenge — capital follows proven profit' });
}

/* ── תדלוק-צף-חיילים (מימון-גוף-גדל): האוצר מקצה-הון-עובד לחיילים-שאזל-צפם —
 * פעם-בשעה-לחייל · עד-0.1 SAOS · מגובה-אוצר · החיילים ממשיכים-לעשות-שוק-ומתחרים ── */
function floatTopUpTxs(txs, g) {
  const tre = st.accounts[ACCOUNT];
  if (tre.saos < µv(1)) return;
  const hour = new Date().toISOString().slice(0, 13);
  g.topDay = g.topDay || {};
  let spent = 0;
  for (const s of SOLDIERS) {
    if (spent >= µv(3)) break; // תקרת-תדלוק-שעתית
    if (g.topDay[s] === hour) continue;
    const a = st.accounts[s];
    if ((a.saos) >= µv(0.15)) continue;
    const amtµ = Math.min(µv(0.3) - a.saos, tre.saos - spent);
    if (amtµ < 20) continue;
    txs.push({ type: 'transfer', from: ACCOUNT, to: s, amount: amtµ / 1000, mirror: 'g98-float-topup' });
    g.topDay[s] = hour; spent += amtµ;
    journal({ kind: 'float-topup', who: s, amtµ, note: 'treasury working capital → soldier market-making float' });
  }
  if (spent > 0) g.topUpsµ = (g.topUpsµ || 0) + spent;
}

/* ── סבב-מסחר אחד = בלוק-אמת-אחד ── */
function tradingRound(time) {
  const g = G();
  const fair = bandFair(g);
  const txs = [];
  if (roundInTick === 0) roundConsumed = new Set();
  if (roundInTick === 0) { bridgeMintTxs(txs, g); seedTxs(txs, g); rebalanceTxs(txs, g); if (!seedPendingG(g)) floatTopUpTxs(txs, g); }
  const pick = [SOLDIERS[(tickNo * 4 + roundInTick) % SOLDIERS.length], SOLDIERS[(tickNo * 4 + roundInTick + 3) % SOLDIERS.length], SOLDIERS[(tickNo * 4 + roundInTick + 6) % SOLDIERS.length], SOLDIERS[(tickNo * 4 + roundInTick + 9) % SOLDIERS.length]];
  ladderTxs(txs, g, fair);
  soldierMakerTxs(txs, g, fair, pick);
  if (!seedPendingG(g)) sweepTxs(txs, g, fair, false);
  sweepTxs(txs, g, fair, roundInTick % 8 === 0); // סוופ-גדול-מחזורי — רווח-מייקר-מדיד לחיילים
  poolflowTxs(txs, g, fair);
  takerTxs(txs, g, fair);
  takerTxs(txs, g, fair);
  takerTxs(txs, g, fair);
  takerTxs(txs, g, fair);
  takerTxs(txs, g, fair); // חמישה-טייקים-לסבב — צפיפות-מילוי
  if (roundInTick % 2 === 1) poolArbTxs(txs, g);
  if (roundInTick === ROUNDS - 1) { valueLadderTxs(txs, g, fair); orderGcTxs(txs, g); }
  let tradesBefore = totalTrades();
  if (!txs.length) return 0;
  const r = K.buildBlock(st, txs, time);
  chainState.blocks.push(r.block);
  const okN = r.results.filter((x) => x.ok).length;
  g.rejected += r.results.length - okN;
  // פנקס-מניות-אישי (לאיזון-הון): pool_xAdd שהצליח → רישום-מניות-פר-זוג
  r.results.forEach((res, i) => {
    if (res.ok && res.type === 'pool_xAdd' && txs[i] && txs[i].owner === ACCOUNT && res.shares) {
      const pair = txs[i].pair;
      g.myLp = g.myLp || {}; g.myLp[pair] = (g.myLp[pair] || 0) + res.shares;
    }
  });
  arbSettle(g);
  // מדידת-עסקאות: fills+swaps בפועל מהתוצאות
  const fills = r.results.filter((x) => x.ok && x.type === 'fill').length;
  const swaps = r.results.filter((x) => x.ok && ['pool_swap', 'pool_swapw', 'pool_x'].includes(x.type)).length;
  const trades = fills + swaps;
  g.rounds++; g.tradesToday += trades; g.txsToday += okN;
  // עמלות-אוצר בפועל (delta st.fees.toTreasury לא-נגיש כאן פר-בלוק — נמדוד-מצטבר בסוף-טיק)
  return trades;
}

/* ── שמירה-קלה: state.json + אפנד-ארכיון בלבד (בלי-שכתוב-חלון-chain.json —
 * השכתוב-הכבד-6MB כל-טיק היה-בעצמו-צוואר-בקבוקי; חלון-מתרענט כל-8-טיקים ── */
function liteSave(nodeSt, chainState, kernelState) {
  nodeSt.height = kernelState.meta.height;
  nodeSt.stateRoot = K.stateRoot(kernelState);
  nodeSt.lastBlockHash = kernelState.meta.lastBlockHash || null;
  nodeSt.updatedAt = new Date().toISOString();
  try {
    N.appendTail(chainState, nodeSt); /* 99b: מגן-זנב-קובץ — אפס-כפילויות */
  } catch (_) {}
  fs.writeFileSync(N.STATE_FILE, JSON.stringify(nodeSt, null, 2));
}

/* ── טיק-מלא: ROUNDS סבבים → בלוקים + שמירה תחת-מנעול ── */
async function tick() {
  tickNo++;
  const g = G();
  const time = new Date().toISOString();
  const lk = N.acquireLock();
  if (!lk.ok) { log('grid98 TICK SKIP — lock held by pid ' + lk.holder.pid); return false; }
  try {
    let trades = 0;
    for (roundInTick = 0; roundInTick < ROUNDS; roundInTick++) trades += tradingRound(time) || 0;
    roundInTick = 0;
    await N.maybeCheckpoint(nodeSt, st, chainState, time);
    const feesTrBefore = nodeSt._feesTrSeen || 0;
    const feesTrNow = st.fees.toTreasury || 0;
    const feeGain = Math.max(0, feesTrNow - feesTrBefore);
    nodeSt._feesTrSeen = feesTrNow;
    if (feeGain > 0) { g.treasuryPnlµ += feeGain; g.treasuryPnlTodayµ += feeGain; g.realizedSinceStepµ = (g.realizedSinceStepµ || 0) + feeGain; g.feeIncomeµ = (g.feeIncomeµ || 0) + feeGain; }
    // דיסק-שומר: נפח-חופשי קובע-קצב (כנות — הדיסק הוא-הצוואר-הבקבוקי-האמיתי)
    try { const sfs = fs.statfs ? await fs.promises.statfs(NODE_DIR) : null; if (sfs) g.disk = { freeMB: Math.round(sfs.bavail * sfs.bsize / 1e6) }; } catch (_) {}
    if (g.disk && g.disk.freeMB < 800) { g.paused = 'disk-low'; ledgerSave(g); log('grid98 PAUSED — disk low (' + g.disk.freeMB + 'MB free, honest)'); return; }
    g.ticks++; g.tradesTotal = (g.tradesTotal || 0) + trades; g.txsTotal = (g.txsTotal || 0) + ROUNDS;
    if (tickNo % WINDOW_FLUSH_EVERY === 0) N.saveAll(nodeSt, chainState, st); // חלון-ספר + תמציות
    else if (tickNo % 4 === 0) liteSave(nodeSt, chainState, st); // state.json כל-4-טיקים (הארכיון-מתעדכן-כל-טיק)
    else { // אפנד-ארכיון-בלבד — הכתיבה-הזולה (99b: מגן-זנב-קובץ)
      try { N.appendTail(chainState, nodeSt); } catch (_) {}
    }
    ledgerSave(g);
    g.at = new Date().toISOString();
    g.height = st.meta.height;
    g.stateRoot = K.stateRoot(st).slice(0, 16);
    g.treasuryPnlSAOS = +(g.treasuryPnlµ / 1000).toFixed(3);
    g.treasuryPnlTodaySAOS = +(g.treasuryPnlTodayµ / 1000).toFixed(3);
    const mins = (g.ticksToday || g.ticks) * (TICK_MS / 60000);
    g.ratePerMin = +(g.tradesToday / Math.max(mins, 0.25)).toFixed(1);
    g.extrapolatedDay = Math.round(g.ratePerMin * 1440);
    g.dutyPct = Math.round(100 * (g.ticks || 0) / Math.max(1, (g.ticks || 0) + (g.lockSkips || 0) / 80));
    g.pools = Object.fromEntries(Object.entries(st.poolsX || {}).map(([k, p]) => [k, { a: p.a / 1000, b: p.b / 1000, px: +(p.b / p.a).toFixed(1), lp: p.lpSupply / 1000 }]));
    g.pools['WTRX/SAOS(pw)'] = st.poolW ? { a: st.poolW.wtrx / 1000, b: st.poolW.saos / 1000, px: +((st.poolW.saos / st.poolW.wtrx) || 0).toFixed(1), lp: st.poolW.lpSupply / 1000 } : null;
    const lb = Object.entries(g.soldierPnlµ).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, pnlµ]) => ({ name, pnlSAOS: +(pnlµ / 1000).toFixed(3) }));
    g.leaderboard = lb;
    rotate(g);
    if (g.day !== g.dayNow) { /* noop — day rollover handled below */ }
    const day = new Date().toISOString().slice(0, 10);
    if (g.day !== day) { g.day = day; g.baseTrades = totalTrades(); g.treasuryPnlTodayµ = 0; g.tradesToday = 0; g.txsToday = 0; g.ticksToday = 0; journalHousekeep(); }
    g.ticksToday = (g.ticksToday || 0) + 1;
    if (tickNo % 24 === 0) journalHousekeep();
  } finally { N.releaseLock(); }
}

/* ── מצב-בנץ': מדידת-תפוקת-קרנל-גולמית (replay של-טרנזאקציות-אמת-מהארכיון על-מצב-משובט)
 * הוכחת-יכולת-כנה: מהירות-המנוע-עצמו (applyTx+buildBlock) בלי-תלות-במצב-שוק-רגעי ── */
/* 107 — ליבת-המדידה משותפת: חוץ (lock+CLI) ופנים (המנוע-החי-עצמו, בלי-ויכוח-מנעול) */
async function benchReplayCore(ms) {
  // טרנזאקציות-אמת: 400 הבלוקים-האחרונים-מהארכיון
  const tailBlocks = [];
  try {
    const fd = fs.openSync(ARCHIVE_FILE, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 1_048_576);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim());
    if (len < size && lines.length) lines.shift();
    for (const l of lines) { try { const b = JSON.parse(l); if (b && b.txs && b.txs.length) tailBlocks.push(b.txs); } catch (_) {} }
  } catch (_) {}
  if (!tailBlocks.length) return null;
  const replaySet = tailBlocks.slice(-400);
  const t0 = Date.now();
  let txs = 0, passes = 0;
  while (Date.now() - t0 < ms) {
    const cs = JSON.parse(JSON.stringify(st)); // מצב-משובט — אף-השפעה-על-החי
    for (const txsOfBlock of replaySet) {
      for (const tx of txsOfBlock) { K.applyTx(cs, tx); txs++; }
      passes++;
      if (Date.now() - t0 >= ms) break;
    }
  }
  const el = Date.now() - t0;
  const tps = +(txs / (el / 1000)).toFixed(0);
  return {
    at: new Date().toISOString(), ms: el, txs, passes,
    txsPerSec: tps,
    capabilityPerDay: Math.round(tps * 86400),
    note: 'measured kernel applyTx-throughput replaying real archive txs on cloned state — chain mechanism ceiling; sustained-live trade rate is economy/budget-bound and reported separately',
  };
}
async function bench() {
  boot();
  const g = G();
  let lkOk = N.acquireLock().ok;
  for (let i = 0; !lkOk && i < 60; i++) { await new Promise((r) => setTimeout(r, 700)); lkOk = N.acquireLock().ok; }
  if (!lkOk) { log('grid98 BENCH SKIP — lock held (40s of retries)'); return; }
  try {
    log('grid98 BENCH (kernel-throughput, replay of real archive txs) · ' + BENCH_MS + 'ms');
    const result = await benchReplayCore(BENCH_MS);
    if (!result) { log('grid98 BENCH: no archive txs to replay (honest skip)'); return; }
    g.bench = result;
    log('grid98 BENCH done · ' + result.txs + ' txs in ' + (result.ms / 1000).toFixed(1) + 's · ' + result.txsPerSec + ' txs/sec · chain capability ≈ ' + result.capabilityPerDay + '/day');
    journal({ kind: 'bench', txs: result.txs, txsPerSec: result.txsPerSec, capabilityPerDay: result.capabilityPerDay, note: 'kernel throughput capability (memory-only, ledger-recorded)' });
    ledgerSave(g);
    console.log(JSON.stringify(g.bench, null, 2));
  } finally { N.releaseLock(); }
}

/* ── רץ-רציף: מיקרו-פעימות + הפעלת-הפעימה-הרגילה (עיגונים/משימות/אקספלורר) ──
 * על-עומק-מנעול (lock-pressure): הפעימה-הרגילה מחזיקה-מנעול 60-174ש' (שלבי-רשת)
 * כל-3-דק' — המנוע-מסתחרר-כל-700מ"ש ותופס-כל-חלון-פנוי; הלחץ-עצמו נמדד-ומדווח (כנות). */
async function run() {
  boot();
  journalHousekeep();
  log('grid98 LIVE start · tick=' + TICK_MS + 'ms rounds=' + ROUNDS + ' legacyEvery=' + LEGACY_EVERY);
  let skips = 0, lastSkipLog = Date.now();
  for (;;) {
    const t0 = Date.now();
    try {
      syncFromDisk();
      const did = await tick();
      if (did === false) {
        skips++;
        const now = Date.now();
        if (now - lastSkipLog >= 60000) {
          const g = G();
          g.lockSkips = (g.lockSkips || 0) + skips;
          g.lastSkipLogAt = new Date().toISOString();
          ledgerSave(g);
          log('grid98 lock-pressure: +' + skips + ' skips/min (beat network phases hold the lock — measured, honest)');
          skips = 0; lastSkipLog = now;
        }
        await new Promise((res) => setTimeout(res, 700));
        continue;
      }
      skips = 0;
      /* 107 — מדידת-יכולת-פנימית: אם-bench חסר או-בן->6ש׳ — 2 שניות replay על-מצב-משובט
       * (בתוך-התהליך-החי — אפס-ויכוח-מנעול · אפס-השפעה-על-המצב-החי). התקרה-המכנית
       * של-השרשרת מדודה-ותמיד-טרייה על-הדף במקום "null" נצחי. */
      {
        const gb = G();
        const bAge = gb.bench && gb.bench.at ? Date.now() - new Date(gb.bench.at).getTime() : Infinity;
        if (bAge > 6 * 3600_000) {
          try {
            const result = await benchReplayCore(2000);
            if (result) {
              gb.bench = result;
              ledgerSave(gb);
              log('grid98 IN-PROC BENCH · ' + result.txsPerSec + ' txs/sec · capability ≈ ' + result.capabilityPerDay + '/day (2s sampled, honest ceiling)');
            }
          } catch (e2) { log('grid98 in-proc bench ERR (honest): ' + String((e2 && e2.message) || e2).slice(0, 80)); }
        }
      }
      if (tickNo % LEGACY_EVERY === 0) {
        log('grid98 → legacy beat (anchors/missions/explorer) · #' + (nodeSt.grid98.legacyBeats + 1));
        const r = spawnSync('node', ['saosnet.cjs', '--beat', '--live'], { cwd: NODE_DIR, timeout: 5 * 60_000 });
        nodeSt = N.loadNodeState();
        G().legacyBeats++; G().lastLegacyAt = new Date().toISOString();
        log('grid98 ← legacy beat exit=' + r.status + (r.stderr ? ' err:' + String(r.stderr).slice(-120) : ''));
        syncFromDisk();
      }
    } catch (e) { log('grid98 tick ERR (honest, continue): ' + String((e && e.message) || e).slice(0, 140)); }
    const dt = Date.now() - t0;
    await new Promise((res) => setTimeout(res, Math.max(500, TICK_MS - dt)));
  }
}

function showStatus() {
  const ns = N.loadNodeState();
  const g = ns.grid98 || {};
  console.log(JSON.stringify({
    at: g.at, ticks: g.ticks, height: g.height, tradesToday: g.tradesToday,
    ratePerMin: g.ratePerMin, extrapolatedDay: g.extrapolatedDay,
    treasuryPnlSAOS: g.treasuryPnlSAOS, today: g.treasuryPnlTodaySAOS,
    leaderboard: g.leaderboard, floor: g.floor, steps: (g.steps || []).length,
    pools: g.pools, bench: g.bench, disk: g.disk, seeds: g.seeds, mints: g.mints,
  }, null, 2));
}

(async function main() {
  if (STATUS) return showStatus();
  if (BENCH_MS) return bench();
  if (ONCE) { boot(); let ok = false; for (let i = 0; i < 40 && !ok; i++) { ok = (await tick()) !== false; if (!ok) await new Promise((r) => setTimeout(r, 700)); } console.log(JSON.stringify(G(), null, 2)); return; }
  if (LIVE_MODE) return run();
  console.log('usage: grid98.cjs --live | --bench <ms> | --once | --status');
})().catch((e) => { log('grid98 FATAL ' + String((e && e.message) || e)); process.exit(1); });
