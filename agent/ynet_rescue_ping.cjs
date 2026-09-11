#!/usr/bin/env node
/**
 * ynet_rescue_ping.cjs — Task 57 LIVE proof: @ynet responds again.
 *
 * Broadcasts a zero-cost custom_json (id=saos) with
 * required_posting_auths=['ynet'], signed by headcorner's POSTING WIF —
 * valid because headcorner holds a posting account-authority on @ynet
 * (weight 1 / threshold 1, the rescue anchor preserved at Task 55).
 * Runs on BOTH chains, then verifies from @ynet's account history.
 * The WIF is read from agent/.env and NEVER printed.
 */
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const STEEM_RPC = 'https://api.steemit.com';
const HIVE_RPC = 'https://api.hive.blog';
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';

function envVal(name) {
  const m = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').match(new RegExp('^' + name + '=(.*)$', 'm'));
  return m ? m[1].trim() : '';
}

function now() { return new Date().toISOString(); }

const payload = JSON.stringify({
  t: 'rescue-ping',
  v: 57,
  account: 'ynet',
  from: 'headcorner (operator-delegated signing)',
  at: now(),
  note: 'soldier restored via preserved posting account-authority',
});

function opFor(account) {
  return ['custom_json', {
    required_auths: [],
    required_posting_auths: [account],
    id: 'saos',
    json: payload,
  }];
}

// R18n — מדיניות-משמורת-מערכת: ה-WIF-נשלף-מהכספת (agent/keys/vault.json · 0600 · מנוטרל-גיט)
// ולא-מ-agent/.env שמינימלי-בכוונה. אפס-ערכים-בפלט.
function vaultPostingWif(chain) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const hc = (v.accounts || []).find((a) => a.username === 'headcorner');
    const hp = hc && hc.keys && hc.keys[chain] && hc.keys[chain].posting;
    const w = hp && typeof hp === 'object' ? hp.wif : hp;
    return typeof w === 'string' ? w : '';
  } catch (_) { return ''; }
}

async function broadcastChain(rpc, chainId) {
  if (chainId) steem.config.set('chain_id', chainId);
  steem.api.setOptions({ url: rpc, useAppbaseApi: true });
  const chain = chainId ? 'hive' : 'steem';
  const wif = vaultPostingWif(chain) || envVal('POSTING_WIF');
  if (!wif) throw new Error('no posting WIF — vault(headcorner.' + chain + '.posting) and .env are both empty');
  const conf = await steem.broadcast.sendAsync({ operations: [opFor('ynet')], extensions: [] }, [wif]);
  return conf;
}

async function verifyFromChain(rpc, label) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: ['ynet', -1, 20], id: 1 }),
  }).then(x => x.json());
  const hist = r && r.result;
  const hits = (hist || []).filter(h => {
    const op = h[1] && h[1].op;
    return op && op[0] === 'custom_json' && op[1] && op[1].id === 'saos' && String(op[1].json || '').includes('"rescue-ping"');
  });
  return hits.map(h => ({ block: h[1].block, txid: (h[1].trx_id || '').slice(0, 16) + '…', at: h[1].timestamp }));
}

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv);
const DRY = GATE.dry;
announceGate(GATE);

(async () => {
  console.log('=== @ynet rescue-ping · operator-delegated signing · LIVE ===');
  if (DRY) { console.log('[DRY] LIVE-GATE — rescue-ping would broadcast as @ynet (operator-delegated) — nothing sent'); return; }
  // Steem
  try {
    const conf = await broadcastChain(STEEM_RPC, null);
    const id = (conf && conf.id) || '?';
    console.log('[steem] broadcast ok · txid=' + String(id).slice(0, 16) + '…');
  } catch (e) {
    console.log('[steem] broadcast FAILED: ' + String(e.message || e).slice(0, 140));
  }
  // Hive
  try {
    const conf = await broadcastChain(HIVE_RPC, HIVE_CHAIN_ID);
    const id = (conf && conf.id) || '?';
    console.log('[hive ] broadcast ok · txid=' + String(id).slice(0, 16) + '…');
  } catch (e) {
    console.log('[hive ] broadcast FAILED: ' + String(e.message || e).slice(0, 140));
  }
  steem.config.set('chain_id', undefined);

  // verify from chain (both)
  await new Promise(r => setTimeout(r, 3000));
  for (const [rpc, label] of [[STEEM_RPC, 'steem'], [HIVE_RPC, 'hive ']]) {
    try {
      const hits = await verifyFromChain(rpc, label);
      const last = hits[hits.length - 1];
      console.log('[' + label.trim() + '] chain-verified: ' + (hits.length ? 'YES · block ' + last.block + ' · tx ' + last.txid + ' · ' + last.at : 'no rescue-ping found in last 20 ops'));
    } catch (e) {
      console.log('[' + label.trim() + '] verify error: ' + String(e.message || e).slice(0, 120));
    }
  }
})().catch(e => { console.error('rescue error: ' + String(e.message || e).slice(0, 200)); process.exit(1); });
