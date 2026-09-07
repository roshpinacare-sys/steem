#!/usr/bin/env node
/**
 * verify_worldlog.cjs — Task 44 SCI: independent world-log verifier.
 *
 * Pulls the hash-chained 'saos' wlog events authored by the account from
 * BOTH chains (Steem + Hive) via public RPC, then proves:
 *   1. HASH CHAIN   — for every seq: h == sha256(seq|prev|time|body) and
 *                     prev == h(seq-1). Any tampering breaks the linkage.
 *   2. CROSS-CHAIN PARITY — the SAME seq carries the SAME h on both chains
 *                     (the ledger is notarized on two independent chains).
 *
 * Output: agent/worldlog_verify.json  { ok, depth, parity, linkage, ... }
 * Anyone can re-run this with nothing but the account name — third-party
 * verifiability is the whole point.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

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
const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';

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

function wlogHash(seq, prev, time, body) {
  return crypto.createHash('sha256').update(seq + '|' + prev + '|' + time + '|' + JSON.stringify(body)).digest('hex').slice(0, 24);
}

/** Pull all wlog events of the account from one chain's public history. */
async function fetchWlog(rpcUrl, chain) {
  const hist = await rpcV4(rpcUrl, {
    jsonrpc: '2.0',
    method: 'condenser_api.get_account_history',
    params: [ACCOUNT, -1, 100],
    id: 1,
  });
  const events = new Map(); // seq → {h, prev, time, txid}
  for (const [, e] of hist) {
    if (e.op[0] !== 'custom_json' || e.op[1].id !== 'saos') continue;
    let pl = null;
    try { pl = JSON.parse(String(e.op[1].json || '{}')); } catch (_) { continue; }
    if (!pl || pl.protocol !== 'saos/v1' || pl.action !== 'wlog') continue;
    if (String(pl.account || '').toLowerCase() !== ACCOUNT) continue;
    if (!events.has(pl.seq)) {
      events.set(pl.seq, { seq: pl.seq, prev: pl.prev, h: pl.h, time: pl.time, body: pl.body, txid: e.trx_id || '' });
    }
  }
  return events;
}

async function main() {
  console.log('═'.repeat(74));
  console.log('SAOS WORLD-LOG VERIFIER · @' + ACCOUNT + ' · ' + new Date().toISOString());
  console.log('═'.repeat(74));
  const problems = [];
  let linkage = null;
  let parity = null;
  let depth = 0;

  const [steemEvents, hiveEvents] = await Promise.all([
    fetchWlog(STEEM_RPC, 'steem'),
    fetchWlog(HIVE_RPC, 'hive'),
  ]);
  console.log('steem wlog events: ' + steemEvents.size + ' · hive wlog events: ' + hiveEvents.size);

  // ── 1) hash-chain linkage (recompute every hash from public data) ──
  const seqs = [...steemEvents.keys()].sort((a, b) => a - b);
  depth = seqs.length;
  if (depth === 0) {
    problems.push('no wlog events found on Steem — the log has not started');
    linkage = false;
  } else {
    let expectedPrev = 'GENESIS';
    linkage = true;
    for (const seq of seqs) {
      const ev = steemEvents.get(seq);
      const recomputed = wlogHash(seq, ev.prev, ev.time, ev.body);
      if (recomputed !== ev.h) {
        linkage = false;
        problems.push('seq ' + seq + ': recomputed hash mismatch (' + recomputed + ' ≠ ' + ev.h + ') — payload was tampered');
      }
      if (ev.prev !== expectedPrev) {
        linkage = false;
        problems.push('seq ' + seq + ': prev=' + ev.prev + ' ≠ h(seq ' + (seq - 1) + ')=' + expectedPrev + ' — order/reparenting tampered');
      }
      expectedPrev = ev.h;
    }
    console.log('linkage: ' + (linkage ? 'VALID' : 'BROKEN') + ' over ' + depth + ' events (genesis→seq ' + seqs[seqs.length - 1] + ')');
  }

  // ── 2) cross-chain parity: same seq → same hash on both chains ──
  const common = [...steemEvents.keys()].filter((s) => hiveEvents.has(s));
  const steemOnly = [...steemEvents.keys()].filter((s) => !hiveEvents.has(s));
  if (depth === 0) {
    parity = false;
  } else if (common.length === 0) {
    parity = false;
    problems.push('no seq exists on both chains — parity not established yet (Hive replication pending)');
  } else {
    parity = true;
    for (const seq of common) {
      const s = steemEvents.get(seq);
      const hv = hiveEvents.get(seq);
      if (s.h !== hv.h) {
        parity = false;
        problems.push('seq ' + seq + ': hash differs between chains (steem=' + s.h + ' hive=' + hv.h + ') — CONFLICT');
      }
      if (JSON.stringify(s.body) !== JSON.stringify(hv.body)) {
        parity = false;
        problems.push('seq ' + seq + ': body differs between chains — CONFLICT');
      }
    }
    console.log('parity: ' + (parity ? 'VALID' : 'CONFLICT') + ' over ' + common.length + ' common seqs' + (steemOnly.length ? ' · steem-only: ' + steemOnly.join(',') : ''));
  }

  const ok = linkage === true && parity === true && depth >= 1;
  const last = depth ? steemEvents.get(seqs[depth - 1]) : null;
  const result = {
    at: new Date().toISOString(),
    account: ACCOUNT,
    ok,
    depth,
    lastSeq: depth ? seqs[depth - 1] : 0,
    lastHash: last ? last.h : null,
    linkage,
    parity,
    steemOnlySeqs: steemOnly,
    verifier: 'sha256(seq|prev|time|body) recomputed from public RPC history on both chains; prev must equal previous h; identical seq must carry identical h on Steem AND Hive',
    problems: problems.slice(0, 10),
  };
  fs.writeFileSync(path.join(__dirname, 'worldlog_verify.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('─'.repeat(74));
  if (ok) {
    console.log('VERDICT: WORLD-LOG PROVEN — ' + depth + ' events, linkage VALID, dual-chain parity VALID ✅');
  } else {
    console.log('VERDICT: ' + (problems.length ? problems.join(' · ') : 'insufficient events') + ' ❌');
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('verify_worldlog fatal:', e.message);
  try {
    fs.writeFileSync(path.join(__dirname, 'worldlog_verify.json'), JSON.stringify({ at: new Date().toISOString(), ok: false, error: String(e.message || e) }, null, 2));
  } catch (_) { /* non-fatal */ }
  process.exit(2);
});
