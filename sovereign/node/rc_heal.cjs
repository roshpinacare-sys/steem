#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * RC-HEAL (112) — מרפא-הדלק של הצבא
 * ───────────────────────────────────────────────────────────────────────────
 * הבעיה-המדודה (חיה, 112): quorum-pending(0/3) — 0 attests מ-00:33 UTC.
 * שני-שורשים: (1) חומת-תקציב ATTESTS_PER_SOLDIER_DAY=3 שנשחקת בחצי-שעה
 * (תיקון ב-saosnet.cjs); (2) @israelnews — חייל-עני: 206 VESTS בלבד, max_rc
 * 2.2G — נשרף-עד-0.43% ונפסל-בשער-ה-RC (40%).
 * התרופה-כאן: האצלת-דלק אמת על-המארח — delegate_vesting_shares מ@haran
 * (החייל-העשיר-בפועל: 35K VESTS פנויים) אל @israelnews. ה-RC נגזר-מה-VESTS
 * האפקטיביים → המקסימום של @israelnews מזנק (נמדד לפני/אחרי), הרוטציה
 * חוזרת-להיות צודקת. חינם-לחלוטין (op פרוטוקול), הפיך (7 ימים), ניתן-לאימות
 * בציבור (rc_api + account-history). steem@0.7.11 לא-מכיר delegate_rc
 * (המדידה-החיה של W23 אצל האח) — delegate_vesting_shares הוא-הדרך-המוכחת.
 * ═══════════════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const steem = require(ROOT + '/node_modules/steem');
const NODES = ['https://api.steemit.com', 'https://api.justyy.com'];
const OUT = path.join(__dirname, 'rc-delegation.json');
const LOG = path.join(__dirname, 'rc-heal.log');

const dlog = (m) => { const line = '[' + new Date().toISOString() + '] rc-heal: ' + m; console.log(line); try { fs.appendFileSync(LOG, line + '\n'); } catch (_) {} };

async function rpc(method, params) {
  for (const url of NODES) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }), signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      if (j && j.result) return j.result;
    } catch (_) {}
  }
  return null;
}
async function rcOf(name) {
  const r = await rpc('rc_api.find_rc_accounts', { accounts: [name] });
  const row = r && r.rc_accounts && r.rc_accounts[0];
  if (!row) return null;
  const cur = parseFloat(row.rc_manabar && row.rc_manabar.current_mana) || 0;
  const max = parseFloat(row.max_rc) || 0;
  return { current: cur, max, pct: max > 0 ? (cur / max) * 100 : 0 };
}
async function vestsOf(name) {
  const r = await rpc('condenser_api.get_accounts', [[name]]);
  const a = r && r[0];
  return a ? { own: a.vesting_shares, received: a.received_vesting_shares, delegated_out: a.delegated_vesting_shares } : null;
}

async function main() {
  const FROM = 'haran', TO = 'israelnews', AMT = '30000.000000 VESTS';
  const before = { from: await vestsOf(FROM), to: await vestsOf(TO), toRc: await rcOf(TO), fromRc: await rcOf(FROM) };
  dlog('BEFORE @' + FROM + ' own=' + (before.from || {}).own + ' free≈own−out · @' + TO + ' max_rc=' + ((before.toRc || {}).max / 1e9).toFixed(2) + 'G (' + ((before.toRc || {}).pct || 0).toFixed(2) + '%)');

  const vault = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent', 'keys', 'vault.json'), 'utf8'));
  const donor = (vault.accounts || []).find((a) => a.username === FROM);
  const wif = donor && donor.keys && donor.keys.active && donor.keys.active.wif;
  if (!wif) { dlog('ABORT: אין-מפתח-active ל@' + FROM + ' (כנות)'); process.exit(2); }

  const op = ['delegate_vesting_shares', { delegator: FROM, delegatee: TO, vesting_shares: AMT }];
  let txid = null;
  try {
    const conf = await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [wif]);
    txid = (conf && conf.id) || null;
    dlog('DELEGATE ✓ ' + AMT + ' @' + FROM + ' → @' + TO + ' txid=' + txid);
  } catch (e) { dlog('BROADCAST-FAIL :: ' + String((e && e.message) || e).slice(0, 160)); process.exit(3); }

  /* אימות-מדידה: ההאצלה נכנסת-לתוקף תוך-בלוק-או-שניים — מודדים עד-3 פעמים */
  let after = null;
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 9000));
    const toV = await vestsOf(TO), toRc = await rcOf(TO);
    const recv = toV && parseFloat(toV.received) || 0;
    if (recv >= 30000) { after = { to: toV, toRc }; break; }
    dlog('verify-' + i + ': received=' + toV && toV.received + ' — ממתין-לאינדקס…');
  }
  const evidence = { at: new Date().toISOString(), op: 'delegate_vesting_shares', from: FROM, to: TO, amount: AMT, txid, before, after, note: '112 — מרפא-הדלק: האצלת-VESTS אמת כדי-שכל-הרוטציה תוכל-לחתום (quorum). ה-RC נגזר-מה-VESTS — נמדד לפני/אחרי.' };
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 1));
  if (after) dlog('AFTER @' + TO + ' received=' + after.to.received + ' · max_rc=' + (after.toRc.max / 1e9).toFixed(2) + 'G (' + after.toRc.pct.toFixed(2) + '%) — הדלק-זרם ✓');
  else dlog('AFTER: האינדקס-טרם-עודכן (נמדד-בסבב-הבא של השער) — txid=' + txid);
}
main().catch((e) => { dlog('FATAL ' + String((e && e.stack) || e).slice(0, 300)); process.exit(1); });
