#!/usr/bin/env node
/* liq_seed.cjs — Task 47: מזריע-נזילות חד-פעמי (רוץ-מהקונסולה / exec-whitelist).
 *
 * פעימה-אחת מלאה של ממלכת-הנזילות, בלי לחכות לטיימר של הדמון:
 *   1. מדידה — snapshot ה-DEX מה-replay (הספר, הבריכות, היתרות)
 *   2. ביטול מדפים תקועים (כמו ה-ask האבסורדי 1551) — תמיד
 *   3. זריעת-בריכה אם אין בריכה: pool_init + pool_add (fee 30bps)
 *   4. הצבת grid סביב מחיר-הוגן מעוגן-כושר-פירעון (≤5 custom_json לעסקה)
 *   5. דיווח מלא — ללא מפתחות בלוג
 *
 * כללי-ברזל: חומת-5-custom_json-לבלוק (נמדדה) · dry-run כברירת-מחדל (--live
 * לשידור אמיתי) · כל המחירים מהמדידה.
 */
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const LIVE = process.argv.includes('--live');
const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const API = (process.env.DEX_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const RPC = process.env.STEEM_RPC || 'https://api.steemit.com';

const GRID_LEVELS = 3;
const STEP_PCT = 3;
const FAIR_PREMIUM = 1.25;
const FAIR_CAP_X = 3;
const OPS_CAP = 5; // חומת-5-custom_json-לחשבון-לבלוק (limits.json)
const POOL_SEED_SAOS = 2;
const POOL_SEED_STEEM = 0.1;
const MIN_SAOS = 0.05;

let postingWif = process.env.POSTING_WIF || '';
let activeWif = process.env.ACTIVE_WIF || '';
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  if (!postingWif) postingWif = (env.match(/^POSTING_WIF=(.+)$/m) || [])[1]?.trim() || '';
  if (!activeWif) activeWif = (env.match(/^ACTIVE_WIF=(.+)$/m) || [])[1]?.trim() || '';
} catch (_) { /* אין .env */ }

const r3 = (n) => Math.round(n * 1000) / 1000;
const r6 = (n) => Math.round(n * 1e6) / 1e6;

function busOp(payload) {
  return [
    'custom_json',
    {
      required_auths: [],
      required_posting_auths: [ACCOUNT],
      id: 'saos',
      json: JSON.stringify({ protocol: 'saos/v1', ...payload }),
    },
  ];
}

async function main() {
  console.log('=== SAOS liq-seed · ' + (LIVE ? 'LIVE' : 'DRY') + ' · @' + ACCOUNT + ' ===');
  const res = await fetch(API + '/api/ops/saos/dex?username=' + encodeURIComponent(ACCOUNT));
  const dex = await res.json();
  if (!dex || dex.ok !== true) {
    console.log('FATAL: dex snapshot unavailable: ' + ((dex && dex.error) || 'unknown'));
    process.exit(1);
  }
  const supply = (dex.balances || []).reduce((s, b) => s + b.saos + b.locked, 0);
  const issuerSteem = dex.solvency.issuerLiquidSteem != null ? Number(dex.solvency.issuerLiquidSteem) : null;
  console.log('book: ' + (dex.book.asks || []).length + ' asks / ' + (dex.book.bids || []).length + ' bids · supply≈' + r3(supply) + ' · issuer STEEM=' + issuerSteem);
  const pool = (dex.pools || []).find((p) => p.pair === 'SAOS:STEEM') || null;
  console.log('pool: ' + (pool ? 'reserves ' + pool.saos + ' SAOS / ' + pool.steem + ' STEEM · k=' + r6(pool.saos * pool.steem) + ' · swaps=' + pool.swaps + ' · fees=' + pool.feesSaos + '/' + pool.feesSteem : 'none'));

  const ops = [];
  const bits = [];
  const nowIso = new Date().toISOString();

  // 1) ביטול מדפים תקועים — תמיד (מרחיב נזיל נעול)
  const mine = (arr) => (arr || []).filter((o) => o.owner === ACCOUNT);
  for (const o of mine(dex.book.asks)) {
    if (ops.length >= OPS_CAP) break;
    ops.push(busOp({ action: 'cancel', oid: o.oid, account: ACCOUNT, time: nowIso }));
    bits.push('cancel ask ' + r3(o.remaining) + '@' + o.price);
  }
  for (const o of mine(dex.book.bids)) {
    if (ops.length >= OPS_CAP) break;
    ops.push(busOp({ action: 'cancel', oid: o.oid, account: ACCOUNT, time: nowIso }));
    bits.push('cancel bid ' + r3(o.remaining) + '@' + o.price);
  }

  // 2) זריעת-בריכה אם אין (דורשת SAOS נזיל + קרדיט פנוי)
  const meBal = (dex.balances || []).find((b) => b.account === ACCOUNT);
  const saosLiquid = meBal ? meBal.saos : 0;
  const myBids = mine(dex.book.bids);
  const myBidLock = myBids.reduce((s, o) => s + o.remaining * o.price, 0);
  const creditAvail = Math.max(0, (meBal ? meBal.credit : 0) - Math.max(0, 0 - myBidLock));
  if (!pool && saosLiquid >= MIN_SAOS && creditAvail >= POOL_SEED_STEEM && ops.length + 2 <= OPS_CAP) {
    const saosSeed = Math.min(r3(POOL_SEED_SAOS), r3(saosLiquid * 0.4));
    const steemSeed = Math.min(r6(POOL_SEED_STEEM), r6(creditAvail * 0.4));
    if (saosSeed >= MIN_SAOS && steemSeed >= 0.01) {
      ops.push(busOp({ action: 'pool_init', pair: 'SAOS:STEEM', feeBps: 30, account: ACCOUNT, time: nowIso }));
      ops.push(busOp({ action: 'pool_add', pair: 'SAOS:STEEM', account: ACCOUNT, saosAmt: saosSeed, steemAmt: steemSeed, time: nowIso }));
      bits.push('pool seed ' + saosSeed + ' SAOS + ' + steemSeed + ' STEEM');
    }
  }

  // 3) grid סביב ההוגן — רק אם אפשר לחשב רצפה
  if (supply > 0 && issuerSteem > 0) {
    const floor = issuerSteem / supply;
    const fair = floor * FAIR_PREMIUM; // הזריעה-הנקייה לא מצטטת מעל ההבטחה — עוגן רצפה בלבד
    console.log('fair: floor=' + r6(floor) + ' · fair=' + r6(fair) + ' STEEM/SAOS');
    const askLevelSaos = Math.min(r3((saosLiquid * 0.7) / GRID_LEVELS), 60);
    for (let k = GRID_LEVELS; k >= 1 && ops.length < OPS_CAP; k--) {
      if (askLevelSaos < MIN_SAOS) break;
      const price = r6(fair * (1 + (STEP_PCT / 100) * k));
      const oid = ACCOUNT + '-' + Date.now().toString(36) + '-a' + k;
      ops.push(busOp({ action: 'order', oid, side: 'sell', price, amount: askLevelSaos, account: ACCOUNT, time: nowIso }));
      bits.push('ask L' + k + ' ' + askLevelSaos + ' @ ' + price);
    }
  } else {
    console.log('grid: fair not computable (supply=' + r3(supply) + ', issuer=' + issuerSteem + ') — seed/cancels only');
  }

  if (ops.length === 0) {
    console.log('nothing to do — book clean, pool exists, inventory empty');
    process.exit(0);
  }
  console.log('ops (' + ops.length + '/' + OPS_CAP + '): ' + bits.join(' · '));
  if (!LIVE) {
    console.log('DRY — לא שודר. הרץ עם --live לשידור אמיתי.');
    process.exit(0);
  }
  if (!postingWif) {
    console.log('FATAL: אין POSTING_WIF ב-.env — חתימה בלתי-אפשרית');
    process.exit(1);
  }
  steem.api.setOptions({ url: RPC });
  const conf = await steem.broadcast.sendAsync({ operations: ops, extensions: [] }, [postingWif]);
  console.log('BROADCAST OK txid=' + ((conf && conf.id) || 'n/a') + ' · ' + ops.length + ' op(s)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('liq-seed FAILED: ' + ((e && e.message) || e));
    process.exit(1);
  });
