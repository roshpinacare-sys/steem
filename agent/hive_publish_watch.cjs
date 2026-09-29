#!/usr/bin/env node
/** hive_publish_watch.cjs — self-waiting publisher: polls treasury Hive mana
 *  every 15 min until it can afford the full spec post, then publishes. */
'use strict';
// 8-b: חשבון-הפעולה = מפרסם-הספק (POSTING_WIF שלו מ-.env) — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/hive_publish_watch.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const { Client, PrivateKey, cryptoUtils } = require('@hiveio/dhive');
const PERMLINK = 'saos-1-protocol-spec-20260904';
const cli = new Client('https://api.deathwing.me');
const reader = new Client('https://api.hive.blog');
const log = (m) => console.log('[' + new Date().toISOString() + '] hpwatch: ' + m);
const spec = fs.readFileSync(path.join(__dirname, 'publish_spec58.cjs'), 'utf8');
const BODY = spec.match(/const BODY = `([\s\S]*?)`;/)[1];
const TITLE = 'SAOS Protocol Spec v58 — the day the swarm learned to harvest its own energy';
const META = JSON.stringify({ app: 'saos/1', format: 'markdown', tags: ['saos'], spec: 'v58' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT }); // 8-b: השער נעוץ בחשבון-הפעולה מה-env — לא בשם-קבוע
const DRY = GATE.dry;
announceGate(GATE, log);

async function mana(name) {
  const r = await cli.call('rc_api', 'find_rc_accounts', { accounts: [name] });
  const row = r.rc_accounts[0];
  const max = parseFloat(row.max_rc);
  const elapsed = Math.max(0, Date.now() / 1000 - row.rc_manabar.last_update_time);
  return Math.min(max, parseFloat(row.rc_manabar.current_mana) + elapsed * (max / (5 * 86400)));
}
(async () => {
  const WIF = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').match(/POSTING_WIF=(.+)/)[1].trim();
  for (let i = 1; i <= 40; i++) {
    const m = await mana(ACCOUNT);
    const ex = await reader.call('condenser_api', 'get_content', [ACCOUNT, PERMLINK]).catch(() => null);
    if (ex && ex.author === ACCOUNT && ex.body.length > 1000) { log('already published (' + ex.body.length + ' chars)'); return; }
    if (DRY) { log('[DRY] LIVE-GATE — mana ' + (m / 1e9).toFixed(2) + 'G — publication requires the live gate (nothing broadcast)'); return; }

    if (m < 2.5e9) { log('try ' + i + ': mana ' + (m / 1e9).toFixed(2) + 'G / needs 2.50G — sleeping 15 min'); await sleep(15 * 60 * 1000); continue; }
    const dgp = await cli.call('condenser_api', 'get_dynamic_global_properties', []);
    const tx = { ref_block_num: dgp.head_block_number & 0xffff, ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4), expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19), operations: [['comment', { parent_author: '', parent_permlink: 'saos', author: ACCOUNT, permlink: PERMLINK, title: TITLE, body: BODY, json_metadata: META }]], extensions: [] };
    const signed = cryptoUtils.signTransaction(tx, [PrivateKey.fromString(WIF)]);
    await cli.call('condenser_api', 'broadcast_transaction', [signed]);
    log('HIVE PUBLISHED ✓ (' + BODY.length + ' chars) · mana after ' + ((await mana(ACCOUNT)) / 1e9).toFixed(2) + 'G');
    return;
  }
  log('gave up after 40 rounds');
})().catch((e) => { log('FATAL ' + String(e.message || e).slice(0, 200)); process.exit(1); });
