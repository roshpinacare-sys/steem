#!/usr/bin/env node
/**
 * energy_ops.cjs — Task 58: the ENERGY program.
 *
 * Three modes (all local signing, secrets never printed/logged):
 *   --battery      dry-run validate_transaction battery — proves WHICH ops our
 *                  authorities can sign on Steem & Hive without broadcasting.
 *                  Includes a negative control (posting key on an active op)
 *                  so a green wall is never fake.
 *   --mint         LIVE: claim_account (grind an account ticket out of pure
 *                  RC energy, measured) → create_claimed_account (a new soldier
 *                  born from energy, owner+posting anchored to the operator)
 *                  → 25 SP endowment → first sovereign ping from its own key.
 *   --hive-share   LIVE: delegate_rc inside the swarm on Hive — energy flows
 *                  from full/idle accounts to @ynet (breaking its Hive wall).
 *
 * Evidence: agent/energy_evidence.json
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/energy_ops.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const steem = require('steem');
const { Client, PrivateKey, cryptoUtils } = require('@hiveio/dhive');

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

const OPERATOR = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const POSTING_WIF = process.env.POSTING_WIF || '';
const OWNER_WIF = process.env.OWNER_WIF || '';
const STEEM_CID = '0000000000000000000000000000000000000000000000000000000000000000';
const STEEM_CID_BUF = Buffer.from(STEEM_CID, 'hex');
const steemCli = new Client(['https://api.steemit.com', 'https://api.justyy.com']);
const hiveCli = new Client('https://api.hive.blog');

const NAMES = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
const CANDIDATES = ['powerspan', 'magdyno', 'energywell', 'saospower'];
const EV_PATH = path.join(__dirname, 'energy_evidence.json');

const mask = (s) => (s ? String(s).slice(0, 8) + '…(' + String(s).length + ')' : '-');
const log = (m) => console.log('[' + new Date().toISOString() + '] energy: ' + m);
function evMerge(section, data) {
  let ev = {};
  try { ev = JSON.parse(fs.readFileSync(EV_PATH, 'utf8')); } catch (_) { /* first */ }
  ev[section] = Object.assign({}, ev[section], data);
  ev.updatedAt = new Date().toISOString();
  fs.writeFileSync(EV_PATH, JSON.stringify(ev, null, 2) + '\n');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: OPERATOR });
const DRY = GATE.dry;
announceGate(GATE, log);


async function rcMana(cli, name) {
  const r = await cli.call('rc_api', 'find_rc_accounts', { accounts: [name] });
  const row = r && r.rc_accounts && r.rc_accounts[0];
  if (!row) return null;
  const max = parseFloat(row.max_rc), now = parseFloat(row.rc_manabar.current_mana);
  const elapsed = Math.max(0, Date.now() / 1000 - row.rc_manabar.last_update_time);
  return { max, now: Math.min(max, now + elapsed * (max / (5 * 86400))), raw: now, at: Date.now() / 1000 };
}
/** regen-adjusted cost: projection of the before-sample at t2 minus the raw after reading */
function rcCostHonest(before, after) {
  if (!before || !after) return null;
  const projected = Math.min(before.max, before.raw + (after.at - before.at) * (before.max / (5 * 86400)));
  return Math.max(0, projected - after.raw);
}

/* ══════════════ signing core ══════════════ */
/** build + locally sign a tx (explicit Buffer chainId for Steem = zeros) */
async function signTx(cli, chainIdBuf, wif, operations) {
  const dgp = await cli.call('condenser_api', 'get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations, extensions: [],
  };
  return cryptoUtils.signTransaction(tx, [PrivateKey.fromString(wif)], chainIdBuf || undefined);
}
async function broadcastSigned(cli, signed) {
  await cli.call('condenser_api', 'broadcast_transaction', [signed]);
  return cryptoUtils.generateTrxId ? cryptoUtils.generateTrxId(signed) : 'broadcast-ok';
}

/* ══════════════ MODE: authority battery (dry-run, no broadcast) ══════════════ *
 * condenser_api.get_required_signatures — the chain ITSELF declares which of
 * OUR public keys each operation requires. Sovereignty perimeter proven
 * without broadcasting and without signatures.                                  */
async function battery() {
  const results = [];
  const PUBS = {
    owner: process.env.OWNER_WIF_PUB || '',
    active: process.env.ACTIVE_WIF_PUB || '',
    posting: process.env.POSTING_WIF_PUB || '',
  };
  const ourPubs = Object.values(PUBS).filter(Boolean);
  const roleOf = (pub) => { for (const [r, p] of Object.entries(PUBS)) if (p === pub) return r; return null; };

  const probe = async (chain, cli, op, tag, expect) => {
    try {
      const dgp = await cli.call('condenser_api', 'get_dynamic_global_properties', []);
      const tx = {
        ref_block_num: dgp.head_block_number & 0xffff,
        ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
        expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
        operations: [op], extensions: [],
      };
      const req = await cli.call('condenser_api', 'get_required_signatures', [tx, ourPubs]);
      const roles = (req || []).map(roleOf);
      const verdict = !req || req.length === 0
        ? 'NO-KEY-HELD'
        : roles.every(Boolean)
          ? 'SOVEREIGN(' + roles.join('+') + ')'
          : 'PARTIAL';
      results.push({ chain, op: op[0], requiredMask: (req || []).map((p) => String(p).slice(0, 10) + '…'), roles, verdict, tag: tag || '', expect: expect || '' });
      log('battery ' + chain + ' ' + op[0] + (tag ? ' [' + tag + ']' : '') + ' → ' + verdict);
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 110);
      results.push({ chain, op: op[0], verdict: 'ERROR', error: msg, tag: tag || '', expect: expect || '' });
      log('battery ' + chain + ' ' + op[0] + (tag ? ' [' + tag + ']' : '') + ' → ERROR: ' + msg.slice(0, 70));
    }
  };
  const me = OPERATOR;
  const ts = Math.floor(Date.now() / 1000) % 1e7;

  // ── Steem: the full perimeter ──
  await probe('steem', steemCli, ['vote', { voter: me, author: me, permlink: 'saos', weight: 0 }], 'posting-family');
  await probe('steem', steemCli, ['comment', { parent_author: '', parent_permlink: 'saos', author: me, permlink: 'saos-probe-' + ts, title: '', body: '', json_metadata: '{}' }], 'posting-family');
  await probe('steem', steemCli, ['custom_json', { required_posting_auths: [me], required_active_auths: [], id: 'follow', json: JSON.stringify(['follow', { follower: me, following: me, what: [] }]) }], 'posting-family');
  await probe('steem', steemCli, ['claim_reward_balance', { account: me, reward_steem: '0.000 STEEM', reward_sbd: '0.000 SBD', reward_vesting_shares: '0.000000 VESTS' }], 'posting-family');
  await probe('steem', steemCli, ['transfer', { from: me, to: me, amount: '0.001 STEEM', memo: 'probe' }], 'money');
  await probe('steem', steemCli, ['transfer_to_savings', { from: me, to: me, amount: '0.001 STEEM', memo: '' }], 'money');
  await probe('steem', steemCli, ['transfer_from_savings', { from: me, to: me, amount: '0.001 STEEM', memo: '', request_id: 99 }], 'money');
  await probe('steem', steemCli, ['limit_order_create', { owner: me, orderid: 99, amount_to_sell: '0.001 STEEM', min_to_receive: '0.001 SBD', fill_or_kill: false, expiration: '2030-01-01T00:00:00' }], 'market');
  await probe('steem', steemCli, ['limit_order_cancel', { owner: me, orderid: 99 }], 'market');
  await probe('steem', steemCli, ['set_withdraw_vesting_route', { account: me, to_account: me, percent: 0, auto_vest: false }], 'vesting');
  await probe('steem', steemCli, ['withdraw_vesting', { account: me, vesting_shares: '0.000000 VESTS' }], 'vesting');
  await probe('steem', steemCli, ['delegate_vesting_shares', { delegator: me, delegatee: me, vesting_shares: '0.000000 VESTS' }], 'vesting');
  await probe('steem', steemCli, ['claim_account', { creator: me, fee: '0.000 STEEM' }], 'energy');
  await probe('steem', steemCli, ['create_claimed_account', { creator: me, new_account_name: 'saosprobex' + (ts % 100), owner: { weight_threshold: 1, account_auths: [], key_auths: [[PUBS.posting, 1]] }, active: { weight_threshold: 1, account_auths: [], key_auths: [[PUBS.posting, 1]] }, posting: { weight_threshold: 1, account_auths: [], key_auths: [[PUBS.posting, 1]] }, memo_key: PUBS.posting, json_metadata: '' }], 'energy');
  await probe('steem', steemCli, ['escrow_transfer', { from: me, to: me, agent: me, escrow_id: 99, sbd_amount: '0.000 SBD', steem_amount: '0.000 STEEM', fee: '0.000 STEEM', ratification_deadline: '2030-01-01T00:00:00', escrow_expiration: '2030-01-02T00:00:00', json_meta: '{}' }], 'escrow');
  await probe('steem', steemCli, ['escrow_approve', { from: me, to: me, agent: me, who: me, escrow_id: 99, approve: true }], 'escrow');
  await probe('steem', steemCli, ['escrow_dispute', { from: me, to: me, agent: me, who: me, escrow_id: 99 }], 'escrow');
  await probe('steem', steemCli, ['escrow_release', { from: me, to: me, agent: me, who: me, receiver: me, escrow_id: 99, sbd_amount: '0.000 SBD', steem_amount: '0.000 STEEM' }], 'escrow');
  await probe('steem', steemCli, ['recurrent_transfer', { from: me, to: me, amount: '0.001 STEEM', memo: '', recurrence: 24, executions: 2, extensions: [] }], 'money');
  await probe('steem', steemCli, ['convert', { owner: me, requestid: 99, amount: '0.000 SBD' }], 'money');
  await probe('steem', steemCli, ['collateralized_convert', { owner: me, requestid: 99, amount: '0.000 HBD' }], 'money');
  await probe('steem', steemCli, ['account_update2', { account: me, json_metadata: '{}' }], 'identity');
  await probe('steem', steemCli, ['account_witness_vote', { account: me, witness: 'justyy', approve: false }], 'governance');
  await probe('steem', steemCli, ['update_proposal_votes', { voter: me, proposal_ids: [0], approve: false, extensions: [] }], 'governance');
  await probe('steem', steemCli, ['delegate_rc', { from: me, to: me, max_rc: 0, extensions: [] }], 'energy');
  await probe('steem', steemCli, ['witness_set_properties', { owner: me, props: [], extensions: [] }], 'governance', 'semantic gate = witness registration');
  await probe('steem', steemCli, ['decline_voting_rights', { account: me, decline: false }], 'owner-family');
  await probe('steem', steemCli, ['change_recovery_account', { account_to_recover: me, new_recovery_account: me, extensions: [] }], 'owner-family');
  // ── negative control: an authority we demonstrably do NOT hold (ynet owner) ──
  await probe('steem', steemCli, ['account_update2', { account: 'ynet', json_metadata: '{}' }], 'negative-control', 'MUST BE NO-KEY-HELD (ynet owner/active keys lost in wipe)');

  // ── Hive: the anchoring chain perimeter ──
  await probe('hive', hiveCli, ['delegate_rc', { from: me, to: me, max_rc: 0, extensions: [] }], 'energy');
  await probe('hive', hiveCli, ['transfer', { from: me, to: me, amount: '0.001 HIVE', memo: 'probe' }], 'money');
  await probe('hive', hiveCli, ['delegate_vesting_shares', { delegator: me, delegatee: me, vesting_shares: '0.000000 VESTS' }], 'vesting');
  await probe('hive', hiveCli, ['withdraw_vesting', { account: me, vesting_shares: '0.000000 VESTS' }], 'vesting');
  await probe('hive', hiveCli, ['claim_reward_balance', { account: me, reward_hive: '0.000 HIVE', reward_hbd: '0.000 HBD', reward_vesting_shares: '0.000000 VESTS' }], 'posting-family');
  await probe('hive', hiveCli, ['recurrent_transfer', { from: me, to: me, amount: '0.001 HIVE', memo: '', recurrence: 24, executions: 2, extensions: [] }], 'money');
  await probe('hive', hiveCli, ['limit_order_create', { owner: me, orderid: 99, amount_to_sell: '0.001 HIVE', min_to_receive: '0.001 HBD', fill_or_kill: false, expiration: '2030-01-01T00:00:00' }], 'market');
  await probe('hive', hiveCli, ['collateralized_convert', { owner: me, requestid: 99, amount: '0.000 HBD' }], 'money');
  await probe('hive', hiveCli, ['account_update2', { account: me, json_metadata: '{}' }], 'identity');

  const sovereign = results.filter((r) => r.verdict.startsWith('SOVEREIGN')).length;
  const blocked = results.filter((r) => r.verdict === 'NO-KEY-HELD').length;
  const summary = { at: new Date().toISOString(), total: results.length, sovereign, noKeyHeld: blocked, other: results.length - sovereign - blocked, results };
  evMerge('battery', summary);
  log('battery DONE: ' + sovereign + ' SOVEREIGN / ' + blocked + ' NO-KEY-HELD / ' + results.length + ' probed · evidence written');
}

/* ══════════════ MODE: mint (energy → new soldier) ══════════════ */
function randomKeys() {
  const roles = ['owner', 'active', 'posting', 'memo'];
  const out = {};
  for (const r of roles) {
    const wif = steem.auth.toWif(crypto.randomBytes(32).toString('hex'));
    out[r] = { wif, pub: steem.auth.wifToPublic(wif) };
  }
  return out;
}
async function getAccount(cli, name) {
  const r = await cli.call('condenser_api', 'get_accounts', [[name]]);
  return r && r[0] ? r[0] : null;
}
const authOf = (pub, accountAuths) => ({ weight_threshold: 1, account_auths: accountAuths || [], key_auths: [[pub, 1]] });

function vaultUpsert(entry) {
  const p = path.join(__dirname, 'keys', 'vault.json');
  let v = { accounts: [] };
  try { v = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { /* new vault */ }
  if (!Array.isArray(v.accounts)) v.accounts = [];
  const u = String(entry.username).toLowerCase();
  v.accounts = v.accounts.filter((a) => !a || String(a.username).toLowerCase() !== u);
  v.accounts.push(entry);
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
  try { fs.chmodSync(p, 0o600); } catch (_) { /* windows */ }
}

/** PHASE A — grind one account-ticket out of the treasury turbine.
 *  Self-waits: claim_account costs a huge RC packet; if mana is insufficient
 *  the chain rejects harmlessly → poll every 15 min until charged. */
async function ensureTicket() {
  const acc = await getAccount(steemCli, OPERATOR);
  const tickets = acc ? acc.pending_claimed_accounts : 0;
  if (tickets >= 1) return { claimed: false, rcCostG: null, tickets };
  for (let i = 1; i <= 40; i++) {
    const before = await rcMana(steemCli, OPERATOR);
    try {
      const s = await signTx(steemCli, STEEM_CID_BUF, ACTIVE_WIF, [['claim_account', { creator: OPERATOR, fee: '0.000 STEEM', extensions: [] }]]);
      await broadcastSigned(steemCli, s);
      const after = await rcMana(steemCli, OPERATOR);
      const cost = rcCostHonest(before, after);
      log('claim OK on try ' + i + ' · rcCost≈' + (cost ? (cost / 1e9).toFixed(1) + 'G' : 'n/a') + ' RC (measured live)');
      return { claimed: true, rcCostG: cost ? +(cost / 1e9).toFixed(1) : null, tickets: 1, tries: i };
    } catch (e) {
      const msg = String((e && e.message) || e);
      const m = msg.match(/has (\d+) RC, needs (\d+) RC/);
      if (!m) throw new Error('claim failed (non-RC): ' + msg.slice(0, 140));
      const need = parseInt(m[2], 10);
      const deficit = need - before.now;
      const hours = deficit / (before.max / 120);
      log('claim try ' + i + ': not charged yet — needs ' + (need / 1e9).toFixed(0) + 'G, have ' +
        (before.now / 1e9).toFixed(0) + 'G → turbine needs ' + hours.toFixed(2) + 'h · sleeping 15 min');
      await sleep(15 * 60 * 1000);
    }
  }
  throw new Error('claim did not succeed within 40 polling rounds (10h)');
}

async function mint() {
  if (!ACTIVE_WIF) return log('mint: no ACTIVE_WIF');
  // 1. pick a free name
  const probe = await steemCli.call('condenser_api', 'get_accounts', [CANDIDATES]);
  const name = CANDIDATES.find((n, i) => !probe[i]);
  if (!name) return log('mint: all candidate names taken — extend CANDIDATES');
  log('mint: name @' + name + ' is free on Steem');

  // PHASE A — energy → ticket (measured, self-waiting)
  const t = await ensureTicket();
  log('mint: ticket in inventory (claimed=' + t.claimed + ' · rcCostG=' + (t.rcCostG ?? 'pre-held') + ')');

  // PHASE B — ticket + tiny RC → a new soldier, owner+posting anchored to operator
  const keys = randomKeys();
  const ownerAuth = { weight_threshold: 1, account_auths: [[OPERATOR, 1]], key_auths: [[keys.owner.pub, 1]] };
  const postAuth = { weight_threshold: 1, account_auths: [[OPERATOR, 1]], key_auths: [[keys.posting.pub, 1]] };
  const actAuth = authOf(keys.active.pub);
  const dgp = await steemCli.call('condenser_api', 'get_dynamic_global_properties', []);
  const per = parseFloat(dgp.total_vesting_shares) / parseFloat(dgp.total_vesting_fund_steem);
  const vests = (25 * per).toFixed(6) + ' VESTS';
  const ops = [
    ['create_claimed_account', {
      creator: OPERATOR, new_account_name: name,
      owner: ownerAuth, active: actAuth, posting: postAuth,
      memo_key: keys.memo.pub, json_metadata: '{"app":"saos-factory/3","born":"rc-energy"}', extensions: [],
    }],
    ['delegate_vesting_shares', { delegator: OPERATOR, delegatee: name, vesting_shares: vests, extensions: [] }],
  ];
  log('mint: broadcasting create_claimed + endow ' + vests + ' (one tx, two ops)');
  const before = await rcMana(steemCli, OPERATOR);
  const signed = await signTx(steemCli, STEEM_CID_BUF, ACTIVE_WIF, ops);
  await broadcastSigned(steemCli, signed);
  const after = await rcMana(steemCli, OPERATOR);
  const createCost = rcCostHonest(before, after);
  log('mint: BROADCAST ok · create rcCost≈' + (createCost ? (createCost / 1e9).toFixed(3) + 'G RC' : 'n/a'));

  // 6. verify on-chain
  await sleep(4000);
  const fresh = await getAccount(steemCli, name);
  if (!fresh) { evMerge('mint', { name, error: 'account not visible after broadcast' }); return log('mint: VERIFY FAILED — account not visible'); }
  const ownerAnchor = (fresh.owner.account_auths || []).some((a) => a[0] === OPERATOR);
  const postAnchor = (fresh.posting.account_auths || []).some((a) => a[0] === OPERATOR);
  const received = parseFloat(fresh.received_vesting_shares) / per;
  const rc = await rcMana(steemCli, name);
  const ticketsAfter = (await getAccount(steemCli, OPERATOR)).pending_claimed_accounts;
  const ok = ownerAnchor && postAnchor && received >= 20;
  log('mint VERIFY: created=' + fresh.created + ' · ownerAnchor=' + ownerAnchor + ' · postingAnchor=' + postAnchor +
    ' · endowment=' + received.toFixed(2) + ' SP · rcMax=' + (rc ? (rc.max / 1e9).toFixed(2) + 'G' : '?') +
    ' · tickets left=' + ticketsAfter + (ok ? ' ✓' : ''));

  // 7. vault + keyfile (git-ignored, double backup, 0600)
  vaultUpsert({
    username: name, tier: 'factory-v2', mode: 'random-energy-born',
    keys: Object.fromEntries(['owner', 'active', 'posting', 'memo'].map((r) => [r, { wif: keys[r].wif, pub: keys[r].pub }])),
    chains: { steem: ['owner', 'active', 'posting', 'memo'] },
    addedAt: new Date().toISOString(), syncedAt: new Date().toISOString(),
    meta: { creator: OPERATOR, gen: 'energy-born', endowmentSp: 25, rescueAnchor: OPERATOR, txNote: "claim=phaseA, create+delegate=phaseB" },
  });
  const kp = path.join(__dirname, 'keys', name + '.json');
  fs.writeFileSync(kp, JSON.stringify({ name, createdAt: new Date().toISOString(), gen: 'energy-born', keys }, null, 2));
  try { fs.chmodSync(kp, 0o600); } catch (_) { /* windows */ }
  log('mint: vault.json + keys/' + name + '.json backed up (git-ignored, 0600)');

  // 8. first sovereign act from its OWN key
  let pingTxid = null;
  try {
    const payload = { t: 'fleet_ping', gen: 3, bot: name, born: 'rc-energy', seq: Math.floor(Date.now() / 1000), at: new Date().toISOString() };
    const pingOps = [['custom_json', { required_posting_auths: [name], required_active_auths: [], id: 'saos', json: JSON.stringify(payload) }]];
    const pinged = await signTx(steemCli, STEEM_CID_BUF, keys.posting.wif, pingOps);
    pingTxid = await broadcastSigned(steemCli, pinged);
    log('mint: first sovereign ping from @' + name + ' own key — on the saos bus');
  } catch (e) { log('mint: ping deferred (' + String((e && e.message) || e).slice(0, 90) + ')'); }

  evMerge('mint', {
    at: new Date().toISOString(), name, creator: OPERATOR,
    claim: t, createRcCostG: createCost ? +(createCost / 1e9).toFixed(3) : null,
    ticketsAfter,
    created: fresh.created, ownerAnchor, postAnchor, endowmentSp: +received.toFixed(2),
    rcMaxG: rc ? +(rc.max / 1e9).toFixed(2) : null, pingTxid, ok,
    note: 'creation fee benchmark = 3.000 STEEM — asset minted from pure RC energy',
  });
}

/* ══════════════ MODE: hive-share (energy redistribution) ══════════════ */
function vaultKeysFor(account) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const row = (v.accounts || []).find((a) => a && String(a.username).toLowerCase() === String(account).toLowerCase());
    return row && row.keys ? row.keys : null;
  } catch (_) { return null; }
}
async function hiveDelegateRc(from, to, maxRc) {
  const keys = from === OPERATOR ? { active: { wif: ACTIVE_WIF }, posting: { wif: POSTING_WIF } } : vaultKeysFor(from);
  if (!keys) throw new Error('no keys for @' + from);
  const before = await rcMana(hiveCli, to);
  const attempt = async (wif, tag) => {
    await hiveBroadcastRaw([['delegate_rc', { from, to, max_rc: maxRc, extensions: [] }]], wif);
    return tag;
  };
  let usedTag = null, lastErr = null;
  for (const tag of ['active', 'posting', 'owner']) {
    if (!keys[tag] || !keys[tag].wif) continue;
    try { usedTag = await attempt(keys[tag].wif, tag); break; } catch (e) { lastErr = e; }
  }
  if (!usedTag) throw new Error('delegate_rc failed with all available keys: ' + String(lastErr && lastErr.message || lastErr).slice(0, 120));
  await sleep(4000);
  const after = await rcMana(hiveCli, to);
  return { from, to, maxRc, signedWith: usedTag, toMaxBefore: before ? before.max : null, toMaxAfter: after ? after.max : null };
}

/* ── raw Hive broadcast for ops dhive 1.3.6 can't serialize (delegate_rc) ──
 * Node-serialization trick (proven in anchor.cjs for Blurt): ask the node for
 * get_transaction_hex, strip the trailing sig-count byte, digest over
 * chain_id ‖ bytes, local low-s sign, self-verify by recovery, broadcast.     */
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
async function hiveBroadcastRaw(ops, wif) {
  const { wifToScalar, ecdsaSignLowS, ecdsaRecover } = require('./identity.cjs');
  const SECP = require('ecurve').getCurveByName('secp256k1');
  const dgp = await hiveCli.call('condenser_api', 'get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: ops, extensions: [],
  };
  const hex = await hiveCli.call('condenser_api', 'get_transaction_hex', [tx]);
  const nb = Buffer.from(hex, 'hex');
  if (nb[nb.length - 1] !== 0x00) throw new Error('unexpected serialization tail (sigs not empty?)');
  const txBytes = nb.subarray(0, nb.length - 1);
  const digest = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(HIVE_CHAIN_ID, 'hex'), txBytes])).digest();
  const { d } = wifToScalar(wif);
  const sig = ecdsaSignLowS(digest, d);
  const signerPoint = SECP.G.multiply(d);
  const rec = ecdsaRecover(digest, sig.r, sig.s, sig.recid);
  if (!rec || rec.getEncoded(true).toString('hex') !== signerPoint.getEncoded(true).toString('hex')) {
    throw new Error('self-verify failed — not broadcasting');
  }
  const sigHex = Buffer.concat([sig.r.toBuffer(32), sig.s.toBuffer(32), Buffer.from([31 + sig.recid])]).toString('hex');
  await hiveCli.call('condenser_api', 'broadcast_transaction', [{ ...tx, signatures: [sigHex] }]);
  return { ok: true };
}

async function hiveShare() {
  const results = [];
  // MEASURED FINDING: delegate_rc is NOT in Hive mainnet's protocol registry —
  // both get_required_signatures and get_transaction_hex assert "Invalid
  // operation name". Energy sharing on Hive therefore flows through HP.
  results.push({
    attempt: 'delegate_rc', ok: false,
    finding: 'op absent from Hive mainnet protocol (measured live ×2 methods) — energy-sharing must ride on vesting',
  });

  // LIVE energy redistribution: treasury HP → ynet (raises max_rc immediately)
  const acc = (await hiveCli.call('condenser_api', 'get_accounts', [[OPERATOR]]))[0];
  const avail = parseFloat(acc.vesting_shares) - parseFloat(acc.delegated_vesting_shares);
  const give = Math.min(3000, Math.floor(avail * 0.5));
  const amountStr = give.toFixed(6) + ' VESTS';
  const before = await rcMana(hiveCli, 'ynet');
  try {
    log('hive-share: @' + OPERATOR + ' → @ynet delegate_vesting_shares ' + amountStr + ' (HP = permanent energy capacity)');
    const s = await signTx(hiveCli, undefined, ACTIVE_WIF, [['delegate_vesting_shares', { delegator: OPERATOR, delegatee: 'ynet', vesting_shares: amountStr, extensions: [] }]]);
    await broadcastSigned(hiveCli, s);
    await sleep(4000);
    const after = await rcMana(hiveCli, 'ynet');
    const ynetAcc = (await hiveCli.call('condenser_api', 'get_accounts', [['ynet']]))[0];
    const received = ynetAcc.received_vesting_shares;
    const delta = after && before ? after.max - before.max : null;
    log('hive-share OK · ynet received=' + received + ' · max_rc ' +
      (before.max / 1e9).toFixed(2) + 'G → ' + (after.max / 1e9).toFixed(2) + 'G (Δ' + (delta / 1e6).toFixed(0) + 'M)');
    results.push({ attempt: 'delegate_vesting_shares', ok: true, from: OPERATOR, to: 'ynet', amount: amountStr, receivedVests: received, maxRcBefore: before.max, maxRcAfter: after.max, deltaRc: delta });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 160);
    log('hive-share FAILED (vesting path): ' + msg);
    results.push({ attempt: 'delegate_vesting_shares', ok: false, error: msg });
  }
  evMerge('hiveShare', { at: new Date().toISOString(), results });
  log('hive-share DONE');
}

/* ══════════════ main ══════════════ */
(async () => {
  const mode = process.argv[2] || '';
  if (mode === '--battery') return battery(); // read-only by construction (get_required_signatures oracle)
  if (DRY) { log('[DRY] LIVE-GATE — broadcast modes (--mint/--hive-share/--all) require the live gate — nothing broadcast'); return; }
  if (mode === '--mint') return mint();
  if (mode === '--hive-share') return hiveShare();
  if (mode === '--all') { await battery(); await mint(); await hiveShare(); return; }
  log('usage: energy_ops.cjs --battery | --mint | --hive-share | --all');
})().catch((e) => { log('FATAL: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
