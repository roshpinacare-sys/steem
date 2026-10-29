#!/usr/bin/env node
/* recover-dead-accounts.mjs — sovereign recovery of dead-key fleet accounts
 * Protocol (per account):
 *  1. fresh owner WIF + fresh active WIF
 *  2. SEAL FIRST (vault-home CROWN-RECOVER-<acct>-<ts>.enc, iter 300000, crown-pass-v5) + durable push
 *  3. request_account_recovery — signed by headcorner OWNER (recovery_account trustee)
 *  4. recover_account — signed by newOwnerWif + headcornerOwnerWif
 *     new_owner_authority = {threshold:1, key_auths:[[newPub,1]], account_auths:[['headcorner',1]]}
 *     (headcorner co-authority guarantees operability even for 0-vest accounts)
 *  5. account_update — set active+memo fresh; posting only if we don't already hold it
 *  6. chain verify owner+active; additive crown-map update; receipt
 * Never prints key material. Never deletes key material (archives pre-rekey values).
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const steem = require('/home/z/fleet/steem/mini-services/saos-engine/node_modules/steem');

const MAP = '/home/z/fleet/steem/.secrets/custody-vault/crown-map.json';
const PASS_FILE = '/home/z/fleet/.crown-pass-v5';
const VAULT_HOME = '/home/z/fleet/vault-home';
const RPC = 'https://api.steemit.com';
const HEAD = 'headcorner';
const ALL_DEAD = ['hcsoldier1','hcsoldier2','hcsoldier3','hcsoldier4','hcsoldier5','hcsoldier6','hcsoldier7',
  'saos-0001','saos-0002','saos-0003','saos-0004','saos-0005','saos-0006','saos-0007','saos-0008','saos-0009'];

const fp = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);
const body = (pub) => pub.slice(3);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function chainGet(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 300));
  return j.result;
}
async function broadcast(ops, wifs) {
  const dgp = await chainGet('condenser_api.get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(Date.now() + 60 * 1000).toISOString().slice(0, -5),
    operations: ops
  };
  const signed = steem.auth.signTransaction(tx, wifs);
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction_synchronous', params: [signed], id: 1 }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 300));
  return j.result;
}
function g(c) { return execSync(c, { cwd: VAULT_HOME, encoding: 'utf8' }).trim(); }
function sealAndPush(name, blob) {
  execSync(`openssl enc -aes-256-cbc -pbkdf2 -iter 300000 -pass file:${PASS_FILE} -out ${VAULT_HOME}/custody-intake/${name}`, { input: blob, shell: '/bin/bash' });
  const opened = execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -pass file:${PASS_FILE} -in ${VAULT_HOME}/custody-intake/${name}`, { input: '', shell: '/bin/bash' }).toString();
  JSON.parse(opened);
  g(`git add custody-intake/${name} && git commit -q -m "seal: ${name}" || true`);
  g('git pull --rebase -q || true');
  g('git push -q origin HEAD');
  const local = g('git rev-parse HEAD'), remote = g('git ls-remote origin -h HEAD').split('\t')[0];
  if (local !== remote) throw new Error('durable push FAILED');
  return local;
}
const map = () => JSON.parse(fs.readFileSync(MAP, 'utf8'));
function saveMap(m) {
  fs.writeFileSync(MAP + '.tmp', JSON.stringify(m));
  fs.chmodSync(MAP + '.tmp', 0o600);
  fs.renameSync(MAP + '.tmp', MAP);
}

async function recoverOne(acct, headOwnerWif) {
  const t0 = Date.now();
  const [a] = await chainGet('condenser_api.get_accounts', [[acct]]);
  if (!a) throw new Error('not on chain');
  const rcAcct = a.recovery_account;
  if (rcAcct !== HEAD) throw new Error(`recovery_account is ${rcAcct}, expected ${HEAD}`);
  // skip if already recovered by us
  const m = map();
  if (m[acct]?.owner && m[acct]?.recovered_at) { console.log(`${acct}: already recovered at ${m[acct].recovered_at}, skip`); return; }

  const newOwnerWif = steem.auth.toWif(crypto.randomBytes(32).toString('hex'), crypto.randomBytes(16).toString('hex'), 'owner');
  const newOwnerPub = steem.auth.wifToPublic(newOwnerWif);
  const newActiveWif = steem.auth.toWif(crypto.randomBytes(32).toString('hex'), crypto.randomBytes(16).toString('hex'), 'active');
  const newActivePub = steem.auth.wifToPublic(newActiveWif);

  // SEAL FIRST
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + 'Z';
  const sealName = `CROWN-RECOVER-${acct}-${ts}.enc`;
  const blob = JSON.stringify({ sealed: ts, account: acct, role: 'owner+active', owner_wif: newOwnerWif, owner_pub: newOwnerPub, active_wif: newActiveWif, active_pub: newActivePub, fps: { owner: fp(newOwnerWif), active: fp(newActiveWif) }, sealed_by: 'recover-dead-accounts.mjs' }, null, 2);
  const rev = sealAndPush(sealName, blob);
  console.log(`${acct}: seal DURABLE ${sealName} rev=${rev.slice(0, 8)} owner_fp=${fp(newOwnerWif)} active_fp=${fp(newActiveWif)}`);

  // 3. request_account_recovery (headcorner owner signs)
  const newOwnerAuth = { weight_threshold: 1, account_auths: [[HEAD, 1]], key_auths: [[newOwnerPub, 1]] };
  await broadcast([['request_account_recovery', { recovery_account: HEAD, account_to_recover: acct, new_owner_authority: newOwnerAuth, extensions: [] }]], [headOwnerWif]);
  console.log(`${acct}: request_account_recovery broadcast OK`);
  await sleep(4000);

  // 4. recover_account (new owner + headcorner owner)
  await broadcast([['recover_account', { account_to_recover: acct, new_owner_authority: newOwnerAuth, extensions: [] }]], [newOwnerWif, headOwnerWif]);
  console.log(`${acct}: recover_account broadcast OK`);
  await sleep(3000);

  // 5. account_update: fresh active+memo; posting only if not held
  const m2 = map();
  const holdPosting = !!m2[acct]?.posting;
  const postingAuth = holdPosting
    ? { weight_threshold: a.posting.weight_threshold, account_auths: a.posting.account_auths, key_auths: a.posting.key_auths }
    : { weight_threshold: 1, account_auths: [], key_auths: [[newActivePub, 1]] };
  await broadcast([['account_update', {
    account: acct,
    owner: newOwnerAuth,
    active: { weight_threshold: 1, account_auths: [], key_auths: [[newActivePub, 1]] },
    posting: postingAuth,
    memo_key: newActivePub,
    json_metadata: a.json_metadata || ''
  }]], [newOwnerWif, headOwnerWif]);
  console.log(`${acct}: account_update (active+memo${holdPosting ? ', posting kept' : ', posting fresh'}) OK`);
  await sleep(2500);

  // 6. chain verify
  const [a2] = await chainGet('condenser_api.get_accounts', [[acct]]);
  const ownerOK = body(a2.owner.key_auths[0][0]) === body(newOwnerPub) || a2.owner.account_auths.some(x => x[0] === HEAD);
  const activeOK = body(a2.active.key_auths[0][0]) === body(newActivePub);
  if (!ownerOK || !activeOK) throw new Error(`chain verify FAIL owner=${ownerOK} active=${activeOK}`);
  console.log(`${acct}: chain-verify owner+active MATCH (${Date.now() - t0}ms)`);

  // additive crown-map update
  const m3 = map();
  if (!m3[acct]) m3[acct] = {};
  if (m3[acct].owner) { m3[acct].owner_pre_recovery = m3[acct].owner; }
  if (m3[acct].posting && !holdPosting) { m3[acct].posting_pre_recovery = m3[acct].posting; }
  m3[acct].owner = newOwnerWif;
  m3[acct].owner_pub = newOwnerPub;
  m3[acct].owner_fp = fp(newOwnerWif);
  m3[acct].active = newActiveWif;
  m3[acct].active_pub = newActivePub;
  m3[acct].active_fp = fp(newActiveWif);
  if (!holdPosting) { m3[acct].posting = newActiveWif; m3[acct].posting_fp = fp(newActiveWif); }
  m3[acct].recovered_at = new Date().toISOString();
  m3[acct].recovery_seal = sealName;
  saveMap(m3);

  const liq = a.balance + ' / ' + a.sbd_balance;
  const rec = JSON.stringify({ ts: new Date().toISOString(), op: 'recover', account: acct, owner_fp: fp(newOwnerWif), active_fp: fp(newActiveWif), seal: sealName, durable: true, chain_verified: true, liquid: liq });
  fs.appendFileSync('/home/z/fleet/steem/receipts/custody-patrol.jsonl', rec + '\n');
  console.log(`RECOVER-COMPLETE ${acct} liquid=${liq}`);
}

async function main() {
  const targets = process.argv.slice(2);
  const list = (targets.length ? targets : ALL_DEAD);
  const headOwnerWif = map()[HEAD].owner;
  // B8 gate: headcorner owner must derive the live chain owner auth
  const [h] = await chainGet('condenser_api.get_accounts', [[HEAD]]);
  const headPub = steem.auth.wifToPublic(headOwnerWif);
  if (body(headPub) !== body(h.owner.key_auths[0][0])) throw new Error('headcorner owner gate FAILED');
  console.log(`gate: headcorner owner fp=${fp(headOwnerWif)} matches chain OK; targets=${list.length}`);
  let ok = 0, fail = 0;
  for (const acct of list) {
    try { await recoverOne(acct, headOwnerWif); ok++; }
    catch (e) { console.error(`RECOVER-FAILED ${acct}: ${e.message.slice(0, 200)}`); fail++; }
    await sleep(1500);
  }
  console.log(`SUMMARY: recovered=${ok}/${list.length} failed=${fail}`);
}

main().catch(e => { console.error('FATAL:', e.message.slice(0, 300)); process.exit(1); });
