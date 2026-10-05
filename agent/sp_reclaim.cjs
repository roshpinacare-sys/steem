#!/usr/bin/env node
/**
 * sp_reclaim.cjs — 117p8-R6: החזרת-האצלות-SP לראש (מפתח-פתיחה של מפעל-הצי).
 *
 * הממצא (נמדד חי 2026-09-10): headcorner מאציל ~3454 SP (~5.58M VESTS) ל-12 החשבונות
 * שלנו (~310 SP כל-אחד) — כולל tov המת. החזרת-ההאצלות מזנקת את תקרת-ה-RC של הראש
 * (0.76–1.0G RC/vest · קיר-טביעה ≈6.0T RC): 6.63–8.5T ≥ קיר ⇒ מפעל-הצי נפתח.
 *
 * האצלה-היא מצב-אבסולוטי: delegate_vesting_shares עם סכום-0 מבטל. ה-VESTS חוזרים
 * למאציל אחרי תקופת-החזרה של השרשרת (7-ימים ב-Steem קלאסי). הפעולה הפיכה —
 * אחרי-החזרה אפשר להאציל-מחדש לכל-אחד (ולחיילים-החדשים שייטבעו).
 *
 * שימוש:
 *   node agent/sp_reclaim.cjs --dry            (חישוב-בלבד)
 *   node agent/sp_reclaim.cjs --live           (חתימה-חיה מהראש)
 *   --keep ynet,wog                            (ממי לא לקחת-חזרה)
 *   --only cashmachine,haran                   (ממי דווקא לקחת)
 *   --to 0.000000                              (סכום-יעד-אבסולוטי; 0=ביטול-מלא)
 *
 * חוקי-ברזל: חתימה-מקומית-בלבד (ACTIVE_WIF של הראש) · self-test-מול-שרשרת ·
 * אפס-סודות-בפלט · --dry קודם-תמיד.
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/sp_reclaim.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
'use strict';
const fs = require('fs');
const path = require('path');
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
// 10-d-3 (2026-09-30) — LIVE-GATE right after the acting account (8-b: .env is the documented
// account source): reclaim broadcasts need --live (or HE_LIVE=1) AND HE_LIVE_CONFIRM=<account>.
// --dry still forces dry. Fail-closed default.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: HEAD });
announceGate(GATE);
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const DRY = process.argv.includes('--dry');
const LIVE = process.argv.includes('--live') && GATE.live;
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const KEEP = new Set((argOf('--keep', '') || '').split(',').filter(Boolean));
const ONLY = new Set((argOf('--only', '') || '').split(',').filter(Boolean));
const TO = argOf('--to', '0.000000');
const MVEST = 618.8802930746991; // steem_per_mvest חי 2026-09-10

const REPORT_PATH = path.join(__dirname, 'sp_reclaim_report.json');
const log = m => console.log('[' + new Date().toISOString() + '] spreclaim: ' + m);

/* נמעני-ההאצלה הידועים (מדידת-חיה: כל-חשבונות-הכספת מקבלים ~310 SP מהראש) */
function vaultNames() {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys/vault.json'), 'utf8'));
  return Object.values(v.accounts || v).map(a => a.username).filter(u => u !== HEAD);
}

async function main() {
  if (!DRY && !process.argv.includes('--live')) { console.log('usage: --dry | --live · --keep a,b · --only a,b · --to X'); process.exit(2); }
  if (!ACTIVE_WIF) throw new Error('ACTIVE_WIF missing in agent/.env');

  /* self-test: מפתח-הפעיל-שלנו אכן-הפעיל-על-השרשרת */
  const derived = steem.auth.wifToPublic(ACTIVE_WIF);
  const [head] = await new Promise((res, rej) => steem.api.getAccounts([HEAD], (e, r) => e ? rej(e) : res(r)));
  if (derived !== head.active.key_auths[0][0]) throw new Error('self-test FAIL: active key mismatch vs chain');
  const delegatedBefore = parseFloat(head.delegated_vesting_shares);
  log('self-test ✓ head=' + HEAD + ' · delegated_before=' + (delegatedBefore / 1e6).toFixed(4) + ' MVests (' + (delegatedBefore / 1e6 * MVEST).toFixed(0) + ' SP)');

  /* גילוי-נמענים: כל-חשבון-כספת שמקבל received>0 (והוא-יעד-שלנו) */
  const names = vaultNames();
  const accs = await new Promise((res, rej) => steem.api.getAccounts(names, (e, r) => e ? rej(e) : res(r)));
  const targets = [];
  for (const a of accs) {
    const rec = parseFloat(a.received_vesting_shares);
    if (rec > 0) targets.push({ name: a.name, received: rec });
  }
  let list = targets.filter(t => !KEEP.has(t.name));
  if (ONLY.size) list = list.filter(t => ONLY.has(t.name));
  const recSum = list.reduce((s, t) => s + t.received, 0);
  log('targets: ' + list.length + ' · reclaiming ' + (recSum / 1e6).toFixed(4) + ' MVests (' + (recSum / 1e6 * MVEST).toFixed(0) + ' SP)' + (KEEP.size ? ' · keep=' + [...KEEP].join(',') : ''));

  const rep = { at: new Date().toISOString(), mode: LIVE ? 'live' : 'dry', delegated_before: delegatedBefore, targets: [], to: TO };

  for (const t of list) {
    rep.targets.push({ account: t.name, reclaim: t.received });
    if (LIVE) {
      try {
        if (stasisStop('sp-reclaim')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
        await steem.broadcast.sendAsync({
          operations: [['delegate_vesting_shares', { delegator: HEAD, delegatee: t.name, vesting_shares: TO + ' VESTS', extensions: [] }]],
          extensions: [],
        }, [ACTIVE_WIF]);
        log('RECLAIMED ' + t.name + ' (was ' + (t.received / 1e6).toFixed(4) + ' MVests → ' + TO + ')');
      } catch (e) {
        rep.targets[rep.targets.length - 1].error = String(e.message || e).slice(0, 200);
        log('ERR ' + t.name + ': ' + String(e.message || e).slice(0, 160));
      }
    } else {
      log('DRY would reclaim ' + t.name + ' (' + (t.received / 1e6).toFixed(4) + ' MVests → ' + TO + ')');
    }
  }

  rep.projected_effective_vests = (parseFloat(head.vesting_shares) - delegatedBefore + parseFloat(head.received_vesting_shares) + recSum);
  rep.projected_effective_sp = +(rep.projected_effective_vests / 1e6 * MVEST).toFixed(1);
  rep.projected_rc_max_t_low = +(0.5022 + 0.7615e-6 * (rep.projected_effective_vests - 500264)).toFixed(3); // חישוב-ליניארי שמרני
  log('projected: effective ' + (rep.projected_effective_vests / 1e6).toFixed(4) + ' MVests (' + rep.projected_effective_sp + ' SP) · RC-max ~' + rep.projected_rc_max_t_low + 'T (claim wall ~6.0T)');

  if (LIVE) {
    const [after] = await new Promise((res, rej) => steem.api.getAccounts([HEAD], (e, r) => e ? rej(e) : res(r)));
    rep.delegated_after = parseFloat(after.delegated_vesting_shares);
    log('delegated_after=' + (rep.delegated_after / 1e6).toFixed(4) + ' MVests (returns to own vests after chain return-period)');
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(rep, null, 1));
  log('report → sp_reclaim_report.json');
}

main().catch(e => { console.error('FATAL', String(e.message || e)); process.exit(1); });
