#!/usr/bin/env node
/**
 * fleet_mint_v3.cjs — 117p8-R5: מפעל-צי-דור-שלישי (בטוח-ויעיל).
 *
 * לקחי-המפעל (v1: hcnova1 · v2: deterministic-FACTORY_MASTER):
 *   v3 משלב: מפתחות-אקראיים-אמיתיים (crypto.randomBytes 32B) שנשמרים-מיד-בכספת
 *   (vault.json — git-ignored, מגובה vault.enc) + עוגן-חילוץ headcorner
 *   בסמכות-ה-owner (threshold 1) + הקצבה-מינימלית + אימות-שרשרת-לפני-ואחרי.
 *
 * שלבים:
 *   1. --claim-rewards  : claim_rewards(headcorner) + transfer_to_vesting לכל-הנזיל
 *   2. --mint N         : claim_account ×N → create_claimed_account ×N → delegate ×N
 *                         (שם: <prefix><start>… · ברירת-מחדל hcnova2)
 *   3. --verify         : אימות-חי-של-החשבונות-החדשים (קיימים+סמכויות+הקצבה)
 *
 * חוקי-ברזל: חתימות-מקומיות-בלבד · ה-WIFs לעולם-לא-בלוג/גיט (רק-קידומת 8-תווים)
 * · --dry קודם-תמיד · self-test מול-השרשרת לפני-כל-חתימה-חיה.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const steem = require('steem');

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
const HEAD = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const OWNER_WIF = process.env.OWNER_WIF || '';

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = n => process.argv.includes(n);
const DRY = has('--dry');
const N = parseInt(argOf('--mint', '0'), 10);
const PREFIX = argOf('--prefix', 'hcnova');
const START = parseInt(argOf('--start', '2'), 10);
const SP = parseFloat(argOf('--sp', '0.1'));
const CLAIM_REWARDS = has('--claim-rewards');
const VERIFY = has('--verify');
const mask = w => (w ? w.slice(0, 8) + '…' : '(none)');
const log = m => console.log('[' + new Date().toISOString() + '] mintv3: ' + m);

const VAULT_PATH = path.join(__dirname, 'keys/vault.json');
const REPORT_PATH = path.join(__dirname, 'fleet_mint_v3_report.json');
const report = { at: new Date().toISOString(), dry: DRY, steps: [], minted: [] };

/* ── self-test: המפתח-הפעיל-שלנו אכן-המפתח-הפעיל-על-השרשרת ── */
async function selfTest() {
  if (!ACTIVE_WIF) throw new Error('ACTIVE_WIF missing in agent/.env');
  const derived = steem.auth.wifToPublic(ACTIVE_WIF);
  const [acc] = await new Promise((res, rej) => steem.api.getAccounts([HEAD], (e, r) => e ? rej(e) : res(r)));
  const chainActive = acc.active.key_auths[0][0];
  if (derived !== chainActive) throw new Error('self-test FAIL: derived active pub ≠ chain active pub (' + derived.slice(0, 10) + '… vs ' + chainActive.slice(0, 10) + '…)');
  log('self-test ✓ head=' + HEAD + ' active=' + derived.slice(0, 10) + '… freeSP~' + ((parseFloat(acc.vesting_shares) - parseFloat(acc.delegated_vesting_shares)) / 1e6).toFixed(2));
  return acc;
}

function signSend(ops, wifs) {
  return new Promise((res, rej) => {
    steem.broadcast.send({ operations: ops, extensions: [] }, wifs, (e, r) => e ? rej(e) : res(r));
  });
}

function keyPair() {
  const wif = steem.auth.toWif(crypto.randomBytes(32));
  return { wif, pub: steem.auth.wifToPublic(wif) };
}

/* ── שלב 1: גביית-תגמולים + power-up ── */
async function doClaimRewards(acc) {
  const rs = { steem: acc.reward_steem_balance, sbd: acc.reward_sbd_balance, vest: acc.reward_vesting_balance };
  const nonzero = parseFloat(rs.steem) > 0 || parseFloat(rs.sbd) > 0 || parseFloat(rs.vest) > 0;
  if (!nonzero) { log('claim-rewards: nothing to claim'); return; }
  log('claim-rewards: ' + JSON.stringify(rs));
  if (DRY) { report.steps.push({ step: 'claim-rewards', dry: true, rewards: rs }); return; }
  await signSend([['claim_rewards', { account: HEAD, reward_steem_balance: rs.steem, reward_sbd_balance: rs.sbd, reward_vesting_balance: rs.vest }]], [ACTIVE_WIF]);
  report.steps.push({ step: 'claim-rewards', ok: true, rewards: rs });
  // power-up the liquid STEEM
  const liq = parseFloat(rs.steem);
  if (liq > 0.001) {
    await signSend([['transfer_to_vesting', { from: HEAD, to: HEAD, amount: rs.steem }]], [ACTIVE_WIF]);
    report.steps.push({ step: 'power-up', ok: true, amount: rs.steem });
    log('power-up ✓ ' + rs.steem);
  }
}

/* ── שלב 2: טביעת-צי ── */
async function mintFleet() {
  if (!N) return;
  const made = [];
  for (let i = 0; i < N; i++) {
    const name = PREFIX + (START + i);
    const kp = { owner: keyPair(), active: keyPair(), posting: keyPair(), memo: keyPair() };
    const entry = {
      username: name, tier: 'fleet-v3', mode: 'random-mint',
      keys: { owner: kp.owner.wif, active: kp.active.wif, posting: kp.posting.wif, memo: kp.memo.wif },
      chains: { steem: ['owner', 'active', 'posting', 'memo'] },
      addedAt: new Date().toISOString(), syncedAt: null
    };
    log('mint ' + name + ' · pubs: o=' + kp.owner.pub.slice(0, 10) + '… a=' + kp.active.pub.slice(0, 10) + '… p=' + kp.posting.pub.slice(0, 10) + '…');
    if (!DRY) {
      // 2a. claim one account-creation slot
      await signSend([['claim_account', { creator: HEAD, fee: '0.000 STEEM', extensions: [] }]], [ACTIVE_WIF]);
      log('  claim_account ✓ ' + name);
      // 2b. create with owner anchored to headcorner
      const auth = (key, acct) => ({ weight_threshold: 1, account_auths: acct ? [[HEAD, 1]] : [], key_auths: [[key, 1]] });
      await signSend([['create_claimed_account', {
        creator: HEAD, new_account_name: name, owner: auth(kp.owner.pub, true), active: auth(kp.active.pub, false),
        posting: auth(kp.posting.pub, false), memo_key: kp.memo.pub, json_metadata: '{}', extensions: []
      }]], [ACTIVE_WIF]);
      log('  create_claimed_account ✓ ' + name);
      // 2c. endowment
      const vest = (SP * 1e6).toFixed(6) + ' VESTS';
      await signSend([['delegate_vesting_shares', { delegator: HEAD, delegatee: name, vesting_shares: vest }]], [ACTIVE_WIF]);
      log('  delegate ✓ ' + SP + 'SP → ' + name);
      entry.syncedAt = new Date().toISOString();
    }
    made.push(entry);
    report.minted.push({ name, ownerPub: kp.owner.pub, activePub: kp.active.pub, postingPub: kp.posting.pub, memoPub: kp.memo.pub, endowmentSP: SP });
  }
  // register ALL into vault (immediately — never lose keys)
  if (!DRY && made.length) {
    const v = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
    fs.writeFileSync(VAULT_PATH + '.bak-fleetv3', JSON.stringify(v, null, 1));
    const have = new Set(v.accounts.map(a => a.username));
    for (const m of made) if (!have.has(m.username)) v.accounts.push(m);
    fs.writeFileSync(VAULT_PATH, JSON.stringify(v, null, 1));
    log('vault ✓ ' + made.length + ' registered (backup: vault.json.bak-fleetv3)');
    report.steps.push({ step: 'vault-register', ok: true, count: made.length });
  }
}

/* ── שלב 3: אימות-חי ── */
async function verify() {
  const names = report.minted.map(m => m.name);
  if (!names.length) { log('verify: no minted names in this run'); return; }
  const accs = await new Promise((res, rej) => steem.api.getAccounts(names, (e, r) => e ? rej(e) : res(r)));
  const rows = accs.map(a => ({
    name: a.name, created: a.created,
    sp: +(parseFloat(a.vesting_shares) / 1e6).toFixed(3),
    ownerHead: a.owner.account_auths.some(x => x[0] === HEAD),
    ownerKey: (report.minted.find(m => m.name === a.name) || {}).ownerPub === a.owner.key_auths[0][0]
  }));
  report.verify = rows;
  rows.forEach(r => log('verify ' + r.name + ' sp=' + r.sp + ' ownerHead✓=' + r.ownerHead + ' ownerKey✓=' + r.ownerKey));
}

(async () => {
  const acc = await selfTest();
  if (CLAIM_REWARDS) await doClaimRewards(acc);
  if (N) await mintFleet();
  if (VERIFY) await verify();
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1));
  log('done ' + (DRY ? '(DRY)' : '(LIVE)') + ' · minted=' + report.minted.length + ' · report=' + path.basename(REPORT_PATH));
})().catch(e => {
  report.error = (e && e.message) || String(e);
  try { fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 1)); } catch (_) { }
  log('FATAL: ' + report.error);
  process.exit(1);
});
