#!/usr/bin/env node
/* retc_test.cjs — Task 64: delegate_rc RETEST on Hive with the COMPLETE op payload.
 * Task 58's negative finding used { from, to, max_rc, extensions } — missing the
 * `vesting_shares` field. The real protocol struct is:
 *   delegate_rc_operation { from, to, vesting_shares, max_rc, extensions }
 * Test: delegate 1G RC headcorner → ynet (one-sided op, no consent needed),
 * sign raw (dhive can't serialize the op), broadcast synchronous → txid,
 * then re-fetch on an independent node + measure ynet max_rc delta.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { Client } = require('@hiveio/dhive');
const { wifToScalar, ecdsaSignLowS, ecdsaRecover } = require('./identity.cjs');
const SECP = require('ecurve').getCurveByName('secp256k1');

let env = {};
for (const ln of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
  const m = ln.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const HIVE_RPC = env.HIVE_RPC || 'https://api.hive.blog';
const ACTIVE_WIF = env.ACTIVE_WIF || '';
if (!ACTIVE_WIF) { console.error('no active key'); process.exit(1); }
const hiveCli = new Client([HIVE_RPC]);
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { const j = JSON.parse(data); j.error ? reject(new Error(j.error.message || 'rpc')) : resolve(j.result); } catch (_) { reject(new Error('bad:' + data.slice(0, 90))); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(payload); req.end();
  });
}
const rcMana = async (acct) => {
  for (const node of ['https://api.openhive.network', 'https://api.hive.blog']) {
    try {
      const r = await rpcV4(node, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: [acct] }, id: 1 });
      const row = (r.rc_accounts || [])[0];
      if (row) return { mana: Number(row.rc_manabar.current_mana), max: Number(row.max_rc) };
    } catch (_) {}
  }
  return null;
};

(async () => {
  const out = {};
  const before = await rcMana('ynet');
  const myRc = await rcMana('headcorner');
  out.before = { ynetMax: before && before.max, myMana: myRc && myRc.mana, myMax: myRc && myRc.max };
  console.log('before:', JSON.stringify(out.before));

  const MAX_RC = 1000000000; // 1G
  const tx = {
    ref_block_num: 0, ref_block_prefix: 0, expiration: '', operations: [
      ['delegate_rc', { from: 'headcorner', to: 'ynet', vesting_shares: '0.000000 VESTS', max_rc: MAX_RC, extensions: [] }],
    ], extensions: [],
  };
  const dgp = await hiveCli.call('condenser_api', 'get_dynamic_global_properties', []);
  tx.ref_block_num = dgp.head_block_number & 0xffff;
  tx.ref_block_prefix = Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4);
  tx.expiration = new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19);

  // THE TEST: if the op is in the protocol registry, get_transaction_hex serializes it
  let hex;
  try {
    hex = await hiveCli.call('condenser_api', 'get_transaction_hex', [tx]);
    out.serializeOk = true;
  } catch (e) {
    out.serializeError = String(e.message || e).slice(0, 200);
    console.log('SERIALIZE FAIL:', out.serializeError);
    console.log(JSON.stringify(out, null, 1));
    return;
  }
  const nb = Buffer.from(hex, 'hex');
  if (nb[nb.length - 1] !== 0x00) throw new Error('tail not empty');
  const txBytes = nb.subarray(0, nb.length - 1);
  const digest = crypto.createHash('sha256').update(Buffer.concat([Buffer.from(HIVE_CHAIN_ID, 'hex'), txBytes])).digest();
  const { d } = wifToScalar(ACTIVE_WIF);
  const sig = ecdsaSignLowS(digest, d);
  const rec = ecdsaRecover(digest, sig.r, sig.s, sig.recid);
  const signerPoint = SECP.G.multiply(d);
  if (!rec || rec.getEncoded(true).toString('hex') !== signerPoint.getEncoded(true).toString('hex')) throw new Error('self-verify failed');
  const sigHex = Buffer.concat([sig.r.toBuffer(32), sig.s.toBuffer(32), Buffer.from([31 + sig.recid])]).toString('hex');
  const signed = { ...tx, signatures: [sigHex] };

  // broadcast synchronous → returns txid immediately (Task 62 discovery)
  const sync = await hiveCli.call('network_broadcast_api', 'broadcast_transaction_synchronous', [signed]);
  out.broadcast = sync || {};
  const txid = (sync && sync.id) || null;
  out.txid = txid;
  console.log('broadcast sync:', JSON.stringify(sync).slice(0, 200));

  await new Promise((r) => setTimeout(r, 5000));
  let landed = null;
  for (const node of ['https://api.openhive.network', 'https://api.hive.blog']) {
    try {
      const t = await rpcV4(node, { jsonrpc: '2.0', method: 'condenser_api.get_transaction', params: [txid], id: 1 });
      if (t && t.transaction_id) { landed = { node, block: t.block_num }; break; }
    } catch (_) {}
  }
  out.landed = landed;
  await new Promise((r) => setTimeout(r, 3000));
  const after = await rcMana('ynet');
  out.after = { ynetMax: after && after.max, delta: after && before ? after.max - before.max : null };
  console.log('RESULT:', JSON.stringify(out, null, 1));
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
