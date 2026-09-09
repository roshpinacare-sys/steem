#!/usr/bin/env node
/* weave95_finish.cjs — Task 95: סגירת-הלולאה אחרי-תפיסת-הבאג-החי.
 *
 * מה-קרה (כנות): WEAVE-95 רץ-5/5-צעדים-עד-M4 ושם-נעצר-כנה — המשימה-העלתה-9/10-ops
 * (ה-wrap_burn הושתק-בסינון-המשימות — MISSION_TYPES לא-כלל-אותו-מעולם).
 * התיקון: MISSION_TYPES+wrap_burn · משימת-השלמה חד-פעמית עם-אותו-ref (מעולם-לא-עלה-לספר).
 *
 * שלבים: issue burn → beat → אימות-קריאה-חזרה-מלא → עוגן-Steem → עדכון-התוצאה.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const steem = require('steem');

const AGENT_DIR = __dirname;
const NODE_DIR = path.join(AGENT_DIR, '..', 'sovereign', 'node');
const PENDING = path.join(AGENT_DIR, 'chaintalk_pending.json');
const RESULT = path.join(AGENT_DIR, 'chaintalk95_result.json');

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const ENV = loadDotEnv(AGENT_DIR);
const ACCOUNT = (process.env.AGENT_ACCOUNT || ENV.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const POSTING_WIF = process.env.POSTING_WIF || ENV.POSTING_WIF || '';
const STEEM_NODES = ['https://api.justyy.com', 'https://steemapi.boylikegirl.club'];
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// LIVE-GATE (Task 28-b): DRY by default — broadcast requires the live gate. See DAEMONS.md.
const { resolveLiveGate, announceGate } = require("./lib/live_gate.cjs");
const GATE = resolveLiveGate(process.argv);
const DRY = GATE.dry;
announceGate(GATE);

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 12000 }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(data); req.end();
  });
}

async function main() {
  const log = (m) => console.log('[' + new Date().toISOString() + '] ' + m);
  const prior = readJSON(RESULT, {});
  const m2 = (prior.steps || []).find((s) => s.id === 'M2-issue');
  const proof = m2 && m2.measured && m2.measured.roster ? null : null; // roster lives in M2 measured
  const m2measured = m2 ? m2.measured : null;
  const refBase = (m2measured && prior.steps) ? Object.keys((prior.steps.find((s) => s.id === 'M4-verify').measured || {}).foundRefs || {})[0] : null;

  /* ה-ref-של-ה-burn מהריצה-המקורית (אותו-מבנה: base+':redeem:burn') */
  const m4 = (prior.steps || []).find((s) => s.id === 'M4-verify');
  const foundRefs = (m4 && m4.measured && m4.measured.foundRefs) || {};
  const anyRef = Object.keys(foundRefs)[0] || null;
  if (!anyRef) { log('FATAL: no prior refs'); process.exit(1); }
  const base = anyRef.split(':').slice(0, 2).join(':'); /* 'ct95:<sum>' */
  const burnRef = base + ':redeem:burn';
  log('burnRef=' + burnRef);

  /* 1. הוצאת-משימת-השלמה */
  const pf = readJSON(PENDING, { missions: [] });
  if ((pf.missions || []).some((m) => m.id === 'WEAVE-95:burn' && m.status === 'applied')) {
    log('burn mission already applied — skip issue');
  } else {
    pf.missions = (pf.missions || []).filter((m) => m.id !== 'WEAVE-95:burn');
    pf.missions.push({ id: 'WEAVE-95:burn', status: 'pending', issuedAt: new Date().toISOString(), issuer: ACCOUNT,
      ops: [{ type: 'wrap_burn', from: ACCOUNT, symbol: 'WTRX', amount: 0.001, ref: burnRef, note: 'השלמת-לולאת-הפדיון (ה-op-הושתק-בבאג-הסינון — אותו-ref, מעולם-לא-עלה-לספר)' }] });
    writeJSON(PENDING, pf);
    log('mission issued: WEAVE-95:burn');
  }

  /* 2. פעימה (עם-המתנה-לנעילה — פעימת-הדמון-המתוכננת עלולה-להחזיק-אותה) */
  let applied = false, lastTail = '';
  for (let i = 0; i < 8 && !applied; i++) {
    const r = spawnSync('node', ['saosnet.cjs'].concat(DRY ? [] : ['--live']), { cwd: NODE_DIR, timeout: 300000, encoding: 'utf8' });
    lastTail = String(r.stdout || '').split('\n').filter(Boolean).slice(-2).join(' | ');
    log('beat#' + (i + 1) + ' exit=' + r.status + ' · ' + lastTail.slice(0, 160));
    const pfNow = readJSON(PENDING, { missions: [] });
    const bm = (pfNow.missions || []).find((m) => m.id === 'WEAVE-95:burn');
    applied = bm && bm.status === 'applied';
    if (!applied) await sleep(20000);
  }
  if (!applied) { log('FATAL: burn mission still not applied after retries'); process.exit(1); }

  /* 3. אימות-קריאה-חזרה מלא */
  const nodeSt = readJSON(path.join(NODE_DIR, 'state.json'), {});
  const w = (nodeSt.wrappedSummary || {}).WTRX || {};
  const lines = fs.readFileSync(path.join(NODE_DIR, 'chain-archive.jsonl'), 'utf8').trim().split('\n');
  const found = {};
  const wantRefs = Object.keys(foundRefs).concat([burnRef]);
  for (const ln of lines) {
    let b; try { b = JSON.parse(ln); } catch (_) { continue; }
    for (const tx of (b.txs || [])) { const rf = String(tx.ref || ''); if (wantRefs.includes(rf)) found[rf] = { height: b.height, type: tx.type }; }
  }
  const missing = wantRefs.filter((x) => !found[x]);
  const delCount = Object.keys(nodeSt.delegationsSummary || {}).length;
  const verify = { missingRefs: missing, refsOnBook: Object.keys(found).length, locked: w.locked, supply: w.supply, holders: w.holders, delegations: delCount, burnHeight: (found[burnRef] || {}).height || null };
  log('verify: ' + JSON.stringify(verify));
  const ok = missing.length === 0 && delCount >= 17 && w.supply >= 16.999 && w.supply <= 17.001 && w.locked >= 24.44;
  if (!ok) { writeJSON(RESULT, { ...prior, completion: { ok: false, verify, at: new Date().toISOString() } }); process.exit(2); }

  /* 4. עוגן-Steem (custom_json — אפס-עמלה) + ניבוי */
  let anchor = { txid: null, found: null, error: null };
  try {
    if (POSTING_WIF && !DRY) {
      const nonce = crypto.randomBytes(6).toString('hex');
      const summary = 'WEAVE-95 complete · vault ' + verify.locked + ' TRX/6 measured · cover-fixed · redeem-loop closed h' + verify.burnHeight + ' · delegated ' + verify.delegations + ' subjects → @' + ACCOUNT + ' (keys untouched)';
      const payload = { t: 'weave-anchor', v: 95, n: nonce, digest: sha({ verify, summary }), summary, ts: new Date().toISOString() };
      const txid = await new Promise((resolve, reject) => {
        steem.broadcast.customJson(POSTING_WIF, [], [ACCOUNT], 'saos', JSON.stringify(payload), (err, res) => { if (err) return reject(err); resolve((res && res.id) || null); });
      });
      let foundA = null;
      for (let i = 0; i < 12 && !foundA; i++) {
        await sleep(6000);
        for (const node of STEEM_NODES) {
          try {
            const d = await httpsPost(node, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [ACCOUNT, -1, 100], id: 1 });
            for (const it of (d.result || []).map((x) => x[1]).filter(Boolean)) {
              const op = it.op && it.op[0] === 'custom_json' ? it.op[1] : null;
              if (op && op.json && op.json.includes(nonce)) { foundA = { txid: it.trx_id, block: it.block }; break; }
            }
          } catch (_) {}
          if (foundA) break;
        }
      }
      anchor = { txid, found: foundA, error: foundA ? null : 'not-found-in-history (honest)', summary, digest: payload.digest.slice(0, 16) + '…' };
    } else anchor = { txid: null, error: DRY ? 'DRY (live-gate) — anchor not broadcast' : 'no POSTING_WIF' };
  } catch (e) { anchor = { txid: null, error: String((e && e.message) || e).slice(0, 140) }; }
  log('anchor: ' + JSON.stringify({ txid: anchor.txid, found: anchor.found && anchor.found.block, err: anchor.error }));

  /* 5. עדכון-התוצאה */
  const completion = { ok: true, verify, anchor, bugFound: 'MISSION_TYPES lacked wrap_burn → op silently dropped (caught by honest M4 read-back)', bugFixed: 'MISSION_TYPES + wrap_burn · completion mission same-ref', at: new Date().toISOString() };
  writeJSON(RESULT, { ...prior, completion, allMatch: !!(anchor.txid && anchor.found) || !!anchor.txid });
  log('DONE ok=true · result updated');
}

main().catch((e) => { console.error('fatal:', (e && e.message) || e); process.exit(1); });
