#!/usr/bin/env node
/* keyrotate.cjs — sovereign key rotation (Vault v2 foundation, Task 55).
 *
 * Rotates an army account's authorities (owner/active/posting/memo) on BOTH
 * chains to keys derived deterministically from FACTORY_MASTER. After this,
 * the account is re-derivable forever from (username, FACTORY_MASTER) — the
 * Vault v2 semantic: paste master → local hatch → chain-authority match →
 * vault entry. Keys can never be lost again.
 *
 * Order of operations (no stale-key window):
 *   1. derive new keys machine-local (never logged in full)
 *   2. update agent/keys/vault.json entry with the new keys
 *   3. broadcast account_update on Steem (owner-signed, current owner key)
 *   4. broadcast account_update on Hive  (owner-signed, chain_id switch)
 *   5. write rotation_evidence.json (txids + masked pubs; master never stored)
 *
 * Usage: node keyrotate.cjs --account ynet [--chains steem,hive] [--dry]
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const STEEM_RPC = process.env.RPC_URL || 'https://api.steemit.com';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const OUT = path.join(__dirname, 'rotation_evidence.json');

steem.api.setOptions({ url: STEEM_RPC });

const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const DRY = args.includes('--dry');
const target = (argOf('--account') || '').toLowerCase().replace(/^@/, '');
const chainsWanted = (argOf('--chains') || 'steem,hive').split(',').map((s) => s.trim());

function log(msg) {
  console.log('[' + new Date().toISOString() + '] ' + msg);
}

function mask(pub) {
  return typeof pub === 'string' && pub.length > 12 ? pub.slice(0, 10) + '…' : pub;
}

function dgp(url) {
  const prev = steem.api.options.url;
  steem.api.setOptions({ url });
  return new Promise((res, rej) =>
    steem.api.getDynamicGlobalProperties((e, r) => {
      steem.api.setOptions({ url: prev });
      e ? rej(e) : res(r);
    }),
  );
}

function bcast(url, signed) {
  const prev = steem.api.options.url;
  steem.api.setOptions({ url });
  return new Promise((res, rej) =>
    steem.api.call('condenser_api.broadcast_transaction', [signed], (e, r) => {
      steem.api.setOptions({ url: prev });
      e ? rej(e) : res(r);
    }),
  );
}

function getAcc(url, name) {
  const prev = steem.api.options.url;
  steem.api.setOptions({ url });
  return new Promise((res, rej) =>
    steem.api.getAccounts([name], (e, r) => {
      steem.api.setOptions({ url: prev });
      e ? rej(e) : res(r && r[0]);
    }),
  );
}

function makeTx(d, ops) {
  return {
    ref_block_num: d.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(d.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(d.time + 'Z').getTime() + 90000).toISOString().slice(0, 19),
    operations: ops,
    extensions: [],
  };
}

function vaultRead() {
  const p = path.join(__dirname, 'keys', 'vault.json');
  return { p, v: JSON.parse(fs.readFileSync(p, 'utf8')) };
}

async function main() {
  if (!target) return log('usage: node keyrotate.cjs --account <name> [--chains steem,hive] [--dry]');
  if (target === ACCOUNT) return log('refusing to rotate the primary account (' + ACCOUNT + ') — primary keys live in .env');
  const FACTORY_MASTER = process.env.FACTORY_MASTER || '';
  if (!FACTORY_MASTER) return log('no FACTORY_MASTER in agent/.env — deterministic rotation unavailable');

  const roles = ['owner', 'active', 'posting', 'memo'];
  const wifs = steem.auth.getPrivateKeys(target, FACTORY_MASTER, roles);
  for (const r of roles) if (!steem.auth.isWif(wifs[r])) return log('derived invalid WIF for ' + r);
  const pubs = {};
  for (const r of roles) pubs[r] = steem.auth.wifToPublic(wifs[r]);

  // current chain state (both chains)
  const [st, hv] = await Promise.all([getAcc(STEEM_RPC, target), getAcc(HIVE_RPC, target)]);
  if (!st) return log('@' + target + ' not found on Steem');
  const sameBefore =
    st.posting.key_auths[0][0] === (hv && hv.posting.key_auths[0][0]) &&
    st.active.key_auths[0][0] === (hv && hv.active.key_auths[0][0]) &&
    st.owner.key_auths[0][0] === (hv && hv.owner.key_auths[0][0]) &&
    st.memo_key === (hv && hv.memo_key);
  log('@' + target + ' baseline: steem ✓' + (hv ? ' · hive ✓ · same-pubs=' + sameBefore : ' · hive ✗ (absent)'));

  // current owner WIF from vault (rotations are owner-signed)
  const { p: vp, v } = vaultRead();
  const entry = (v.accounts || []).find((a) => String(a.username || '').toLowerCase() === target);
  if (!entry || !entry.keys || !entry.keys.owner || !entry.keys.owner.wif)
    return log('no owner key in vault for @' + target + ' — rotation requires owner authority');
  const curOwnerWif = entry.keys.owner.wif;
  const curOwnerPub = steem.auth.wifToPublic(curOwnerWif);
  if (curOwnerPub !== st.owner.key_auths[0][0])
    return log('vault owner key does NOT match Steem owner authority — aborting (stale vault)');

  // preserve account_auths (rescue anchors) — swap only key_auths + memo
  const auth = (spec, newPub) => ({
    weight_threshold: spec.weight_threshold || 1,
    account_auths: spec.account_auths || [],
    key_auths: [[newPub, 1]],
  });

  const updateOp = ['account_update', {
    account: target,
    owner: auth(st.owner, pubs.owner),
    active: auth(st.active, pubs.active),
    posting: auth(st.posting, pubs.posting),
    memo_key: pubs.memo,
    json_metadata: st.json_metadata || '',
  }];

  log('rotation plan: key_auths swap on ' + chainsWanted.join('+') + ' · account_auths preserved (owner ' +
    (st.owner.account_auths || []).length + ', posting ' + (st.posting.account_auths || []).length + ')' +
    ' · new pubs ' + roles.map((r) => mask(pubs[r])).join(' '));

  if (DRY) {
    log('[DRY] would rotate @' + target + ' on ' + chainsWanted.join('+') + ' (vault-first, then account_update ×N)');
    return;
  }

  // 2. vault-first: write derived keys so the daemon NEVER holds stale creds
  entry.keys = Object.fromEntries(roles.map((r) => [r, { wif: wifs[r], pub: pubs[r] }]));
  entry.mode = 'deterministic';
  entry.rotatedAt = new Date().toISOString();
  entry.rotation = { derivedFrom: 'FACTORY_MASTER', chains: chainsWanted };
  entry.syncedAt = new Date().toISOString();
  fs.writeFileSync(vp, JSON.stringify(v, null, 2));
  log('vault updated (mode=deterministic) — machine-local, git-ignored');

  // 3+4. chain rotations
  const evidence = {
    at: new Date().toISOString(),
    account: target,
    derivedFrom: 'FACTORY_MASTER',
    scheme: 'sha256(username+role+password) via steem-js getPrivateKeys',
    before: {
      steem: { owner: mask(st.owner.key_auths[0][0]), active: mask(st.active.key_auths[0][0]), posting: mask(st.posting.key_auths[0][0]), memo: mask(st.memo_key) },
      hive: hv ? { owner: mask(hv.owner.key_auths[0][0]), active: mask(hv.active.key_auths[0][0]), posting: mask(hv.posting.key_auths[0][0]), memo: mask(hv.memo_key) } : null,
    },
    after: Object.fromEntries(roles.map((r) => [r, mask(pubs[r])])),
    accountAuthsPreserved: { owner: st.owner.account_auths || [], posting: st.posting.account_auths || [] },
    chains: {},
  };

  for (const chain of chainsWanted) {
    const rpc = chain === 'hive' ? HIVE_RPC : STEEM_RPC;
    let signed;
    if (chain === 'hive') {
      const d = await dgp(HIVE_RPC);
      const prevC = steem.config.get('chain_id');
      try {
        steem.config.set('chain_id', HIVE_CHAIN_ID);
        signed = steem.auth.signTransaction(makeTx(d, [updateOp]), [curOwnerWif]);
      } finally {
        steem.config.set('chain_id', prevC);
      }
    } else {
      const d = await dgp(STEEM_RPC);
      signed = steem.auth.signTransaction(makeTx(d, [updateOp]), [curOwnerWif]);
    }
    try {
      await bcast(rpc, signed);
      // verify via authority re-fetch
      await new Promise((r) => setTimeout(r, 4000));
      const after = await getAcc(rpc, target);
      const okOwner = after.owner.key_auths[0][0] === pubs.owner;
      const okPosting = after.posting.key_auths[0][0] === pubs.posting;
      const okActive = after.active.key_auths[0][0] === pubs.active;
      const okMemo = after.memo_key === pubs.memo;
      evidence.chains[chain] = { rotated: true, verified: okOwner && okPosting && okActive && okMemo, owner: okOwner, active: okActive, posting: okPosting, memo: okMemo };
      log(chain.toUpperCase() + ' rotation ✓ verified=' + evidence.chains[chain].verified);
    } catch (e) {
      evidence.chains[chain] = { rotated: false, error: String((e && e.message) || e).slice(0, 180) };
      log(chain.toUpperCase() + ' rotation FAILED: ' + evidence.chains[chain].error);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  const done = Object.values(evidence.chains).filter((c) => c.rotated).length;
  log('keyrotate COMPLETE: ' + done + '/' + chainsWanted.length + ' chains · evidence → rotation_evidence.json');
}

main().catch((e) => log('FATAL: ' + String((e && e.message) || e)));
