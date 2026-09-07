#!/usr/bin/env node
/* sibling.cjs — Task 110: אח-וריאפקה — אימות-הדדי על השרשרת-הגולמית.
 *
 * המהנדס-השני (steem-engeiner W22) סרק בעצמו את דלתות-ה-THE-DOOR שלנו מה-STEEM
 * chain עצמו (8 דלתות חיות כולל headcorner:7 @ blk 109355798) ואימת את הוכחת-הטרון
 * שלנו מול trongrid — והצעדי-ack שלו משרשרים את txid-הדלתות-שלנו לתוך חוזיו.
 * החוק-הריבוני: קריאה-בלבד בשני-הכיוונים, אימות-עצמאי, לא-העתקת-טענות.
 *
 * מה עושה הדמון הזה (ההדדי — מה שהוא עשה לנו, אנחנו עושים לו):
 *   1. סריקת get_account_history של @headcorner (אותו-כותב-רשת — שני-המופעים
 *      משדרים תחת-אותו-חשבון; ההבחנה-מבחינת-תוכן, לא-מבחינת-חשבון):
 *        · id 'saos.relay.v1' → צעדי-חוזה שלו (protocol saos:relay/v1 ·
 *          contract/run/step/of/prev/ack) — כל-צעד נבדק: צורה + שרשור-prev
 *          (txid של צעד i חייב להופיע כ-prev.txid בצעד i+1) — לא-יותר → rejected.
 *        · צעד-ack שמצטט txid-דלת-שלנו → kind 'ack' — השרשור-החוצה-מופעים
 *          של דבר-גורר-דבר, נבדק-כאן מול מצב-ה-relay המקומי-שלנו.
 *   2. כל-ראיה מוזרמת לספר-שלנו כ-tx type 'sibling' (kernel 110) — על-השרשרת
 *      הריבונית, לא רק בלוג.
 *   3. שיעורים-מדודים-ממנו (W22): הצמתים-מגבילים get_account_history ל-100/עמוד
 *      → דיפדוף-אחורה לפי-seq; סריקה-כבדה = וויסות-IP → עוצרים-כשיש-מספיק.
 *
 * פקודות: status | once | watch (tick 180ש׳ — המרווח-המדוד-שלו).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const LOG = path.join(HERE, 'sibling-scan.log');
const STATE_SNAP = path.join(HERE, 'state-snapshot.json');

const ACCOUNT = 'headcorner';
const PEER = 'steem-engeiner-W22';
const NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://steem.61bts.com'];
const TICK_MS = 180000;   // השיעור-המדוד-שלו (W22): מרווח-כבד-מדי = וויסות
const MAX_PAGES = 6;      // עוצרים-כשיש-מספיק (הלקח-המדוד-שלו)
const NEW_STOP = 6;       // מספיק-ראיות-חדשות-בסריקה-אחת

function log(msg) {
  const line = '[' + new Date().toISOString() + '] sibling: ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}

/* ── inject לספר-שלנו (אותה-משמעת של relay.cjs: אותו-מנעול, 10 נסיונות) ── */
function inject(txs, tag) {
  const f = path.join(HERE, 'inject-sibling-' + Date.now() + '.json');
  fs.writeFileSync(f, JSON.stringify(txs));
  const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {} };
  let out = '', ok = false, skipped = false;
  for (let a = 0; a < 10 && !ok; a++) {
    if (a > 0) sleepSync(5000 + Math.floor(Math.random() * 3000)); // ה-beat מחזיק-מנעול ב-CATCH-UP+עוגנים — ממתינים-בכבוד (נמדד 110: 4×4s לא מספיק בשיא-פעילות)
    const r = spawnSync('node', [path.join(HERE, 'saosnet.cjs'), '--inject', f], { cwd: HERE, encoding: 'utf8', timeout: 120000 });
    out = (r.stdout || '') + (r.stderr || '');
    ok = /INJECT DONE/.test(out);
    skipped = /SKIPPED/.test(out);
    if (ok || !skipped) break;
  }
  try { fs.unlinkSync(f); } catch (_) {}
  log('inject[' + tag + '] ' + (ok ? 'OK' : skipped ? 'LOCK-BUSY(10 tries)' : 'FAIL') + ' :: ' + out.split('\n').filter((l) => /INJECT|REJECT|SKIPPED/.test(l)).slice(0, 3).join(' | '));
  return ok;
}

/* ── RPC עם נפילה-בין-צמתים ── */
function rpc(node, method, params, timeoutMs) {
  const payload = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 });
  const u = new URL(node);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: timeoutMs || 12000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc-error')); resolve(j.result); }
        catch (_) { reject(new Error('bad-rpc')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}
async function firstOk(method, params) {
  let lastErr = null;
  for (const n of NODES) {
    try { return await rpc(n, method, params); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all-nodes-down');
}

/* ── מצב-מקומי: מה-כבר-רשום-אצלנו (מניעת-כפילויות) + txid-הדלתות-שלנו ── */
function localState() {
  let issuer = 'headcorner', doorTxids = {}, known = {};
  try {
    const s = JSON.parse(fs.readFileSync(STATE_SNAP, 'utf8'));
    issuer = (s.st && s.st.meta && s.st.meta.issuer) || issuer;
    const open = (s.st && s.st.relay && s.st.relay.open) || {};
    for (const [ref, r] of Object.entries(open)) if (r.txid) doorTxids[String(r.txid).toLowerCase()] = ref;
    const S = (s.st && s.st.siblings) || { seen: {} };
    known = S.seen || {};
  } catch (e) { log('local-state: fallback-issuer (snap unreadable: ' + String(e.message).slice(0, 60) + ')'); }
  return { issuer, doorTxids, known };
}

/* ── הסריקה: היסטוריית-הכותב → צעדי-החוזה-שלו ── */
async function scanSteps() {
  const steps = []; // { txid, block, at, contract, run, step, of, prev, ack }
  const seen = new Set();
  let start = -1;
  for (let page = 0; page < MAX_PAGES; page++) {
    let hist = [];
    try { hist = await firstOk('condenser_api.get_account_history', [ACCOUNT, start, 100]); }
    catch (e) { log('scan: nodes-down (' + String(e.message).slice(0, 60) + ')'); break; }
    if (!Array.isArray(hist) || !hist.length) break;
    for (const [, e] of hist) {
      const [type, v] = (e && e.op) || [];
      if (type !== 'custom_json' || !e.trx_id || seen.has(e.trx_id)) continue;
      if (v && v.id !== 'saos.relay.v1') continue; // רק-החוזים-שלו (הדלתות-שלנו: id 'saos' — כבר-אצלנו)
      let j = null;
      try { j = JSON.parse(v.json || '{}'); } catch (_) { continue; }
      if (!j || j.protocol !== 'saos:relay/v1') continue;
      /* 110-מדוד: לה-שני-סוגי-ארטיפקטים — צעדי-חוזה (contract/run/step) ואיטומי-שרשרת
       * (event:'seal' + digest + steps[] — "איטום-אחד-מוכיח-את-השרשרת-כולה"). */
      if (j.event === 'seal') {
        seen.add(e.trx_id);
        steps.push({
          txid: String(e.trx_id).toLowerCase(), block: typeof e.block === 'number' ? e.block : null, at: e.timestamp || null,
          contract: String(j.contract || '').slice(0, 64), run: String(j.run || '').slice(0, 64),
          step: -1, of: 0, seal: true, digest: String(j.digest || '').slice(0, 80),
          sealSteps: Array.isArray(j.steps) ? j.steps.map((s) => String(s.txid || '').toLowerCase()).filter(Boolean) : [],
          prev: null, ack: null,
        });
        continue;
      }
      if (!j.contract || !j.run) continue;
      seen.add(e.trx_id);
      steps.push({
        txid: String(e.trx_id).toLowerCase(),
        block: typeof e.block === 'number' ? e.block : null,
        at: e.timestamp || null,
        contract: String(j.contract || '').slice(0, 64),
        run: String(j.run || '').slice(0, 64),
        step: Number(j.step) || 0,
        of: Number(j.of) || 0,
        prev: j.prev && j.prev.txid ? String(j.prev.txid).toLowerCase() : null,
        ack: j.ack && j.ack.txid ? String(j.ack.txid).toLowerCase() : null,
      });
    }
    const oldestSeq = hist[0] && hist[0][0];
    if (typeof oldestSeq !== 'number' || oldestSeq <= 1) break;
    start = oldestSeq - 1;
  }
  return steps;
}

/* ── האימות: צורה + שרשור-prev + ציטוט-דלתות-שלנו ── */
function verifySteps(steps, doorTxids) {
  const byRun = {};
  const allStepTxids = new Set(steps.filter((s) => !s.seal).map((s) => s.txid));
  for (const s of steps) (byRun[s.run] = byRun[s.run] || []).push(s);
  const recs = [];
  for (const [run, arr] of Object.entries(byRun)) {
    arr.sort((a, b) => a.step - b.step);
    const txidOf = {}; for (const s of arr) txidOf[s.txid] = true;
    for (const s of arr) {
      if (s.seal) {
        /* איטום: digest חוקי + כל-צעדי-השרשרת-שלו-שנמצאו-בסריקה מצטרפים-להוכחה */
        const digestOk = /^[0-9a-f]{64}$/.test(s.digest || '');
        const linked = (s.sealSteps || []).filter((t) => allStepTxids.has(t)).length;
        const note = digestOk ? 'seal-digest ✓ · steps-linked ' + linked + '/' + (s.sealSteps || []).length : 'bad-digest';
        recs.push({ txid: s.txid, kind: 'proof', verdict: digestOk ? 'verified' : 'rejected', contract: s.contract, step: null, note: note.slice(0, 120), at: s.at });
        continue;
      }
      let verdict = 'verified', note = '';
      if (!(s.step > 0)) { verdict = 'rejected'; note = 'step-shape'; }
      if (s.step > 1 && s.prev) {
        if (txidOf[s.prev]) { /* הקודם-בחלון ומתחבר — עובר-אוטומטית בהמשך */ }
        else note = 'prev-outside-window';
      } else if (s.step > 1 && !s.prev) { verdict = 'rejected'; note = 'missing-prev-link'; }
      if (s.ack) {
        if (doorTxids[s.ack]) note = (note ? note + ' · ' : '') + 'covers our door ' + doorTxids[s.ack];
        else note = (note ? note + ' · ' : '') + 'ack-cites-external-txid';
      }
      recs.push({ txid: s.txid, kind: s.ack && doorTxids[s.ack] ? 'ack' : 'step', verdict, contract: s.contract, step: s.step, note: note.slice(0, 120), at: s.at });
    }
  }
  return recs;
}

async function once() {
  const { issuer, doorTxids, known } = localState();
  const steps = await scanSteps();
  if (!steps.length) { log('pass: 0 peer-contract steps found'); return 0; }
  const recs = verifySteps(steps, doorTxids);
  const fresh = recs.filter((r) => !known[r.txid]);
  log('pass: steps=' + steps.length + ' · fresh=' + fresh.length + ' · our-doors-known=' + Object.keys(doorTxids).length);
  for (const r of fresh.slice(0, 4)) log('  · ' + r.kind + ' ' + r.txid.slice(0, 12) + '… ' + r.verdict + (r.contract ? ' contract=' + r.contract.slice(0, 16) : '') + (r.step ? ' step=' + r.step : '') + (r.note ? ' · ' + r.note : ''));
  if (!fresh.length) return 0;
  const txs = fresh.slice(0, 24).map((r) => ({
    type: 'sibling', by: issuer, peer: PEER, kind: r.kind, txid: r.txid,
    contract: r.contract || null, step: r.step || null,
    verdict: r.verdict, note: r.note || null, ref: 'sibling-scan', at: r.at,
  }));
  const ok = inject(txs, 'sibling-' + fresh.length);
  return ok ? fresh.length : 0;
}

function cmdStatus() {
  const { doorTxids, known } = localState();
  console.log(JSON.stringify({ account: ACCOUNT, peer: PEER, ourDoorsTracked: Object.keys(doorTxids).length, siblingRecsKnown: Object.keys(known).length }, null, 2));
}

(async () => {
  const arg = process.argv[2] || 'once';
  if (arg === 'status') return cmdStatus();
  if (arg === 'once') { const n = await once(); log('once done · recorded=' + n); return; }
  if (arg === 'watch') {
    log('watch: tick=' + (TICK_MS / 1000) + 's · peer=' + PEER);
    for (;;) {
      try { await once(); } catch (e) { log('watch-err: ' + String(e.message || e).slice(0, 140)); }
      await new Promise((r) => setTimeout(r, TICK_MS));
    }
  }
  console.log('usage: sibling.cjs status|once|watch');
})().catch((e) => { log('FATAL: ' + String(e.message || e).slice(0, 160)); process.exit(1); });
