#!/usr/bin/env node
/**
 * he_powerup.cjs — Hive-side capability build: transfer_to_vesting (power up)
 * our liquid HIVE into HP so the bridge/worldlog/Hive-ops stop starving on RC.
 * Transport copied 1:1 from he_sell.cjs (proven signing on this stack).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(__dirname);

const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const AMOUNT_RAW = process.argv.find((a) => a.startsWith('--amount')) ? process.argv[process.argv.indexOf('--amount') + 1] : '1.400';
// Task 27: --amount ALL → power up the whole liquid balance (owner directive:
// "obtain HIVE and close the resource corner" — the 9.682 HIVE must not sit).

function log(msg) { console.log('[' + new Date().toISOString() + '] powerup: ' + msg); }

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) {
            reject(new Error('bad rpc response: ' + data.slice(0, 120)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout 20s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  if (!ACTIVE_WIF) return log('no ACTIVE_WIF');

  // ── authority pre-verification (Task 27): derive → compare live chain —
  //    abort BEFORE any broadcast on mismatch (names/pubkeys only, never WIFs)
  const derivedPub = steem.auth.wifToPublic(ACTIVE_WIF);
  const accPre = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 10 });
  const chainActive = accPre[0].active.key_auths[0][0];
  if (derivedPub !== chainActive) {
    log('REFUSED: authority-mismatch — envelope ACTIVE_WIF derives ' + derivedPub.slice(0, 11) + '… but ' + ACCOUNT + ' HIVE active authority is ' + chainActive.slice(0, 11) + '… (nothing broadcast)');
    process.exit(2);
  }
  log('authority ✓ envelope ACTIVE_WIF matches on-chain active authority for ' + ACCOUNT);

  // ── RC feasibility: one op costs ~124M RC (measured 2026-09-08); wait honestly
  let AMOUNT = AMOUNT_RAW;
  if (String(AMOUNT).toUpperCase() === 'ALL') {
    const liquid = parseFloat(String(accPre[0].balance || '0').split(' ')[0]) || 0;
    AMOUNT = (Math.floor(liquid * 1000) / 1000).toFixed(3);
    log('ALL → ' + AMOUNT + ' HIVE (full liquid balance)');
  }
  const rcPre = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [ACCOUNT] }, id: 11 });
  const rcA = rcPre.rc_accounts[0];
  const rcMaxN = Number(rcA.max_rc) || 0;
  const stored = Number(rcA.rc_manabar.current_mana) || 0;
  const regen = Math.floor(((Math.floor(Date.now() / 1000) - Number(rcA.rc_manabar.last_update_time)) * rcMaxN) / (5 * 86400));
  const manaNow = Math.min(rcMaxN, stored + regen);
  const OP_COST = 1.5e8; // ≈ one broadcast (measured ~124M custom_json; financial ops similar)
  if (manaNow < OP_COST) {
    const etaMin = Math.ceil(((OP_COST - manaNow) * 5 * 86400) / (Number(rcA.max_rc) || 1) / 60);
    log('REFUSED: RC ' + manaNow + ' < ' + OP_COST + ' (one op) — שחזור ≈' + etaMin + ' דק. Re-run then. (nothing broadcast)');
    process.exit(3);
  }
  log('RC feasibility ✓ ' + manaNow + ' ≥ ' + OP_COST);

  const op = ['transfer_to_vesting', { from: ACCOUNT, to: ACCOUNT, amount: AMOUNT + ' HIVE' }];
  const dgp = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 2 });
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [op],
    extensions: [],
  };
  const prevChainId = steem.config.get('chain_id');
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try {
    signed = steem.auth.signTransaction(tx, [ACTIVE_WIF]);
  } finally {
    steem.config.set('chain_id', prevChainId);
  }
  await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 3 });
  log('broadcast ✓ — power up ' + AMOUNT + ' HIVE → HP · txid ' + (signed.transaction_id || 'n/a'));

  await new Promise((r) => setTimeout(r, 6000));
  const acc = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 4 });
  const rc = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [ACCOUNT] }, id: 5 });
  const a = acc[0];
  log('after: balance=' + a.balance + ' · vesting_shares=' + a.vesting_shares + ' · RC mana=' + rc.rc_accounts[0].rc_manabar.current_mana + '/' + rc.rc_accounts[0].max_rc);
  fs.writeFileSync(path.join(__dirname, 'he_powerup_result.json'), JSON.stringify({
    at: new Date().toISOString(), amount: AMOUNT + ' HIVE', txid: signed.transaction_id || null,
    vesting: a.vesting_shares, rcMana: rc.rc_accounts[0].rc_manabar.current_mana, rcMax: rc.rc_accounts[0].max_rc,
  }, null, 2) + '\n');
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
