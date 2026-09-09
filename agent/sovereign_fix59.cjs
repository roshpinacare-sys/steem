#!/usr/bin/env node
/**
 * sovereign_fix59.cjs — Task 59 corrective batch (honest repairs + re-runs).
 *
 *  R1. RESTORE ynet fuel (80,824 VESTS — my delegation was absolute, not
 *      additive, exactly the Task-58 lesson) then add the +3,000 gift.
 *      Net: ynet 83,824 received vests on Steem, both txids on the ledger.
 *  R2. fleet recovery via change_recovery_account (set_reset_account is
 *      DISABLED on Steem mainnet — measured today, that is a wall).
 *  R3. market cycle with legal expiration (≤28d) — create → seen → cancel.
 *  R4. witness votes signed with ACTIVE authority (posting was rejected).
 *  R5. convert SBD→STEEM (Steem CET direction measured today).
 */
'use strict';
const fs = require('fs');
const path = require('path');
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

const OPERATOR = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const VAULT_PATH = path.join(__dirname, 'keys', 'vault.json');
const EV_PATH = path.join(__dirname, 'sovereign_59_evidence.json');
const STEEM_CID = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
const steemCli = new Client(['https://api.steemit.com', 'https://api.justyy.com']);
const hiveCli = new Client('https://api.hive.blog');
const SOLDIERS = ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'];

const log = (m) => console.log('[' + new Date().toISOString() + '] fix59: ' + m);
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: OPERATOR });
const DRY = GATE.dry;
announceGate(GATE, log);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function evSet(section, data) {
  let ev = {};
  try { ev = JSON.parse(fs.readFileSync(EV_PATH, 'utf8')); } catch (_) { /* first */ }
  ev[section] = Object.assign({}, ev[section], data);
  ev.updatedAt = new Date().toISOString();
  fs.writeFileSync(EV_PATH, JSON.stringify(ev, null, 2) + '\n');
}
function readVault() {
  try { return (JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8')).accounts) || []; } catch (_) { return []; }
}
async function getAccounts(cli, names) { return (await cli.call('condenser_api', 'get_accounts', [names])) || []; }
async function signSteem(wif, operations) {
  const dgp = await steemCli.call('condenser_api', 'get_dynamic_global_properties', []);
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations, extensions: [],
  };
  return cryptoUtils.signTransaction(tx, [PrivateKey.fromString(wif)], STEEM_CID);
}
async function steemOp(wif, operations, tag) {
  const signed = await signSteem(wif, operations);
  const txid = await (async () => {
    await steemCli.call('condenser_api', 'broadcast_transaction', [signed]);
    return cryptoUtils.generateTrxId ? cryptoUtils.generateTrxId(signed) : 'broadcast-ok';
  })();
  log(tag + ' BROADCAST txid=' + String(txid).slice(0, 16) + '…');
  await sleep(4000);
  return { txid: String(txid) };
}

/* R1 — ynet fuel: restore 80,824 then gift +3,000 → 83,824 */
async function fixYnetFuel() {
  log('── R1. ynet fuel: restore 80,824 (delegation is absolute!) then gift +3,000');
  const before = (await getAccounts(steemCli, ['ynet']))[0];
  log('ynet received_vesting before: ' + before.received_vesting_shares);
  const r1 = await steemOp(ACTIVE_WIF, [['delegate_vesting_shares', {
    delegator: OPERATOR, delegatee: 'ynet', vesting_shares: '80824.000000 VESTS',
  }]], 'restore(ynet ← 80824 VESTS)');
  const mid = (await getAccounts(steemCli, ['ynet']))[0];
  log('ynet after restore: ' + mid.received_vesting_shares + (parseFloat(mid.received_vesting_shares) >= 80824 ? ' ✓' : ' ⚠'));
  const r2 = await steemOp(ACTIVE_WIF, [['delegate_vesting_shares', {
    delegator: OPERATOR, delegatee: 'ynet', vesting_shares: '83824.000000 VESTS',
  }]], 'gift(ynet → 83824 VESTS = restore+3000)');
  await sleep(2000);
  const after = (await getAccounts(steemCli, ['ynet']))[0];
  const ok = parseFloat(after.received_vesting_shares) >= 83823;
  log('ynet FINAL: ' + after.received_vesting_shares + (ok ? ' ✓ (80824 restored + 3000 gift)' : ' ⚠'));
  evSet('energyShare', {
    incident: 'first delegation (3000) was absolute and replaced the 80824 fuel — same Task-58 lesson, caught by our own verify step within seconds',
    restoreTxid: r1.txid, giftTxid: r2.txid,
    final: after.received_vesting_shares, restored: ok,
    delegatee: 'ynet', chain: 'steem',
  });
}

/* R2 — fleet recovery via change_recovery_account (owner-signed per soldier) */
async function fleetRecoveryReal() {
  log('── R2. fleet recovery via change_recovery_account (owner-signed per soldier)');
  const vault = readVault();
  const results = [];
  for (const soldier of SOLDIERS) {
    try {
      const entry = vault.find((a) => a.username === soldier);
      const ownerWif = entry && entry.keys && entry.keys.owner && entry.keys.owner.wif;
      const acc = (await getAccounts(steemCli, [soldier]))[0];
      if (!acc) { results.push({ soldier, error: 'not found' }); continue; }
      if (acc.recovery_account === OPERATOR) { results.push({ soldier, status: 'already-hardened' }); continue; }
      if (!ownerWif) { results.push({ soldier, error: 'no owner key in vault' }); continue; }
      const r = await steemOp(ownerWif, [['change_recovery_account', {
        account_to_recover: soldier, new_recovery_account: OPERATOR, extensions: [],
      }]], 'recovery2[' + soldier + ']');
      results.push({ soldier, txid: r.txid, requested: OPERATOR, note: 'takes effect after 30-day delay (protocol)' });
      await sleep(400);
    } catch (e) {
      log('recovery2[' + soldier + '] FAILED: ' + String((e && e.message) || e).slice(0, 140));
      results.push({ soldier, error: String((e && e.message) || e).slice(0, 200) });
    }
  }
  evSet('fleetRecovery', {
    op: 'change_recovery_account',
    wallFound: 'set_reset_account is DISABLED on Steem mainnet (measured live — "Set Reset Account Operation is currently disabled")',
    results,
  });
}

/* R3 — market round-trip with legal expiration */
async function marketFix() {
  log('── R3. market round-trip (expiration +27d backstop)');
  try {
    const median = await steemCli.call('condenser_api', 'get_current_median_history_price', []);
    const base = parseFloat(median.base) / parseFloat(median.quote);
    const askPrice = Math.max(base * 5, 5);
    const orderId = (Date.now() + 7) % 2147483647;
    const minSbd = (askPrice * 0.001).toFixed(3);
    const dgp = await steemCli.call('condenser_api', 'get_dynamic_global_properties', []);
    const expiry = new Date(new Date(dgp.time + 'Z').getTime() + 27 * 86400 * 1000).toISOString().slice(0, 19);
    const r1 = await steemOp(ACTIVE_WIF, [['limit_order_create', {
      owner: OPERATOR, orderid: orderId, amount_to_sell: '0.001 STEEM',
      min_to_receive: minSbd + ' SBD', fill_or_kill: false, expiration: expiry,
    }]], 'market-create2(orderid=' + orderId + ' @ ' + askPrice.toFixed(1) + '× market)');
    let orders = await steemCli.call('condenser_api', 'get_open_orders', [OPERATOR]);
    const seen = (orders || []).some((o) => o.orderid === orderId);
    log('market VERIFY: order on book → ' + seen + ' (open=' + (orders || []).length + ')');
    let cancelTxid = null, gone = false;
    if (seen) {
      const r2 = await steemOp(ACTIVE_WIF, [['limit_order_cancel', { owner: OPERATOR, orderid: orderId }]], 'market-cancel2(' + orderId + ')');
      cancelTxid = r2.txid;
      await sleep(3000);
      orders = await steemCli.call('condenser_api', 'get_open_orders', [OPERATOR]);
      gone = !(orders || []).some((o) => o.orderid === orderId);
      log('market VERIFY: gone after cancel → ' + gone);
    }
    evSet('market', { medianPrice: base, askPrice, orderId, expiry, createTxid: r1.txid, orderSeen: seen, cancelTxid, orderGone: gone, roundTrip: seen && gone });
  } catch (e) {
    log('market2 FAILED: ' + String((e && e.message) || e).slice(0, 160));
    evSet('market', { error: String((e && e.message) || e).slice(0, 240) });
  }
}

/* R4 — witness votes with ACTIVE authority (both chains) */
async function witnessFix() {
  log('── R4. witness votes (ACTIVE-signed)');
  const targets = ['justyy', 'boylikegirl'];
  const steemRes = [];
  try {
    const cur = await steemCli.call('condenser_api', 'get_witness_by_account', [OPERATOR]);
    const voted = cur ? cur.witnesses_voted_for || [] : [];
    for (const w of targets) {
      if (voted.includes(w)) { steemRes.push({ witness: w, status: 'already' }); continue; }
      const r = await steemOp(ACTIVE_WIF, [['account_witness_vote', { account: OPERATOR, witness: w, approve: true }]], 'witness-vote2[steem:' + w + ']');
      const fresh = await steemCli.call('condenser_api', 'get_witness_by_account', [OPERATOR]);
      steemRes.push({ witness: w, txid: r.txid, verified: fresh ? (fresh.witnesses_voted_for || []).includes(w) : null });
    }
    evSet('witnessSteem', { results: steemRes, authority: 'active' });
  } catch (e) {
    log('witness2[steem] FAILED: ' + String((e && e.message) || e).slice(0, 160));
    evSet('witnessSteem', { error: String((e && e.message) || e).slice(0, 240), results: steemRes });
  }
  try {
    await hiveCli.broadcast.sendOperations(
      [['account_witness_vote', { account: OPERATOR, witness: 'justyy', approve: true }]],
      PrivateKey.fromString(ACTIVE_WIF),
    );
    log('witness-vote2[hive:justyy] BROADCAST ✓');
    evSet('witnessHive', { status: 'broadcast-ok', witness: 'justyy', authority: 'active' });
  } catch (e) {
    log('witness2[hive] FAILED (honest): ' + String((e && e.message) || e).slice(0, 160));
    evSet('witnessHive', { error: String((e && e.message) || e).slice(0, 240) });
  }
}

/* R5 — convert in the REAL direction: SBD→STEEM */
async function convertFix() {
  log('── R5. convert SBD→STEEM (the actual CET direction on Steem)');
  try {
    const hc = (await getAccounts(steemCli, [OPERATOR]))[0];
    const sbd = parseFloat(hc.sbd_balance);
    log('SBD balance: ' + hc.sbd_balance);
    if (sbd < 0.001) {
      log('no SBD to convert — protocol knowledge recorded (Steem CET = SBD→STEEM only)');
      evSet('convert', { knowledge: 'Steem convert op is SBD→STEEM only ("Can only convert SBD to STEEM") — the STEEM→SBD direction does not exist on the protocol level; STEEM→SBD liquidity goes through the internal market (proven separately in R3)', sbdBalance: hc.sbd_balance, executed: false });
      return;
    }
    const reqId = (Date.now() + 13) % 2147483647;
    const r = await steemOp(ACTIVE_WIF, [['convert', { owner: OPERATOR, requestid: reqId, amount: '0.001 SBD' }]], 'convert(requestid=' + reqId + ', 0.001 SBD→STEEM)');
    await sleep(2000);
    const reqs = await steemCli.call('condenser_api', 'get_conversion_requests', [OPERATOR]);
    const ours = (reqs || []).filter((x) => String(x.requestid) === String(reqId));
    log('convert VERIFY: open requests=' + (reqs || []).length + (ours.length ? ' (ours ✓)' : ''));
    evSet('convert', { requestid: reqId, amount: '0.001 SBD', openRequests: (reqs || []).length, oursFound: ours.length > 0, txid: r.txid, settlement: '3.5d', executed: true });
  } catch (e) {
    log('convert2 FAILED: ' + String((e && e.message) || e).slice(0, 160));
    evSet('convert', { error: String((e && e.message) || e).slice(0, 240) });
  }
}

(async () => {
  log('fix59 — corrective batch · operator @' + OPERATOR);
  if (DRY) { log('[DRY] LIVE-GATE — corrective batch requires the live gate — nothing broadcast'); return; }
  await fixYnetFuel();
  await fleetRecoveryReal();
  await marketFix();
  await witnessFix();
  await convertFix();
  log('fix59 complete');
})().catch((e) => { log('FATAL: ' + String((e && e.message) || e)); process.exit(1); });
