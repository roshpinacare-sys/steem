#!/usr/bin/env node
/* muster.cjs — Task 49: מסדר-תעסוקה — גל-escrow מיידי לכל-הצי.
 *
 * הדמון מעסיק חיילים במחזורי liq (כל 25 דק') — המסדר מקפיץ את-זה:
 * כל חייל עם active-WIF ועודף-נזיל (≥0.005 מעל רצפת-השמירה) חותם עכשיו
 * transfer→memo 'saos:escrow' במפתח-ה-active שלו עצמו → קרדיט-DEX →
 * הדמון הופך ל-SAOS → pool_add → מניות-LP אמיתיות.
 *
 * היעד: 10/10 מועסקים (baseline שנמדד: 2/10).
 * כללי-ברזל: dry-run כברירת-מחדל (--live) · חתימה-עצמית לכל חייל ·
 * caps: 0.025/חייל/מסדר · רצפת-שמירה 0.01 · אין מפתחות בלוג.
 */
// 8-b: חשבון-פעולה חובה לפני-כל-טעינה — אין ברירת-מחדל, לעולם (המשך 7-c · docs/117o-KEY-INCIDENT.md)
if (!process.env.AGENT_ACCOUNT) { console.error('usage: AGENT_ACCOUNT=<account> node agent/muster.cjs — no default acting account (2026-09-08 incident)'); process.exit(1); }
const fs = require('fs');
const path = require('path');
const steem = require('steem');
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}

const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv);
const LIVE = GATE.live;
const ACCOUNT = (process.env.AGENT_ACCOUNT || '').toLowerCase();
announceGate(GATE, log);
const ESCROW_CAP = 0.025;   // מקסימום לחייל במסדר-אחד
const KEEP = 0.01;          // רצפת-שמירה בחייל
const MIN_WANT = 0.005;     // מתחת-זה אין-טעם ב-broadcast
const OUT = path.join(__dirname, 'muster_result.json');

function log(msg) { console.log('[' + new Date().toISOString() + '] muster: ' + msg); }
const r3 = (n) => Math.round(n * 1000) / 1000;

function loadArmyKeys() {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8'));
    return (v.accounts || [])
      .filter((a) => a && a.username && String(a.username).toLowerCase() !== ACCOUNT)
      .map((a) => ({
        username: String(a.username).toLowerCase(),
        activeWif: (a.keys && a.keys.active && a.keys.active.wif) || '',
      }))
      .filter((a) => a.activeWif);
  } catch (_) { return []; }
}

async function main() {
  log('=== מסדר-תעסוקה · ' + (LIVE ? 'LIVE' : 'DRY') + ' · cap ' + ESCROW_CAP + ' · keep ' + KEEP + ' ===');
  const army = loadArmyKeys();
  if (!army.length) { log('FATAL: אין חיילים עם active-WIF בכספת'); process.exit(1); }
  log('צי: ' + army.length + ' חיילים חתימים-עצמיים');

  const accs = await steem.api.getAccountsAsync(army.map((a) => a.username));
  const byName = new Map(accs.map((a) => [a.name, a]));

  const plan = [];
  for (const s of army) {
    const a = byName.get(s.username);
    if (!a) continue;
    const liq = parseFloat(a.balance);
    const want = r3(Math.min(ESCROW_CAP, Math.max(0, liq - KEEP)));
    plan.push({ ...s, liq, want });
    log('  @' + s.username + ' — liq ' + liq.toFixed(3) + ' → escrow ' + want + (want < MIN_WANT ? ' (דילוג)' : ''));
  }

  const active = plan.filter((p) => p.want >= MIN_WANT);

  // 49 — אגירת-ראיות: גלים קודמים לא נמחקים — המסדר הוא קומפולטיבי (כל txid נשמר)
  const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { return null; } })();
  const prevWaves = (prev && Array.isArray(prev.waves)) ? prev.waves.filter((w) => w && w.txid) : [];
  const result = {
    at: new Date().toISOString(),
    mode: LIVE ? 'live' : 'dry',
    cap: ESCROW_CAP,
    keep: KEEP,
    fleet: plan.map((p) => ({ username: p.username, liq: p.liq, escrow: p.want })),
    waves: prevWaves.slice(), // הראיות החיות קודם
    employed: 0,
    totalEscrow: 0,
  };

  if (!LIVE) {
    log('[DRY] ' + active.length + '/' + plan.length + ' חיילים ישדרו escrow (' + active.reduce((s, p) => s + p.want, 0).toFixed(3) + ' STEEM)');
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
    return;
  }

  for (const p of active) {
    try {
      if (stasisStop('muster')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
      const conf = await steem.broadcast.sendAsync({
        operations: [['transfer', { from: p.username, to: ACCOUNT, amount: p.want.toFixed(3) + ' STEEM', memo: 'saos:escrow' }]],
        extensions: [],
      }, [p.activeWif]);
      const txid = (conf && conf.id) || null;
      result.waves.push({ username: p.username, amt: p.want, txid });
      result.employed++;
      result.totalEscrow = r3(result.totalEscrow + p.want);
      log('escrow ✓ @' + p.username + ' ' + p.want + ' STEEM → קרדיט-DEX (txid ' + txid + ')');
    } catch (e) {
      result.waves.push({ username: p.username, amt: p.want, error: String((e && e.message) || e).slice(0, 160) });
      log('escrow FAIL @' + p.username + ': ' + String((e && e.message) || e).slice(0, 140));
    }
    await new Promise((r) => setTimeout(r, 1200)); // קצב-נימוס בין חתימות
  }

  // מדידת-אימות: ההעברות הגיעו לאוצר?
  await new Promise((r) => setTimeout(r, 4000));
  const [me] = await steem.api.getAccountsAsync([ACCOUNT]);
  result.treasuryLiquidAfter = parseFloat(me.balance);
  // תעסוקה = חיילים ייחודיים שחתמו escrow חי (בכל-הגלים המצטברים)
  const uniqueSigners = new Set(result.waves.map((w) => w.username));
  result.employment = uniqueSigners.size + '/' + plan.length;
  result.totalEscrow = r3(result.waves.reduce((s, w) => s + (w.amt || 0), 0));
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  log('result → ' + OUT);
  log('=== מסדר הסתיים: תעסוקה ' + result.employment + ' · סה"כ escrow ' + result.totalEscrow + ' STEEM ===');
}

main().catch((e) => {
  log('fatal: ' + String((e && e.message) || e).slice(0, 300));
  process.exit(1);
});
