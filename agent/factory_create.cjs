#!/usr/bin/env node
/**
 * factory_create.cjs — MINT a sovereign agent identity in ONE on-chain transaction:
 *   op1 create_claimed_account  (keys generated machine-local, never leave)
 *   op2 delegate_vesting_shares (endowment from the headcorner SP treasury)
 * Both ops signed by ACTIVE authority. Stealth-neutral name (no SAOS on the card).
 *
 * Usage: node factory_create.cjs [--dry] [--name hcnova1] [--sp 50]
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/factory_create.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const steem = require('steem');

const STEEM_RPC = 'https://api.steemit.com';
const RPCS = ['https://api.steemit.com', 'https://api.steem.fans', 'https://api.justyy.com', 'https://steem.61bts.com'];

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
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
const ACTIVE_WIF = process.env.ACTIVE_WIF || '';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry;
announceGate(GATE);

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const NAME = argOf('--name', 'hcnova1');
const SP = parseFloat(argOf('--sp', '50'));
const log = m => console.log('[' + new Date().toISOString() + '] mint: ' + m);

function rpcV4(url, body) {
  const u = new URL(url); const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 }, res => {
      let d = ''; res.on('data', c => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc error')); resolve(j.result); }
        catch (_) { reject(new Error('bad rpc: ' + d.slice(0, 120))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}
async function raceRpc(body) {
  const rs = await Promise.allSettled(RPCS.map(u => rpcV4(u, body).catch(() => null)));
  for (const r of rs) if (r.status === 'fulfilled' && r.value) return r.value;
  throw new Error('all RPCs failed');
}
function genKey(role) {
  // entropy: 48 random bytes → sha256 → WIF; keys stay in agent/keys/ (git-ignored)
  const pw = crypto.randomBytes(48).toString('hex');
  const wif = steem.auth.toWif(ACCOUNT, pw, role);
  if (!steem.auth.isWif(wif)) throw new Error('generated invalid WIF');
  return { role, wif, pub: steem.auth.wifToPublic(wif) };
}
const auth = pub => ({ weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] });

(async () => {
  if (!ACTIVE_WIF) return log('no ACTIVE_WIF — create_claimed_account requires active authority');
  if (!/^[a-z][a-z0-9-]{2,15}$/.test(NAME)) return log('bad account name');
  // 1. name availability
  const existing = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[NAME]], id: 1 });
  if (existing && existing.length) return log('name taken: ' + NAME);
  // 2. on-chain active-authority verification of our WIF
  const [me] = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 1 });
  const myActivePub = steem.auth.wifToPublic(ACTIVE_WIF);
  if (!(me.active.key_auths || []).some(k => k[0] === myActivePub)) return log('ACTIVE_WIF does not match on-chain active authority — abort');
  log('active authority verified: ' + myActivePub.slice(0, 12) + '…');
  // 3. SP→VESTS conversion from live props
  const dgp = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 2 });
  const vestsPerSp = parseFloat(dgp.total_vesting_shares) / parseFloat(dgp.total_vesting_fund_steem);
  const vests = (SP * vestsPerSp).toFixed(6) + ' VESTS';
  log('endowment: ' + SP + ' SP = ' + vests + ' (live ratio ' + Math.round(vestsPerSp) + ' VESTS/SP)');
  // 4. keys — machine-local only
  const keys = { owner: genKey('owner'), active: genKey('active'), posting: genKey('posting'), memo: genKey('memo') };
  log('keys generated locally: 4 roles · pubs ' + Object.values(keys).map(k => k.pub.slice(3, 9) + '…').join(' '));
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [
      ['create_claimed_account', {
        creator: ACCOUNT, new_account_name: NAME,
        owner: auth(keys.owner.pub), active: auth(keys.active.pub), posting: auth(keys.posting.pub),
        memo_key: keys.memo.pub, json_metadata: '',
      }],
      ['delegate_vesting_shares', { delegator: ACCOUNT, delegatee: NAME, vesting_shares: vests }],
    ],
    extensions: [],
  };
  if (DRY) { log('[DRY] would mint @' + NAME + ' with ' + vests + ' endowment in 1 tx'); return; }
  const signed = steem.auth.signTransaction(tx, [ACTIVE_WIF]);
  const res = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 3 });
  const txid = Buffer.from(steem.crypto ? [] : []).length ? '' : (signed.id || require('crypto').createHash('sha256').update(JSON.stringify(signed)).digest('hex'));
  log('MINTED ✓ txid=' + (res && res.result ? JSON.stringify(res.result).slice(0, 60) : 'broadcast-ok'));
  // 5. persist machine-local
  const keyPath = path.join(__dirname, 'keys', NAME + '.json');
  fs.writeFileSync(keyPath, JSON.stringify({ name: NAME, createdAt: new Date().toISOString(), funded: { vests, sp: SP }, keys }, null, 2));
  fs.chmodSync(keyPath, 0o600);
  log('keys persisted machine-local: ' + keyPath + ' (0600, git-ignored)');
  // 6. on-chain verification
  await new Promise(r => setTimeout(r, 4000));
  const [fresh] = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[NAME]], id: 4 });
  const [deleg] = await raceRpc({ jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[ACCOUNT]], id: 5 });
  log('VERIFY: @' + NAME + ' created=' + (fresh ? fresh.created : 'MISSING') + ' · received_vesting=' + (fresh ? fresh.received_vesting_shares : '?') + ' · delegator out=' + (deleg ? deleg.delegated_vesting_shares : '?'));
  const rc = await raceRpc({ jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [NAME] }, id: 6 });
  const rcRow = rc && rc.rc_accounts && rc.rc_accounts[0];
  if (rcRow) log('VERIFY: agent RC max=' + rcRow.max_rc + ' (' + (parseFloat(rcRow.max_rc) / 1e9).toFixed(2) + ' G) — identity is ALIVE');
})().catch(e => { log('fatal: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
