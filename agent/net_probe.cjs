#!/usr/bin/env node
/**
 * net_probe.cjs — 117p8-R6: סקר-רשת עמוק (zero-secrets output).
 *
 * תפקיד: לראות בדיוק מה-יש-בידיים ומה-חוסם — חי, משתי-השרשראות:
 *   1. dgp+config לכל שרשרת (fee-יצירה · מחיר-vest · עדות-עדכונית)
 *   2. מלאי-חי לכל 12 החשבונות בשתי-השרשראות (SP · נזיל · SBD/HBD · תגמולים-ממתינים)
 *   3. RC חי (max/current) לכל חשבון → מטריצת-יכולות + פוטנציאל delegate_rc
 *   4. --claim : תביעת-כל-תגמול-ממתין בכל חשבון (Steem+Hive) — דלק-לטייס
 *   5. מתמטיקת-פתרונות: סף-טביעה · מהירות-התאוששות-RC · קצב-ייצור-צי
 *
 * חוקי-ברזל: אפס-סודות-בפלט (רק-קידומות) · --claim בלבד-חותם-חי · self-test לפני-תביעה.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';
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
const HEAD = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const CLAIM = process.argv.includes('--claim');

const VAULT_PATH = path.join(__dirname, 'keys/vault.json');
const REPORT_PATH = path.join(__dirname, 'net_probe_report.json');
const log = m => console.log('[' + new Date().toISOString() + '] netprobe: ' + m);

function rpc(url, body) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const p = JSON.stringify(body);
    const r = https.request({ hostname: u.hostname, path: (u.pathname || '/') + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(p) }, timeout: 25000 }, x => {
      let d = '';
      x.on('data', c => (d += c));
      x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error('parse: ' + d.slice(0, 120))); } });
    });
    r.on('error', rej);
    r.setTimeout(25000, () => r.destroy(new Error('timeout')));
    r.write(p); r.end();
  });
}
const rc = (url, method, params) => rpc(url, { jsonrpc: '2.0', method, params, id: 1 });
const condenser = (url, method, params) => rpc(url, { jsonrpc: '2.0', method: 'condenser_api.' + method, params, id: 1 });

/* ── כספת: שמות + מפתחות-תביעה (posting+active) ── */
function vaultAccounts() {
  const v = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
  return Object.values(v.accounts || v).map(a => ({ username: a.username, keys: a.keys || {} }));
}
const mask = w => (w ? String(w).slice(0, 8) + '…' : '(none)');

/* ── self-test: מפתח-הפעיל-בכספת אכן-המפתח-על-השרשרת ── */
async function selfTestActive(chain, acc) {
  const raw = acc.keys.active;
  const wif = typeof raw === 'string' ? raw : (raw && raw.wif) || process.env.ACTIVE_WIF || '';
  if (!wif) return false;
  const derived = steem.auth.wifToPublic(wif);
  const [live] = await new Promise((res, rej) => steem.api.getAccounts([acc.username], (e, r) => e ? rej(e) : res(r)));
  return derived === live.active.key_auths[0][0];
}

async function main() {
  const NAMES = vaultAccounts().map(a => a.username);
  const rep = { at: new Date().toISOString(), chains: {}, accounts: {}, solutions: {}, claims: [] };

  for (const [chain, url] of [['steem', STEEM_RPC], ['hive', HIVE_RPC]]) {
    try {
      const [dgpR, cfgR, accR] = await Promise.all([
        condenser(url, 'get_dynamic_global_properties', []),
        condenser(url, 'get_config', []),
        condenser(url, 'get_accounts', [NAMES]),
      ]);
      const dgp = dgpR.result, cfg = cfgR.result, accs = accR.result || [];
      const vestFund = parseFloat(dgp.total_vesting_fund_steem || dgp.total_vesting_fund_hive || '0');
      const vestShares = parseFloat(dgp.total_vesting_shares || '0');
      const mvest = vestShares > 0 ? vestFund / (vestShares / 1e6) : 0;
      const rate = dgp.sbd_exchange_rate || dgp.hbd_exchange_rate || null;

      rep.chains[chain] = {
        head_block: dgp.head_block_number,
        head_time: dgp.time,
        account_creation_fee: cfg && (cfg.STEEM_ACCOUNT_CREATION_FEE || cfg.account_creation_fee) ? String(cfg.STEEM_ACCOUNT_CREATION_FEE || cfg.account_creation_fee) : null,
        steem_per_mvest: mvest.toFixed(6),
        sbd_per_steem: rate ? parseFloat(rate.base.split(' ')[0]) / parseFloat(rate.quote.split(' ')[0]) : null,
        virtual_supply: dgp.current_supply || dgp.current_hive_supply || null,
      };

      let rcArr = [];
      try {
        const rcR = await rc(url, 'rc_api.find_rc_accounts', { accounts: NAMES });
        rcArr = (rcR.result && rcR.result.rc_accounts) || [];
      } catch (_) { /* rc pool unavailable — continue */ }
      const rcMap = {};
      for (const a of rcArr) rcMap[a.account] = { max: a.max_rc, cur: a.rc_manabar ? a.rc_manabar.current_mana : '0' };

      for (const a of accs) {
        const name = a.name;
        const vests = parseFloat(a.vesting_shares), dele = parseFloat(a.delegated_vesting_shares), rec = parseFloat(a.received_vesting_shares);
        const ownV = vests - dele;
        rep.accounts[name] = rep.accounts[name] || {};
        rep.accounts[name][chain] = {
          own_sp: (ownV / 1e6 * mvest).toFixed(4),
          received_sp: (rec / 1e6 * mvest).toFixed(4),
          liquid: a.balance,
          sbd: a.sbd_balance || a.hbd_balance || null,
          reward_pending: { steem: a.reward_steem_balance || a.reward_hive_balance || '0.000 STEEM', sbd: a.reward_sbd_balance || a.reward_hbd_balance || '0.000 SBD', vests: a.reward_vesting_balance || '0.000000 VESTS' },
          rc_max_t: rcMap[name] ? (Number(BigInt(rcMap[name].max)) / 1e12).toFixed(4) : null,
          rc_cur_t: rcMap[name] ? (Number(BigInt(rcMap[name].cur)) / 1e12).toFixed(4) : null,
        };
      }

      /* מתמטיקת-פתרונות לשרשרת-זו */
      const aggMax = rcArr.reduce((s, a) => s + BigInt(a.max_rc), 0n);
      const aggCur = rcArr.reduce((s, a) => s + BigInt(a.rc_manabar ? a.rc_manabar.current_mana : '0'), 0n);
      const headR = rcArr.find(a => a.account === HEAD);
      const CLAIM_RC_NEED = 5822571589956n; // מדידה-חיה 2026-09-10 (steem; hive-טרם-נמדד-מקרוב)
      const othersMax = rcArr.filter(a => a.account !== HEAD).reduce((s, a) => s + BigInt(a.max_rc), 0n);
      const sol = {
        agg_max_rc_t: (Number(aggMax) / 1e12).toFixed(4),
        agg_cur_rc_t: (Number(aggCur) / 1e12).toFixed(4),
        head_max_rc_t: headR ? (Number(BigInt(headR.max_rc)) / 1e12).toFixed(4) : null,
        claim_rc_need_t: (Number(CLAIM_RC_NEED) / 1e12).toFixed(3),
        delegate_rc_pool_t: (Number(othersMax) / 1e12).toFixed(4),
        delegate_keep20_head_max_t: (Number(BigInt(headR ? headR.max_rc : '0') + (othersMax * 8n) / 10n) / 1e12).toFixed(4),
        mint_unlockable_via_bridge: headR ? (BigInt(headR.max_rc) + (othersMax * 8n) / 10n) >= CLAIM_RC_NEED : false,
        rc_regen_days: 5, // RC_REGEN_SECONDS=432000
        // קצב-ייצור: אחרי-טביעה current= max-need; regen-מצטבר 20%/יום של max
        post_claim_regen_to_need_days: headR ? ((((CLAIM_RC_NEED - (BigInt(headR.max_rc) - CLAIM_RC_NEED)) * 10000n) / BigInt(headR.max_rc)) / 10000 * 5).toFixed(2) : null,
      };
      rep.solutions[chain] = sol;
    } catch (e) {
      rep.chains[chain] = { error: String(e.message || e).slice(0, 200) };
    }
  }

  /* ── --claim: תביעת-כל-תגמול-ממתין (דלק) ── */
  if (CLAIM) {
    const vault = vaultAccounts();
    for (const chain of ['steem', 'hive']) {
      const url = chain === 'steem' ? STEEM_RPC : HIVE_RPC;
      const node = chain === 'steem' ? STEEM_RPC : HIVE_RPC;
      steem.api.setOptions({ url: node, useAppbaseApi: true });
      for (const acc of vault) {
        try {
          const [live] = await new Promise((res, rej) => steem.api.getAccounts([acc.username], (e, r) => e ? rej(e) : res(r)));
          const okActive = await selfTestActive(chain, acc);
          if (!okActive) { rep.claims.push({ account: acc.username, chain, skipped: 'active-key-mismatch' }); continue; }
          const st = parseFloat(live.reward_steem_balance || live.reward_hive_balance || '0');
          const sb = parseFloat(live.reward_sbd_balance || live.reward_hbd_balance || '0');
          const vs = parseFloat(live.reward_vesting_balance || '0');
          if (st <= 0 && sb <= 0 && vs <= 0) continue;
          if (chain === 'hive') { /* Hive תביעה — אותו-פורמט condenser */ }
          const wifs = {};
          if (okActive) wifs.active = typeof acc.keys.active === 'string' ? acc.keys.active : acc.keys.active.wif;
          const postingRaw = acc.keys.posting;
          const postingWif = typeof postingRaw === 'string' ? postingRaw : (postingRaw && postingRaw.wif) || '';
          const postingMatch = postingWif && steem.auth.wifToPublic(postingWif) === live.posting.key_auths[0][0];
          if (postingMatch) wifs.posting = postingWif;
          await steem.broadcast.sendAsync({
            operations: [['claim_reward_balance', {
              account: acc.username,
              reward_steem: live.reward_steem_balance || live.reward_hive_balance,
              reward_sbd: live.reward_sbd_balance || live.reward_hbd_balance,
              reward_vests: live.reward_vesting_balance,
            }]], extensions: [],
          }, wifs);
          rep.claims.push({ account: acc.username, chain, claimed: { steem: st.toFixed(3), sbd: sb.toFixed(3), vests: vs.toFixed(3) }, keys: Object.keys(wifs).map(k => k + ':' + mask(wifs[k])) });
          log('CLAIMED ' + acc.username + '@' + chain + ' st=' + st.toFixed(3) + ' vests=' + vs.toFixed(3));
        } catch (e) {
          rep.claims.push({ account: acc.username, chain, error: String(e.message || e).slice(0, 160) });
        }
      }
    }
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(rep, null, 1));
  log('report → ' + path.basename(REPORT_PATH) + ' · chains=' + Object.keys(rep.chains).length + ' accounts=' + Object.keys(rep.accounts).length + ' claims=' + rep.claims.length);
  /* הדפסה-חיה (ממוסכת) */
  for (const c of ['steem', 'hive']) {
    const s = rep.solutions[c]; if (!s) continue;
    console.log('── ' + c + ' ── fee=' + (rep.chains[c].account_creation_fee || '?') + ' · mvest=' + rep.chains[c].steem_per_mvest);
    console.log('aggMax=' + s.agg_max_rc_t + 'T · head=' + s.head_max_rc_t + 'T · claimNeed=' + s.claim_rc_need_t + 'T · pool=' + s.delegate_rc_pool_t + 'T · bridgeKeep20=' + s.delegate_keep20_head_max_t + 'T · UNLOCK=' + s.mint_unlockable_via_bridge);
  }
  if (rep.claims.length) console.log('claims: ' + JSON.stringify(rep.claims.map(c => (c.account + '@' + c.chain + (c.claimed ? ' ✓' : ' ✗ ' + (c.skipped || c.error || '')))).join(', ')));
}

main().catch(e => { console.error('FATAL', String(e.message || e)); process.exit(1); });
