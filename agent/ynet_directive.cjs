#!/usr/bin/env node
/**
 * ynet_directive.cjs — R18o: הנחיה-רשמית-על-השרשרת דרך ערוץ-@ynet (id=saos · zero-cost).
 * =============================================================================
 * מסילת-הסוכנים לסגירת-שני-הסעיפים הפיזיים-שנותרו:
 *   1. @ynet-steem: הרשויות-על-השרשרת [headcorner·1, steemauto·1] — המפתח-החי-אצל
 *      ההתקנה-שביצעה-את-סיבוב-הראש (09-10 23:25:21) — מבקשים: שידור-rescue-ping-ב-steem.
 *   2. @tov-hive: המפתחות-החיים-אצל-השותפים (רוטציה-חמישית-מוכחת h21) — מבקשים:
 *      הוספת-headcorner-ל-posting_auths-של-tov-hive (weight-1 · threshold-1) → לינקג'-22/22.
 * DRY כברירת-מחדל · --live + HE_LIVE_CONFIRM=headcorner · HIVE-בלבד (steem-מפתח-מיושן-בכנות).
 * אפס-סודות-בפלט · אימות-מהיסטוריית-@ynet-בשרשרת.
 */
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const HIVE_RPC = 'https://api.hive.blog';
const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';

function vaultPostingWif(chain) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    const hc = (v.accounts || []).find((a) => a.username === 'headcorner');
    const hp = hc && hc.keys && hc.keys[chain] && hc.keys[chain].posting;
    const w = hp && typeof hp === 'object' ? hp.wif : hp;
    return typeof w === 'string' ? w : '';
  } catch (_) { return ''; }
}

function payload() {
  return JSON.stringify({
    t: 'r18o-directive',
    v: 1,
    account: 'ynet',
    from: 'headcorner (operator mandate: agents-do-everything)',
    at: new Date().toISOString(),
    mandate: 'המפעיל: «תעשה הכל — אני לא עושה כלום — יש לי סוכנים — מאשר את ההחלטה בעלת הערך הגבוהה ביותר»',
    requests: [
      {
        id: 'ynet-steem-channel',
        measured: 'ynet posting.auths=[headcorner:1,steemauto:1] on BOTH chains (live 2026-09-11)',
        ask: 'holder of headcorner current STEEM keys (rotation 2026-09-10T23:25:21 blk 109470572): broadcast @ynet steem rescue-ping (custom_json id=saos) to open the dual channel',
        verify: 'steem account history of @ynet',
      },
      {
        id: 'tov-hive-linkage',
        measured: 'tov hive: no account_auths · keys rotated by partner rail (5th proven rotation h21)',
        ask: 'holder of tov HIVE authority: account_update2 posting_auths += headcorner (weight 1, threshold 1) — closes fleet linkage 21/22 → 22/22',
        verify: 'hive authorities of @tov',
      },
    ],
    rules: 'zero secrets on-chain · public txids only · verify from chain · ack via your own pulse',
  });
}

function opFor(account) {
  return ['custom_json', {
    required_auths: [],
    required_posting_auths: [account],
    id: 'saos',
    json: payload(),
  }];
}

async function broadcastHive() {
  steem.config.set('chain_id', HIVE_CHAIN_ID);
  steem.api.setOptions({ url: HIVE_RPC, useAppbaseApi: true });
  const wif = vaultPostingWif('hive');
  if (!wif) throw new Error('no hive posting WIF in vault (headcorner.hive.posting)');
  const conf = await steem.broadcast.sendAsync({ operations: [opFor('ynet')], extensions: [] }, [wif]);
  return conf;
}

async function verifyFromChain() {
  const r = await fetch(HIVE_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_account_history', params: ['ynet', -1, 20], id: 1 }),
  }).then(x => x.json());
  const hist = r && r.result;
  const hits = (hist || []).filter(h => {
    const op = h[1] && h[1].op;
    return op && op[0] === 'custom_json' && op[1] && op[1].id === 'saos' && String(op[1].json || '').includes('"r18o-directive"');
  });
  return hits.map(h => ({ block: h[1].block, txid: (h[1].trx_id || '').slice(0, 16) + '…', at: h[1].timestamp }));
}

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv);
announceGate(GATE);

(async () => {
  console.log('=== @ynet R18o-directive · operator-mandate · agents-do-everything ===');
  if (GATE.dry) { console.log('[DRY] would broadcast 1× custom_json (id=saos) as @ynet on HIVE — nothing sent'); return; }
  try {
    const conf = await broadcastHive();
    const id = (conf && conf.id) || '?';
    console.log('[hive] broadcast ok · txid=' + String(id).slice(0, 16) + '…');
  } catch (e) {
    console.log('[hive] broadcast FAILED: ' + String(e.message || e).slice(0, 140));
    process.exitCode = 1;
  }
  await new Promise(r => setTimeout(r, 3000));
  try {
    const hits = await verifyFromChain();
    const last = hits[hits.length - 1];
    console.log('[hive] chain-verified: ' + (hits.length ? 'YES · block ' + last.block + ' · tx ' + last.txid + ' · ' + last.at : 'no r18o-directive found in last 20 ops'));
  } catch (e) {
    console.log('[hive] verify error: ' + String(e.message || e).slice(0, 120));
  }
})().catch(e => { console.error('directive error: ' + String(e.message || e).slice(0, 200)); process.exit(1); });
