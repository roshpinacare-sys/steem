#!/usr/bin/env node
/* rekey-cashmachine.mjs — sovereign re-key wave, account 1/10: cashmachine
 * Law compliance:
 *  - two-envelope: seal FIRST (vault-home custody-intake, iter 300000, .crown-pass-v5),
 *    durable push verified (ls-remote == rev-parse), THEN local deploy, THEN broadcast.
 *  - never print WIF/full keys — fingerprints only (sha256 first 8).
 *  - never delete key material; additive merge into crown-map.json.
 *  - B8: every gate self-verifies its premise (owner WIF vs chain owner auth body).
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const steem = require('/home/z/fleet/steem/mini-services/saos-engine/node_modules/steem');

const MAP = '/home/z/fleet/steem/.secrets/custody-vault/crown-map.json';
const PASS_FILE = '/home/z/fleet/.crown-pass-v5';
const VAULT_HOME = '/home/z/fleet/vault-home';
const RPC = 'https://api.steemit.com';
const ACCOUNT = process.argv[2] || 'cashmachine';

const fp = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);
const body = (pub) => pub.slice(3); // prefix-agnostic compare (STM/TST)

async function chainGet(method, params) {
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
}
async function broadcastSend(tx, wifs) {
  const signed = steem.auth.signTransaction(tx, wifs);
  const r = await fetch(RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction_synchronous', params: [signed], id: 1 })
  });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 400));
  return j.result; // { block_num, trx_id, ... }
}

async function main() {
  const t0 = Date.now();
  // 1. load owner WIF (never printed)
  const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  const ownerWif = map[ACCOUNT]?.owner;
  if (!ownerWif) throw new Error('no owner WIF in crown-map for ' + ACCOUNT);
  const ownerPub = steem.auth.wifToPublic(ownerWif);

  // 2. B8 gate: owner WIF must derive the LIVE chain owner auth
  const [acct] = await chainGet('condenser_api.get_accounts', [[ACCOUNT]]);
  if (!acct) throw new Error('account not found on chain');
  const chainOwner = acct.owner.key_auths[0][0];
  if (body(ownerPub) !== body(chainOwner)) {
    throw new Error(`owner mismatch: our ${fp(ownerWif)} derives ${ownerPub.slice(0, 10)}... but chain has ${chainOwner.slice(0, 10)}...`);
  }
  console.log(`gate1 owner-wif-matches-chain fp=${fp(ownerWif)} OK`);

  // 3. fresh active key
  const activeWif = steem.auth.toWif(crypto.randomBytes(32).toString('hex'), crypto.randomBytes(16).toString('hex'), 'active');
  const activePub = steem.auth.wifToPublic(activeWif);
  console.log(`fresh active key fp=${fp(activeWif)} pub=${activePub.slice(0, 10)}...`);

  // 4. SEAL FIRST (two-envelope law)
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + 'Z';
  const sealName = `CROWN-REKEY-${ACCOUNT}-${ts}.enc`;
  const blob = JSON.stringify({ sealed: ts, account: ACCOUNT, role: 'active', wif: activeWif, pub: activePub, fp: fp(activeWif), sealed_by: 'rekey-cashmachine.mjs via crown-pass-v5' }, null, 2);
  execSync(`openssl enc -aes-256-cbc -pbkdf2 -iter 300000 -pass file:${PASS_FILE} -out ${VAULT_HOME}/custody-intake/${sealName}`, { input: blob, shell: '/bin/bash' });
  // test-open the seal before trusting it (premise check)
  const opened = execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -pass file:${PASS_FILE} -in ${VAULT_HOME}/custody-intake/${sealName}`, { input: '', shell: '/bin/bash' }).toString();
  JSON.parse(opened); // throws if seal is broken
  console.log(`seal created + test-opened OK: ${sealName}`);
  // durable push (A8: verify ls-remote == rev-parse)
  const g = (c) => execSync(c, { cwd: VAULT_HOME, encoding: 'utf8' }).trim();
  g(`git add custody-intake/${sealName} && git commit -q -m "seal: rekey ${ACCOUNT}.active ${fp(activeWif)}" || true`);
  g(`git pull --rebase -q || true`);
  g(`git push -q origin HEAD`);
  const local = g('git rev-parse HEAD'), remote = g('git ls-remote origin -h HEAD').split('\t')[0];
  if (local !== remote) throw new Error(`durable push FAILED local=${local} remote=${remote}`);
  console.log(`seal DURABLE (ls-remote==rev-parse=${local.slice(0, 8)})`);

  // 5. local deploy: additive merge (never delete — archive any pre-existing active)
  if (map[ACCOUNT].active && map[ACCOUNT].active !== activeWif) {
    map[ACCOUNT].active_pre_rekey = map[ACCOUNT].active;
    if (map[ACCOUNT].active_pub) map[ACCOUNT].active_pub_pre_rekey = map[ACCOUNT].active_pub;
    if (map[ACCOUNT].active_fp) map[ACCOUNT].active_fp_pre_rekey = map[ACCOUNT].active_fp;
  }
  map[ACCOUNT].active = activeWif;
  map[ACCOUNT].active_pub = activePub;
  map[ACCOUNT].active_fp = fp(activeWif);
  map[ACCOUNT].rekeyed_at = new Date().toISOString();
  fs.writeFileSync(MAP + '.tmp', JSON.stringify(map));
  fs.chmodSync(MAP + '.tmp', 0o600);
  fs.renameSync(MAP + '.tmp', MAP);
  console.log(`crown-map updated: ${ACCOUNT}.active fp=${fp(activeWif)} (additive)`);

  // 6. broadcast account_update signed with owner WIF (keep owner/posting/memo intact)
  const dgp = await chainGet('condenser_api.get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(Date.now() + 60 * 1000).toISOString().slice(0, -5), // steemd from_iso_string: NO trailing Z
    operations: [[
      'account_update', {
        account: ACCOUNT,
        owner: { weight_threshold: acct.owner.weight_threshold, account_auths: acct.owner.account_auths, key_auths: acct.owner.key_auths }, // untouched
        active: { weight_threshold: 1, account_auths: [], key_auths: [[activePub, 1]] },
        posting: { weight_threshold: acct.posting.weight_threshold, account_auths: acct.posting.account_auths, key_auths: acct.posting.key_auths }, // untouched
        memo_key: acct.memo_key, // untouched
        json_metadata: acct.json_metadata || ''
      }
    ]]
  };
  const rc = await broadcastSend(tx, [ownerWif]);
  console.log(`broadcast OK txid=${(rc && rc.operation && rc.operation.id) || 'accepted'} (${Date.now() - t0}ms)`);

  // 7. chain verify (9-c law inverse: chain must now derive-match the new key)
  await new Promise(r => setTimeout(r, 2500));
  const [acct2] = await chainGet('condenser_api.get_accounts', [[ACCOUNT]]);
  const chainActive = acct2.active.key_auths[0][0];
  const match = body(chainActive) === body(activePub);
  console.log(`chain-verify active-auth=${chainActive.slice(0, 10)}... match=${match ? 'MATCH' : 'MISMATCH'}`);
  if (!match) throw new Error('chain did not take the new active key');

  // 8. receipt
  const rec = JSON.stringify({ ts: new Date().toISOString(), op: 'rekey', account: ACCOUNT, role: 'active', new_fp: fp(activeWif), signer: 'owner', sealed: sealName, durable: true, chain_verified: true });
  console.log(`RC-note: ${acct.vesting_shares} own vests`);
  fs.appendFileSync('/home/z/fleet/steem/receipts/custody-patrol.jsonl', rec + '\n');
  console.log('REKEY-COMPLETE', rec);
}

main().catch(e => { console.error('REKEY-FAILED:', e.message); process.exit(1); });
