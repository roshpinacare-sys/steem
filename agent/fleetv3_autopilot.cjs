#!/usr/bin/env node
/**
 * fleetv3_autopilot.cjs — 117p8-R6: טייס-הצמיחה + קו-ייצור הצי (מתוקן-יחידות).
 *
 * תיקוני-אמת (R6 · נמדד חי 2026-09-10):
 *   (1) יחידות: R5 דיווח "SP" = vests/1e6 — זהו MVests! SP אמיתי = vests/1e6 × steem_per_mvest
 *       (הראש: 8.65 MVests = 5351 SP אמיתיים לפי mvest=618.88).
 *   (2) rc_max: R5 קרא rc_manabar.max_mana (לא-קיים) → נפל ל-current. השדה האמיתי = max_rc ברמה-העליונה.
 *   (3) קיר-הטביעה נמדד חי משגיאת-שרשרת: claim_account needs 5,782,813,530,594 RC.
 *   (4) מסלול-הפתיחה: החזרנו 5.55M vests מוקצים (sp_reclaim 11/11) + בוטל power-down 2.82M vests
 *       → כשה-vests חוזרים (~7 ימים) maxRC מזנק מ-2.76T ל-~7-10T ≥ קיר ⇒ פתיחה-אוטומטית.
 *
 * תפקיד יומי:
 *   A. תביעת-תגמולים + power-up (דלק מצטבר)
 *   B. מדידת RC חי (max+current) + ETA מדויק (regen 20%/יום של max)
 *   C. אם current ≥ קיר: **טביעה-אוטומטית** — fleet_mint_v3 --mint 1 (חייל-חדש על-השרשרת)
 *
 * הרצה: node agent/fleetv3_autopilot.cjs [--dry]
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/fleetv3_autopilot.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const steem = require('steem');

const DIR = __dirname;
steem.api.setOptions({ url: 'https://api.steemit.com', useAppbaseApi: true });
for (const line of fs.readFileSync(path.join(DIR, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq <= 0) continue;
  const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}
const HEAD = (process.env.AGENT_ACCOUNT || '').toLowerCase();
// 10-d-3 (2026-09-30) — LIVE-GATE right after the acting account (8-b: .env is the documented
// account source), BEFORE any key material is referenced: claim/power-up/auto-mint broadcasts
// need --live (or HE_LIVE=1) AND HE_LIVE_CONFIRM=<account>. --dry still forces dry. Fail-closed default.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: HEAD });
announceGate(GATE);
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const DRY = process.argv.includes('--dry') || GATE.dry;
const STATE_PATH = path.join(DIR, 'fleetv3_state.json');
const CLAIM_RC_NEEDED = 5782813530594; // נמדד חי משגיאת-שרשרת 2026-09-10
const RC_REGEN_DAYS = 5;               // RC regen: מלא תוך ~5 ימים
const AUTO_MINT = true;                // טביעה-אוטומטית כשהקיר נחצה
const log = m => console.log('[' + new Date().toISOString() + '] autopilot: ' + m);

const state = (() => { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (_) { return { runs: [], claimed: 0, poweredUp: 0, lifetimePoweredUp: 0 }; } })();

/* RC מדויק: max_rc (רמה-עליונה) + current_mana */
function rcApi() {
  return new Promise((res, rej) => {
    const p = JSON.stringify({ jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [HEAD] }, id: 1 });
    const q = https.request({ hostname: 'api.steemit.com', path: '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }, timeout: 25000 }, r => {
      let d = ''; r.on('data', c => (d += c)); r.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return rej(new Error(j.error.message));
          const a = j.result.rc_accounts[0];
          res({ max: Number(a.max_rc), cur: Number(a.rc_manabar ? a.rc_manabar.current_mana : 0) });
        } catch (x) { rej(x); }
      });
    });
    q.on('timeout', () => q.destroy(new Error('timeout'))); q.on('error', rej); q.write(p); q.end();
  });
}

(async () => {
  let rc = { max: 0, cur: 0 };
  try { rc = await rcApi(); } catch (x) { log('rc read warn: ' + x.message.slice(0, 60)); }
  const raw = await new Promise((res, rej) => steem.api.getAccounts([HEAD], (e, r) => e ? rej(e) : res(r)));
  const a = Array.isArray(raw) ? raw[0] : (raw.accounts ? raw.accounts[0] : raw);
  const dgpR = await new Promise((res) => steem.api.getDynamicGlobalProperties((e, r) => res(e ? null : r)));
  const mvest = dgpR ? (parseFloat(dgpR.total_vesting_fund_steem) / (parseFloat(dgpR.total_vesting_shares) / 1e6)) : 0;

  const vest = parseFloat(a.vesting_shares), delOut = parseFloat(a.delegated_vesting_shares), recv = parseFloat(a.received_vesting_shares);
  const spTotal = vest / 1e6 * mvest, spEffective = (vest - delOut + recv) / 1e6 * mvest, liq = parseFloat(a.balance);
  const rw = { steem: a.reward_steem_balance, sbd: a.reward_sbd_balance, vests: a.reward_vesting_balance };
  const hasRw = parseFloat(rw.steem) > 0 || parseFloat(rw.sbd) > 0 || parseFloat(rw.vests) > 0;
  const run = { at: new Date().toISOString(), day: new Date().toISOString().slice(0, 10), spTotal: +spTotal.toFixed(1), spEffective: +spEffective.toFixed(1), liquid: +liq.toFixed(3), delegatedOut: +(delOut / 1e6).toFixed(3), rewards: rw, claimedNow: false, poweredNow: false, mintedNow: 0 };

  log('head ' + HEAD + ' realSP=' + spTotal.toFixed(1) + ' effective=' + spEffective.toFixed(1) + ' liq=' + liq + ' delegatedOut=' + (delOut / 1e6).toFixed(3) + 'MVEST · rc max=' + (rc.max / 1e12).toFixed(3) + 'T cur=' + (rc.cur / 1e12).toFixed(3) + 'T');

  /* A. תביעת-תגמולים + power-up */
  if (hasRw && !DRY && ACTIVE_WIF) {
    try {
      await steem.broadcast.sendAsync({ operations: [['claim_reward_balance', { account: HEAD, reward_steem: rw.steem, reward_sbd: rw.sbd, reward_vests: rw.vests }]], extensions: [] }, [ACTIVE_WIF]);
      run.claimedNow = true; state.claimed = (state.claimed || 0) + 1;
      log('claim ✓ ' + rw.steem + ' + ' + rw.vests);
    } catch (x) { run.error = String(x.message).slice(0, 120); log('claim ✗ ' + run.error); }
    if (parseFloat(rw.steem) > 0.001 && !run.error) {
      try {
        await steem.broadcast.sendAsync({ operations: [['transfer_to_vesting', { from: HEAD, to: HEAD, amount: rw.steem }]], extensions: [] }, [ACTIVE_WIF]);
        run.poweredNow = true; state.lifetimePoweredUp = +(((state.lifetimePoweredUp || 0) + parseFloat(rw.steem))).toFixed(4);
        log('power-up ✓ ' + rw.steem);
      } catch (x) { run.error = run.error || String(x.message).slice(0, 120); log('power-up ✗ ' + run.error); }
    }
  }

  /* B. מתמטיקת-פתיחה חיה */
  const unlocked = rc.max >= CLAIM_RC_NEEDED && rc.cur >= CLAIM_RC_NEEDED;
  const rcRatioMax = rc.max ? +(rc.max / CLAIM_RC_NEEDED).toFixed(3) : 0;
  const rcRatioCur = rc.max ? +(rc.cur / CLAIM_RC_NEEDED).toFixed(3) : 0;
  const regenPerDay = rc.max / RC_REGEN_DAYS;
  const daysToRegen = regenPerDay > 0 ? Math.max(0, (CLAIM_RC_NEEDED - rc.cur) / regenPerDay) : null;
  const vestsPendingReturn = delOut; // ההאצלות-שבוטלו חוזרות אחרי תקופת-השרשרת
  const etaReturnDays = vestsPendingReturn > 0 ? 7 : 0; // תקופת-החזרה קלאסית (נבדק בקרוב מהשרשרת)

  /* C. טביעה-אוטומטית */
  if (unlocked && AUTO_MINT && !DRY) {
    log('WALL CROSSED (max=' + (rc.max / 1e12).toFixed(3) + 'T ≥ ' + (CLAIM_RC_NEEDED / 1e12).toFixed(3) + 'T) — minting 1 soldier…');
    const r = spawnSync('node', [path.join(DIR, 'fleet_mint_v3.cjs'), '--live', '--mint', '1', '--prefix', 'hcnova', '--start', String((state.mintedStart || 2)), '--sp', '0.1'], { encoding: 'utf8', cwd: path.join(DIR, '..') });
    const out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
    run.mintedNow = /create_claimed_account ✓/.test(out) ? 1 : 0;
    if (run.mintedNow) { state.minted = (state.minted || 0) + 1; state.mintedStart = (state.mintedStart || 2) + 1; }
    log('mint output: ' + out.split('\n').slice(-6).join(' | ').slice(0, 400));
  }

  state.fleetMintUnlocked = unlocked;
  state.lastRun = run;
  state.progress = {
    realSPTotal: +spTotal.toFixed(1), realSPEffective: +spEffective.toFixed(1),
    vestsPendingReturn: +(vestsPendingReturn / 1e6).toFixed(3), etaReturnDays,
    rcMaxT: +(rc.max / 1e12).toFixed(3), rcCurT: +(rc.cur / 1e12).toFixed(3),
    rcNeededT: +(CLAIM_RC_NEEDED / 1e12).toFixed(3), rcRatioMax, rcRatioCur,
    daysToRegen: daysToRegen === null ? null : +daysToRegen.toFixed(1),
    unitsFixed: 'R6: SP=mvest-true · rc_max=real-field · wall=5.7828T live-measured',
  };
  state.runs = (state.runs || []).concat(run).slice(-30);
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));

  if (unlocked) log('fleetMintUnlocked=true — קו-הייצור חי!');
  else log('gap: cur=' + (rc.cur / 1e12).toFixed(3) + 'T/max=' + (rc.max / 1e12).toFixed(3) + 'T vs wall=' + (CLAIM_RC_NEEDED / 1e12).toFixed(3) + 'T · regen-ETA ' + (daysToRegen === null ? '?' : daysToRegen.toFixed(1)) + 'd (אחרי חזרת ה-vests) · vests-in-return=' + (vestsPendingReturn / 1e6).toFixed(3) + 'M');
})().catch(x => { log('FATAL ' + x.message); process.exit(1); });
