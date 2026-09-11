#!/usr/bin/env node
/**
 * measure_r18o.cjs — R18o: מדידת-חי קריאה-בלבד (READ-ONLY · אפס-שידור · אפס-סודות).
 * =============================================================================
 * שאלות-המדידה:
 *   1. מי-מחזיק-רשויות-חשבון (account_auths) על @ynet ו-@tov — ב-steem וב-hive?
 *   2. האם-מפתחות-הכספת-תואמים-את-רשויות-המפתח-על-השרשרת (MATCH/MISMATCH-בוליאני)?
 *   3. האם-@steemauto-קיים-ומה-מעמדו?
 * כל-הפלט-פומבי: שמות-חשבון · משקלים · מפתחות-ציבוריים · בוליאנים. אף-WIF-לא-נגע-בפלט.
 * שוחזר-ב-R18o-אחרי-ריקוד-הגרדיאן (לקח-R18i: שחזור-קדימה+דחיפה-מיידית).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const TARGETS = ['ynet', 'tov', 'steemauto', 'headcorner'];

function vaultAccounts() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return v.accounts || [];
  } catch (_) { return []; }
}

function wifOf(acc, chain, role) {
  // חיילים: keys.<role>.wif (משותף-לשתי-השרשרות) · headcorner: keys.<chain>.<role>.wif
  const k = acc.keys || {};
  const direct = k[role];
  if (direct) { const w = typeof direct === 'object' ? direct.wif : direct; if (typeof w === 'string' && w) return w; }
  const perChain = k[chain] && k[chain][role];
  if (perChain) { const w = typeof perChain === 'object' ? perChain.wif : perChain; if (typeof w === 'string' && w) return w; }
  return '';
}

async function getAccounts(rpc, chainId, names) {
  if (chainId) steem.config.set('chain_id', chainId);
  steem.api.setOptions({ url: rpc, useAppbaseApi: true });
  const chain = chainId ? 'hive' : 'steem';
  try {
    const accs = await steem.api.getAccountsAsync(names);
    return { chain, accounts: accs.filter(Boolean) };
  } finally {
    if (chainId) steem.config.set('chain_id', undefined);
  }
}

function authSummary(a) {
  const pick = (auth) => ({
    account_auths: (auth && auth.account_auths || []).map(([n, w]) => [n, w]),
    key_auths: (auth && auth.key_auths || []).map(([k]) => k),
    weight_threshold: auth && auth.weight_threshold,
  });
  return { posting: pick(a.posting), active: pick(a.active), owner: pick(a.owner) };
}

async function main() {
  const out = { at: new Date().toISOString(), read_only: true, chains: {} };
  const vault = vaultAccounts();
  out.vaultAccounts = vault.map(a => a.username); // שמות-בלבד

  for (const [rpc, chainId, label] of [[STEEM_RPC, null, 'steem'], [HIVE_RPC, HIVE_CHAIN_ID, 'hive']]) {
    let got;
    try { got = await getAccounts(rpc, chainId, TARGETS); }
    catch (e) { out.chains[label] = { error: String(e.message || e).slice(0, 120) }; continue; }
    const res = { accounts: {} };
    for (const a of got.accounts) {
      res.accounts[a.name] = authSummary(a);
    }
    // הצלבת-מפתחות: לכל-חשבון-כספת — האם-מפתח-הפוסטינג-הגלוי-בכספת-תואם-את-המפתח-הציבורי-על-השרשרת
    const cross = [];
    for (const acc of vault) {
      const wif = wifOf(acc, label, 'posting');
      const live = res.accounts[acc.username];
      if (!wif || !live) { cross.push({ u: acc.username, wif: !!wif, onChain: !!live, postingMatch: null }); continue; }
      let pub = '';
      try { pub = steem.auth.wifToPublic(wif); } catch (_) { pub = 'INVALID'; }
      const chainPub = (live.posting.key_auths || [])[0] || '';
      cross.push({ u: acc.username, wif: true, onChain: true, postingMatch: pub === chainPub, chainPub });
    }
    res.vaultPostingKeyMatch = cross;
    out.chains[label] = res;
  }

  fs.writeFileSync(path.join(__dirname, 'measure_r18o.json'), JSON.stringify(out, null, 1));
  // סיכום-קונסולה קומפקטי
  for (const label of ['steem', 'hive']) {
    const c = out.chains[label];
    if (c.error) { console.log('[' + label + '] ERROR: ' + c.error); continue; }
    console.log('=== ' + label.toUpperCase() + ' ===');
    for (const [name, s] of Object.entries(c.accounts || {})) {
      const pa = s.posting.account_auths, aa = s.active.account_auths, oa = s.owner.account_auths;
      console.log('@' + name + ' posting.auths=' + JSON.stringify(pa) + ' active.auths=' + JSON.stringify(aa) + ' owner.auths=' + JSON.stringify(oa));
      console.log('        posting.key=' + (s.posting.key_auths[0] || '-') + ' threshold=' + s.posting.weight_threshold);
    }
    for (const m of (c.vaultPostingKeyMatch || [])) {
      console.log('vault↔chain ' + m.u + ': wif=' + m.wif + ' onChain=' + m.onChain + ' postingMatch=' + m.postingMatch);
    }
  }
  console.log('written: agent/measure_r18o.json (פומבי-בלבד)');
}

main().catch(e => { console.error('measure error: ' + String(e.message || e).slice(0, 200)); process.exit(1); });
