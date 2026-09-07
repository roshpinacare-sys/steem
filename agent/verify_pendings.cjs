#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
 * VERIFY-PENDINGS (Task 89) — "מתועד-אבל-לא-מאומת-עד-הסוף" → נאמת-עד-הסוף.
 *
 * הבעיה-שנמצאה-בחיים: hive-anchor pendings נרשמו (kind=hive-anchor, txid=null,
 * by=חייל) ומעולם-לא-אומתו — הלולאה-הישנה בדקה רק סוגים-אחרים ודרשה txid.
 * המציאות (מדוד): העוגנים **נחתו** על Hive דרך @tov — אבל-המדינה-שלנו עמדה
 * על "pending:tov" לנצח. טענה-רשומה-בלי-אימות = בדיוק-הדימום-שהמפעיל-ראה.
 *
 * התיקון-כאן (keyless, read-only מול-המארח):
 *   1. לכל pending hive-anchor (by+payloadTime): קריאת-היסטוריית-החייל-החיה
 *      ב-Hive → חיפוש custom_json id=saos שה-payload.time שלו === הרשומה
 *      → חילוץ trx_id + block אמיתיים.
 *   2. תיקון-המדינה: pendingVerifies → verified+txid+block;
 *      checkpoints[].anchors.hive 'pending:by'/undefined → אובייקט-אימות.
 *   3. דוח חי agent/pendings_verify_report.json — כל-המרה עם-ראיה.
 *
 * עקרון: אף-טענה-לא-מתוקנת-בלי-ראיה-מהשרשרת-המארחת-עצמה. מה-שלא-נמצא —
 * נשאר-כנה (cps 264+ חסומי-RC עד-הרג'ן — לא-ממציאים-אימותים).
 * ───────────────────────────────────────────────────────────────────────────── */
const fs = require('fs');
const path = require('path');

const HIVE_NODES = ['https://api.hive.blog', 'https://api.deathwing.me', 'https://hive-api.3speak.tv'];
const STATE_PATH = path.join(__dirname, '..', 'sovereign', 'node', 'state.json');
const REPORT_PATH = path.join(__dirname, 'pendings_verify_report.json');

async function hiveRpc(node, method, params) {
  const r = await fetch(node, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'SAOS-verify-pendings/89' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (j.error) throw new Error(String(j.error.message || JSON.stringify(j.error)).slice(0, 90));
  return j.result;
}

async function readSaosHistory(account, limit) {
  for (const node of HIVE_NODES) {
    try {
      const rows = await hiveRpc(node, 'condenser_api.get_account_history', [account, -1, limit]);
      const out = [];
      for (const row of rows) {
        const o = Array.isArray(row) ? row[1] : row;
        if (!o || !o.op || o.op[0] !== 'custom_json') continue;
        if (String((o.op[1] || {}).id || '') !== 'saos') continue;
        let pl;
        try { pl = JSON.parse(String(o.op[1].json || '{}')); } catch (_) { continue; }
        out.push({ trx: o.trx_id || null, block: o.block || null, ts: o.timestamp || null, payload: pl });
      }
      return out;
    } catch (e) { /* next node */ }
  }
  throw new Error('all hive nodes failed for history read');
}

async function main() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  state.pendingVerifies = state.pendingVerifies || [];
  state.checkpoints = state.checkpoints || [];

  const pendings = state.pendingVerifies.filter((p) => p.kind === 'hive-anchor' && !p.verified);
  // סמנים-לקריאת-היסטוריה: מי-שנרשם-ב-pendings + מי-שמופיע-כ-pending: + כל-הצבא (שמות-בלבד — keyless)
  let armyNames = [];
  try {
    const st2 = JSON.parse(fs.readFileSync(path.join(__dirname, 'agent-status.json'), 'utf8'));
    const fl = (st2.fleet && (st2.fleet.soldiers || st2.fleet)) || st2.army || [];
    armyNames = (Array.isArray(fl) ? fl : []).map((s) => (typeof s === 'string' ? s : s.username || s.account || s.name)).filter(Boolean);
  } catch (_) { /* optional */ }
  const anchorWriters = new Set(armyNames);
  for (const p of pendings) anchorWriters.add(p.by);
  for (const c of state.checkpoints) {
    const a = c.anchors && c.anchors.hive;
    if (typeof a === 'string' && a.startsWith('pending:')) anchorWriters.add(a.slice(8));
  }
  const report = { at: new Date().toISOString(), checked: pendings.length, verifiedNow: [], stillPending: [], checkpointRepairs: [], notes: [] };
  console.log('verify-pendings: ' + pendings.length + ' unverified hive-anchor claims · history-reads: ' + [...anchorWriters].join(','));

  // שלב 1 — אימות-מההיסטוריה-החיה (מטמון-אחד-לכל-חייל)
  const histCache = new Map();
  for (const who of anchorWriters) {
    try { histCache.set(who, await readSaosHistory(who, 1000)); }
    catch (e) { histCache.set(who, null); report.notes.push('history-read-fail @' + who + ': ' + String(e.message || e).slice(0, 60)); }
  }

  for (const p of pendings) {
    const hist = histCache.get(p.by);
    if (!hist) { report.stillPending.push({ by: p.by, time: p.time, reason: 'history-unreadable' }); continue; }
    // ההתאמה-המדויקת: payload.time === הזמן-שנרשם-בשידור (מזהה-חד-חד-ערכי)
    const match = hist.find((h) => h.payload && h.payload.time === p.time && h.payload.action === 'checkpoint');
    if (match) {
      p.verified = true;
      p.txid = match.trx;
      p.block = match.block;
      p.verifiedAt = new Date().toISOString();
      p.verifiedVia = 'hive-history-read-back (verify-pendings 89)';
      report.verifiedNow.push({ by: p.by, time: p.time, txid: match.trx, block: match.block, action: match.payload.action, cpHeight: match.payload.height || null });
      console.log('  ✓ verified @' + p.by + ' time=' + p.time + ' → trx ' + String(match.trx).slice(0, 14) + ' blk ' + match.block);
    } else {
      report.stillPending.push({ by: p.by, time: p.time, reason: 'no-matching-op-in-history' });
      console.log('  ✗ not-found @' + p.by + ' time=' + p.time + ' — נשאר-כנה (לא-ממציאים)');
    }
  }

  // שלב 2 — תיקון-עוגני-ה-checkpoint (מההיסטוריה-הזמינה, לפי-גובה)
  // מכסה-שני-מצבים: 'pending:by' (רישום-קיים-שלא-נאמת) ו-undefined (אף-רישום —
  // השידור-נחת-אבל-החוק-שלאכט-מעולם-לא-תיעד-אותו). שניהם-מתוקנים-מהשרשרת-המארחת.
  for (const cp of state.checkpoints) {
    const anchor = cp.anchors && cp.anchors.hive;
    const isPending = typeof anchor === 'string' && anchor.startsWith('pending:');
    if (anchor && !isPending) continue; // כבר-מאומת
    const by = isPending ? anchor.slice(8) : null;
    // מועמדים-לאימות: ההיסטוריה-של-מי-שנרשם, ואם-אין-רישום — כל-ההיסטוריות-שכבר-נקראו
    const sources = by ? [by] : [...histCache.keys()];
    let chosen = null;
    for (const who of sources) {
      const hist = histCache.get(who);
      if (!hist) continue;
      const matches = hist.filter((h) => h.payload && h.payload.action === 'checkpoint' && Number(h.payload.height) === Number(cp.height));
      if (matches.length) { chosen = { who, matches }; break; }
    }
    if (!chosen) continue;
    const first = chosen.matches[0];
    cp.anchors.hive = { verified: true, txid: first.trx, block: first.block, by: chosen.who, at: new Date().toISOString(), duplicates: chosen.matches.length - 1, backfilled: !isPending };
    report.checkpointRepairs.push({ cp: cp.height, txid: first.trx, block: first.block, by: chosen.who, duplicates: chosen.matches.length - 1, backfilled: !isPending });
    console.log('  ⚑ cp' + cp.height + '.hive repaired → trx ' + String(first.trx).slice(0, 14) + ' blk ' + first.block + (chosen.matches.length - 1 ? ' (' + (chosen.matches.length - 1) + ' dup-broadcasts documented)' : '') + (isPending ? '' : ' (backfill — לא-היה-רישום-כלל)'));
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log('verify-pendings DONE · verified-now=' + report.verifiedNow.length + ' · still-pending=' + report.stillPending.length + ' · cp-repairs=' + report.checkpointRepairs.length);
  console.log('report → ' + REPORT_PATH);
}

main().catch((e) => { console.error('verify-pendings FAILED: ' + String((e && e.message) || e)); process.exit(1); });
