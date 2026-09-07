#!/usr/bin/env node
/* roshpina-bridge.cjs — Task 116: הגשר-רושפינה — הקונסולה מדברת אל השרשרת-הריבונית.
 *
 * Task 115 השאיר את התפר פתוח: קונסולת-רושפינה (/home/z/roshpina) מוסיפה
 * saos:anchor/v1 payloads אל .bridge/pending-anchors.jsonl — ואף-אחד לא ליקט.
 * הדמון-הזה הוא-הליקוט: סריקה → אימות-קשוח → עיגון-מארח (custom_json אפס-עמלה)
 * → הזרקה-על-הספר (attest · validator-ייחודי-פר-עוגן) → רישום-צריכה.
 *
 * החוקים:
 *   · רעיון-קובץ-מצורף-בלבד — רושפינה בעלת-הקובץ; אנחנו-לעולם-לא-כותבים-בו.
 *     הצריכה נרשמת-אצלנו (state · headHash-map) — אידמפוטנטי-לחלוטין.
 *   · fail-closed: שורה-לא-תקינה → הסגר (roshpina-bridge-quarantine.jsonl + סיבה),
 *     לעולם-לא-שתיקה. עוגן-שנכשל-על-המארח → נשאר-ממתין (כנות, לא-הבטחה).
 *   · אותה-משמעת-הזרקה של-כל-הצי: קובץ-זמני → saosnet --inject → 10 נסיונות
 *     מול-מנעול-ה-beat (נמדד 110-113: ה-beat מחזיק-מנעול 2-4.7 דקות).
 *   · attest-הקרנל הוא-פעם-אחת-ל-validator — לכן validator = 'roshpina:' +
 *     headHash.slice(0,16): כל-עוגן-מקבל-מקום-ייחודי, אין-התנגשות-אפשרית.
 *
 * פקודות: status | once | watch (tick 300ש׳).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');
const QUEUE = '/home/z/roshpina/.bridge/pending-anchors.jsonl';
const STATE = path.join(HERE, 'roshpina-bridge-state.json');
const QUARANTINE = path.join(HERE, 'roshpina-bridge-quarantine.jsonl');
const LOG = path.join(HERE, 'roshpina-bridge.log');
const SNAPSHOT = path.join(HERE, 'state-snapshot.json');
const ACCOUNT = 'headcorner';
const TICK_MS = 300000;
const INJECT_TRIES = 10;

let steem = null;
try { steem = require('steem'); } catch (_) { steem = require(path.join(ROOT, 'agent', 'node_modules', 'steem')); }
const VAULT = require(path.join(HERE, 'vault-lib.cjs'));

function log(msg) {
  const line = '[' + new Date().toISOString() + '] roshpina-bridge: ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {}
}

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {}
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (_) {}
  return { consumed: {}, quarantined: 0, lastScan: null, lastHostTxid: null };
}
function saveState(s) { try { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); } catch (_) {} }

/* ── WIF: agent/.env ראשון · הכספת (114) כגיבוי — אותו-סדר כמו relay.cjs ── */
function loadEnvWif() {
  try {
    const env = fs.readFileSync(path.join(ROOT, 'agent', '.env'), 'utf8');
    const m = env.match(/^POSTING_WIF\s*=\s*(\S+)/m);
    if (m) return m[1];
  } catch (_) {}
  try {
    const v = VAULT.readMember('vault.json');
    const me = (v.accounts || []).find((a) => String(a.username).toLowerCase() === ACCOUNT);
    if (me && me.keys && me.keys.posting && me.keys.posting.wif) return me.keys.posting.wif;
  } catch (_) {}
  return null;
}

/* ── אימות-קשוח (fail-closed) — מחזיר {ok, reason} ── */
function validate(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'not-object' };
  if (p.protocol !== 'saos:anchor/v1') return { ok: false, reason: 'bad-protocol' };
  if (p.action !== 'roshpina-anchor') return { ok: false, reason: 'bad-action' };
  const t = p.tenantId;
  if (typeof t !== 'string' || !t.trim() || t.length > 64) return { ok: false, reason: 'bad-tenantId' };
  if (typeof p.headHash !== 'string' || !/^[0-9a-f]{64}$/.test(p.headHash)) return { ok: false, reason: 'bad-headHash' };
  if (!Number.isInteger(p.height) || p.height < 0 || p.height > 1e9) return { ok: false, reason: 'bad-height' };
  if (isNaN(Date.parse(p.at))) return { ok: false, reason: 'bad-at' };
  return { ok: true };
}

function quarantine(p, reason) {
  try {
    fs.appendFileSync(QUARANTINE, JSON.stringify({ at: new Date().toISOString(), reason, payload: p }) + '\n');
  } catch (_) {}
}

/* ── עיגון-מארח: custom_json id 'saos' — אפס-עמלה (RC בלבד), תקדים wallets 113 ── */
async function anchorHost(p) {
  const wif = loadEnvWif();
  if (!wif) throw new Error('no-posting-wif');
  const op = ['custom_json', {
    required_auths: [], required_posting_auths: [ACCOUNT], id: 'saos',
    json: JSON.stringify({
      protocol: 'saos:anchor/v1', action: 'roshpina-anchor', tenantId: p.tenantId,
      headHash: p.headHash, height: p.height, at: p.at,
      anchor_writer: ACCOUNT, time: new Date().toISOString(),
    }),
  }];
  const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [wif]);
  const txid = conf && conf.id;
  if (!txid) throw new Error('no-txid');
  return String(txid);
}

/* ── הזרקה-על-הספר — אותה-משמעת של wallets/sibling (מנעול-ה-beat) ── */
function inject(txs, tag) {
  const f = path.join(HERE, 'inject-roshpina-' + Date.now() + '.json');
  fs.writeFileSync(f, JSON.stringify(txs));
  let ok = false, skipped = false, out = '';
  for (let a = 0; a < INJECT_TRIES && !ok; a++) {
    if (a > 0) sleepSync(5000 + Math.floor(Math.random() * 3000));
    const { spawnSync } = require('child_process');
    const r = spawnSync('node', [path.join(HERE, 'saosnet.cjs'), '--inject', f], { cwd: HERE, encoding: 'utf8', timeout: 120000 });
    out = (r.stdout || '') + (r.stderr || '');
    ok = /INJECT DONE/.test(out);
    skipped = /SKIPPED/.test(out);
    if (ok || !skipped) break;
  }
  try { fs.unlinkSync(f); } catch (_) {}
  if (ok) log('inject ' + tag + ' ✓ ON-BOOK');
  else if (skipped) log('inject ' + tag + ' skipped (lock) — retry next tick');
  else log('inject ' + tag + ' FAIL: ' + out.slice(-120).replace(/\s+/g, ' '));
  return ok;
}

async function processQueue() {
  const st = loadState();
  let lines = [];
  try { lines = fs.readFileSync(QUEUE, 'utf8').split('\n').filter((l) => l.trim()); } catch (_) { lines = []; }
  st.lastScan = new Date().toISOString();
  let fresh = 0, done = 0, held = 0;

  for (const line of lines) {
    let p = null;
    try { p = JSON.parse(line); } catch (_) { p = null; }
    const v = validate(p);
    if (!v.ok) {
      if (p !== null || line.trim()) { quarantine(typeof p === 'object' && p ? p : { raw: line.slice(0, 200) }, v.reason); st.quarantined++; }
      continue;
    }
    if (st.consumed[p.headHash]) continue; // אידמפוטנטי — כבר-נלקט
    fresh++;
    try {
      const hostTxid = await anchorHost(p);
      log('HOST ✓ roshpina/' + p.tenantId + ' h' + p.height + ' head ' + p.headHash.slice(0, 12) + '… txid ' + hostTxid);
      const validator = 'roshpina:' + p.headHash.slice(0, 16);
      const tx = { type: 'attest', by: ACCOUNT, validator, checkpointHash: p.headHash, tenantId: p.tenantId, hostTxid, at: new Date().toISOString() };
      const onBook = inject([tx], 'roshpina:' + p.headHash.slice(0, 10) + '…');
      st.consumed[p.headHash] = { tenantId: p.tenantId, height: p.height, at: p.at, hostTxid, onBook: onBook ? 'injected' : 'pending-inject', consumedAt: st.lastScan };
      if (!onBook) held++;
      st.lastHostTxid = hostTxid;
      done++;
    } catch (e) {
      log('HOST ✗ head ' + p.headHash.slice(0, 12) + '… :: ' + String((e && e.message) || e).slice(0, 90) + ' — stays pending (honest retry)');
    }
  }
  if (fresh || st.quarantined) saveState(st);
  const n = Object.keys(st.consumed).length;
  log('scan: queue=' + lines.length + ' fresh=' + fresh + ' done=' + done + (held ? ' held-inject=' + held : '') + ' total-consumed=' + n + (st.quarantined ? ' quarantined=' + st.quarantined : ''));
}

async function main() {
  const cmd = process.argv.includes('watch') ? 'watch' : process.argv.includes('once') ? 'once' : 'status';
  if (cmd === 'status') {
    const st = loadState();
    const consumed = Object.entries(st.consumed);
    console.log(JSON.stringify({
      daemon: 'roshpina-bridge', queue: QUEUE,
      consumed: consumed.length, quarantined: st.quarantined || 0,
      lastScan: st.lastScan, lastHostTxid: st.lastHostTxid,
      latest: consumed.slice(-3).map(([h, c]) => ({ headHash: h, height: c.height, hostTxid: c.hostTxid, onBook: c.onBook })),
    }, null, 2));
    return;
  }
  if (cmd === 'once') { await processQueue(); return; }
  log('watch up (tick ' + TICK_MS / 1000 + 's) — ליקוט-עוגני-רושפינה אל-השרשרת-הריבונית');
  for (;;) {
    try { await processQueue(); } catch (e) { log('tick-ERROR: ' + String((e && e.message) || e).slice(0, 120)); }
    sleepSync(TICK_MS);
  }
}
main().catch((e) => { log('FATAL: ' + String((e && e.message) || e)); process.exit(1); });
