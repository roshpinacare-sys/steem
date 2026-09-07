#!/usr/bin/env node
/* keyscan.cjs — empire discovery engine (read-only, zero signatures).
 * Scans Steem + Hive for every account whose authority includes any of OUR
 * public keys, plus Hive-Engine balances. Chain-first: the public keys are
 * read from the chain authorities themselves (works even with an empty .env).
 * Writes keyscan_result.json: { scannedAt, summary:{...}, accounts:[...] }
 * Consumers: agent.cjs empireScanCycle → STATUS.empire, verify_system.cjs,
 * /api/ops/agent/exec (manual run from the console).
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'keyscan_result.json');

// 43 — scan ALL sovereign roots: the primary (headcorner) + every army
// account (operator vault + factory-minted agents). Key-references then
// discovers even MORE accounts sharing those keys — the army grows itself.
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
const ACCOUNTS = sovereignRoots();

const STEEM_NODES = ['https://api.steemit.com', 'https://api.justyy.com', 'https://api.steem.fans'];
const HIVE_NODES = ['https://api.hive.blog', 'https://api.syncad.com', 'https://anyx.io'];

function rpcV4(url, body) {
  const u = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, timeout: 15000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.error) return reject(new Error(j.error.message || 'rpc error'));
            resolve(j.result);
          } catch (_) { reject(new Error('bad rpc: ' + d.slice(0, 120))); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

async function firstOk(nodes, method, params) {
  let lastErr;
  for (const n of nodes) {
    try {
      return await rpcV4(n, { jsonrpc: '2.0', method, params, id: 1 });
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all nodes failed');
}

async function heBalances(account) {
  try {
    const res = await rpcV4('https://api.hive-engine.com/rpc/contracts', {
      jsonrpc: '2.0', method: 'find',
      params: { contract: 'tokens', table: 'balances', query: { account }, limit: 100 }, id: 1,
    });
    const rows = Array.isArray(res) ? res : [];
    let swapHive = 0;
    for (const row of rows) {
      const total = (parseFloat(row.balance) || 0) + (parseFloat(row.stake) || 0);
      if (row.symbol === 'SWAP.HIVE') swapHive = parseFloat(row.balance) || 0;
    }
    return { tokens: rows.filter((r) => (parseFloat(r.balance) || 0) + (parseFloat(r.stake) || 0) > 0).length, swapHive };
  } catch (_) {
    return { tokens: 0, swapHive: 0 };
  }
}

const amt = (x) => parseFloat(String(x).split(' ')[0] || 0) || 0;

async function scanChain(nodes) {
  // 1) our public keys straight from the chain authority (no .env needed)
  const accs = await firstOk(nodes, 'condenser_api.get_accounts', [ACCOUNTS]);
  if (!Array.isArray(accs) || !accs.length) throw new Error('root accounts not found');
  const pubs = [];
  const rootsFound = new Set();
  for (const a of accs) {
    rootsFound.add(String(a.name).toLowerCase());
    pubs.push(a.owner.key_auths[0][0], a.active.key_auths[0][0], a.posting.key_auths[0][0]);
  }
  const pubSet = Array.from(new Set(pubs));

  // 2) every account that references any of our keys
  const refs = new Set(rootsFound);
  for (const pub of pubSet) {
    const r = await firstOk(nodes, 'condenser_api.get_key_references', [[pub]]).catch(() => []);
    for (const group of Array.isArray(r) ? r : []) {
      for (const name of Array.isArray(group) ? group : [group]) {
        if (typeof name === 'string') refs.add(name);
      }
    }
  }
  const names = Array.from(refs).filter((n) => /^[a-z0-9\-.]{3,16}$/.test(n));

  // 3) full account objects for each discovered name
  const details = await firstOk(nodes, 'condenser_api.get_accounts', [names]).catch(() => []);
  const vestsToSp = await (async () => {
    try {
      const g = await firstOk(nodes, 'condenser_api.get_dynamic_global_properties', []);
      const totalVests = amt(g.total_vesting_shares);
      const totalVestFund = amt(g.total_vesting_fund_hive) || amt(g.total_vesting_fund_steem);
      return totalVests > 0 ? totalVestFund / totalVests : 0;
    } catch (_) { return 0; }
  })();

  return { names, details, vestsToSp };
}

(async () => {
  const out = { scannedAt: new Date().toISOString(), summary: null, accounts: [] };
  const sum = { totalAccounts: 0, steemCount: 0, hiveCount: 0, totalSP: 0, totalHP: 0, totalHive: 0, totalHbd: 0, totalSteem: 0, controllableNow: 0, heSwapHive: 0 };

  // Steem side
  try {
    const s = await scanChain(STEEM_NODES);
    for (const d of s.details) {
      const sp = amt(d.vesting_shares) * (s.vestsToSp || 0);
      sum.totalSP += sp;
      sum.totalSteem += amt(d.balance);
      sum.steemCount += 1;
      out.accounts.push({ chain: 'steem', account: d.name, sp: Math.round(sp * 1000) / 1000, steem: amt(d.balance), created: d.created });
    }
  } catch (e) {
    console.log('[keyscan] steem side failed:', e.message);
  }

  // Hive side
  try {
    const h = await scanChain(HIVE_NODES);
    for (const d of h.details) {
      const hp = amt(d.vesting_shares) * (h.vestsToSp || 0);
      sum.totalHP += hp;
      sum.totalHive += amt(d.balance);
      sum.totalHbd += amt(d.hbd_balance);
      sum.hiveCount += 1;
      const he = await heBalances(d.name);
      sum.heSwapHive += he.swapHive;
      out.accounts.push({ chain: 'hive', account: d.name, hp: Math.round(hp * 1000) / 1000, hive: amt(d.balance), hbd: amt(d.hbd_balance), heTokens: he.tokens, heSwapHive: Math.round(he.swapHive * 1e6) / 1e6, created: d.created });
    }
  } catch (e) {
    console.log('[keyscan] hive side failed:', e.message);
  }

  sum.totalAccounts = sum.steemCount + sum.hiveCount;
  sum.controllableNow = sum.totalAccounts;
  sum.totalSP = Math.round(sum.totalSP * 1000) / 1000;
  sum.totalHP = Math.round(sum.totalHP * 1000) / 1000;
  sum.heSwapHive = Math.round(sum.heSwapHive * 1e6) / 1e6;
  out.summary = sum;

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log('[keyscan] done —', JSON.stringify(sum));
})().catch((e) => {
  console.log('[keyscan] fatal:', e.message);
  process.exit(1);
});
