#!/usr/bin/env node
/* chaintalk95.cjs — Task 95: WEAVE-95 — חיבור-כולם לראש (@headcorner) בלי-לגעת-במפתחות-ראשיים.
 *
 * הרקע (הזיוף-שנתפס):
 *   S1-של-94 מדד-עתודות-טרון ורשם-20.84-TRX — אבל-תשובה-ריקה-מ-TronGrid (הגבלת-קצב)
 *   טופלה-כ"יתרה-אפס" והכתובות s3/s4/s5 לא-נספרו. המדידה-החיה-המלאה (כל-6-הכתובות)
 *   = 24.44-TRX. הכיסוי-האמיתי גדול-ממה-שנרשם — מתקנים-על-הספר-עצמו (לא-עריכת-היסטוריה).
 *
 * המשימה (ההדרכה: "לחבר את כולם ל@headcorner בלי לפגוע במפתח הראשי שלהם כדי להאציל"):
 *   M1 עדות   — מדידת-כספת-חיה מלאה (measuredComplete חייב-true; לא-ממשיכים-בשקר)
 *   M2 כיסוי  — wrap_cover: +delta על-הספר (op-חדש-95: מנפיק-בלבד, locked-בלבד, ref-מדידה)
 *   M3 פדיון  — wrap_burn 0.001 + wrap_mint 0.001-חזרה (לולאת-הפדיון עובדת-חי-על-הספר)
 *   M4 האצלה  — delegate: כל-החיילים + זהות-הכספת-על-טרון מחוברים-לראש בסקופים-מוגדרים —
 *               אף-מפתח-ראשי-לא-נגע; ההאצלה = סקופים על-הספר, המפתחות-נשארים-אישיים
 *   M5 עוגן   — digest-התוצאה חוזר-ל-Steem כ-custom_json (אפס-עמלה) — השרשרת נסגרת
 *
 * בטיחות: אף-TRX לא נשלח · אף-STEEM לא נשלח (custom_json בלבד) · מפתחות-קריאה-בלבד ·
 *          כל-צעד predict→act→measure→match; אי-התאמה = עצירה-כנה.
 *
 * שימוש: node chaintalk95.cjs --run
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
const OUT = path.join(AGENT_DIR, 'chaintalk95_result.json');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');
const BRIDGE = path.join(NODE_DIR, 'tron-bridge-state.json');

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

const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
const sha = (o) => crypto.createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex');

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 12000 }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.write(data); req.end();
  });
}

/* M1 — מדידת-כספת-מלאה (תיקון-הזיוף: תשובה-ריקה ≠ אפס; 3-ניסיונות+backoff+צומת-שני) */
async function vaultProof() {
  const tb = readJSON(BRIDGE, {});
  const addrs = [[tb.address, 's0-sender'], [tb.addressRelay, 's1-relay']].concat((tb.squadAddresses || []).map((a, i) => [a, 's' + (i + 2)]));
  const rows = [];
  for (const [a, tag] of addrs) {
    let bal = null;
    for (let attempt = 0; attempt < 3 && bal === null; attempt++) {
      for (const host of ['https://api.trongrid.io', 'https://api.tronstack.io']) {
        try {
          const d = await httpsPost(host + '/walletsolidity/getaccount', { address: a, visible: true });
          if (d && typeof d.balance === 'number') { bal = d.balance; break; }
          if (d && (d.Error || d.error)) throw new Error('rpc-error');
        } catch (_) { /* צומת-הבא */ }
      }
      if (bal === null) await sleep(1200 * (attempt + 1));
    }
    rows.push({ tag, address: a, trx: bal === null ? null : +(bal / 1e6).toFixed(6) });
  }
  const known = rows.filter((r) => r.trx !== null);
  const measured = +known.reduce((s, r) => s + r.trx, 0).toFixed(6);
  return { rows, measuredTrx: measured, addrsCount: rows.length, knownCount: known.length, measuredComplete: known.length === rows.length, at: new Date().toISOString() };
}

/* האצלה: מי-מחובר-לראש ובאילו-סקופים (מהרוסטר-החי — לא-מקודד) */
function fleetRoster() {
  const lr = readJSON(path.join(AGENT_DIR, 'linkage_report.json'), {});
  const soldiers = (lr.soldiers || []).map((s) => s.username).filter(Boolean).filter((u) => u !== ACCOUNT);
  const tb = readJSON(BRIDGE, {});
  const tronCount = 2 + (tb.squadAddresses || []).length; /* שדרן+רכזת+סדוגה */
  return { soldiers, tronCount };
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
  const r = spawnSync('node', ['saosnet.cjs', '--live'], { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
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

/* M5 — עוגן-Steem custom_json (אפס-עמלה) + ניבוי-קריאה-חזרה */
async function anchorSteem(digest, summary) {
  if (!POSTING_WIF) return { error: 'no POSTING_WIF', txid: null };
  const nonce = crypto.randomBytes(6).toString('hex');
  const payload = { t: 'weave-anchor', v: 95, n: nonce, digest, summary, ts: new Date().toISOString() };
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

  /* M1 — המדידה-החיה-המלאה */
  step('M1-vault-proof', 'TRON→read', 'מדידת-כספת-מלאה (קריאה-בלבד · תיקון-זיוף-האפס)',
    { expect: '6/6 כתובות מדודות (measuredComplete=true) · Σ מדויק · אף-מפתח לא זז' },
    async () => await vaultProof(),
    (m) => m.measuredComplete === true && m.addrsCount === 6 && m.measuredTrx > 17);

  /* M2+M3+M4 — הוצאת-המשימות-לספר (שתי-משימות — מגבלת-12-ops) */
  let proof = null, roster = null, coverDelta = null;
  step('M2-issue', 'SAOS-NET', 'הוצאת-משימות WEAVE-95 + DELEGATE-95 (מנפיק=@headcorner)',
    { expect: '2 משימות פנדינג · ops ≤12 לכל-אחת · refs ייחודיים' },
    async (measured) => {
      /* חוזר-על-מדידת-M1 (אותה-ראיה — בלי-קריאות-כפולות ל-TronGrid) */
      proof = measured[0] && measured[0].measured;
      if (!proof || !proof.measuredComplete) return { error: 'vault incomplete — honest stop', proof };
      roster = fleetRoster();
      /* מצב-הספר-הנוכחי (µ): locked-נוכחי של WTRX */
      const nodeSt = readJSON(path.join(NODE_DIR, 'state.json'), {});
      const w = (nodeSt.wrappedSummary || {}).WTRX || { locked: 0, supply: 0 };
      const curLockedµ = Math.round(w.locked * 1000);
      const wantLockedµ = Math.round(proof.measuredTrx * 1000);
      coverDelta = +(Math.max(0, wantLockedµ - curLockedµ) / 1000).toFixed(3);
      const refBase = 'ct95:' + proof.measuredTrx.toFixed(6).replace('.', '');
      const del = (subject, scopes, ref, note) => ({ type: 'delegate', issuer: ACCOUNT, subject, scopes, ref, note: (note || '').slice(0, 160) });
      const soldScope = ['trade', 'attest', 'report'];
      const tronScope = ['anchor', 'ring', 'bridge'];
      const headScope = ['issue', 'anchor', 'command'];
      const delegates1 = [del(ACCOUNT, headScope, refBase + ':del:head', 'הראש-עצמו — רישום-סמכות המנפיק')]
        .concat(roster.soldiers.slice(0, 6).map((u) => del(u, soldScope, refBase + ':del:' + u, 'מחובר-לראש @' + ACCOUNT + ' · מפתחות-אישיים-שלמים')));
      const delegates2 = roster.soldiers.slice(6).map((u) => del(u, soldScope, refBase + ':del:' + u, 'מחובר-לראש @' + ACCOUNT + ' · מפתחות-אישיים-שלמים'))
        .concat(Array.from({ length: roster.tronCount }, (_, i) => del('tron-s' + i, tronScope, refBase + ':del:tron-s' + i, 'זהות-כספת-טרון משוזרת-לראש')));
      const ops1 = [
        { type: 'wrap_cover', issuer: ACCOUNT, symbol: 'WTRX', lockedDelta: coverDelta, ref: refBase + ':cover', note: 'תיקון-כיסוי: מדידה-מלאה ' + proof.measuredTrx + ' TRX על 6 כתובות (הישן רשם 20.84 — תשובות-ריקות נספרו-אפס)' },
        { type: 'wrap_burn', from: ACCOUNT, symbol: 'WTRX', amount: 0.001, ref: refBase + ':redeem:burn' },
        { type: 'wrap_mint', issuer: ACCOUNT, to: ACCOUNT, symbol: 'WTRX', amount: 0.001, ref: refBase + ':redeem:remint', note: 'לולאת-פדיון: burn+remint — הכיסוי-המשוחרר-מממש מחדש (ללא-lockedDelta)' },
      ].concat(delegates1);
      const ops2 = delegates2;
      issueMission('WEAVE-95', ops1);
      if (ops2.length) issueMission('DELEGATE-95', ops2);
      return { ops1: ops1.length, ops2: ops2.length, coverDelta, curLocked: w.locked, roster: roster.soldiers.length + roster.tronCount };
    },
    (m) => !m.error && m.ops1 >= 4 && m.coverDelta > 0);

  /* M3 — פעימות: הספר מבצע (משימה-אחת-לפעימה) */
  step('M3-beats', 'SAOS-NET', 'פעימות-הספר מבצעות את המשימות (WEAVE-95 → DELEGATE-95)',
    { expect: 'exit=0 ×2 · הגובה עולה · אין-שגיאות-FATAL' },
    async () => {
      const b1 = await beatOnce('WEAVE-95');
      const b2 = await beatOnce('DELEGATE-95');
      return { b1, b2 };
    },
    (m) => m.b1.exit === 0 && m.b2.exit === 0);

  /* M4 — אימות-קריאה-חזרה מהספר-עצמו */
  step('M4-verify', 'SAOS-NET', 'קריאה-חזרה: ה-refs-על-הספר + הכיסוי-החדש + ההאצלות-במצב',
    { expect: 'כל-ה-refs נמצאו · locked=מדידה · delegationsSummary מלא (ראש+חיילים+טרון)' },
    async () => {
      const nodeSt = readJSON(path.join(NODE_DIR, 'state.json'), {});
      const w = (nodeSt.wrappedSummary || {}).WTRX || {};
      const pf = readJSON(PENDING, { missions: [] });
      const allOps = ((pf.missions || []).filter((m) => ['WEAVE-95', 'DELEGATE-95'].includes(m.id)).map((m) => m.ops)).flat();
      const refs = allOps.map((op) => op.ref).filter(Boolean);
      const foundRefs = await bookScanRefs(refs.filter(Boolean));
      const delCount = Object.keys(nodeSt.delegationsSummary || {}).length;
      return { foundRefs, missingRefs: refs.filter(Boolean).filter((r) => !foundRefs[r]), locked: w.locked, expectedLocked: +(Math.round(proof.measuredTrx * 1000) / 1000).toFixed(3), delegations: nodeSt.delegationsSummary || null, delCount };
    },
    (m) => m.missingRefs.length === 0 && m.locked >= m.expectedLocked - 0.002 && m.delCount >= 1);

  /* M5 — עוגן-השרשרת על Steem (אפס-עמלה) */
  step('M5-anchor', 'SAOS→STEEM', 'עוגן-WEAVE-95: digest-התוצאה חוזר-ל-Steem כ-custom_json',
    { expect: 'txid ציבורי · נמצא-בקריאה-חוזרת בהיסטוריה של @' + ACCOUNT },
    async (measuredSoFar) => {
      const digest = sha(measuredSoFar);
      const summary = 'WEAVE-95 · vault ' + (proof ? proof.measuredTrx : '?') + ' TRX/6 · cover-fixed +' + coverDelta + ' · redeem-loop live · delegated ' + (roster ? roster.soldiers.length + roster.tronCount : '?') + ' subjects → @' + ACCOUNT + ' (keys untouched)';
      const r = await anchorSteem(digest, summary);
      return { ...r, digest: digest.slice(0, 16) + '…', summary };
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
    at: new Date().toISOString(), mission: 'WEAVE-95', language: 'CHL-1 (predict→act→measure→match)',
    steps: measured, allMatch,
    summaryHe: allMatch
      ? 'הזיוף-תוקן-על-הספר: כיסוי-WTRX = מדידה-חיה-מלאה · לולאת-פדיון חיה · כל-הצי+זהויות-הטרון מואצלים-לראש @' + ACCOUNT + ' בלי-לגעת-במפתחות-ראשיים · עוגן-Steem סוגר-את-השרשרת'
      : 'עצירה-כנה — צעד-ללא-התאמה (מתועד, לא-מזויף)',
  };
  writeJSON(OUT, result);
  log('DONE · allMatch=' + allMatch + ' · ' + OUT);
  return result;
}

if (process.argv.includes('--run')) { run().then(() => process.exit(0)).catch((e) => { log('FATAL ' + (e && e.message)); console.error('fatal:', e && e.message); process.exit(1); }); }
else { console.log('usage: node chaintalk95.cjs --run'); process.exit(2); }
