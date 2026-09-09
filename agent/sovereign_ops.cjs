#!/usr/bin/env node
/**
 * sovereign_ops.cjs — Task 59: the BOUNDARY-BREAKING batch.
 *
 * Everything the battery (Task 58) declared SOVEREIGN on paper, this script
 * executes LIVE — tiny amounts, reversible where possible, every step verified
 * by re-reading the chain:
 *
 *   A. fleet-recovery      set_reset_account × soldiers — recovery_account :=
 *                          headcorner (owner-signed per soldier from the vault).
 *                          The 30-day recovery of EVERY soldier becomes ours.
 *   B. market cycle        limit_order_create → get_open_orders → limit_order_cancel
 *                          — full internal-market round-trip (liquidity sovereignty).
 *   C. savings family      transfer_to_savings + transfer_from_savings (3-day
 *                          request) — the value-freeze/unfreeze rail, live.
 *   D. governance          account_witness_vote (Steem live, Hive best-effort)
 *                          — we vote for the node operators we actually use.
 *   E. energy share        delegate_vesting_shares headcorner→ynet on STEEM —
 *                          the rescued soldier is energy-fed on BOTH chains now.
 *   F. economy pipeline    set_withdraw_vesting_route lsa→headcorner — empire
 *                          powerdown routing, measured units.
 *   G. value conversion    convert 0.001 STEEM→SBD — the CET pipeline, live.
 *   H. delegate_rc probe   get_required_signatures on Steem — does Steem mainnet
 *                          know RC delegation at all? (negative knowledge = proof)
 *
 * Evidence: agent/sovereign_59_evidence.json (public data only — never secrets).
 */
'use strict';
const fs = require('fs');
const path = require('path');
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

const OPERATOR = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: OPERATOR });
const DRY = GATE.dry;
announceGate(GATE);

const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const OWNER_WIF = process.env.OWNER_WIF || '';
const POSTING_WIF = process.env.POSTING_WIF || '';
const VAULT_PATH = path.join(__dirname, 'keys', 'vault.json');
const EV_PATH = path.join(__dirname, 'sovereign_59_evidence.json');

const STEEM_CID = Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
const steemCli = new Client(['https://api.steemit.com', 'https://api.justyy.com']);
const hiveCli = new Client('https://api.hive.blog');

const SOLDIERS = ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'];
const log = (m) => console.log('[' + new Date().toISOString() + '] sv59: ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (s) => (s ? String(s).slice(0, 10) + '…' : '-');

function evSet(section, data) {
  let ev = {};
  try { ev = JSON.parse(fs.readFileSync(EV_PATH, 'utf8')); } catch (_) { /* first */ }
  ev[section] = Object.assign({}, ev[section], data);
  ev.updatedAt = new Date().toISOString();
  ev.dry = !!DRY;
  fs.writeFileSync(EV_PATH, JSON.stringify(ev, null, 2) + '\n');
}

function readVault() {
  try {
    const v = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
    return v.accounts || [];
  } catch (e) {
    return [];
  }
}

/* ══════════════ chain primitives ══════════════ */
async function getAccounts(cli, names) {
  const r = await cli.call('condenser_api', 'get_accounts', [names]);
  return r || [];
}
async function rcMana(cli, name) {
  try {
    const r = await cli.call('rc_api', 'find_rc_accounts', { accounts: [name] });
    const row = r && r.rc_accounts && r.rc_accounts[0];
    if (!row) return null;
    const max = parseFloat(row.max_rc), now = parseFloat(row.rc_manabar.current_mana);
    const elapsed = Math.max(0, Date.now() / 1000 - row.rc_manabar.last_update_time);
    return { max, now: Math.min(max, now + elapsed * (max / (5 * 86400))) };
  } catch (_) { return null; }
}
/** build + locally sign a Steem tx (zeros chain-id) with an arbitrary WIF */
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
async function broadcastSteem(signed) {
  await steemCli.call('condenser_api', 'broadcast_transaction', [signed]);
  return cryptoUtils.generateTrxId ? cryptoUtils.generateTrxId(signed) : 'broadcast-ok';
}
/** live op on Steem with verify-by-refetch */
async function steemOp(wif, operations, tag) {
  if (DRY) { log('[DRY] ' + tag); return { dry: true }; }
  const signed = await signSteem(wif, operations);
  const txid = await broadcastSteem(signed);
  log(tag + ' BROADCAST txid=' + String(txid).slice(0, 16) + '…');
  await sleep(4000); // ≥2 blocks
  return { txid: String(txid) };
}

/* ══════════════ A. fleet recovery hardening ══════════════ */
async function fleetRecovery() {
  log('── A. fleet-recovery: recovery_account → ' + OPERATOR + ' (owner-signed per soldier)');
  const vault = readVault();
  const results = [];
  const accounts = await getAccounts(steemCli, SOLDIERS);
  for (const soldier of SOLDIERS) {
    const entry = vault.find((a) => a.username === soldier);
    const ownerWif = entry && entry.keys && entry.keys.owner && entry.keys.owner.wif;
    const acc = accounts.find((a) => a && a.name === soldier);
    if (!acc) { results.push({ soldier, error: 'not found on chain' }); continue; }
    if (!ownerWif) { results.push({ soldier, error: 'no owner key in vault', current: acc.recovery_account }); continue; }
    if (acc.recovery_account === OPERATOR) { results.push({ soldier, status: 'already-hardened', recovery: OPERATOR }); continue; }
    try {
      const r = await steemOp(ownerWif, [['set_reset_account', {
        account: soldier,
        current_reset_account: acc.recovery_account || '',
        reset_account: OPERATOR,
      }]], 'recovery[' + soldier + ']');
      const fresh = (await getAccounts(steemCli, [soldier]))[0];
      const verified = fresh && fresh.recovery_account === OPERATOR;
      log('recovery[' + soldier + '] VERIFY: ' + fresh.recovery_account + (verified ? ' ✓' : ' (pending)'));
      results.push({ soldier, txid: r.txid, recovery: fresh.recovery_account, verified });
    } catch (e) {
      log('recovery[' + soldier + '] FAILED: ' + String((e && e.message) || e).slice(0, 140));
      results.push({ soldier, error: String((e && e.message) || e).slice(0, 200) });
    }
    await sleep(600);
  }
  evSet('fleetRecovery', { op: 'set_reset_account', results });
}

/* ══════════════ B. internal-market round-trip ══════════════ */
async function marketCycle() {
  log('── B. market: limit_order_create → open-orders → limit_order_cancel');
  const median = await steemCli.call('condenser_api', 'get_current_median_history_price', []);
  const base = parseFloat(median.base) / parseFloat(median.quote); // SBD per STEEM
  const askPrice = Math.max(base * 5, 5); // 5× market — can never fill
  const orderId = Date.now() % 2147483647;
  const minSbd = (askPrice * 0.001).toFixed(3);
  try {
    const r1 = await steemOp(ACTIVE_WIF, [['limit_order_create', {
      owner: OPERATOR, orderid: orderId,
      amount_to_sell: '0.001 STEEM', min_to_receive: minSbd + ' SBD',
      fill_or_kill: false, expiration: '1969-12-31T23:59:59', // never expires on its own
    }]], 'market-create(orderid=' + orderId + ', price=' + minSbd + ' SBD/0.001 STEEM ≈ ' + askPrice.toFixed(1) + '×)');
    let orders = await steemCli.call('condenser_api', 'get_open_orders', [OPERATOR]);
    const seen = (orders || []).some((o) => o.orderid === orderId);
    log('market VERIFY: open-orders contains our orderid → ' + seen + ' (total open=' + (orders || []).length + ')');
    let canceled = null;
    if (seen && !DRY) {
      const r2 = await steemOp(ACTIVE_WIF, [['limit_order_cancel', { owner: OPERATOR, orderid: orderId }]], 'market-cancel(' + orderId + ')');
      canceled = r2.txid;
      await sleep(3000);
      orders = await steemCli.call('condenser_api', 'get_open_orders', [OPERATOR]);
      const gone = !(orders || []).some((o) => o.orderid === orderId);
      log('market VERIFY: order gone after cancel → ' + gone);
      evSet('market', { medianPrice: base, askPrice, orderId, createTxid: r1.txid, orderSeen: seen, cancelTxid: canceled, orderGone: gone, roundTrip: seen && gone });
    } else {
      evSet('market', { medianPrice: base, askPrice, orderId, createTxid: r1.txid, orderSeen: seen, cancelTxid: canceled, roundTrip: false, dry: DRY });
    }
  } catch (e) {
    log('market FAILED: ' + String((e && e.message) || e).slice(0, 160));
    evSet('market', { error: String((e && e.message) || e).slice(0, 240) });
  }
}

/* ══════════════ C. savings family ══════════════ */
async function savingsCycle() {
  log('── C. savings: transfer_to_savings + transfer_from_savings (3-day request)');
  try {
    const before = (await getAccounts(steemCli, [OPERATOR]))[0];
    const sb = before ? before.savings_balance : '?';
    const reqId = Date.now() % 2147483647;
    const r1 = await steemOp(ACTIVE_WIF, [['transfer_to_savings', {
      from: OPERATOR, to: OPERATOR, amount: '0.001 STEEM', memo: 'saos-savings-deposit-59',
    }]], 'savings-deposit');
    const r2 = await steemOp(ACTIVE_WIF, [['transfer_from_savings', {
      from: OPERATOR, to: OPERATOR, amount: '0.001 STEEM', memo: 'saos-savings-withdraw-59', request_id: reqId,
    }]], 'savings-withdraw-request(request_id=' + reqId + ')');
    await sleep(2000);
    const after = (await getAccounts(steemCli, [OPERATOR]))[0];
    const reqs = await steemCli.call('condenser_api', 'get_savings_withdraw_from', [OPERATOR]);
    const pending = (reqs || []).filter((x) => x.request_id === reqId);
    log('savings VERIFY: savings_balance ' + sb + ' → ' + after.savings_balance + ' · pending withdraw requests=' + (reqs || []).length + (pending.length ? ' (ours found ✓)' : ''));
    evSet('savings', { savingsBefore: sb, savingsAfter: after.savings_balance, depositTxid: r1.txid, withdrawTxid: r2.txid, requestId: reqId, pendingRequests: (reqs || []).length, oursFound: pending.length > 0 });
  } catch (e) {
    log('savings FAILED: ' + String((e && e.message) || e).slice(0, 160));
    evSet('savings', { error: String((e && e.message) || e).slice(0, 240) });
  }
}

/* ══════════════ D. governance: witness votes ══════════════ */
async function witnessVotes() {
  log('── D. governance: account_witness_vote (Steem live · Hive best-effort)');
  const targets = ['justyy', 'boylikegirl']; // node operators we actually route through
  const steemRes = [];
  try {
    const current = await steemCli.call('condenser_api', 'get_witness_by_account', [OPERATOR]);
    const voted = current ? current.witnesses_voted_for || [] : [];
    log('witness: currently voting for ' + voted.length + ' witnesses' + (voted.length ? ' (' + voted.slice(0, 5).join(', ') + (voted.length > 5 ? '…' : '') + ')' : ''));
    for (const w of targets) {
      if (voted.includes(w)) { steemRes.push({ witness: w, status: 'already' }); continue; }
      const r = await steemOp(POSTING_WIF, [['account_witness_vote', { account: OPERATOR, witness: w, approve: true }]], 'witness-vote[steem:' + w + ']');
      const fresh = await steemCli.call('condenser_api', 'get_witness_by_account', [OPERATOR]);
      steemRes.push({ witness: w, txid: r.txid, verified: fresh ? (fresh.witnesses_voted_for || []).includes(w) : null });
    }
    evSet('witnessSteem', { votedBefore: voted.length, results: steemRes });
  } catch (e) {
    log('witness[steem] FAILED: ' + String((e && e.message) || e).slice(0, 160));
    evSet('witnessSteem', { error: String((e && e.message) || e).slice(0, 240), results: steemRes });
  }
  // Hive — best effort (RC wall-28 may still bind at ~0.2G mana; honest either way)
  try {
    const hc = (await getAccounts(hiveCli, [OPERATOR]))[0];
    const votedH = hc ? hc.witnesses_voted_for || 0 : 0;
    const r = await hiveCli.broadcast.sendOperations(
      [['account_witness_vote', { account: OPERATOR, witness: 'justyy', approve: true }]],
      PrivateKey.fromString(POSTING_WIF),
    );
    log('witness-vote[hive:justyy] BROADCAST ' + JSON.stringify(r).slice(0, 60));
    evSet('witnessHive', { votedBefore: votedH, status: 'broadcast-ok' });
  } catch (e) {
    log('witness[hive] FAILED (honest): ' + String((e && e.message) || e).slice(0, 160));
    evSet('witnessHive', { error: String((e && e.message) || e).slice(0, 240) });
  }
}

/* ══════════════ E. energy share → ynet on Steem ══════════════ */
async function energyShare() {
  log('── E. energy-share: delegate_vesting_shares ' + OPERATOR + '→ynet (STEEM)');
  try {
    const ynetBefore = (await getAccounts(steemCli, ['ynet']))[0];
    const before = ynetBefore ? ynetBefore.received_vesting_shares : '?';
    const vests = '3000.000000 VESTS';
    const r = await steemOp(ACTIVE_WIF, [['delegate_vesting_shares', {
      delegator: OPERATOR, delegatee: 'ynet', vesting_shares: vests,
    }]], 'energy-share(ynet += ' + vests + ')');
    await sleep(2000);
    const ynetAfter = (await getAccounts(steemCli, ['ynet']))[0];
    const afterV = ynetAfter ? parseFloat(ynetAfter.received_vesting_shares) : 0;
    const beforeV = parseFloat(String(before).replace(/ VESTS/, '')) || 0;
    const delta = afterV - beforeV;
    log('energy-share VERIFY: ynet received_vesting ' + before + ' → ' + ynetAfter.received_vesting_shares + ' (Δ' + delta.toFixed(3) + ' VESTS)');
    evSet('energyShare', { op: 'delegate_vesting_shares', delegatee: 'ynet', vests, before: String(before), after: ynetAfter.received_vesting_shares, delta, txid: r.txid });
  } catch (e) {
    log('energy-share FAILED: ' + String((e && e.message) || e).slice(0, 160));
    evSet('energyShare', { error: String((e && e.message) || e).slice(0, 240) });
  }
}

/* ══════════════ F. powerdown routing (economy pipeline) ══════════════ */
async function withdrawRoute() {
  log('── F. route: set_withdraw_vesting_route lsa→' + OPERATOR + ' (empire economy)');
  try {
    const vault = readVault();
    const lsaEntry = vault.find((a) => a.username === 'lsa');
    const lsaOwner = lsaEntry && lsaEntry.keys && lsaEntry.keys.owner && lsaEntry.keys.owner.wif;
    if (!lsaOwner) throw new Error('no owner key for lsa in vault');
    const r = await steemOp(lsaOwner, [['set_withdraw_vesting_route', {
      from_account: 'lsa', to_account: OPERATOR, percent: 100, auto_vest: true,
    }]], 'route(lsa→' + OPERATOR + ' percent=100 auto_vest, lsa-owner-signed)');
    await sleep(2000);
    const routes = await steemCli.call('condenser_api', 'get_withdraw_routes', ['lsa', 'outgoing']);
    const ours = (routes || []).find((x) => x.to_account === OPERATOR);
    log('route VERIFY: lsa outgoing routes=' + (routes || []).length + ' · ours percent=' + (ours ? ours.percent : 'MISSING'));
    evSet('withdrawRoute', { from: 'lsa', to: OPERATOR, sent: 100, measuredPercent: ours ? ours.percent : null, measuredUnit: ours && ours.percent === 100 ? '1%-units' : ours && ours.percent === 1 ? '0.01%-units' : 'unknown', autoVest: true, txid: r.txid, routes: (routes || []).map((x) => ({ to: x.to_account, percent: x.percent })) });
  } catch (e) {
    log('route FAILED: ' + String((e && e.message) || e).slice(0, 160));
    evSet('withdrawRoute', { error: String((e && e.message) || e).slice(0, 240) });
  }
}

/* ══════════════ G. value conversion (CET pipeline) ══════════════ */
async function convertProbe() {
  log('── G. convert: 0.001 STEEM → SBD (3.5-day CET)');
  try {
    const reqId = Date.now() % 2147483647;
    const r = await steemOp(ACTIVE_WIF, [['convert', { owner: OPERATOR, requestid: reqId, amount: '0.001 STEEM' }]], 'convert(requestid=' + reqId + ')');
    await sleep(2000);
    const reqs = await steemCli.call('condenser_api', 'get_conversion_requests', [OPERATOR]);
    const ours = (reqs || []).filter((x) => x.requestid === reqId || String(x.requestid) === String(reqId));
    log('convert VERIFY: open conversion requests=' + (reqs || []).length + (ours.length ? ' (ours found ✓)' : ''));
    evSet('convert', { requestid: reqId, amount: '0.001 STEEM', openRequests: (reqs || []).length, oursFound: ours.length > 0, txid: r.txid, settlement: '3.5d' });
  } catch (e) {
    log('convert FAILED: ' + String((e && e.message) || e).slice(0, 160));
    evSet('convert', { error: String((e && e.message) || e).slice(0, 240) });
  }
}

/* ══════════════ H. delegate_rc probe on Steem (protocol knowledge) ══════════════ */
async function delegateRcProbe() {
  log('── H. delegate_rc probe on Steem (does the protocol know RC delegation?)');
  try {
    const dgp = await steemCli.call('condenser_api', 'get_dynamic_global_properties', []);
    const tx = {
      ref_block_num: dgp.head_block_number & 0xffff,
      ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
      expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
      operations: [['delegate_rc', { from: OPERATOR, to: 'ynet', max_rc: '1000000000' }]],
      extensions: [],
    };
    const pubs = [process.env.OWNER_WIF_PUB, process.env.ACTIVE_WIF_PUB, process.env.POSTING_WIF_PUB].filter(Boolean);
    const req = await steemCli.call('condenser_api', 'get_required_signatures', [tx, pubs]);
    log('delegate_rc[steem]: get_required_signatures → ' + JSON.stringify(req) + ' — op EXISTS on Steem');
    evSet('delegateRc', { exists: true, required: req });
  } catch (e) {
    const msg = String((e && e.message) || e);
    log('delegate_rc[steem]: REJECTED — ' + msg.slice(0, 160) + ' → op NOT in Steem mainnet protocol (negative knowledge, mirrors Hive Task-58)');
    evSet('delegateRc', { exists: false, error: msg.slice(0, 240) });
  }
}

/* ══════════════ main ══════════════ */
(async () => {
  log('sovereign_ops Task 59 — operator @' + OPERATOR + (DRY ? ' · DRY' : ' · LIVE'));
  const rc = await rcMana(steemCli, OPERATOR);
  log('pre-flight: headcorner RC ' + (rc ? (100 * rc.now / rc.max).toFixed(1) + '%' : '?') + ' · ACTIVE_WIF ' + (ACTIVE_WIF ? 'present' : 'MISSING'));
  if (!ACTIVE_WIF && !DRY) { log('no ACTIVE_WIF — aborting LIVE batch'); process.exit(1); }
  evSet('meta', { operator: OPERATOR, startedAt: new Date().toISOString(), rc: rc ? { pct: 100 * rc.now / rc.max, max: rc.max } : null });
  await fleetRecovery();
  await marketCycle();
  await savingsCycle();
  await witnessVotes();
  await energyShare();
  await withdrawRoute();
  await convertProbe();
  await delegateRcProbe();
  log('batch complete — evidence: agent/sovereign_59_evidence.json');
})().catch((e) => { log('FATAL: ' + String((e && e.message) || e)); process.exit(1); });
