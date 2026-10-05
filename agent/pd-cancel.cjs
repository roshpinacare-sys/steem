#!/usr/bin/env node
'use strict';
/**
 * pd-cancel.cjs — ביטול-הפאוורדאון הנותר על @headcorner (owner directive 2026-10-05, IM trace 1a10e3975b4668a1)
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════
 * OWNER WORD (מילה-במילה): 'לא עושים עוד פאוורדאון!!!!! צריך את הכוח! צריך כוח לכולם!'
 *
 * פעולה: withdraw_vesting { account: headcorner, vesting_shares: '0.000000 VESTS' } — סגירת-לוח-הזמנים.
 * אפקט: תשלום-ה-~475.95 SP שהיה מתוכנן ל-2026-10-10T02:01:27Z מבוטל — הכוח נשאר SP (הצבעה/האצלה).
 * הפיכות: פאוורדאון חדש ניתן לפתיחה בכל-עת — הפעולה מסוכנת-מינימום ומורידת-סיכון (עוצרת-דליפת-כוח).
 *
 * סמכות (כנות-מלאה): owner-directive מרושש בשרשרת-ההנחיות i=3 (owner-note, lanes=['vesting'], hash 083c8510…).
 *   הריצה היא יד-הבעלים דרך משטח-החתימה של האורגניזם — NOT an organism lane expansion:
 *   STASIS+E10 לא "אישרו" ולא נדרשו-לאישור כאן; הם נשארים בתוקף מלא לכל-פעולת-הון שמקורה האורגניזם.
 *   boundaryStatus נשאר OWNER_ONLY (R30 verdict B) — הקבלה לא מתלוננת אחרת.
 *
 * סורגים: live-gate 28-b (--live + HE_LIVE_CONFIRM=headcorner; DRY ברירת-מחדל) · סורג-בייטים
 *   (נגזרת-מפתח-פעיל מול active.key_auths בשרשרת) · idempotency (to_withdraw=0 → NOOP) ·
 *   אימות-קריאה-חוזרת (to_withdraw=0 && rate=0) · קבלה ל-agent/receipts · journal ל-capital-decisions.jsonl.
 *
 * אפס-סודות: מפתח-האם נקרא מקובץ-מקומי, נגזר ל-WIF בזיכרון בלבד — לעולם לא מודפס/נרשם/נשלח.
 *
 * הרצה:  AGENT_ACCOUNT=headcorner node agent/pd-cancel.cjs            (DRY)
 * חי:    AGENT_ACCOUNT=headcorner HE_LIVE=1 HE_LIVE_CONFIRM=headcorner node agent/pd-cancel.cjs
 */
const fs = require('fs');
const path = require('path');
const steem = require('steem');
const capGate = require('./lib/capital_gate.cjs');
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');

steem.api.setOptions({ url: process.env.PD_NODE || 'https://api.steemit.com' });
const RPCS = [process.env.PD_NODE || 'https://api.steemit.com', 'https://api.justyy.com'];
const HEAD = 'headcorner';
const KEYFILE = process.env.HC_KEYFILE || '/home/z/my-project/upload/headcorner.txt';
const TRACE = '1a10e3975b4668a1';
const OUT = path.join(__dirname, 'receipts', '2026-10-05-powerdown-cancel.json');
const ACTING = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACTING) { console.error('usage: AGENT_ACCOUNT=headcorner node agent/pd-cancel.cjs — no default acting account'); process.exit(1); }
if (ACTING !== HEAD) { console.error('head-only lock: this executor touches @' + HEAD + ' only'); process.exit(1); }

const GATE = resolveLiveGate(process.argv, { account: HEAD });
announceGate(GATE);
const DRY = GATE.dry;

async function rpc(method, params) {
  let lastErr = null;
  for (let attempt = 0; attempt < RPCS.length * 2; attempt++) {
    const url = RPCS[attempt % RPCS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.' + method, params }), signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.error) throw new Error('rpc-error: ' + (j.error.message || JSON.stringify(j.error)).slice(0, 140));
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw new Error('all RPC nodes failed (' + ((lastErr && lastErr.message) || lastErr) + ')');
}

function loadMasterPassword() {
  if (!fs.existsSync(KEYFILE)) return null;
  const lines = fs.readFileSync(KEYFILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => (l.startsWith('P') || l.startsWith('5')) && l.length >= 50) || null;
}

function spOf(vestRaw, props) {
  const tv = parseFloat(props.total_vesting_fund_steem), ts = parseFloat(props.total_vesting_shares);
  return (parseFloat(vestRaw) / ts) * tv;
}

async function main() {
  const t0 = new Date().toISOString();
  const acct = (await rpc('get_accounts', [[HEAD]]))[0];
  const props = await rpc('get_dynamic_global_properties', []);
  const before = {
    vestingSP: +spOf(acct.vesting_shares, props).toFixed(3),
    delegatedOutSP: +spOf(acct.delegated_vesting_shares, props).toFixed(3),
    toWithdraw: acct.to_withdraw,
    withdrawn: acct.withdrawn,
    rate: acct.vesting_withdraw_rate,
    nextVestingWithdrawal: acct.next_vesting_withdrawal,
    remainingToWithdrawSP: +spOf(String((Number(acct.to_withdraw) - Number(acct.withdrawn)) / 1e6), props).toFixed(3),
  };
  console.log('[PD] before: remaining=' + before.remainingToWithdrawSP + ' SP · next=' + before.nextVestingWithdrawal + ' · rate=' + before.rate);

  if (Number(before.toWithdraw) === 0 && Number(before.rate) === 0) {
    const receipt = { at: t0, tool: 'pd-cancel.cjs', trace: TRACE, status: 'NOOP-ALREADY-CANCELED', before, note: 'no active power-down schedule — nothing to do (idempotent)' };
    fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
    capGate.journal('pd-cancel', { kind: 'owner-directed-capital-op', decision: 'no-op', lane: 'vesting', authority: 'owner-directive IM ' + TRACE + ' (chain i=3)', note: 'already canceled — idempotent NOOP', dry: DRY });
    console.log('[PD] NOOP — power-down schedule already zero. receipt → ' + OUT);
    return;
  }

  // סורג-בייטים: נגזרת מפתח-האם מול סמכות-ה-active בשרשרת (טביעות-אצבע ציבוריות בלבד)
  const pw = loadMasterPassword();
  if (!pw) { console.error('[PD] FATAL: master key file not found/invalid — fail-closed, no broadcast'); process.exit(1); }
  let wif = null, actOk = false;
  try { wif = steem.auth.toWif(HEAD, pw, 'active'); actOk = steem.auth.wifToPublic(wif) === acct.active.key_auths[0][0]; } catch (_) {}
  /* wif נשאר בזיכרון-בלבד — לעולם לא מודפס/נרשם */
  console.log('[PD] active-key byte gate: ' + actOk + (DRY ? ' · DRY' : ' · LIVE'));
  if (!actOk) { console.error('[PD] GATE FAIL — derived key is NOT the on-chain active authority. No broadcast.'); process.exit(1); }

  const op = ['withdraw_vesting', { account: HEAD, vesting_shares: '0.000000 VESTS' }];

  if (DRY) {
    const receipt = { at: t0, tool: 'pd-cancel.cjs', trace: TRACE, status: 'DRY-WOULD-CANCEL', before, op: { type: op[0], account: op[1].account, vesting_shares: op[1].vesting_shares }, note: 'DRY gate — broadcast requires --live + HE_LIVE_CONFIRM=headcorner; byte gate PASSED (derived key matches on-chain active authority)', authority: 'owner-directive IM ' + TRACE + ' (chain i=3, hash 083c851004d76bd4…)' };
    fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
    capGate.journal('pd-cancel', { kind: 'owner-directed-capital-op', decision: 'dry-execute', lane: 'vesting', authority: 'owner-directive IM ' + TRACE + ' (chain i=3)', note: 'DRY — byte gate passed, would cancel remaining ' + before.remainingToWithdrawSP + ' SP power-down', dry: true });
    console.log('[PD] DRY — would broadcast withdraw_vesting=0 (keeps ~' + before.remainingToWithdrawSP + ' SP). receipt → ' + OUT);
    return;
  }

  // LIVE
  let bcErr = null;
  try { await steem.broadcast.sendAsync({ operations: [op], extensions: [] }, [wif]); } catch (e) { bcErr = e; }
  if (bcErr) {
    const receipt = { at: t0, tool: 'pd-cancel.cjs', trace: TRACE, status: 'BROADCAST-FAIL', before, error: String(bcErr.message || bcErr).slice(0, 200) };
    fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
    capGate.journal('pd-cancel', { kind: 'owner-directed-capital-op', decision: 'execute-failed', lane: 'vesting', authority: 'owner-directive IM ' + TRACE + ' (chain i=3)', note: 'broadcast failed: ' + String(bcErr.message || bcErr).slice(0, 120), dry: false });
    console.error('[PD] BROADCAST FAILED: ' + String(bcErr.message || bcErr).slice(0, 160));
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 2500));
  const acct2 = (await rpc('get_accounts', [[HEAD]]))[0];
  /* הקריאה-החוזרת: שדות-השרשרת הם מחרוזות-עם-יחידות ('0.000000 VESTS') — parseFloat לפני-השוואה
   * (תיקון: הריצה-הראשונה 22:52Z דירגה NO-READBACK בגלל NaN של-Number('0.000000 VESTS');
  *  אימות-עצמאי בשני-צמתים אישר CANCELED — הקבלה תוקנה ונרשמה שורת-אימות ביומן). */
  const verified = parseFloat(String(acct2.to_withdraw)) === 0 && parseFloat(String(acct2.vesting_withdraw_rate)) === 0;

  // txid מהיסטוריית-החשבון (ראיה-ציבורית)
  let trxId = null;
  try {
    const hist = await rpc('get_account_history', [HEAD, -1, 20]);
    const rows = (hist || []).map((x) => x[1]).filter((r) => r && r.op && (r.op[0] === 'withdraw_vesting'));
    const last = rows[rows.length - 1];
    if (last) { trxId = last.trx_id; if (parseFloat(last.op[1].vesting_shares) !== 0) trxId = trxId + ' (note: last withdraw_vesting op amount=' + last.op[1].vesting_shares + ')'; }
  } catch (_) {}

  const receipt = {
    at: t0, finishedAt: new Date().toISOString(), tool: 'pd-cancel.cjs', trace: TRACE,
    status: verified ? 'CANCELED-VERIFIED' : 'NO-READBACK',
    ownerWord: 'לא עושים עוד פאוורדאון!!!!! צריך את הכוח! צריך כוח לכולם!',
    authority: 'owner-directive IM ' + TRACE + ' — recorded in owner-directives.jsonl i=3 (owner-note, lanes=["vesting"], hash 083c851004d76bd4…); executed as the owner\'s hand via the organism signing surface — NOT an organism lane expansion; STASIS+E10 remain in force for organism-initiated capital ops; boundaryStatus remains OWNER_ONLY (R30 verdict B)',
    before,
    op: { type: op[0], account: op[1].account, vesting_shares: op[1].vesting_shares },
    trxId,
    after: { toWithdraw: acct2.to_withdraw, withdrawn: acct2.withdrawn, rate: acct2.vesting_withdraw_rate, nextVestingWithdrawal: acct2.next_vesting_withdrawal },
    keptAsPowerSP: before.remainingToWithdrawSP,
    reversibility: 'a new power-down can be opened at any time by owner word',
  };
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
  capGate.journal('pd-cancel', { kind: 'owner-directed-capital-op', decision: 'execute', lane: 'vesting', authority: 'owner-directive IM ' + TRACE + ' (chain i=3)', trxId, verified, note: 'withdraw_vesting=0 broadcast; kept ' + before.remainingToWithdrawSP + ' SP as power; read-back ' + (verified ? 'VERIFIED' : 'PENDING'), dry: false });
  console.log('[PD] ' + (verified ? 'CANCELED-VERIFIED' : 'NO-READBACK') + ' · kept ~' + before.remainingToWithdrawSP + ' SP as power · trx=' + (trxId || 'n/a') + ' · receipt → ' + OUT);
}

main().catch((e) => { console.error('[PD] fatal: ' + String(e.message || e).slice(0, 200)); process.exit(1); });
