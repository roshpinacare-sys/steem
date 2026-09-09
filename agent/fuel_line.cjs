#!/usr/bin/env node
/* fuel_line.cjs — Task 49: מסילת-הדלק — תעסוקה מלאה של הצבא.
 *
 * הבעיה שנמדדה: 10 חיילים בצי, רק 2 מועסקים (cashmachine+haran) —
 * שמונה חיילים מוחזקים בדלק-אבק (0.003–0.008 STEEM נזיל, SP עצמי 2–5) —
 * אין להם מה לשלוח ל-escrow ואין להם כוח-עסקאות.
 *
 * הפעולה (שתי טרנזקציות מקובצות, חתימת active של האוצר):
 *   tx1 — 10 × delegate_vesting_shares: 50 SP אמיתיים לכל חייל (500 SP מהאוצר, חוזרים אחרי 7 ימים)
 *   tx2 — 10 × transfer 0.03 STEEM memo 'saos:fuel' — הון-חוזר לתעסוקה (escrow→SAOS→LP)
 *
 * אחרי-הפעולה: מדידה חוזרת על השרשרת (received_vesting_shares) + fuel_result.json.
 * כלל-ברזל: dry-run כברירת-מחדל (--live לשידור) · אין מפתחות בלוג · הכל נמדד.
 */
const fs = require('fs');
const path = require('path');
const steem = require('steem');

const LIVE = process.argv.includes('--live');
const ACCOUNT = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
const SP_PER_SOLDIER = 50;
const FUEL_STEEM = 0.03;
const OUT = path.join(__dirname, 'fuel_result.json');

let activeWif = process.env.ACTIVE_WIF || '';
try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  if (!activeWif) activeWif = (env.match(/^ACTIVE_WIF=(.+)$/m) || [])[1]?.trim() || '';
} catch (_) { /* אין .env */ }

function log(msg) { console.log('[' + new Date().toISOString() + '] fuel: ' + msg); }
const r6 = (n) => Math.round(n * 1e6) / 1e6;

function loadArmy() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || [])
      .filter((a) => a && a.username && String(a.username).toLowerCase() !== ACCOUNT)
      .map((a) => String(a.username).toLowerCase());
  } catch (_) { return []; }
}

async function main() {
  log('=== מסילת-הדלק · ' + (LIVE ? 'LIVE' : 'DRY') + ' · @' + ACCOUNT + ' ===');
  if (!activeWif) { log('FATAL: no ACTIVE_WIF'); process.exit(1); }

  const army = loadArmy();
  if (!army.length) { log('FATAL: צבא ריק — אין כספת'); process.exit(1); }
  log('צי: ' + army.length + ' חיילים — ' + army.join(' '));

  // מדידה חיה: יחס-vests + מצב-דלק נוכחי
  const [dgpo, accs] = await Promise.all([
    steem.api.getDynamicGlobalPropertiesAsync(),
    steem.api.getAccountsAsync([ACCOUNT, ...army]),
  ]);
  const vestsPerSp = parseFloat(dgpo.total_vesting_shares) / parseFloat(dgpo.total_vesting_fund_steem);
  const vestsAmt = Math.floor(SP_PER_SOLDIER * vestsPerSp); // 50 SP ב-VESTS חיים
  const byName = new Map(accs.map((a) => [a.name, a]));
  const treasury = byName.get(ACCOUNT);
  const treasuryLiq = parseFloat(treasury.balance);

  log('יחס-חי: ' + r6(vestsPerSp) + ' VESTS/SP → ' + vestsAmt + ' VESTS ל-50SP');
  log('אוצר: ' + treasuryLiq.toFixed(3) + ' STEEM נזיל · ' + treasury.received_vesting_shares + ' מוקצה-אליו');

  const before = {};
  for (const name of army) {
    const a = byName.get(name);
    if (!a) { log('חסר על-השרשרת: ' + name); continue; }
    before[name] = {
      liquid: parseFloat(a.balance),
      receivedVests: parseFloat(a.received_vesting_shares),
      ownVests: parseFloat(a.vesting_shares),
    };
    log('  @' + name + ' — liq ' + before[name].liquid.toFixed(3) + ' · recv ' + before[name].receivedVests.toFixed(0) + ' vests');
  }

  const targetVests = vestsAmt.toFixed(6) + ' VESTS';
  const fuelPlan = army.filter((n) => before[n]);

  // tx1 — נציבות-SP (10 ops מקובצים)
  const delOps = fuelPlan.map((name) => [
    'delegate_vesting_shares',
    { delegator: ACCOUNT, delegatee: name, vesting_shares: targetVests },
  ]);
  // tx2 — הון-חוזר (10 ops מקובצים)
  const fuelOps = fuelPlan.map((name) => [
    'transfer',
    { from: ACCOUNT, to: name, amount: FUEL_STEEM.toFixed(3) + ' STEEM', memo: 'saos:fuel' },
  ]);

  const needLiq = FUEL_STEEM * fuelPlan.length;
  if (treasuryLiq < needLiq + 0.3) { log('FATAL: אוצר נזיל ' + treasuryLiq.toFixed(3) + ' < נדרש ' + needLiq.toFixed(3) + '+0.3 (רגל-פירעון)'); process.exit(1); }

  const result = {
    at: new Date().toISOString(),
    mode: LIVE ? 'live' : 'dry',
    vestsPerSp: r6(vestsPerSp),
    spPerSoldier: SP_PER_SOLDIER,
    vestsPerSoldier: vestsAmt,
    fuelSteem: FUEL_STEEM,
    soldiers: fuelPlan,
    before,
    delegations: null,
    capital: null,
  };

  if (!LIVE) {
    log('[DRY] tx1: ' + delOps.length + ' × delegate_vesting_shares (' + targetVests + ' לכל חייל)');
    log('[DRY] tx2: ' + fuelOps.length + ' × transfer ' + FUEL_STEEM + ' STEEM (memo saos:fuel)');
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
    log('dry-result → ' + OUT);
    return;
  }

  // שידור tx1 — נציבות
  log('שידור tx1: ' + delOps.length + ' נציבויות (' + (SP_PER_SOLDIER * fuelPlan.length) + ' SP סה"כ)...');
  const conf1 = await steem.broadcast.sendAsync({ operations: delOps, extensions: [] }, [activeWif]);
  const txid1 = (conf1 && conf1.id) || null;
  log('tx1 ✓ txid=' + txid1);
  result.delegations = { txid: txid1, ops: delOps.length, vestsEach: vestsAmt };

  // שידור tx2 — הון-חוזר
  log('שידור tx2: ' + fuelOps.length + ' העברות (' + needLiq.toFixed(3) + ' STEEM סה"כ)...');
  const conf2 = await steem.broadcast.sendAsync({ operations: fuelOps, extensions: [] }, [activeWif]);
  const txid2 = (conf2 && conf2.id) || null;
  log('tx2 ✓ txid=' + txid2);
  result.capital = { txid: txid2, ops: fuelOps.length, steemEach: FUEL_STEEM, total: r6(needLiq) };

  // אימות-אחרי: received_vesting על השרשרת (השהיה קצרה ליישום)
  await new Promise((r) => setTimeout(r, 4000));
  const accs2 = await steem.api.getAccountsAsync(fuelPlan);
  result.after = {};
  let confirmed = 0;
  for (const a of accs2) {
    const recv = parseFloat(a.received_vesting_shares);
    result.after[a.name] = { receivedVests: recv, liquid: parseFloat(a.balance) };
    if (recv >= vestsAmt * 0.999) confirmed++;
  }
  result.delegationConfirmed = confirmed + '/' + fuelPlan.length;
  log('אימות: ' + result.delegationConfirmed + ' חיילים עם ' + vestsAmt + ' vests מאומתים on-chain');

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  log('result → ' + OUT);
  log('=== הסתיים: ' + (SP_PER_SOLDIER * fuelPlan.length) + ' SP מוקצים · ' + needLiq.toFixed(3) + ' STEEM הון-חוזר · txids ' + txid1 + ' / ' + txid2 + ' ===');
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
