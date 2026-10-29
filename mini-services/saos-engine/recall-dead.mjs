#!/usr/bin/env node
// recall-dead.mjs — recall headcorner's delegations to provably-dead accounts.
// Recalled: hcsoldier4-7 (keys died with sandbox, unrecoverable: 229 cloud passes + census verify 0)
//           saos-0001..0009 (permanently retired per dead-key verdict).
// KEPT: cashmachine/haran/israelnews/lsa/macrame (GEN-archive recoverable), siq/tov/wic/wog/woq (same),
//       hive-177702 (community).
// Nothing is deleted on-chain (delegate→0 is reversible). Fingerprints only, no key material printed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { buildTx } from './steemtx.mjs';

const ACC = 'headcorner';
const rpc = async (method, params) => {
  for (const node of ['https://api.steemit.com', 'https://api.justyy.com']) {
    try {
      const r = await fetch(node, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }), signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      if (j.error) continue;
      return j.result;
    } catch {}
  }
  throw new Error('rpc fail: ' + method);
};

const map = JSON.parse(readFileSync('/home/z/fleet/steem/.secrets/custody-vault/crown-map.json', 'utf8'));
const wif = map.headcorner.active;
if (!wif) throw new Error('no headcorner.active in crown-map');

const RECALL = ['hcsoldier4', 'hcsoldier5', 'hcsoldier6', 'hcsoldier7',
  'saos-0001', 'saos-0002', 'saos-0003', 'saos-0004', 'saos-0005', 'saos-0006', 'saos-0007', 'saos-0008', 'saos-0009'];

// 1. measure
const del = await rpc('condenser_api.get_vesting_delegations', [ACC, '', 100]);
const before = {};
let freedVests = 0;
for (const d of del) {
  if (RECALL.includes(d.delegatee)) { before[d.delegatee] = d.vesting_shares; freedVests += parseFloat(d.vesting_shares); }
}
console.log(`measured: ${Object.keys(before).length} recall targets, ${freedVests.toFixed(6)} VESTS frozen`);

// 2. broadcast (single tx, 13 ops, active authority)
const dgpo = await rpc('condenser_api.get_dynamic_global_properties', []);
const ops = RECALL.map((d) => ['delegate_vesting_shares', { delegator: ACC, delegatee: d, vesting_shares: '0.000000 VESTS' }]);
const tx = buildTx({ ops, dgpo, wifs: [wif], ttlSec: 60 });
let ok = false, lastErr = '';
for (const node of ['https://api.steemit.com', 'https://api.justyy.com']) {
  try {
    const r = await fetch(node, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [tx.json], id: 1 }),
      signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (j.error) { lastErr = String(j.error.message).slice(0, 200); console.log(`  ${node} REJECT: ${lastErr}`); continue; }
    ok = true; console.log(`  ${node} ACCEPTED`); break;
  } catch (e) { lastErr = String(e?.message ?? e).slice(0, 160); }
}
if (!ok) { console.error('broadcast FAILED:', lastErr); process.exit(1); }

// 3. readback (B10 law)
await new Promise((r) => setTimeout(r, 4000));
const del2 = await rpc('condenser_api.get_vesting_delegations', [ACC, '', 100]);
const after = {};
for (const d of del2) if (RECALL.includes(d.delegatee)) after[d.delegatee] = d.vesting_shares;
const remaining = Object.values(after).filter((v) => parseFloat(v) > 0);
console.log(`readback: ${RECALL.length - remaining.length}/${RECALL.length} recalled to 0 (pending-return); maturation 7 days`);
if (remaining.length) console.log('  still delegated:', JSON.stringify(after));

// 4. receipt
mkdirSync('/home/z/fleet/steem/receipts', { recursive: true });
writeFileSync('/home/z/fleet/steem/receipts/recall-dead-2026-10-29.json', JSON.stringify({
  at: new Date().toISOString(), event: 'DEAD-DELEGATION-RECALL',
  recalled: RECALL, freedVests: freedVests.toFixed(6), freedSP: (freedVests / 1610.4745).toFixed(2),
  keptRecoverable: ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'],
  keptCommunity: ['hive-177702'],
  maturationDays: 7, broadcastOk: ok, readbackPending: remaining.length,
  law: 'owner mandate: activate-all + soldier >=300 Steem; dead soldiers replaced post-powerdown-payout 2026-11-05',
  nextFundingEvent: 'powerdown payout 2026-11-05T10:58:15 (~305 STEEM) -> create soldiers -> delegate >=300 SP each',
}, null, 1));
console.log('receipt written');
