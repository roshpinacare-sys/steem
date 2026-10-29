#!/usr/bin/env node
/* create-soldiers.mjs — new soldier creation wave via fee channel
 * Law: seal FIRST (4 fresh WIFs per soldier, CROWN-NEW-<name>.enc, durable push),
 * then account_create (creator=cashmachine active, fee from chain median), chain-verify,
 * additive crown-map, receipt. Names hcsoldier8..16. Delegation is a SEPARATE script.
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
const CREATOR = process.argv[2] || 'cashmachine';
const NAMES = process.argv.slice(3).length ? process.argv.slice(3)
  : ['hcsoldier8','hcsoldier9','hcsoldier10','hcsoldier11','hcsoldier12','hcsoldier13','hcsoldier14','hcsoldier15','hcsoldier16'];

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
  const tx = { ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(Date.now() + 60 * 1000).toISOString().slice(0, -5), operations: ops };
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
  JSON.parse(execSync(`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -pass file:${PASS_FILE} -in ${VAULT_HOME}/custody-intake/${name}`, { input: '', shell: '/bin/bash' }).toString());
  g(`git add custody-intake/${name} && git commit -q -m "seal: ${name}" || true`);
  g('git pull --rebase -q || true'); g('git push -q origin HEAD');
  const local = g('git rev-parse HEAD'), remote = g('git ls-remote origin -h HEAD').split('\t')[0];
  if (local !== remote) throw new Error('durable push FAILED');
  return local;
}
const map = () => JSON.parse(fs.readFileSync(MAP, 'utf8'));
function saveMap(m) { fs.writeFileSync(MAP + '.tmp', JSON.stringify(m)); fs.chmodSync(MAP + '.tmp', 0o600); fs.renameSync(MAP + '.tmp', MAP); }
const wif = (label) => steem.auth.toWif(crypto.randomBytes(32).toString('hex'), crypto.randomBytes(16).toString('hex'), label);

async function main() {
  const m0 = map();
  const creatorActive = m0[CREATOR]?.active;
  if (!creatorActive) throw new Error('no active for creator ' + CREATOR);
  const [c] = await chainGet('condenser_api.get_accounts', [[CREATOR]]);
  const creatorPub = steem.auth.wifToPublic(creatorActive);
  if (body(creatorPub) !== body(c.active.key_auths[0][0])) throw new Error('creator active gate FAILED');
  console.log(`gate: ${CREATOR}.active fp=${fp(creatorActive)} matches chain OK; names=${NAMES.length}`);

  const ws = await chainGet('condenser_api.get_witness_schedule', []);
  const median = ws.median_props.account_creation_fee; // e.g. "3.000 STEEM"
  const fee = median; // pay exactly the chain median
  console.log(`chain median account_creation_fee=${fee}`);

  let ok = 0;
  for (const name of NAMES) {
    try {
      const [exists] = await chainGet('condenser_api.get_accounts', [[name]]);
      if (exists) { console.log(`${name}: already exists, skip`); continue; }
      const k = { owner: wif('owner'), active: wif('active'), posting: wif('posting'), memo: wif('memo') };
      const p = {}; for (const r of Object.keys(k)) p[r] = steem.auth.wifToPublic(k[r]);
      const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '') + 'Z';
      const sealName = `CROWN-NEW-${name}-${ts}.enc`;
      const blob = JSON.stringify({ sealed: ts, account: name, roles: Object.keys(k).map(r => ({ role: r, wif: k[r], pub: p[r], fp: fp(k[r]) })), sealed_by: 'create-soldiers.mjs', creator: CREATOR }, null, 2);
      const rev = sealAndPush(sealName, blob);
      console.log(`${name}: seal DURABLE ${sealName} rev=${rev.slice(0,8)} fps=${Object.keys(k).map(r => r+':'+fp(k[r])).join(' ')}`);

      const auth = (pub) => ({ weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] });
      await broadcast([['account_create', {
        fee, creator: CREATOR, new_account_name: name,
        owner: auth(p.owner), active: auth(p.active), posting: auth(p.posting), memo_key: p.memo, json_metadata: '{"app":"saos-army"}'
      }]], [creatorActive]);
      console.log(`${name}: account_create broadcast OK (fee ${fee})`);
      await sleep(3000);

      const [a] = await chainGet('condenser_api.get_accounts', [[name]]);
      if (!a) throw new Error('not found after create');
      const v = body(a.owner.key_auths[0][0]) === body(p.owner) && body(a.active.key_auths[0][0]) === body(p.active);
      if (!v) throw new Error('chain verify FAIL');
      console.log(`${name}: chain-verify owner+active MATCH`);

      const m = map(); m[name] = {
        owner: k.owner, owner_pub: p.owner, owner_fp: fp(k.owner),
        active: k.active, active_pub: p.active, active_fp: fp(k.active),
        posting: k.posting, posting_pub: p.posting, posting_fp: fp(k.posting),
        memo: k.memo, memo_pub: p.memo, memo_fp: fp(k.memo),
        created_at: new Date().toISOString(), creation_seal: sealName, creator: CREATOR
      }; saveMap(m);
      const rec = JSON.stringify({ ts: new Date().toISOString(), op: 'account_create', account: name, creator: CREATOR, fee, seal: sealName, durable: true, chain_verified: true });
      fs.appendFileSync('/home/z/fleet/steem/receipts/custody-patrol.jsonl', rec + '\n');
      console.log(`CREATE-COMPLETE ${name}`);
      ok++;
      await sleep(1500);
    } catch (e) {
      console.error(`CREATE-FAILED ${name}: ${e.message.slice(0, 220)}`);
      if (/RC|resource_credit/i.test(e.message)) { console.error('RC wall hit — stopping wave honestly'); break; }
    }
  }
  console.log(`SUMMARY: created=${ok}/${NAMES.length}`);
}
main().catch(e => { console.error('FATAL:', e.message.slice(0, 300)); process.exit(1); });
