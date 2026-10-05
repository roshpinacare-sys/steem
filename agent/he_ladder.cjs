#!/usr/bin/env node
/* he_ladder.cjs — Task 49: גיוס-הון אמיתי ראשון — סולם-מכירה על Hive-Engine.
 *
 * הארנק-HE מחזיק טוקנים מתים-למחצה (WAIV·CENT·VKBT·POSH·PIZZA·SPORTS).
 * סולם זה מוכר כל-אחד לתוך ה-bid החי הגבוה (מחיר 97% מה-bid → חוצה את הספר
 * → מתממש במחירי-bid אמיתיים) → SWAP.HIVE נזיל — מקור-ההון החיצוני הראשון.
 *
 * שונה מ-he_sell (מכירה-בודדת): סולם מלא-על-כל-הארנק בריצה-אחת + מדידת-סט.
 * כללי-ברזל: dry-run כברירת-מחדל (--live) · חתימת active על Hive ·
 * דילוג-כנה כשאין-counterparty · אין מפתחות בלוג.
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/he_ladder.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const https = require('https');
const steem = require('steem');
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}

const HIVE_CHAIN_ID = 'beeab0de00000000000000000000000000000000000000000000000000000000';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const HE_RPC = 'https://api.hive-engine.com/rpc/contracts';
const OUT = path.join(__dirname, 'he_ladder_result.json');
const CROSS_PCT = 0.97; // 97% מה-bid הגבוה → חוצה-ספר → מתממש מיידית

let activeWif = process.env.ACTIVE_WIF || '';
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  if (!activeWif) activeWif = (env.match(/^ACTIVE_WIF=(.+)$/m) || [])[1]?.trim() || '';
} catch (_) { /* אין .env */ }

const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
function log(msg) { console.log('[' + new Date().toISOString() + '] ladder: ' + msg); }
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: ACCOUNT });
const LIVE = GATE.live;
announceGate(GATE, log);


function rpcV4(urlStr, body) {
  const u = new URL(urlStr);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname || '/', method: 'POST', family: 4, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 20000 },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || 'rpc error'));
            resolve(json.result);
          } catch (_) { reject(new Error('bad rpc response: ' + data.slice(0, 120))); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('rpc timeout 20s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const heFind = (contract, table, query, limit = 10) =>
  rpcV4(HE_RPC, { jsonrpc: '2.0', method: 'find', params: { contract, table, query, limit }, id: 1 });

async function main() {
  log('=== סולם-גיוס-הון HE · ' + (LIVE ? 'LIVE' : 'DRY') + ' · @' + ACCOUNT + ' ===');
  if (!activeWif) { log('FATAL: no ACTIVE_WIF'); process.exit(1); }

  const [balRows] = await Promise.all([heFind('tokens', 'balances', { account: ACCOUNT }, 100)]);
  const swp = (Array.isArray(balRows) ? balRows : []).find((b) => b.symbol === 'SWAP.HIVE');
  const swapHiveBefore = swp ? parseFloat(swp.balance) : 0;

  const candidates = (Array.isArray(balRows) ? balRows : [])
    .map((b) => ({ symbol: b.symbol, bal: parseFloat(b.balance) }))
    .filter((b) => b.symbol !== 'SWAP.HIVE' && b.symbol !== 'SWAP.HBD' && b.bal > 0)
    .sort((a, b) => b.bal - a.bal);
  log('ארנק: ' + candidates.map((c) => c.symbol + ':' + c.bal).join(' · ') + ' · SWAP.HIVE לפני=' + swapHiveBefore);

  const result = { at: new Date().toISOString(), mode: LIVE ? 'live' : 'dry', swapHiveBefore, orders: [], fills: [], skip: [] };

  for (const c of candidates) {
    // ספר-קניות חי לטוקן
    let bids;
    try { bids = await heFind('market', 'buyBook', { symbol: c.symbol }, 50); } catch (e) { log('skip ' + c.symbol + ' (book err)'); result.skip.push({ symbol: c.symbol, why: 'book-error' }); continue; }
    const rows = (Array.isArray(bids) ? bids : [])
      .map((b) => ({ price: parseFloat(b.price), qty: parseFloat(b.quantity), account: b.account }))
      .filter((b) => b.price > 0 && b.qty > 0)
      .sort((a, b) => b.price - a.price);
    const best = rows[0];
    if (!best) { log('skip ' + c.symbol + ' (' + c.bal + ' יח׳) — אין-counterparty (bid ריק)'); result.skip.push({ symbol: c.symbol, bal: c.bal, why: 'no-bid' }); continue; }

    const depth = rows.reduce((s, r) => s + r.qty, 0);
    const valueAtBest = best.price * Math.min(best.qty, c.bal);
    if (valueAtBest < 0.00001) { log('skip ' + c.symbol + ' — ערך-bid זעיר (' + valueAtBest.toExponential(2) + ' SWAP.HIVE)'); result.skip.push({ symbol: c.symbol, bal: c.bal, why: 'dust-value' }); continue; }

    const qty = c.bal.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    const price = Number((best.price * CROSS_PCT).toPrecision(8)); // HE: מחיר כמחרוזת (כמו he_sell שעבד) — נעטף ב-String
    log(c.symbol + ': bid-ראשון ' + best.price + ' × ' + best.qty.toFixed(0) + ' (@' + best.account + ') · depth ' + depth.toFixed(0) + ' → מוכר ' + qty + ' @ ' + price);

    if (!LIVE) { result.orders.push({ symbol: c.symbol, qty: parseFloat(qty), price: price, bid: best.price }); continue; }

    const op = ['custom_json', {
      required_auths: [ACCOUNT],
      required_posting_auths: [],
      id: 'ssc-mainnet-hive',
      json: JSON.stringify({ contractName: 'market', contractAction: 'sell', contractPayload: { symbol: c.symbol, quantity: String(qty), price: String(price) } }),
    }];
    try {
      if (stasisStop('he-ladder')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
      const dgp = await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.get_dynamic_global_properties', params: [], id: 2 });
      const tx = {
        ref_block_num: dgp.head_block_number & 0xffff,
        ref_block_prefix: Buffer.from(dgp.head_block_id, 'hex').readUInt32LE(4),
        expiration: new Date(new Date(dgp.time + 'Z').getTime() + 60000).toISOString().slice(0, 19),
        operations: [op],
        extensions: [],
      };
      const prev = steem.config.get('chain_id');
      steem.config.set('chain_id', HIVE_CHAIN_ID);
      let signed;
      try { signed = steem.auth.signTransaction(tx, [activeWif]); } finally { steem.config.set('chain_id', prev); }
      await rpcV4(HIVE_RPC, { jsonrpc: '2.0', method: 'condenser_api.broadcast_transaction', params: [signed], id: 3 });
      result.orders.push({ symbol: c.symbol, qty: parseFloat(qty), price: price, bid: best.price });
      log(c.symbol + ' ✓ הוגש-לספר');
    } catch (e) {
      result.orders.push({ symbol: c.symbol, qty: parseFloat(qty), error: String((e && e.message) || e).slice(0, 160) });
      log(c.symbol + ' FAIL: ' + String((e && e.message) || e).slice(0, 140));
    }
    await new Promise((r) => setTimeout(r, 2500));
  }

  if (LIVE && result.orders.length) {
    // יישוב-סולם: ה-HE כמעט-מיידי — המתנה קצרה ואז מדידת-סט
    await new Promise((r) => setTimeout(r, 9000));
    const [balRows2, trades] = await Promise.all([
      heFind('tokens', 'balances', { account: ACCOUNT }, 100),
      heFind('market', 'tradesHistory', {}, 30),
    ]);
    const swp2 = (Array.isArray(balRows2) ? balRows2 : []).find((b) => b.symbol === 'SWAP.HIVE');
    result.swapHiveAfter = swp2 ? parseFloat(swp2.balance) : 0;
    result.swapHiveDelta = Math.round((result.swapHiveAfter - result.swapHiveBefore) * 1e8) / 1e8;
    const mine = (Array.isArray(trades) ? trades : []).filter((t) => t.seller === ACCOUNT);
    result.fills = mine.map((t) => ({ symbol: t.symbol, qty: t.quantity, price: t.price, timestamp: t.timestamp }));
    log('יישוב: SWAP.HIVE ' + result.swapHiveBefore + ' → ' + result.swapHiveAfter + ' (Δ=' + result.swapHiveDelta + ') · מילויים-שלנו ב-tradesHistory: ' + result.fills.length);
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  log('result → ' + OUT);
  log('=== סולם הסתיים: ' + result.orders.length + ' הזמנות · ' + result.skip.length + ' דילוגים-כנים ===');
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
