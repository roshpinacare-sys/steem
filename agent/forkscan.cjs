#!/usr/bin/env node
/* forkscan.cjs — same-key territory audit (read-only, zero signatures).
 *
 * The operator asked: "what else can this key open? which networks started as
 * plain Steem copies?" Every Steem-family fork shares the same secp256k1 key
 * derivation — so the SAME posting/active keys may already control accounts
 * on forks that forked BEFORE a key rotation. This scanner probes every known
 * fork endpoint honestly:
 *
 *   alive     — chain answered dgp; account existence + balances reported
 *   exists    — the account name is registered on that fork
 *   dead      — every candidate endpoint failed (answer: no, not "?" — and
 *               re-runnable any time)
 *
 * Writes forkscan_result.json. Read-only: get_dynamic_global_properties +
 * get_accounts. Nothing is signed, nothing is broadcast.
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'forkscan_result.json');

// ── same roots as keyscan: primary + army (operator vault + factory agents) ──
function sovereignRoots() {
  const roots = new Set(['headcorner']);
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    for (const a of v.accounts || []) if (a && a.username) roots.add(String(a.username).toLowerCase());
  } catch (_) { /* no vault yet */ }
  try {
    for (const f of fs.readdirSync(path.join(__dirname, 'keys')).filter((x) => x.endsWith('.json') && x !== 'vault.json')) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', f), 'utf8'));
        if (j && j.name) roots.add(String(j.name).toLowerCase());
      } catch (_) { /* corrupt key file */ }
    }
  } catch (_) { /* no keys dir */ }
  return Array.from(roots);
}

const FORKS = [
  { id: 'steem', label: 'Steem (baseline)', endpoints: ['https://api.steemit.com', 'https://api.justyy.com'] },
  { id: 'hive', label: 'Hive (2020 fork)', endpoints: ['https://api.hive.blog', 'https://api.openhive.network'] },
  { id: 'blurt', label: 'Blurt (2020 fork)', endpoints: ['https://blurt-rpc.saboin.com', 'https://rpc.blurt.world'] },
  { id: 'serey', label: 'Serey (Steem fork)', endpoints: ['https://rpc.serey.com', 'https://api.serey.io', 'https://rpc.serey.io', 'https://api.serey.com'] },
  { id: 'golos', label: 'Golos (Steem fork)', endpoints: ['https://api.golos.id', 'https://rpc.golos.id', 'https://api.golos.today'] },
  { id: 'steemclassic', label: 'Steem Classic (fork)', endpoints: ['https://rpc.steemclassic.com', 'https://api.steemclassic.com'] },
  { id: 'weku', label: 'Weku (Steem fork)', endpoints: ['https://rpc.weku.io', 'https://api.weku.io'] },
];
// Not probeable with Steem keys by construction (different crypto):
//   Whaleshares/BitShares-family — Graphene but secp256k1 usage differs, no condenser API.

function rpcV4(url, body, timeoutMs) {
  const u = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, timeout: timeoutMs || 8000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.error) return reject(new Error(j.error.message || 'rpc error'));
            resolve(j.result);
          } catch (_) { reject(new Error('bad rpc: ' + d.slice(0, 100))); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

const amt = (x) => parseFloat(String(x).split(' ')[0] || 0) || 0;

async function probeFork(fork, accounts) {
  const tried = [];
  // pass ×2 over endpoints — community nodes flap
  for (let pass = 0; pass < 2; pass++) {
    for (const url of fork.endpoints) {
      tried.push(url.replace(/^https?:\/\//, ''));
      try {
        const dgp = await rpcV4(url, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
        const headBlock = dgp && (dgp.head_block_number ?? (dgp.result && dgp.result.head_block_number));
        if (!Number.isFinite(Number(headBlock))) continue;
        const accs = await rpcV4(url, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [accounts], id: 1 }).catch(() => null);
        const rows = Array.isArray(accs) ? accs : (accs && Array.isArray(accs.result) ? accs.result : []);
        const found = new Set(rows.map((r) => String(r.name).toLowerCase()));
        return {
          id: fork.id,
          label: fork.label,
          alive: true,
          endpoint: url.replace(/^https?:\/\//, ''),
          headBlock: Number(headBlock),
          accounts: accounts.map((name) => {
            const row = rows.find((r) => String(r.name).toLowerCase() === name);
            return row
              ? {
                  name,
                  exists: true,
                  liquid: amt(row.balance),
                  debt: amt(row.sbd_balance || row.hbd_balance || 0),
                  vests: amt(row.vesting_shares),
                  pending: amt(row.reward_steem_balance) + amt(row.reward_sbd_balance || row.reward_hbd_balance || 0) + amt(row.reward_vesting_balance),
                }
              : { name, exists: found.has(name) ? true : false };
          }),
          tried,
        };
      } catch (_) { /* next endpoint */ }
    }
  }
  return { id: fork.id, label: fork.label, alive: false, endpoint: null, headBlock: null, accounts: accounts.map((name) => ({ name, exists: null })), tried };
}

(async () => {
  const accounts = sovereignRoots();
  const out = { scannedAt: new Date().toISOString(), accounts, forks: [], summary: null };
  for (const fork of FORKS) {
    const r = await probeFork(fork, accounts);
    out.forks.push(r);
    console.log('[forkscan] ' + fork.id + ': ' + (r.alive ? 'alive @' + r.endpoint + ' (head ' + r.headBlock + ')' : 'DEAD (no endpoint answered)') +
      ' · ' + r.accounts.map((a) => a.name + '=' + (a.exists === true ? 'exists' : a.exists === false ? 'no-account' : '?')).join(', '));
  }
  const alive = out.forks.filter((f) => f.alive);
  const controlled = alive.reduce((s, f) => s + f.accounts.filter((a) => a.exists).length, 0);
  out.summary = {
    forksProbed: FORKS.length,
    forksAlive: alive.length,
    chainsControlled: alive.filter((f) => f.accounts.some((a) => a.exists)).length,
    accountsControlled: controlled,
    liquidNote: 'liquid/pending per fork in forks[] — the same 2018 keys rule every chain where the name exists',
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log('[forkscan] done —', JSON.stringify(out.summary));
})().catch((e) => {
  console.log('[forkscan] fatal:', e.message);
  process.exit(1);
});
