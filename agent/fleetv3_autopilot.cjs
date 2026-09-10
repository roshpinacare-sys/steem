#!/usr/bin/env node
/**
 * fleetv3_autopilot.cjs — 117p8-R5: טייס-אוטומטי-צמיחת-SP → פתיחת-מפעל-הצי.
 *
 * הרקע (מדויק): claim_account דורש 5,822,571,589,956 RC (5.83T) · ל-headcorner
 * יש 3.46T RC מקסימלי (≈8.8 SP) ⇒ טביעת-חשבונות-חדשים חסומה עד ~+6.0 SP.
 *
 * המנוע: כל-ריצה —
 *   1. קריאת-יתרות-חיות (reward balances + SP + RC)
 *   2. claim_reward_balance אם-יש-תגמולים (posting/active — מפתח-פעיל-בלבד)
 *   3. transfer_to_vesting לכל-ה-STEEM הנזיל של-הראש (compound מלא)
 *   4. מדידת-הפער-אל-סף-הפתיחה + פלט-מצב-ל-agent/fleetv3_state.json
 *   5. כשה-RC-max חוצה-את-הסף → fleetMintUnlocked=true (מפעל-הצי-נפתח!)
 *
 * ריצה-יומית מתוכננת דרך guardian-loop (ללא-סודות-בלוג · WIFs-רק-בזיכרון).
 */
'use strict';
const fs = require('fs');
const path = require('path');
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
const HEAD = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const DRY = process.argv.includes('--dry');
const STATE_PATH = path.join(DIR, 'fleetv3_state.json');
const CLAIM_RC_NEEDED = 5822571589956; // measured live 2026-09-10
const SP_AT_UNLOCK = 14.8;            // measured ratio: 8.8 SP → 3.46T ⇒ 5.83T ≈ 14.8 SP
const log = m => console.log('[' + new Date().toISOString() + '] autopilot: ' + m);

const state = (() => { try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch (_) { return { runs: [], claimed: 0, poweredUp: 0 }; } })();

/* RC מדויק דרך rc_api (get_accounts לא-מחזיר-מקסימלי-אמין) */
const https = require('https');
function rcApi() {
  return new Promise((res, rej) => {
    const p = JSON.stringify({ jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [HEAD] }, id: 1 });
    const q = https.request({ hostname: 'api.steemit.com', path: '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }, timeout: 25000 }, r => {
      let d = ''; r.on('data', c => (d += c)); r.on('end', () => { try { const j = JSON.parse(d); j.error ? rej(new Error(j.error.message)) : res(j.result.rc_accounts[0].rc_manabar); } catch (x) { rej(x); } });
    });
    q.on('timeout', () => q.destroy(new Error('timeout'))); q.on('error', rej); q.write(p); q.end();
  });
}

(async () => {
  let rcMax = 0;
  try { const m = await rcApi(); rcMax = Number(m.max_mana || m.current_mana || 0); } catch (x) { log('rc read warn: ' + x.message.slice(0, 60)); }
  const raw = await new Promise((res, rej) => steem.api.getAccounts([HEAD], (e, r) => e ? rej(e) : res(r)));
  const a = Array.isArray(raw) ? raw[0] : (raw.accounts ? raw.accounts[0] : raw);
    const vest = parseFloat(a.vesting_shares), delOut = parseFloat(a.delegated_vesting_shares);
  const sp = vest / 1e6, free = (vest - delOut) / 1e6, liq = parseFloat(a.balance);
  const rw = { steem: a.reward_steem_balance, sbd: a.reward_sbd_balance, vests: a.reward_vesting_balance };
  const hasRw = parseFloat(rw.steem) > 0 || parseFloat(rw.sbd) > 0 || parseFloat(rw.vests) > 0; // current≈max when full
  const run = { at: new Date().toISOString(), day: new Date().toISOString().slice(0, 10), sp: +sp.toFixed(3), freeSP: +free.toFixed(2), liquid: +liq.toFixed(3), rewards: rw, claimedNow: false, poweredNow: false };

  log('head ' + HEAD + ' SP=' + sp.toFixed(3) + ' free=' + free.toFixed(2) + ' liq=' + liq + ' rewards=' + JSON.stringify(rw));

  if (hasRw && !DRY && ACTIVE_WIF) {
    try {
      await steem.broadcast.sendAsync({ operations: [['claim_reward_balance', { account: HEAD, reward_steem: rw.steem, reward_sbd: rw.sbd, reward_vests: rw.vests }]], extensions: [] }, [ACTIVE_WIF]);
      run.claimedNow = true; state.claimed = (state.claimed || 0) + 1;
      log('claim ✓ ' + rw.steem + ' + ' + rw.vests);
    } catch (x) { run.error = String(x.message).slice(0, 120); log('claim ✗ ' + run.error); }
    if (parseFloat(rw.steem) > 0.001 && !run.error) {
      try {
        await steem.broadcast.sendAsync({ operations: [['transfer_to_vesting', { from: HEAD, to: HEAD, amount: rw.steem }]], extensions: [] }, [ACTIVE_WIF]);
        run.poweredNow = true; state.poweredUp = (state.poweredUp || 0) + parseFloat(rw.steem);
        log('power-up ✓ ' + rw.steem);
      } catch (x) { run.error = run.error || String(x.message).slice(0, 120); log('power-up ✗ ' + run.error); }
    }
  }

  const gapSP = Math.max(0, SP_AT_UNLOCK - sp);
  const rcRatio = rcMax ? +(rcMax / CLAIM_RC_NEEDED).toFixed(3) : null;
  state.fleetMintUnlocked = rcMax >= CLAIM_RC_NEEDED;
  state.lastRun = run;
  state.progress = { spNow: +sp.toFixed(3), spAtUnlock: SP_AT_UNLOCK, gapSP: +gapSP.toFixed(3), rcNowT: +(rcMax / 1e12).toFixed(2), rcNeededT: 5.83, rcRatio };
  state.runs = (state.runs || []).concat(run).slice(-30);
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 1));

  if (state.fleetMintUnlocked) log('fleetMintUnlocked=true — מפעל-הצי-פתוח! הרץ: node agent/fleet_mint_v3.cjs --mint N');
  else log('gap: ' + gapSP.toFixed(2) + ' SP to unlock (' + (rcRatio ? (rcRatio * 100).toFixed(1) : '?') + '% of threshold)');
})().catch(x => { log('FATAL ' + x.message); process.exit(1); });
