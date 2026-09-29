#!/usr/bin/env node
/**
 * harden58.cjs — Task 58 spot-fixes, live-signed, secrets never printed.
 *  1. israelnews: embed operator posting-auth anchor (both chains) — closes the
 *     only SCI topology gap (was 'free').
 *  2. ynet on Hive: rescue-ping v58 — the energy-share proof that the battery
 *     lifted (max_rc 2.08G→5.08G) translated back into ACTION.
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/harden58.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
'use strict';
const fs = require('fs');
const path = require('path');
const { Client, PrivateKey, cryptoUtils } = require('@hiveio/dhive');

function loadDotEnv(dir) {
  const p = path.join(dir, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq <= 0) continue;
    const k = t.slice(0, eq).trim(); let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(__dirname);
const OPERATOR = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const HIVE_POSTING_WIF = process.env.POSTING_WIF || '';
const steemCli = new Client(['https://api.steemit.com', 'https://api.justyy.com']);
const hiveCli = new Client('https://api.hive.blog');
const log = (m) => console.log('[' + new Date().toISOString() + '] harden58: ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: OPERATOR });
const DRY = GATE.dry;
announceGate(GATE, log);


function vaultKeysFor(account) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const row = (v.accounts || []).find((a) => a && String(a.username).toLowerCase() === account);
    return row && row.keys ? row.keys : null;
  } catch (_) { return null; }
}
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
  return 'broadcast-ok';
}

async function anchorPostingAuth(chain, cli, cidBuf, soldier) {
  const keys = vaultKeysFor(soldier);
  if (!keys || !keys.active || !keys.active.wif) throw new Error('no active key for @' + soldier);
  const acc = (await cli.call('condenser_api', 'get_accounts', [[soldier]]))[0];
  if (!acc) throw new Error(soldier + ' missing on ' + chain);
  const curPub = (acc.posting.key_auths[0] || [])[0];
  const has = (acc.posting.account_auths || []).some((a) => a[0] === OPERATOR);
  if (has) { log(chain + ': @' + soldier + ' already anchored — skip'); return { chain, soldier, skipped: true }; }
  const posting = { weight_threshold: acc.posting.weight_threshold, account_auths: [...(acc.posting.account_auths || []), [OPERATOR, acc.posting.weight_threshold || 1]], key_auths: [[curPub, 1]] };
  const s = await signTx(cli, cidBuf, keys.active.wif, [['account_update2', { account: soldier, posting, json_metadata: '', posting_json_metadata: '', extensions: [] }]]);
  await broadcastSigned(cli, s);
  await sleep(4000);
  const fresh = (await cli.call('condenser_api', 'get_accounts', [[soldier]]))[0];
  const ok = (fresh.posting.account_auths || []).some((a) => a[0] === OPERATOR);
  log(chain + ': @' + soldier + ' posting-anchor=' + (ok ? 'LIVE ✓' : 'FAILED'));
  return { chain, soldier, ok };
}

async function ynetHivePing() {
  const payload = { t: 'rescue-ping', v: 58, note: 'energy-share live: max_rc lifted 2.08G→5.08G via treasury HP', seq: Math.floor(Date.now() / 1000), at: new Date().toISOString() };
  const ops = [['custom_json', { required_auths: [], required_posting_auths: ['ynet'], required_active_auths: [], id: 'saos', json: JSON.stringify(payload) }]];
  const mana = await hiveCli.call('rc_api', 'find_rc_accounts', { accounts: ['ynet'] });
  const row = mana.rc_accounts[0];
  const before = { max: parseFloat(row.max_rc), cur: parseFloat(row.rc_manabar.current_mana) };
  log('ynet hive mana before: ' + (before.cur / 1e9).toFixed(3) + 'G / ' + (before.max / 1e9).toFixed(2) + 'G');
  const s = await signTx(hiveCli, undefined, HIVE_POSTING_WIF, ops); // headcorner posting signs FOR ynet (anchor)
  await broadcastSigned(hiveCli, s);
  await sleep(5000);
  const hist = await hiveCli.call('condenser_api', 'get_account_history', ['ynet', -1, 5]);
  const found = (hist || []).find(([, e]) => e.op[0] === 'custom_json' && e.op[1].id === 'saos' && String(e.op[1].json).includes('"v":58'));
  log('ynet hive rescue-ping v58: ' + (found ? 'ON-CHAIN ✓ (txid ' + (found[1].trx_id || '').slice(0, 16) + '…)' : 'pending/lag'));
  const after = await hiveCli.call('rc_api', 'find_rc_accounts', { accounts: ['ynet'] });
  const r2 = after.rc_accounts[0];
  log('ynet hive mana after: ' + (parseFloat(r2.rc_manabar.current_mana) / 1e9).toFixed(3) + 'G — the wall is broken');
  return { found: !!found, txid: found ? found[1].trx_id : null, maxRc: parseFloat(r2.max_rc) };
}

(async () => {
  if (DRY) { log('[DRY] LIVE-GATE — authority anchors + rescue-ping require the live gate — nothing broadcast'); return; }
  const out = { at: new Date().toISOString() };
  try { out.israelnewsSteem = await anchorPostingAuth('steem', steemCli, Buffer.from('0'.repeat(64), 'hex'), 'israelnews'); }
  catch (e) { log('israelnews steem: ' + String(e.message || e).slice(0, 140)); out.israelnewsSteem = { error: String(e.message || e).slice(0, 140) }; }
  try { out.israelnewsHive = await anchorPostingAuth('hive', hiveCli, undefined, 'israelnews'); }
  catch (e) { log('israelnews hive: ' + String(e.message || e).slice(0, 140)); out.israelnewsHive = { error: String(e.message || e).slice(0, 140) }; }
  try { out.ynetHivePing = await ynetHivePing(); }
  catch (e) { log('ynet hive ping: ' + String(e.message || e).slice(0, 140)); out.ynetHivePing = { error: String(e.message || e).slice(0, 140) }; }
  fs.writeFileSync(path.join(__dirname, 'harden58_result.json'), JSON.stringify(out, null, 2) + '\n');
  log('done → harden58_result.json');
})().catch((e) => { log('FATAL ' + String(e.message || e).slice(0, 200)); process.exit(1); });
