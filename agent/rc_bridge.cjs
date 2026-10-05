#!/usr/bin/env node
/**
 * rc_bridge.cjs — 117p8-R6: גשר-ה-RC (הפתרון-החי למפעל-הצי).
 *
 * הרעיון (נמדד חי 2026-09-10): ספירת max_rc מצטברת של הצי על Steem = 7.77T ≥ כל-סף-טביעה
 * אפשרי. delegate_rc מחיילים→ראש מרכיב את תקרת-ה-RC של הראש בלי-עלות, בלי-מפתחות-חדשים,
 * הפיך-מיד (delegate_rc הוא אבסולוטי — ערך-כולל-שנקבע מחדש בכל-קריאה).
 *
 * שימוש:
 *   node agent/rc_bridge.cjs --dry          (חישוב-בלבד)
 *   node agent/rc_bridge.cjs --live         (חתימה-חיה)
 *   --pct 80                                (אחוז-מ-max_rc של-כל-חייל להאציל; ברירת-מחדל 80)
 *   --exclude ynet                          (לדלג על חשבון)
 *
 * חוקי-ברזל: self-test מפתח-פעיל-מול-שרשרת לפני-כל-חתימה · אפס-סודות-בפלט ·
 * כל-חייל שומר-לפחות (100-pct)% מה-RC שלו לפעולות-יומיומיות.
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/rc_bridge.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}

const STEEM_RPC = 'https://api.steemit.com';
steem.api.setOptions({ url: STEEM_RPC, useAppbaseApi: true });

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq <= 0) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(__dirname);
const HEAD = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const DRY = process.argv.includes('--dry');
const LIVE = process.argv.includes('--live');
const PCT = parseInt((a => (process.argv.indexOf(a) > -1 ? process.argv[process.argv.indexOf(a) + 1] : null))('--pct'), 10) || 80;
const EXCLUDE = new Set([HEAD, ...(((i => (i > -1 ? process.argv[i + 1] : ''))(process.argv.indexOf('--exclude'))) || '').split(',').filter(Boolean)]);

const VAULT_PATH = path.join(__dirname, 'keys/vault.json');
const REPORT_PATH = path.join(__dirname, 'rc_bridge_report.json');
const log = m => console.log('[' + new Date().toISOString() + '] rcbridge: ' + m);
const mask = w => (w ? String(w).slice(0, 8) + '…' : '(none)');
/* מפתחות-כספת: מחרוזת או אובייקט {wif,pub} */
const wifOf = k => (typeof k === 'string' ? k : (k && k.wif) || '');

function vaultAccounts() {
  const v = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
  return Object.values(v.accounts || v).map(a => ({ username: a.username, keys: a.keys || {} }));
}

function rpc(url, body) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const p = JSON.stringify(body);
    const r = https.request({ hostname: u.hostname, path: '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }, timeout: 25000 }, x => {
      let d = '';
      x.on('data', c => (d += c));
      x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('parse: ' + d.slice(0, 120))); } });
    });
    r.on('error', rej);
    r.setTimeout(25000, () => r.destroy(new Error('timeout')));
    r.write(p); r.end();
  });
}

async function rcAccounts(names) {
  const r = await rpc(STEEM_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: names }, id: 1 });
  const arr = (r.result && r.result.rc_accounts) || [];
  return new Map(arr.map(a => [a.account, { max: BigInt(a.max_rc), cur: BigInt(a.rc_manabar ? a.rc_manabar.current_mana : '0') }]));
}

async function main() {
  if (!DRY && !LIVE) { console.log('usage: --dry | --live · --pct N · --exclude a,b'); process.exit(2); }
  const vault = vaultAccounts().filter(a => !EXCLUDE.has(a.username));
  const names = vault.map(a => a.username);
  const before = await rcAccounts([...names, HEAD]);
  const headBefore = before.get(HEAD).max;
  log('pool: ' + names.length + ' soldiers · keep ' + (100 - PCT) + '% each · head max_before=' + (Number(headBefore) / 1e12).toFixed(4) + 'T');

  const rep = { at: new Date().toISOString(), mode: LIVE ? 'live' : 'dry', pct: PCT, delegated: [], head_max_before: Number(headBefore).toString() };

  let totalDeleg = 0n;
  for (const acc of vault) {
    try {
      const rcInfo = before.get(acc.username);
      if (!rcInfo) { rep.delegated.push({ account: acc.username, skipped: 'no-rc-info' }); continue; }
      const amount = (rcInfo.max * BigInt(PCT)) / 100n;
      if (amount <= 0n) { rep.delegated.push({ account: acc.username, skipped: 'zero-amount' }); continue; }
      /* self-test: מפתח-הפעיל-בכספת אכן-המפתח-על-השרשרת */
      const wif = wifOf(acc.keys.active);
      if (!wif) { rep.delegated.push({ account: acc.username, skipped: 'no-active-key-in-vault' }); continue; }
      const derived = steem.auth.wifToPublic(wif);
      const [live] = await new Promise((res, rej) => steem.api.getAccounts([acc.username], (e, r) => e ? rej(e) : res(r)));
      if (derived !== live.active.key_auths[0][0]) { rep.delegated.push({ account: acc.username, skipped: 'active-key-mismatch' }); continue; }
      rep.delegated.push({ account: acc.username, key: mask(wif), max_rc: Number(rcInfo.max).toString(), delegate: Number(amount).toString() });
      totalDeleg += amount;
      if (LIVE) {
        if (stasisStop('rc-bridge')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
        await steem.broadcast.sendAsync({
          operations: [['delegate_rc', { from: acc.username, to: HEAD, max_rc: Number(amount).toString(), extensions: [] }]],
          extensions: [],
        }, { active: wif });
        log('DELEGATED ' + acc.username + ' → ' + HEAD + ' rc=' + (Number(amount) / 1e12).toFixed(4) + 'T (key ' + mask(wif) + ')');
      } else {
        log('DRY would delegate ' + acc.username + ' → ' + HEAD + ' rc=' + (Number(amount) / 1e12).toFixed(4) + 'T');
      }
    } catch (e) {
      rep.delegated.push({ account: acc.username, error: String(e.message || e).slice(0, 200) });
      log('ERR ' + acc.username + ': ' + String(e.message || e).slice(0, 160));
    }
  }

  const headAfterTarget = headBefore + totalDeleg;
  rep.head_max_projected = Number(headAfterTarget).toString();
  rep.head_max_projected_t = (Number(headAfterTarget) / 1e12).toFixed(4);
  log('head max projected: ' + (Number(headBefore) / 1e12).toFixed(4) + 'T → ' + (Number(headAfterTarget) / 1e12).toFixed(4) + 'T');

  if (LIVE) {
    const after = await rcAccounts([HEAD]);
    const headAfter = after.get(HEAD).max;
    rep.head_max_after = Number(headAfter).toString();
    rep.head_max_after_t = (Number(headAfter) / 1e12).toFixed(4);
    log('head max AFTER (live): ' + rep.head_max_after_t + 'T');
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(rep, null, 1));
  log('report → rc_bridge_report.json');
}

main().catch(e => { console.error('FATAL', String(e.message || e)); process.exit(1); });
