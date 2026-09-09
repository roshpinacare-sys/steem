#!/usr/bin/env node
/**
 * harden_topology.cjs — Task 44 SCI: authority topology hardening (Steem).
 *
 * Embeds the operator's POWER into the chain itself, account by account:
 *
 *   1. POSTING AUTHORITY — add @<operator> to every army account's posting
 *      auths (account_update2 signed with the soldier's OWN active key).
 *      Operator gains posting-level command over the whole army: if a
 *      soldier's posting key is lost/rotated, the operator can still act.
 *      Verifiable by anyone: get_accounts → posting.account_auths.
 *
 *   2. RC DELEGATION — delegate ~25 SP of Resource Credits from the
 *      operator to every soldier (custom_json id 'rc' → delegate_rc).
 *      Poor-RC soldiers (e.g. 2.19e9 mana) become fully operational.
 *      Verifiable: rc_api.find_rc_accounts → max_rc jump + the 'rc' op in
 *      operator history.
 *
 * Idempotent: running twice adds nothing twice; RC delegation re-asserts
 * the same amount. Hive-side authority changes are intentionally out of
 * scope here (Hive op-ids diverged post-fork; requires dhive — roadmap).
 *
 * Usage: node harden_topology.cjs [--rc-sp 25]
 * Output: agent/harden_result.json
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');

function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const ENV = loadDotEnv(__dirname);
const ACCOUNT = (ENV.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const STEEM_RPC = process.env.RPC_URL || 'https://api.steemit.com';
steem.api.setOptions({ url: STEEM_RPC });

const POSTING_WIF = ENV.POSTING_WIF || '';
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const DRY = GATE.dry || String(process.env.DRY_RUN || '').toLowerCase() === 'true';
announceGate(Object.assign({}, GATE, { live: !DRY, dry: DRY }), log);


function log(msg) { console.log('[' + new Date().toISOString() + '] ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 25000 },
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
    req.on('timeout', () => req.destroy(new Error('rpc timeout 25s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function loadArmy() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || [])
      .filter((a) => a.username && a.keys && a.keys.active && a.keys.active.wif)
      .map((a) => ({
        name: String(a.username).toLowerCase(),
        activeWif: a.keys.active.wif,
        ownerWif: (a.keys.owner && a.keys.owner.wif) || '',
      }));
  } catch (_) {
    return [];
  }
}

async function broadcast(ops, wifs) {
  const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, wifs);
  return (conf && conf.id) || null;
}

/** Steem RPC serializes empty arrays as {} — normalize back to arrays. */
function asPairs(v) {
  if (Array.isArray(v)) return v.map(([n, w]) => [n, w]);
  if (v && typeof v === 'object') return Object.entries(v).map(([n, w]) => [n, Number(w)]);
  return [];
}

async function main() {
  const rcSpArg = process.argv.indexOf('--rc-sp');
  const rcSp = rcSpArg > -1 ? Math.max(0, parseFloat(process.argv[rcSpArg + 1]) || 25) : 25;
  const army = loadArmy();
  if (!army.length) {
    console.log('no army accounts — nothing to harden');
    fs.writeFileSync(path.join(__dirname, 'harden_result.json'), JSON.stringify({ at: new Date().toISOString(), accounts: [], ok: true, note: 'army empty' }, null, 2));
    return;
  }

  console.log('═'.repeat(74));
  console.log('SAOS TOPOLOGY HARDENING · @' + ACCOUNT + ' · army: ' + army.map((a) => '@' + a.name).join(', '));
  console.log('═'.repeat(74));

  // vests↔SP ratio for RC delegation
  const dgpo = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 1 });
  const fund = parseFloat(String(dgpo.total_vesting_fund_steem).split(' ')[0]);
  const shares = parseFloat(String(dgpo.total_vesting_shares).split(' ')[0]);
  const vestsPerSp = shares / fund; // 1 SP = vestsPerSp VESTS
  const rcVests = Math.round(rcSp * vestsPerSp);
  console.log('RC delegation target: ' + rcSp + ' SP = ' + rcVests.toLocaleString() + ' VESTS per soldier');

  const results = [];
  for (const soldier of army) {
    const [accArr] = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_accounts', params: [[soldier.name]], id: 2 });
    const acc = accArr;
    if (!acc) {
      results.push({ account: soldier.name, error: 'account not found on Steem' });
      continue;
    }
    const entry = { account: soldier.name, recovery: acc.recovery_account, postingAuth: null, rcDelegate: null };

    // ── 0) recovery topology: point recovery_account at the operator ──
    // set_reset_account is owner-signed. We use the soldier's stored owner key
    // when available (operator chose to store it at connect); otherwise it's
    // skipped (connect-time hardening covers future pastes).
    if (acc.recovery_account !== ACCOUNT) {
      if (!soldier.ownerWif) {
        entry.recovery = acc.recovery_account + ' (owner key not stored — connect-time hardening armed)';
        log('@' + soldier.name + ': recovery stays @' + acc.recovery_account + ' — no owner key on machine');
      } else if (DRY) {
        log('[DRY_RUN] @' + soldier.name + ': would set_reset_account → @' + ACCOUNT);
        entry.recovery = 'dry-run';
      } else {
        try {
          const txid = await broadcast(
            [['set_reset_account', { account: soldier.name, current_reset_account: acc.recovery_account, reset_account: ACCOUNT }]],
            [soldier.ownerWif]
          );
          entry.recovery = ACCOUNT;
          entry.recoveryTxid = txid;
          log('@' + soldier.name + ': recovery_account → @' + ACCOUNT + ' txid=' + txid);
        } catch (e) {
          entry.recoveryTxid = 'FAILED: ' + String(e.message || e).slice(0, 120);
          log('@' + soldier.name + ': set_reset_account FAILED — ' + (e.message || e));
        }
      }
      await sleep(6000);
    } else {
      log('@' + soldier.name + ': recovery already @' + ACCOUNT);
    }

    // ── 1) posting authority: embed operator key ──
    const posting = {
      weight_threshold: acc.posting.weight_threshold,
      account_auths: asPairs(acc.posting.account_auths),
      key_auths: asPairs(acc.posting.key_auths),
    };
    const hasOperator = posting.account_auths.some(([n]) => n.toLowerCase() === ACCOUNT);
    if (!hasOperator) {
      if (DRY) {
        log('[DRY_RUN] @' + soldier.name + ': would add @' + ACCOUNT + ' to posting auths');
        entry.postingAuth = 'dry-run';
      } else {
        try {
          const txid = await broadcast(
            [['account_update2', {
              account: soldier.name,
              posting: {
                weight_threshold: posting.weight_threshold,
                account_auths: [...posting.account_auths, [ACCOUNT, 1]],
                key_auths: posting.key_auths,
              },
              json_metadata: '',
              posting_json_metadata: '',
            }]],
            [soldier.activeWif]
          );
          entry.postingAuth = txid;
          log('@' + soldier.name + ': posting authority embedded → @' + ACCOUNT + ' txid=' + txid);
        } catch (e) {
          entry.postingAuth = 'FAILED: ' + String(e.message || e).slice(0, 120);
          log('@' + soldier.name + ': account_update2 FAILED — ' + (e.message || e));
        }
      }
    } else {
      entry.postingAuth = 'already-embedded';
      log('@' + soldier.name + ': @' + ACCOUNT + ' already in posting auths');
    }

    await sleep(6000);

    // ── 2) RC delegation (operator → soldier, custom_json id 'rc') ──
    if (rcSp > 0 && POSTING_WIF) {
      if (DRY) {
        log('[DRY_RUN] @' + soldier.name + ': would delegate ' + rcSp + ' SP (RC)');
        entry.rcDelegate = 'dry-run';
      } else {
        try {
          const txid = await broadcast(
            [['custom_json', {
              required_auths: [],
              required_posting_auths: [ACCOUNT],
              id: 'rc',
              json: JSON.stringify(['delegate_rc', { from: ACCOUNT, to: soldier.name, vesting_shares: rcVests + ' VESTS' }]),
            }]],
            [POSTING_WIF]
          );
          entry.rcDelegate = txid;
          log('@' + soldier.name + ': RC delegation ' + rcSp + ' SP broadcast txid=' + txid);
        } catch (e) {
          entry.rcDelegate = 'FAILED: ' + String(e.message || e).slice(0, 120);
          log('@' + soldier.name + ': RC delegation FAILED — ' + (e.message || e));
        }
      }
      await sleep(6000);
    }

    results.push(entry);
  }

  // ── read-side verification: max_rc after delegation + auths visible ──
  let rcVerified = null;
  try {
    const rc = await rpcV4(STEEM_RPC, { jsonrpc: '2.0', method: 'rc_api.find_rc_accounts', params: { accounts: army.map((a) => a.name) }, id: 3 });
    rcVerified = (rc.rc_accounts || []).map((r) => ({ account: r.account, max_rc: Number(r.max_rc) }));
  } catch (_) { /* optional */ }

  const ok = results.every((r) => !String(r.postingAuth || '').startsWith('FAILED') && !String(r.rcDelegate || '').startsWith('FAILED'));
  const out = { at: new Date().toISOString(), account: ACCOUNT, rcSp, results, rcVerified, ok, verifier: 'get_accounts → posting.account_auths contains @' + ACCOUNT + '; rc_api.find_rc_accounts → max_rc includes delegated VESTS' };
  fs.writeFileSync(path.join(__dirname, 'harden_result.json'), JSON.stringify(out, null, 2) + '\n');
  console.log('─'.repeat(74));
  console.log(ok ? 'VERDICT: TOPOLOGY HARDENED ✅ — ' + results.length + ' accounts under operator command + RC armed' : 'VERDICT: partial failures ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('harden fatal:', e.stack || e.message);
  try {
    fs.writeFileSync(path.join(__dirname, 'harden_result.json'), JSON.stringify({ at: new Date().toISOString(), ok: false, error: String(e.message || e).slice(0, 300) }, null, 2));
  } catch (_) { /* non-fatal */ }
  process.exit(2);
});
