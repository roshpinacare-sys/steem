#!/usr/bin/env node
/**
 * cascade.cjs — Task 53: the cascade relay — one local decision, three chain
 * signatures, measured.
 *
 * "כל פעולה אצלנו תגרור פעולות בשאר השרשראות" — proven live:
 *   leg 1 · Steem  @headcorner   (issuer — the sovereign root)
 *   leg 2 · Steem  @cashmachine  (soldier ack — the fleet on the host chain)
 *   leg 3 · Hive   @haran        (soldier anchor — same key, other chain)
 *
 * The three legs fire IN PARALLEL and each is visibility-verified on its own
 * chain (trx_id from the signer's own history). Per-leg acceptance + visibility
 * latencies are measured. A digest binds the cascade to the live world state
 * (value-lock + bridge checkpoint + pool depth), so the cascade IS the state.
 *
 * Usage: node cascade.cjs [--dry]     → cascade_result.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const STEEM_RPC = process.env.STEEM_RPC || 'https://api.steemit.com';
const CONSOLE = process.env.CONSOLE_URL || 'http://localhost:3000';

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
const POSTING_WIF = process.env.POSTING_WIF || '';
const DRY = process.argv.includes('--dry');
const RESULT_PATH = path.join(__dirname, 'cascade_result.json');

function log(msg) { console.log('[' + new Date().toISOString() + '] cascade: ' + msg); }
const sha256 = (s) => require('crypto').createHash('sha256').update(s).digest('hex');

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 25000 },
      (res) => { let buf = ''; res.on('data', (d) => (buf += d)); res.on('end', () => { try { const json = JSON.parse(buf); resolve(json.result !== undefined ? json.result : json); } catch (e) { reject(e); } }); }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(payload);
  });
}

function vaultSoldier(name) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const a = (v.accounts || []).find((x) => String(x.username).toLowerCase() === name);
    return a && a.keys && a.keys.posting && a.keys.posting.wif ? { account: name, wif: a.keys.posting.wif } : null;
  } catch (_) { return null; }
}

/** build + sign + broadcast one custom_json op; returns {txid?|block?, ms}
 *  Steem legs: verify by BLOCK SCAN (Task 52 lesson — get_transaction lags >3min,
 *  and hot accounts cycle their 20-op history window in seconds). Hive legs:
 *  history visibility is fast and reliable there. */
async function leg(legName, chain, signerAccount, signerWif, payload) {
  const t0 = Date.now();
  const isHive = chain === 'hive';
  const rpcUrl = isHive ? HIVE_RPC : STEEM_RPC;
  const dgpMethod = 'condenser_api.get_dynamic_global_properties';
  const dgp = await rpcV4(rpcUrl, { jsonrpc: '2.0', method: dgpMethod, params: [], id: 1 });
  const headAtSend = dgp.head_block_number;
  const tx = {
    ref_block_num: dgp.head_block_number & 0xffff,
    ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
    expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
    operations: [['custom_json', { required_auths: [], required_posting_auths: [signerAccount], id: 'saos', json: JSON.stringify(payload) }]],
    extensions: [],
  };
  const prev = steem.config.get('chain_id');
  if (isHive) steem.config.set('chain_id', HIVE_CHAIN_ID);
  let signed;
  try { signed = steem.auth.signTransaction(tx, [signerWif]); } finally { if (isHive) steem.config.set('chain_id', prev); }
  await rpcV4(rpcUrl, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 2 });
  const acceptedMs = Date.now() - t0;

  if (!isHive) {
    // block scan — our op must appear in a block ≥ headAtSend (chain truth)
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      for (let b = headAtSend; b <= headAtSend + 14; b++) {
        const blk = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_block', params: [b], id: 4 }).catch(() => null);
        if (!blk || !Array.isArray(blk.transactions)) continue;
        for (const t of blk.transactions) {
          for (const [type, v] of t.operations || []) {
            if (type !== 'custom_json' || v.id !== 'saos') continue;
            try {
              const pl = JSON.parse(String(v.json || '{}'));
              if (pl.time === payload.time && pl.digest === payload.digest && (v.required_posting_auths || []).includes(signerAccount)) {
                return { leg: legName, chain, signer: signerAccount, acceptedMs, block: b, visibleMs: Date.now() - t0 };
              }
            } catch (_) {}
          }
        }
      }
    }
    return { leg: legName, chain, signer: signerAccount, acceptedMs, headAtSend };
  }

  // Hive: visibility in the signer's own history
  let txid = null;
  let visibleMs = null;
  for (let i = 0; i < 8 && !txid; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const hist = await rpcV4(rpcUrl, { jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: [signerAccount, -1, 20], id: 3 }).catch(() => null);
    const arr = hist && Array.isArray(hist) ? hist : [];
    for (const [, e] of arr) {
      if (e.op[0] !== 'custom_json' || e.op[1].id !== 'saos') continue;
      try {
        const pl = JSON.parse(String(e.op[1].json || '{}'));
        if (pl.time === payload.time && pl.digest === payload.digest) { txid = e.trx_id || null; visibleMs = Date.now() - t0; break; }
      } catch (_) {}
    }
  }
  return { leg: legName, chain, signer: signerAccount, acceptedMs, txid, visibleMs };
}

async function main() {
  const result = { at: new Date().toISOString(), mode: DRY ? 'dry' : 'live', legs: [], verify: [] };
  if (!POSTING_WIF) { result.error = 'no POSTING_WIF'; fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n'); process.exit(1); }

  // live world digest — the cascade carries the state, not noise
  const dex = await fetch(CONSOLE + '/api/ops/saos/dex?username=' + encodeURIComponent(ACCOUNT), { signal: AbortSignal.timeout(40000) }).then((r) => r.json()).catch(() => null);
  const vl = JSON.parse(fs.readFileSync(path.join(__dirname, 'value_lock_state.json'), 'utf8'));
  const bs = JSON.parse(fs.readFileSync(path.join(__dirname, 'bridge_state.json'), 'utf8'));
  const pool = dex && dex.ok ? (dex.pools || []).find((p) => p.pair === 'SAOS:STEEM') : null;
  const digestSrc = JSON.stringify({
    pool: pool ? { saos: pool.saos, steem: pool.steem, lp: pool.lpSupply, locked: pool.locked } : null,
    vl: { seq: vl.seq, lockedLp: vl.lockedLp, lastTxid: vl.lastTxid },
    bs: { anchoredTotal: bs.anchoredTotal, checkpoints: bs.checkpoints },
  });
  const digest = sha256(digestSrc).slice(0, 32);
  result.digest = digest;
  log('digest ' + digest + ' (pool ' + (pool ? pool.saos + '/' + pool.steem : 'n/a') + ' · locked ' + (pool ? pool.locked : 'n/a') + ' · cp ' + bs.checkpoints + ')');

  const time = new Date().toISOString();
  const payload = {
    protocol: 'saos/v1', action: 'cascade', account: ACCOUNT, digest, time,
    world: { pool: pool ? { saos: pool.saos, steem: pool.steem, locked: pool.locked, lpSupply: pool.lpSupply } : null, valueLocks: vl.seq, checkpoints: bs.checkpoints },
    note: 'one local decision → three chain signatures · sovereign relay 53',
  };
  result.payload = payload;

  if (DRY) {
    result.legs = [
      { leg: 'steem-issuer', chain: 'steem', signer: ACCOUNT, dry: true },
      { leg: 'steem-soldier', chain: 'steem', signer: 'cashmachine', dry: true },
      { leg: 'hive-soldier', chain: 'hive', signer: 'haran', dry: true },
    ];
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
    log('DRY — 3 legs planned');
    return;
  }

  const cash = vaultSoldier('cashmachine');
  const haran = vaultSoldier('haran');
  if (!cash) throw new Error('no cashmachine wif in vault');
  if (!haran) throw new Error('no haran wif in vault');

  // the cascade — three legs in parallel, three chains/keys, one decision
  const [l1, l2, l3] = await Promise.all([
    leg('steem-issuer', 'steem', ACCOUNT, POSTING_WIF, payload),
    leg('steem-soldier', 'steem', 'cashmachine', cash.wif, payload),
    leg('hive-soldier', 'hive', 'haran', haran.wif, payload),
  ]);
  result.legs = [l1, l2, l3];
  for (const l of result.legs) log(l.leg + ' @' + l.signer + ' [' + l.chain + '] accepted=' + l.acceptedMs + 'ms · txid=' + (l.txid || 'NOT-VISIBLE') + (l.visibleMs ? ' (' + l.visibleMs + 'ms)' : ''));

  // chain re-fetch — every leg must answer from its own chain
  for (const l of result.legs) {
    if (l.chain === 'hive') {
      if (!l.txid) { result.verify.push({ leg: l.leg, pass: false, error: 'not visible' }); continue; }
      const tx = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_transaction', params: [l.txid], id: 9 }).catch((e) => ({ err: String(e.message || e) }));
      if (tx && Array.isArray(tx.operations)) {
        const pl = JSON.parse(tx.operations[0][1].json);
        result.verify.push({ leg: l.leg, pass: pl.digest === digest, block: tx.block_num, txid: l.txid, digest: pl.digest });
      } else {
        result.verify.push({ leg: l.leg, pass: false, error: String((tx && (tx.err || (tx.error && tx.error.message))) || 'no result').slice(0, 80) });
      }
    } else {
      if (!l.block) { result.verify.push({ leg: l.leg, pass: false, error: 'op not found in blocks ' + l.headAtSend + '..+14' }); continue; }
      const blk = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_block', params: [l.block], id: 9 }).catch((e) => ({ err: String(e.message || e) }));
      let pass = false;
      let witness = null;
      if (blk && Array.isArray(blk.transactions)) {
        witness = blk.witness;
        outer: for (const t of blk.transactions) {
          for (const [type, v] of t.operations || []) {
            if (type !== 'custom_json' || v.id !== 'saos') continue;
            try {
              const pl = JSON.parse(String(v.json || '{}'));
              if (pl.digest === digest && (v.required_posting_auths || []).includes(l.signer)) { pass = true; break outer; }
            } catch (_) {}
          }
        }
      }
      result.verify.push({ leg: l.leg, pass, block: l.block, witness, signer: l.signer });
    }
  }
  result.allVerified = result.verify.every((v) => v.pass);
  log('VERIFY: ' + result.verify.map((v) => v.leg + '=' + (v.pass ? 'OK blk' + v.block : 'FAIL')).join(' · '));

  fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2) + '\n');
  log('DONE — 3 legs · digest ' + digest + ' · allVerified=' + result.allVerified);
}

main().catch((e) => {
  log('FATAL: ' + String((e && e.message) || e));
  try { fs.writeFileSync(RESULT_PATH, JSON.stringify({ at: new Date().toISOString(), fatal: String((e && e.message) || e) }, null, 2) + '\n'); } catch (_) {}
  process.exit(1);
});
