#!/usr/bin/env node
/* delegate-sp.mjs — headcorner delegates 300 SP per new soldier (owner-approved ≥300SP law)
 * Capacity-honest: measures free vests (vesting - delegated_out) each run; stops at the wall.
 * Signed with headcorner ACTIVE (37-byte, lib-compatible). Receipt per op.
 */
import { createRequire } from 'module';
import fs from 'fs';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const steem = require('/home/z/fleet/steem/mini-services/saos-engine/node_modules/steem');
const RPC = 'https://api.steemit.com';
const MAP = '/home/z/fleet/steem/.secrets/custody-vault/crown-map.json';
const FROM = 'headcorner';
const TARGETS = process.argv.slice(2).length ? process.argv.slice(2)
  : ['hcsoldier8', 'hcsoldier9', 'hcsoldier10', 'hcsoldier11'];
const SP_PER = 300;

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

async function main() {
  const m = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  const wif = m[FROM].active;
  const [h] = await chainGet('condenser_api.get_accounts', [[FROM]]);
  if (body(steem.auth.wifToPublic(wif)) !== body(h.active.key_auths[0][0])) throw new Error('gate FAILED');
  const g = await chainGet('condenser_api.get_dynamic_global_properties', []);
  const vestsPerSP = parseFloat(g.total_vesting_shares.split(' ')[0]) / parseFloat(g.total_vesting_fund_steem.split(' ')[0]);
  const amt = (SP_PER * vestsPerSP).toFixed(6) + ' VESTS';
  const freeV = parseFloat(h.vesting_shares) - parseFloat(h.delegated_vesting_shares);
  console.log(`gate OK headcorner.active fp=${fp(wif)} | free=${(freeV / vestsPerSP).toFixed(1)} SP | per-soldier ${amt}`);

  let ok = 0;
  for (const t of TARGETS) {
    try {
      const [acct] = await chainGet('condenser_api.get_accounts', [[t]]);
      if (!acct) { console.error(`${t}: not on chain, skip`); continue; }
      const cur = parseFloat(acct.received_vesting_shares || '0') / vestsPerSP;
      if (cur >= SP_PER) { console.log(`${t}: already at ${cur.toFixed(1)} SP, skip`); continue; }
      await broadcast([['delegate_vesting_shares', { delegator: FROM, delegatee: t, vesting_shares: amt }]], [wif]);
      console.log(`${t}: delegated ${SP_PER} SP (tx accepted)`);
      const rec = JSON.stringify({ ts: new Date().toISOString(), op: 'delegate', from: FROM, to: t, amount: amt, sp: SP_PER, signer_fp: fp(wif), chain_accepted: true });
      fs.appendFileSync('/home/z/fleet/steem/receipts/custody-patrol.jsonl', rec + '\n');
      ok++;
      await sleep(2500);
    } catch (e) {
      console.error(`DELEGATE-FAILED ${t}: ${e.message.slice(0, 200)}`);
      if (/RC|insufficient|vesting/i.test(e.message)) { console.error('capacity wall — stopping honestly'); break; }
    }
  }
  console.log(`SUMMARY: delegated=${ok}/${TARGETS.length}`);
}
main().catch(e => { console.error('FATAL:', e.message.slice(0, 300)); process.exit(1); });
