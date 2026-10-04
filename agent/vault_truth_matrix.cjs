#!/usr/bin/env node
/* vault_truth_matrix.cjs — R20c-deep: כל-15-חשבונות-הכספת מול-השרשראות (STEEM+HIVE).
 * מוציא-מטריצת-אמת: לכל-חשבון/שרשרת/תפקיד — MATCH/STALE/NO-CHAIN.
 * כל-המפתחות-הפרטיים-בזיכרון-בלבד; מודפסים-רק-פומביים-וסטטוסים.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const steem = require('steem');
const dhive = require('@hiveio/dhive');

steem.api.setOptions({ url: 'https://api.steemit.com', useAppbaseApi: true });
const hiveClient = new dhive.Client(['https://api.hive.blog', 'https://api.openhive.network']);
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';

const ROLES = ['owner', 'active', 'posting', 'memo'];

function wifToPub(wif, chain) {
  if (chain === 'hive') {
    try { const pk = dhive.PrivateKey.fromString(wif); return pk.createPublic('STM').toString(); } catch (e) { return null; }
  }
  try { return steem.auth.wifToPublic(wif); } catch (e) { return null; }
}

(async () => {
  const vault = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys/vault.json'), 'utf8'));
  const arr = Array.isArray(vault) ? vault : (vault.accounts || []);
  const rows = [];
  for (const acc of arr) {
    const name = acc.name || acc.account;
    const ks = acc.keys || {};
    const entry = { name, chains: {} };
    for (const ch of ['steem', 'hive']) {
      if (!ks[ch]) continue;
      entry.chains[ch] = {};
      for (const role of ROLES) {
        const el = ks[ch][role];
        const wif = el && typeof el === 'object' ? el.wif : el;
        if (!wif) continue;
        entry.chains[ch][role] = wif;
      }
    }
    rows.push(entry);
  }
  console.log('vault accounts: ' + rows.length);

  const steemNames = rows.filter(r => r.chains.steem).map(r => r.name);
  const hiveNames = rows.filter(r => r.chains.hive).map(r => r.name);
  const [steemAccs, hiveAccs] = await Promise.all([
    steemNames.length ? steem.api.getAccountsAsync(steemNames) : [],
    hiveNames.length ? hiveClient.database.getAccounts(hiveNames) : [],
  ]);
  const steemChain = {};
  for (const a of steemAccs) steemChain[a.name] = { owner: a.owner.key_auths[0][0], active: a.active.key_auths[0][0], posting: a.posting.key_auths[0][0], memo: a.memo_key };
  const hiveChain = {};
  for (const a of hiveAccs) hiveChain[a.name] = { owner: a.owner.key_auths[0][0], active: a.active.key_auths[0][0], posting: a.posting.key_auths[0][0], memo: a.memo_key };

  const FACTORY = fs.readFileSync(path.join(__dirname, 'keys/hed-soldiers-source.txt'), 'utf8').split(/\r?\n/)[18].trim();
  const factPub = (name, role) => { try { return steem.auth.wifToPublic(steem.auth.getPrivateKeys(name, FACTORY, [role])[role]); } catch (e) { return null; } };

  let match = 0, stale = 0, missing = 0, total = 0;
  const staleList = [];
  for (const row of rows) {
    for (const ch of Object.keys(row.chains)) {
      const chainMap = ch === 'steem' ? steemChain : hiveChain;
      if (!chainMap[row.name]) { console.log(`${row.name} [${ch}] → NOT-ON-CHAIN (account absent)`); continue; }
      const per = [];
      for (const role of ROLES) {
        const wif = row.chains[ch][role];
        if (!wif) { per.push(role + ':∅'); continue; }
        total++;
        const pub = wifToPub(wif, ch);
        if (pub && pub === chainMap[row.name][role]) { match++; per.push(role + ':MATCH'); }
        else {
          stale++;
          const isFact = ch === 'steem' && factPub(row.name, role) === chainMap[row.name][role];
          per.push(role + ':STALE' + (isFact ? '(factory-derivable)' : ''));
          staleList.push({ name: row.name, ch, role, isFact, chainPub: chainMap[row.name][role] });
        }
      }
      console.log(`${row.name} [${ch}] → ` + per.join(' · '));
    }
  }
  console.log(`\n[truth] roles-tested=${total} · MATCH=${match} · STALE=${stale}`);
  console.log('[stale-list] ' + JSON.stringify(staleList.map(s => `${s.name}:${s.ch}.${s.role}${s.isFact ? '+factory' : ''}`)));
  fs.writeFileSync(path.join(__dirname, 'vault_truth_matrix.json'), JSON.stringify({ at: new Date().toISOString(), total, match, stale, staleList }, null, 2) + '\n');
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
