#!/usr/bin/env node
/**
 * energy_census.cjs — Task 58: fresh read-only census of the fleet's ENERGY
 * (Resource Credits / mana) on Steem + Hive, chain economics, name candidates,
 * pending rewards (harvestable value) and claimed-ticket inventory.
 * READ-ONLY: no broadcasts, no secrets printed.
 */
'use strict';
const fs = require('fs');
const path = require('path');

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

function rpc(url, body) {
  const u = new URL(url); const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = require('https').request({ hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => {
        try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message || 'rpc error')); resolve(j.result); }
        catch (_) { reject(new Error('bad rpc: ' + d.slice(0, 120))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    req.write(payload); req.end();
  });
}
const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';
const steem = (method, params) => rpc(STEEM_RPC, { jsonrpc: '2.0', method, params, id: 1 });
const hive = (method, params) => rpc(HIVE_RPC, { jsonrpc: '2.0', method, params, id: 1 });

const NAMES = ['headcorner', 'cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet'];
const CANDIDATES = ['turbine', 'dynamo', 'reactor', 'kilowatt', 'gigawatt', 'wattson', 'powerspan', 'magdyno', 'energywell', 'saospower'];

const n1 = (x) => (x / 1e9).toFixed(2) + 'G';
function rcRow(row) {
  if (!row) return null;
  const max = parseFloat(row.max_rc), now = parseFloat(row.rc_manabar.current_mana);
  const t = row.rc_manabar.last_update_time;
  const elapsed = Math.max(0, Date.now() / 1000 - t);
  const regenerated = Math.min(max, elapsed * (max / (5 * 86400)));
  const cur = Math.min(max, now + regenerated);
  return { max, now: cur, pct: +((cur / max) * 100).toFixed(1), regenPerDay: max / 5 };
}

(async () => {
  const out = { at: new Date().toISOString(), operator: OPERATOR };

  // ── Steem census ──
  const [sa, src, props] = await Promise.all([
    steem('condenser_api.get_accounts', [NAMES]),
    steem('rc_api.find_rc_accounts', { accounts: NAMES }),
    steem('condenser_api.get_dynamic_global_properties', []),
  ]);
  const rcMap = Object.fromEntries((src.rc_accounts || []).map((r) => [r.account, rcRow(r)]));
  const vestsPerSp = parseFloat(props.total_vesting_shares) / parseFloat(props.total_vesting_fund_steem);
  out.steem = {
    headBlock: props.head_block_number,
    vestsPerSp: +vestsPerSp.toFixed(2),
    accounts: sa.filter(Boolean).map((a) => {
      const rc = rcMap[a.name] || {};
      const vests = parseFloat(a.vesting_shares), recv = parseFloat(a.received_vesting_shares), del = parseFloat(a.delegated_vesting_shares);
      const sp = (vests / vestsPerSp), spIn = (recv / vestsPerSp);
      const rw = {
        steem: parseFloat(a.reward_steem_balance), sbd: parseFloat(a.reward_sbd_balance), vests: parseFloat(a.reward_vesting_balance),
      };
      const rwSp = rw.vests / vestsPerSp;
      return {
        account: a.name,
        rcPct: rc.pct, rcMax: rc.max, rcNow: rc.now, regenGPerDay: rc.max ? +(rc.regenPerDay / 1e9).toFixed(2) : null,
        compactOpsPerDay: rc.max ? Math.floor(rc.regenPerDay / 54882553) : null,
        hpSp: +sp.toFixed(2), delegatedInSp: +spIn.toFixed(2), delegatedOutSp: +(del / vestsPerSp).toFixed(2),
        liquid: a.balance, sbd: a.sbd_balance,
        tickets: a.pending_claimed_accounts,
        rewardSteem: rw.steem, rewardSbd: rw.sbd, rewardVestsSp: +rwSp.toFixed(3),
        harvestable: (rw.steem > 0 || rw.sbd > 0 || rw.vests > 0),
      };
    }),
  };
  out.steem.fleet = {
    regenGPerDay: +out.steem.accounts.reduce((s, a) => s + (a.regenGPerDay || 0), 0).toFixed(1),
    compactOpsPerDay: out.steem.accounts.reduce((s, a) => s + (a.compactOpsPerDay || 0), 0),
    harvestableAccounts: out.steem.accounts.filter((a) => a.harvestable).map((a) => a.account),
    ticketsTotal: out.steem.accounts.reduce((s, a) => s + (a.tickets || 0), 0),
  };

  // ── Hive census ──
  try {
    const [ha, hrc, hprops] = await Promise.all([
      hive('condenser_api.get_accounts', [NAMES]),
      hive('rc_api.find_rc_accounts', { accounts: NAMES }),
      hive('condenser_api.get_dynamic_global_properties', []),
    ]);
    const hrcMap = Object.fromEntries((hrc.rc_accounts || []).map((r) => [r.account, rcRow(r)]));
    const hVestsPerSp = parseFloat(hprops.total_vesting_shares) / parseFloat(hprops.total_vesting_fund_steem);
    out.hive = {
      headBlock: hprops.head_block_number,
      exists: ha.filter(Boolean).map((a) => a.name),
      missing: NAMES.filter((n) => !ha.some((a) => a && a.name === n)),
      accounts: ha.filter(Boolean).map((a) => {
        const rc = hrcMap[a.name] || {};
        return {
          account: a.name, rcPct: rc.pct, rcMaxG: rc.max ? +(rc.max / 1e9).toFixed(2) : null, rcNowG: rc.now ? +(rc.now / 1e9).toFixed(2) : null,
          hpSp: +(parseFloat(a.vesting_shares) / hVestsPerSp).toFixed(2),
          liquid: a.balance, hbd: a.hbd_balance,
          rewardHive: parseFloat(a.reward_hive_balance), rewardHbd: parseFloat(a.reward_hbd_balance), rewardVests: parseFloat(a.reward_vesting_balance),
          harvestable: parseFloat(a.reward_hive_balance) > 0 || parseFloat(a.reward_hbd_balance) > 0 || parseFloat(a.reward_vesting_balance) > 0,
        };
      }),
    };
  } catch (e) { out.hive = { error: String(e.message || e).slice(0, 120) }; }

  // ── name candidates (Steem) ──
  const probe = await steem('condenser_api.get_accounts', [CANDIDATES]);
  out.candidates = CANDIDATES.map((n, i) => ({ name: n, free: !probe[i] }));

  // ── chain creation fee (value benchmark of one minted account) ──
  try {
    const cp = await steem('condenser_api.get_chain_properties', []);
    out.steem.accountCreationFee = cp.account_creation_fee;
  } catch (_) { /* non-fatal */ }

  fs.writeFileSync(path.join(__dirname, 'energy_census.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
