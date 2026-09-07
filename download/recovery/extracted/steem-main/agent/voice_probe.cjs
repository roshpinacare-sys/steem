#!/usr/bin/env node
/**
 * voice_probe.cjs — Task 78 (VOICE-OF-FLEET) opening probe. READ-ONLY.
 *
 * Measures every candidate rail before any trial fires:
 *   R1  Steem posting  — RC (current + max + pct) per soldier + head
 *   R2  Hive  posting  — RC per account on api.hive.blog
 *   R3  HE value       — WAIV/SPORTS/SWAP.HIVE liquid + pendingUnstakes
 *   R4  Curation       — head VP pct (Steem)
 *
 * Output: agent/voice_probe.json + console decision table.
 * No keys, no broadcasts — pure measurement.
 */
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const STEEM_RPC = process.env.STEEM_RPC || 'https://api.steemit.com';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const HE_RPC = process.env.HE_RPC || 'https://api.hive-engine.com/rpc';
const HEAD = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnv(__dirname);

const amt = (s) => parseFloat(String(s || '0')) || 0;

function loadArmy() {
  const out = [];
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    for (const a of v.accounts || []) {
      if (!a || !a.username) continue;
      const u = String(a.username).toLowerCase();
      if (u === HEAD) continue;
      const delegated = a.mode === 'operator-delegated';
      out.push({
        username: u,
        postingWif: delegated ? (process.env.POSTING_WIF || '') : ((a.keys && a.keys.posting && a.keys.posting.wif) || ''),
        activeWif: delegated ? '' : ((a.keys && a.keys.active && a.keys.active.wif) || ''),
      });
    }
  } catch (_) {}
  try {
    const files = fs
      .readdirSync(path.join(__dirname, 'keys'))
      .filter((f) => f.endsWith('.json') && f !== 'vault.json');
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', f), 'utf8'));
        const u = String((j && j.name) || '').toLowerCase();
        const wif = j && j.keys && j.keys.posting && j.keys.posting.wif;
        if (u && wif && u !== HEAD && !out.find((o) => o.username === u)) {
          out.push({ username: u, postingWif: wif, activeWif: (j.keys && j.keys.active && j.keys.active.wif) || '' });
        }
      } catch (_) {}
    }
  } catch (_) {}
  return out;
}

async function withTimeout(p, ms, label) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timeout ' + ms + 'ms')), ms)),
  ]);
}

async function main() {
  steem.api.setOptions({ url: STEEM_RPC });
  const army = loadArmy();
  const names = [HEAD, ...army.map((a) => a.username)];
  const out = {
    at: new Date().toISOString(),
    head: HEAD,
    armySize: army.length,
    keysOk: army.filter((a) => a.postingWif).length,
    steem: {},
    hive: {},
    he: {},
    vp: {},
  };

  // R1 — Steem RC
  try {
    const rc = await withTimeout(
      steem.api.callAsync('rc_api.find_rc_accounts', { accounts: names }),
      20000,
      'steem rc'
    );
    for (const r of (rc && rc.rc_accounts) || []) {
      const max = Number(r.max_rc) || 0;
      const cur = Number(r.rc_manabar && r.rc_manabar.current_mana) || 0;
      out.steem[r.account] = { cur, max, pct: max > 0 ? +((cur / max) * 100).toFixed(2) : 0 };
    }
  } catch (e) {
    out.steemError = String(e.message || e).slice(0, 120);
  }

  // R2 — Hive RC
  try {
    const res = await fetch(HIVE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: names }, id: 1 }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json();
    for (const r of (j.result && j.result.rc_accounts) || []) {
      const max = Number(r.max_rc) || 0;
      const cur = Number(r.rc_manabar && r.rc_manabar.current_mana) || 0;
      out.hive[r.account] = { cur, max, pct: max > 0 ? +((cur / max) * 100).toFixed(2) : 0 };
    }
  } catch (e) {
    out.hiveError = String(e.message || e).slice(0, 120);
  }

  // R3 — HE balances + pendingUnstakes
  const heFind = async (contract, table, query, limit = 10) => {
    const res = await fetch(HE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'find', params: { contract, table, query, limit }, id: 1 }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await res.json();
    return (j.result && j.result.rows) || [];
  };
  for (const sym of ['WAIV', 'SPORTS', 'SWAP.HIVE', 'BEE', 'AFIT']) {
    try {
      const rows = await heFind('tokens', 'balances', { account: HEAD, symbol: sym }, 1);
      out.he[sym] = rows[0] ? { balance: rows[0].balance, staked: rows[0].staked } : null;
    } catch (e) {
      out.he[sym] = { error: String(e.message || e).slice(0, 80) };
    }
  }
  try {
    const pu = await heFind('tokens', 'pendingUnstakes', { account: HEAD }, 100);
    out.he.pendingUnstakes = pu.map((p) => ({ symbol: p.symbol, quantity: p.quantity, nextTxTimestamp: p.nextTxTimestamp }));
  } catch (e) {
    out.he.pendingUnstakes = { error: String(e.message || e).slice(0, 80) };
  }

  // R4 — head VP (Steem)
  try {
    const accs = await withTimeout(steem.api.getAccountsAsync([HEAD]), 20000, 'steem accounts');
    const acc = accs && accs[0];
    if (acc) {
      const effective = amt(acc.vesting_shares) - amt(acc.delegated_vesting_shares) + amt(acc.received_vesting_shares);
      const maxMana = effective * 1e6;
      const cur = Number(acc.voting_manabar && acc.voting_manabar.current_mana);
      out.vp[HEAD] = maxMana > 0 ? +((cur / maxMana) * 100).toFixed(2) : null;
    }
  } catch (e) {
    out.vpError = String(e.message || e).slice(0, 120);
  }

  fs.writeFileSync(path.join(__dirname, 'voice_probe.json'), JSON.stringify(out, null, 1));

  // decision table
  const line = (s) => console.log(s);
  line('=== VOICE PROBE ' + out.at + ' ===');
  line('army=' + out.armySize + ' · posting-keys=' + out.keysOk);
  line('--- R1 Steem RC (top 6 by pct) ---');
  const st = Object.entries(out.steem).sort((a, b) => b[1].pct - a[1].pct);
  for (const [n, v] of st.slice(0, 6)) line('  @' + n.padEnd(14) + ' ' + v.pct + '%  cur=' + (v.cur / 1e6).toFixed(0) + 'M  max=' + (v.max / 1e9).toFixed(2) + 'B');
  line('--- R2 Hive RC (top 6 by pct) ---');
  const hv = Object.entries(out.hive).sort((a, b) => b[1].cur - a[1].cur);
  for (const [n, v] of hv.slice(0, 6)) line('  @' + n.padEnd(14) + ' cur=' + (v.cur / 1e6).toFixed(0) + 'M  max=' + (v.max / 1e9).toFixed(2) + 'B  ' + v.pct + '%');
  line('--- R3 HE ---');
  for (const [sym, v] of Object.entries(out.he)) {
    if (sym === 'pendingUnstakes') {
      line('  pendingUnstakes: ' + JSON.stringify(v));
    } else {
      line('  ' + sym.padEnd(10) + JSON.stringify(v));
    }
  }
  line('--- R4 VP ---');
  for (const [n, v] of Object.entries(out.vp)) line('  @' + n + ' VP=' + v + '%');
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
