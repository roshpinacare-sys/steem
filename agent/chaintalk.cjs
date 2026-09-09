#!/usr/bin/env node
/* chaintalk.cjs — Task 94: CHAINTALK — שפת-תקשורת בין-הרשתות בפעולות-שרשרת חכמות.
 *
 * העיקרון (ההדרכה של המפעיל, מילולית):
 *   "אם אתה מבין איזו תגובה תקבל מהפעולה שביצעת — אז ממש תוכל לדבר עם הפעולות-השרשרת...
 *    אם נסיק שהוראה z מובילה ל-y שיוביל לבא — זו שפת-התקשורת בין-הרשתות,
 *    אבל הן חייבות להביא לנו ערך ממשי"
 *
 * השפה CHL-1: משימה = רצף-צעדים; כל-צעד מכריז-מראש על-התגובה-הצפויה (predict)
 *   → מבצע (act) → מודד-את-התגובה-האמיתית (measured) → משווה (match).
 *   רק-צעד-שנמדד מדליק את-הצעד-הבא; אי-התאמה = עצירה-כנה-מתועדת (לא זיוף).
 *
 * משימת-הבכורה VALUE-GRID-94 — ערך של ~$5 חוצה-רשתות על הרשת שלנו, אפס-עמלות:
 *   S1 TRON  — הוכחת-עתודות-חיה: קריאה-בלבד ל-TronGrid על 6 כתובות-הכספת (אף-מפתח לא זז)
 *   S2 SAOS  — WTRX: 17 TRX (≈$5) נעטפים-על-הספר-הריבוני ומתחלקים ל-11 חברי-הצי —
 *              ערך-טרון נכנס-לרשת-שלנו כנגזרת-עטופה-מלאה (עתודות-מדודות-חי ≥ supply)
 *   S3 SAOS  — סולם-גריד-אוצר: 3 הזמנות סביב-הספר (2 מהן חוצות — מובטחות-טריידים)
 *   S4 STEEM — חיילים סוחרים-עצמאית (custom_json — אפס-STEEM-נז, RC בלבד)
 *   S5 SAOS  — פעימה → הספר זז בפועל (טריידים + מחיר-חדש + עומק)
 *   S6 STEEM — עוגן-המשימה: digest-התוצאות חוזר-ל-Steem כ-custom_json (אפס-עמלה) —
 *              הלולאה נסגרת: TRON→SAOS-NET→STEEM→הרשת-שלנו מדברת-עם-עצמה
 *
 * בטיחות: אף-TRX לא נשלח (קריאה-בלבד) · אף-STEEM לא נשלח (custom_json בלבד) ·
 *          כל-צעד נכתב-בכנות (match=true/false) · התוצאה: agent/chaintalk_result.json
 *
 * שימוש:  node chaintalk.cjs --run     (משימה מלאה)
 *          node chaintalk.cjs --status (תוצאה-אחרונה)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const https = require('https');
const steem = require('steem');

const AGENT_DIR = __dirname;
const NODE_DIR = path.join(__dirname, '..', 'sovereign', 'node');
const OUT = path.join(AGENT_DIR, 'chaintalk_result.json');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');
const LOCAL_API = 'http://127.0.0.1:3000';

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const ENV = loadDotEnv(AGENT_DIR);
const ACCOUNT = (process.env.AGENT_ACCOUNT || ENV.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const POSTING_WIF = process.env.POSTING_WIF || ENV.POSTING_WIF || '';

const STEEM_NODES = ['https://api.justyy.com', 'https://steemapi.boylikegirl.club'];
const sha = (o) => crypto.createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex');
const log = (m) => { const line = new Date().toISOString() + ' ' + m; console.log(line); try { fs.appendFileSync(path.join(AGENT_DIR, 'chaintalk.log'), line + '\n'); } catch (_) {} };
const readJSON = (p, dflt) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return dflt; } };
const writeJSON = (p, o) => { fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// LIVE-GATE (Task 28-b): DRY by default — --run is this daemon's explicit-enable,
// the shared gate adds the HE_LIVE_CONFIRM layer (--dry always wins). See DAEMONS.md.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv.concat(process.argv.includes('--run') ? ['--live'] : []), { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE, log);

function httpsPost(urlStr, body, timeoutMs = 15000) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json: ' + data.slice(0, 60))); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function rpcNode(urlStr, method, params, timeoutMs = 20000) {
  const u = new URL(urlStr);
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { const j = JSON.parse(data); if (j.error) return reject(new Error(String(j.error.message || JSON.stringify(j.error)).slice(0, 90))); resolve(j.result); } catch (_) { reject(new Error('bad rpc: ' + data.slice(0, 60))); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}

/* צעד-עזר: פעימה-חיה של הצומת (spawn מסונכרן — המנעול מגן מפני-כפילות) */
function runBeat(timeoutMs = 300000) {
  const r = spawnSync('node', ['saosnet.cjs'].concat(DRY ? [] : ['--live']), { cwd: NODE_DIR, timeout: timeoutMs, encoding: 'utf8' });
  return { ok: r.status === 0, tail: String(r.stdout || '').split('\n').filter(Boolean).slice(-6).join(' | ') || String(r.stderr || '').slice(0, 160) };
}

/* S1 — הוכחת-עתודות-טרון: קריאה-חיה-בלבד לכל-כתובות-הכספת (walletsolidity/getaccount — תגלית-94: /v1/accounts 404) */
async function tronReserveProof() {
  const tb = readJSON(path.join(NODE_DIR, 'tron-bridge-state.json'), {});
  const addrs = [tb.address, tb.addressRelay].concat(tb.squadAddresses || []).filter(Boolean);
  const rows = [];
  for (const a of addrs) {
    let bal = null;
    /* 95-תיקון-זיוף-מדידה: תשובה-ריקה ≠ יתרה-אפס — TronGrid מחזיר-גוף-ריק בהגבלת-קצב
     * והקוד-הישן רשם-0 (S1-רשם-20.84 במקום 24.44 — הכתובות s3/s4/s5 נספרו-אפס).
     * עכשיו: רק-balance-מספרי-הוא-תשובה; אחרת נסיון-נוסף+צומת-שני+backoff; אם-עדיין-לא-ידוע → null-כנה. */
    for (let attempt = 0; attempt < 3 && bal === null; attempt++) {
      for (const host of ['https://api.trongrid.io', 'https://api.tronstack.io']) {
        try {
          const d = await httpsPost(host + '/walletsolidity/getaccount', { address: a, visible: true });
          if (d && typeof d.balance === 'number') { bal = d.balance; break; }
          if (d && (d.Error || d.error)) throw new Error('rpc-error-body');
          /* תשובה-ריקה = לא-ידוע — לא-אפס (כנות-מדידה) */
        } catch (_) { /* צומת-הבא */ }
      }
      if (bal === null) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
    rows.push({ address: a.slice(0, 8) + '…', trx: bal === null ? null : bal / 1e6 });
  }
  const known = rows.filter((r) => r.trx !== null);
  const measured = known.reduce((s, r) => s + r.trx, 0);
  return { rows, measuredTrx: +measured.toFixed(6), addrsCount: rows.length, measuredComplete: known.length === rows.length, unknownCount: rows.length - known.length };
}

/* פס-המשימות: כתיבת-משימה לחיץ-הצומת */
function issueMission(id, ops) {
  const pf = readJSON(PENDING, { missions: [] });
  pf.missions = (pf.missions || []).filter((m) => m.id !== id);
  pf.missions.push({ id, status: 'pending', issuedAt: new Date().toISOString(), issuer: ACCOUNT, ops });
  writeJSON(PENDING, pf);
}

function missionResult(id) {
  const pf = readJSON(PENDING, { missions: [] });
  return (pf.missions || []).find((m) => m.id === id) || null;
}

/* מצב-הספר מהצומת (state.json נכתב-אחרי-כל-פעימה) */
function nodeState() {
  return readJSON(path.join(NODE_DIR, 'state.json'), {});
}

/* S4 — סבב-חיילים על-המיקרו-דקס (custom_json — אפס-STEEM-נז) */
function soldierRound() {
  const before = readJSON(path.join(AGENT_DIR, 'microdex_state.json'), { txids: [] });
  const nBefore = (before.txids || []).length;
  const r = spawnSync('node', ['microdex.cjs'].concat(DRY ? [] : ['--live']), { cwd: AGENT_DIR, timeout: 300000, encoding: 'utf8' });
  const after = readJSON(path.join(AGENT_DIR, 'microdex_state.json'), { txids: [] });
  const fresh = (after.txids || []).slice(nBefore);
  return { exit: r.status, newOps: fresh.length, fresh, tail: String(r.stdout || '').split('\n').filter(Boolean).slice(-4).join(' | ') };
}

/* S6 — עוגן-המשימה על Steem (custom_json — אפס-STEEM-נז) */
async function anchorMission(payloadDigest, summary) {
  if (!POSTING_WIF) return { error: 'no POSTING_WIF' };
  if (DRY) return { error: 'DRY (live-gate) — anchor not broadcast', dry: true };
  const nonce = crypto.randomBytes(6).toString('hex');
  const payload = { t: 'chaintalk-anchor', v: 94, n: nonce, digest: payloadDigest, summary, ts: new Date().toISOString() };
  const txid = await new Promise((resolve, reject) => {
    steem.broadcast.customJson(POSTING_WIF, [], [ACCOUNT], 'saos', JSON.stringify(payload), (err, res) => {
      if (err) return reject(err);
      resolve((res && res.id) || null);
    });
  });
  // ניבוי: נמצא-בהיסטוריה-העצמית תוך-90 שניות (read-back — תבנית-89)
  let found = null;
  for (let i = 0; i < 15 && !found; i++) {
    await sleep(6000);
    for (const node of STEEM_NODES) {
      try {
        const hist = await rpcNode(node, 'condenser_api.get_account_history', [ACCOUNT, -1, 10]);
        const entries = Array.isArray(hist) ? hist : (hist.history || []);
        for (let k = entries.length - 1; k >= 0; k--) {
          const e = entries[k] && entries[k][1];
          const o = e && e.op;
          const t = o && (Array.isArray(o) ? o[0] : String(o.type || '').replace(/_operation$/, ''));
          const v = o && (Array.isArray(o) ? o[1] : o.value);
          if (t === 'custom_json' && v && v.id === 'saos' && String(v.json).includes(nonce)) { found = { txid: e.trx_id, block: e.block, node: new URL(node).hostname }; break; }
        }
        if (found) break;
      } catch (_) { /* צומת-הבא */ }
    }
  }
  return { txid, found, nonce };
}

/* ── המשימה ── */
async function run() {
  const t0 = Date.now();
  const steps = [];
  const step = (s) => { steps.push(s); log('step ' + s.id + ' · match=' + s.match + (s.note ? ' · ' + s.note : '')); return s; };

  const st0 = nodeState();
  const book0 = st0.book || {};
  const soldiers = ['cashmachine', 'haran', 'woq', 'siq', 'tov', 'wic', 'wog', 'lsa', 'macrame', 'ynet'];
  const missionId = 'value-grid-94';

  /* S1 — עתודות-טרון (קריאה-בלבד) */
  {
    const p = { expect: '6 vault addresses readable on TronGrid · Σ ≥ 17 TRX (the $5 backing)' };
    const m = await tronReserveProof();
    const okReadable = m.rows.every((r) => r.trx !== null);
    const enough = m.measuredTrx >= 17;
    step({ id: 'S1-tron-reserve', net: 'TRON→read', label: 'הוכחת-עתודות-חיה (קריאה-בלבד)', predict: p, measured: m, match: okReadable && enough, evidence: 'Σ=' + m.measuredTrx + ' TRX על ' + m.addrsCount + ' כתובות · אף-מפתח לא זז' });
    if (!enough) { writeJSON(OUT, { at: new Date().toISOString(), mission: missionId, steps, allMatch: false, halt: 'reserve < 17 TRX — honest halt' }); return; }
  }

  /* S2 — WTRX: עטיפת 17 TRX וחלוקה ל-11 חברי-הצי (משימה-א' → פס-הצומת) */
  {
    const res1 = steps[0];
    const lockedDelta = res1.measured.measuredTrx; // העתודה-המדודה-חי = העיגון
    const ops = [{ type: 'wrap_mint', symbol: 'WTRX', issuer: ACCOUNT, to: ACCOUNT, amount: 7, lockedDelta, ref: 'ct94:wtrx:' + ACCOUNT }];
    for (const s of soldiers) ops.push({ type: 'wrap_mint', symbol: 'WTRX', issuer: ACCOUNT, to: s, amount: 1, ref: 'ct94:wtrx:' + s });
    issueMission(missionId + ':wrap', ops);
    const p = { expect: 'node applies 11/11 wrap_mint ops → WTRX supply=17 · locked=Σ-מדוד · holders=11 · block height H' };
    const b = runBeat();
    const mr = missionResult(missionId + ':wrap');
    const st = nodeState();
    const w = (st.wrappedSummary || {}).WTRX || { supply: 0, locked: 0, holders: 0 };
    // 94-לקח: הספר-החי הוא-האמת (LIVE-DEDUP) — המדידה מהספר; ה-write-back הוא-נוחות בלבד
    const supplyOk = Math.abs(w.supply - 17) < 0.001;
    const holdersOk = w.holders >= 11;
    const backed = w.locked >= w.supply;
    step({ id: 'S2-wtrx-wrap', net: 'TRON→SAOS-NET', label: 'עטיפת ~$5 (17 TRX) וחלוקה-לצי', predict: p, measured: { book: w, busStatus: mr && mr.status, appliedHeight: mr && mr.appliedHeight, beat: b.tail }, match: !!(supplyOk && holdersOk && backed), evidence: 'supply ' + w.supply + ' WTRX · עטוף ' + w.locked + ' TRX (מדוד-חי) · ' + w.holders + ' מחזיקים · נמדד-מהספר' });
  }

  /* S3 — סולם-גריד-אוצר (משימה-ב' — 2 חוצות + 1 עומק) */
  {
    const lastP = (nodeState().book || {}).lastPrice || 0.016862;
    const crossSell = +(lastP * 0.945).toFixed(6);  // מתחת-לצערי-הקניה-החיים → מובטח-מילוי
    const crossBuy = +(lastP * 1.03).toFixed(6);    // מעל-השאלה-העומדת של-@cashmachine → מובטח-מילוי
    const depthSell = +(lastP * 1.008).toFixed(6);  // עומק-מנוחה מעל-השוק
    const ops = [
      { type: 'order', owner: ACCOUNT, side: 'sell', amount: 1.0, price: crossSell, ref: 'ct94b:ord:sell-cross' },
      { type: 'order', owner: ACCOUNT, side: 'buy', amount: 0.5, price: crossBuy, ref: 'ct94b:ord:buy-cross' },
      { type: 'order', owner: ACCOUNT, side: 'sell', amount: 2.0, price: depthSell, ref: 'ct94b:ord:sell-depth' },
    ];
    issueMission(missionId + ':grid', ops);
    const p = { expect: '3/3 orders applied · asks+bids grow around lastPrice · 2 crossing orders rest' };
    const b = runBeat();
    const mr = missionResult(missionId + ':grid');
    const book = (nodeState().book || {});
    const asks = (book.asks || []).length, bids = (book.bids || []).length;
    // 94-לקח: המדידה מהספר — הזמנות-האוצר חיות-על-הספר (owner+price), לא-בקבצת-הקבלה
    const treasuryOrders = (book.asks || []).concat(book.bids || []).filter((o) => o.owner === ACCOUNT);
    const crossOnBook = treasuryOrders.some((o) => Math.abs(o.price - crossSell) < 1e-6) || treasuryOrders.some((o) => Math.abs(o.price - crossBuy) < 1e-6);
    step({ id: 'S3-treasury-grid', net: 'SAOS-NET', label: 'סולם-גריד-אוצר (חוצה+עומק)', predict: p, measured: { bookOrders: treasuryOrders.map((o) => ({ side: (book.asks || []).includes(o) ? 'ask' : 'bid', amount: o.amount, price: o.price })), asks, bids, prices: { crossSell, crossBuy, depthSell }, busStatus: mr && mr.status, appliedHeight: mr && mr.appliedHeight, beat: b.tail }, match: !!(treasuryOrders.length >= 2 && (crossOnBook || (book.trades || 0) > (book0.trades || 0))), evidence: 'לאוצר ' + treasuryOrders.length + ' הזמנות-חיות-על-הספר · asks ' + asks + ' · bids ' + bids });
  }

  /* S4 — חיילים סוחרים (Steem custom_json — אפס-STEEM-נז) */
  {
    const p = { expect: '≥1 new soldier custom_json op verified on-chain (microdex rotation) · 0.000 STEEM moved' };
    const m = soldierRound();
    step({ id: 'S4-soldier-grid', net: 'STEEM', label: 'סבב-מסחר-חיילים (אפס-עמלה)', predict: p, measured: { newOps: m.newOps, fresh: m.fresh.map((f) => ({ by: f.by, why: f.why, txid: String(f.txid || '').slice(0, 18) })), exit: m.exit, tail: m.tail }, match: m.newOps >= 1, evidence: m.newOps + ' ops חדשים-חתומים-עצמאית · אפס-STEEM-נז (RC בלבד)' });
  }

  /* S5 — פעימה: הספר זז (המנוע-הריבוני מממש את-החוצים) */
  {
    const trades0 = book0.trades || 0;
    const p = { expect: 'trades ≥ ' + (trades0 + 2) + ' · lastPrice moved · feesµ grew · matcher filled the crossing orders' };
    const b = runBeat();
    const st = nodeState();
    const book = st.book || {};
    const trades1 = book.trades || 0;
    const fees1 = book.feesµ || 0;
    const moved = trades1 >= trades0 + 2 && book.lastPrice && book.lastPrice !== book0.lastPrice;
    step({ id: 'S5-book-moves', net: 'SAOS-NET', label: 'הגריד זז בפועל (מנוע-ההתאמה)', predict: p, measured: { trades: trades0 + '→' + trades1, lastPrice: book0.lastPrice + '→' + book.lastPrice, feesµ: fees1, asks: (book.asks || []).length, bids: (book.bids || []).length, beat: b.tail }, match: moved, evidence: 'טריידים +' + (trades1 - trades0) + ' · מחיר-אחרון ' + book.lastPrice + ' · עמלות ' + fees1 + 'µ' });
  }

  /* S6 — עוגן-המשימה על Steem (אפס-עמלה) — הלולאה נסגרת */
  {
    const st = nodeState();
    const w = (st.wrappedSummary || {}).WTRX || {};
    const summary = { wtrx: { supply: w.supply, locked: w.locked, holders: w.holders }, grid: { trades: (st.book || {}).trades, lastPrice: (st.book || {}).lastPrice, feesµ: (st.book || {}).feesµ }, steps: steps.map((s) => s.id + '=' + (s.match ? '✓' : '✗')) };
    const digest = sha(summary);
    const p = { expect: 'custom_json id=saos found in own history ≤90s with txid+block · 0.000 STEEM moved' };
    const m = await anchorMission(digest, summary);
    step({ id: 'S6-anchor', net: 'SAOS→STEEM', label: 'עוגן-המשימה (digest חוזר-לשרשרת)', predict: p, measured: { digest: digest.slice(0, 16) + '…', txid: m.txid, found: m.found, err: m.error || null }, match: !!(m.found && m.found.txid), evidence: 'txid ' + (m.found && m.found.txid) + ' בלוק ' + (m.found && m.found.block) + ' · TRON→SAOS→STEEM משוזרים' });
  }

  const allMatch = steps.every((s) => s.match);
  const result = {
    at: new Date().toISOString(),
    mission: missionId,
    language: 'CHL-1 (predict→act→measure→match)',
    steps,
    allMatch,
    matches: steps.filter((s) => s.match).length + '/' + steps.length,
    durationS: Math.round((Date.now() - t0) / 1000),
    summaryHe: allMatch
      ? 'שרשרת-ערך מלאה: ~$5 מ-TRON נכנסו-לרשת-שלנו כ-WTRX עטוף-מלא, חולקו-ל-11 חברי-הצי, הגריד זז (טריידים אמיתיים), והדיגסט נעון-חזרה על Steem — הכל באפס-עמלות.'
      : 'שרשרת-חלקית בכנות: ' + steps.filter((s) => !s.match).map((s) => s.id).join(', ') + ' לא-נמדדו-כמו-שניבאו — מתועד, לא מזויף.',
  };
  writeJSON(OUT, result);
  log('MISSION ' + missionId + ' · ' + result.matches + ' match · allMatch=' + allMatch);
  console.log(JSON.stringify({ mission: result.mission, matches: result.matches, allMatch }, null, 2));
}

function status() {
  const r = readJSON(OUT, null);
  if (!r) { console.log('no result yet'); return; }
  console.log('mission ' + r.mission + ' · ' + r.matches + ' · allMatch=' + r.allMatch + ' · at ' + r.at);
  for (const s of r.steps || []) console.log(' ' + (s.match ? '✓' : '✗') + ' ' + s.id + ' — ' + String(s.evidence || '').slice(0, 110));
}

if (process.argv.includes('--status')) { status(); }
else if (process.argv.includes('--run')) { run().then(() => process.exit(0)).catch((e) => { log('FATAL ' + (e && e.message)); console.error('fatal:', e && e.message); process.exit(1); }); }
else { console.log('usage: node chaintalk.cjs --run | --status'); }
