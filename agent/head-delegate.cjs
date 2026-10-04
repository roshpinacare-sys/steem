#!/usr/bin/env node
/**
 * SAOS HEAD-DELEGATE ENGINE v1 — מנוע-הון-עצמי (Z-20, 2026-09-29)
 *
 * למה: הרשת מתחזקת את-עצמה. הראש מאציל 30 SP לכל-חייל (11 חיילים) — RC/קול-ערך
 * לכל-המטריצה. אידמפוטנטי: כבר-מאוצל מעל-סף → SKIP. סורג-בייטים: המפתח-הנגזר
 * מול active.key_auths בשרשרת → בלב-חתימה. קריאה-חוזרת לכל-האצלה. fail-soft.
 *
 * גבולות-קשיחים: רשימת-היעדים קבועה (צי-בלבד) · מקסימום 30 SP ליעד · אין-פעולות-אחרות.
 * הרצה: node agent/head-delegate.cjs   (VAULT_RECOVERY מהריפו-הפרטי · DRY=1 לבדיקה)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const steem = require('steem');
const capGate = require('./lib/capital_gate.cjs'); // owner directive 2026-10-04: think-before-sign (STASIS + roster + journal)

steem.api.setOptions({ url: 'https://api.steemit.com' });
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.RECEIPT_OUT || path.join(ROOT, 'agent', 'head-delegate-receipt.json');
const SOLDIERS = ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet']; // 11 — כולל ynet
const SP_PER_SOLDIER = 30;   // תקרה-קשיחה
const HEAD = 'headcorner';

// 10-d-3 (2026-09-30) — LIVE-GATE before vault/key recovery: delegation broadcasts need
// --live (or HE_LIVE=1) AND HE_LIVE_CONFIRM=headcorner. DRY=1 still forces dry. Fail-closed default.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: HEAD });
const DRY = process.env.DRY === '1' || GATE.dry;
announceGate(GATE);
if (GATE.dry) console.log('[head-del] gate dry — no delegation broadcast (arm: --live + HE_LIVE_CONFIRM=' + HEAD + ')');

function recoverVault() {
  const out = '/tmp/hd-keys';
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const metas = [];
  try { metas.push(JSON.parse(fs.readFileSync(path.join(ROOT, 'agent', 'recovery-meta.json'), 'utf8'))); } catch (_) {}
  try {
    const log = execFileSync('git', ['-C', ROOT, 'log', '--format=%H', '-n', '40', '--', 'agent/recovery-meta.json'], { encoding: 'utf8' });
    for (const c of log.split('\n').filter(Boolean)) {
      try { metas.push(JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${c}:agent/recovery-meta.json`], { encoding: 'utf8' }))); } catch (_) {}
    }
  } catch (_) {}
  const crypto = require('crypto');
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const vdir = path.join(ROOT, 'agent', 'vault');
  let encs = [];
  try { encs = fs.readdirSync(vdir).filter(f => f.endsWith('.enc')).map(f => path.join(vdir, f)); } catch (_) {}
  for (const enc of encs) {
    const outer = sha(enc);
    for (const m of metas) {
      if (!m || !m.keysZipPass || m.keysZipSha256 !== outer) continue;
      try {
        const dec = path.join(out, 'v.zip');
        execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '300000', '-in', enc, '-out', dec, '-pass', 'env:HDZP'], { env: { ...process.env, HDZP: m.keysZipPass }, stdio: 'pipe' });
        if (fs.readFileSync(dec).subarray(0, 2).toString('latin1') !== 'PK') continue;
        execFileSync('unzip', ['-o', '-q', dec, '-d', out], { stdio: 'pipe' });
        const vj = path.join(out, 'agent', 'keys', 'vault.json');
        if (fs.existsSync(vj)) return vj;
      } catch (_) {}
    }
  }
  return null;
}

const P = (fn) => new Promise((res, rej) => fn((e, r) => e ? rej(e) : res(r)));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const t0 = new Date().toISOString();
  // שער-המחשבה (owner 2026-10-04): בלם-חירום קודם-לכל — ואז שוער-רוסטר על-כל-יעד
  if (capGate.stasisHalt('head-delegate')) return;
  const roster = capGate.guardTargets('head-delegate', SOLDIERS, 'steem');
  const vaultPath = process.env.VAULT || recoverVault();
  if (!vaultPath) { console.log('[head-del] NO-VAULT — fail-soft'); return; }
  const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  const acct = (vault.accounts || []).find(a => a.username === HEAD);
  const k = (acct && acct.keys) || {};
  const actWif = (k.steem && k.steem.active && k.steem.active.wif) || (k.active && k.active.wif) || null;
  if (!actWif) { console.log('[head-del] NO-ACTIVE-KEY — fail-soft (delegation unchanged)'); return; }

  // סורג-אמת: נגזרת מול השרשרת
  const [head, globals] = await Promise.all([
    P(cb => steem.api.getAccounts([HEAD], cb)).then(r => r[0]),
    P(cb => steem.api.getDynamicGlobalProperties(cb)),
  ]);
  let actOk = false;
  try { actOk = steem.auth.wifToPublic(actWif) === head.active.key_auths[0][0]; } catch (_) {}
  console.log(`[head-del] active-key byte gate: ${actOk}${DRY ? ' · DRY' : ''}`);
  if (!actOk) { console.log('[head-del] GATE FAIL — no broadcast, fail-soft'); return; }

  const ratio = parseFloat(globals.total_vesting_fund_steem) / parseFloat(globals.total_vesting_shares);
  const vestsTarget = (SP_PER_SOLDIER / ratio).toFixed(6) + ' VESTS';

  const results = []; let delegated = 0, skipped = 0, failed = 0, refused = 0;
  for (const x of roster.refused) { results.push({ to: x.name, target: 'n/a', status: 'REFUSED-ROSTER', why: x.reason }); refused++; console.log('[REFUSED-ROSTER] headcorner → @' + x.name + ' · ' + x.reason); }
  for (const s of roster.allowed) {
    const R = { to: s, target: `${SP_PER_SOLDIER} SP` };
    try {
      const sa = (await P(cb => steem.api.getAccounts([s], cb)))[0];
      const have = parseFloat(sa.received_vesting_shares);
      const want = SP_PER_SOLDIER / ratio;
      if (have >= want * 0.95) { R.status = 'SKIP-ALREADY'; R.haveSp = Math.round(have); skipped++; }
      else if (DRY) { R.status = 'DRY-WOULD-DELEGATE'; R.haveSp = Math.round(have); }
      else {
        await P(cb => steem.broadcast.delegateVestingShares(actWif, HEAD, s, vestsTarget, cb));
        await sleep(2000);
        const sa2 = (await P(cb => steem.api.getAccounts([s], cb)))[0];
        const got = parseFloat(sa2.received_vesting_shares);
        R.status = got >= want * 0.95 ? 'DELEGATED-VERIFIED' : 'NO-READBACK';
        R.readbackSp = Math.round(got * 1000) / 1000;
        R.status === 'DELEGATED-VERIFIED' ? delegated++ : failed++;
      }
    } catch (e) { R.status = 'FAIL'; R.err = String(e.message || e).slice(0, 90); failed++; }
    results.push(R);
    console.log(`[${R.status}] headcorner → @${s} (${R.haveSp != null ? R.haveSp + ' SP have' : vestsTarget})`);
    await sleep(400);
  }

  capGate.journal('head-delegate', { dry: DRY, rosterLoaded: roster.rosterLoaded, allowed: roster.allowed, refused: roster.refused, delegated, skipped, failed, refusedCount: refused });
  const receipt = {
    ok: true, tool: 'head-delegate.cjs', doctrine: 'self-capital — the fleet allocates its own SP, idempotent, bounded 30 SP per soldier, canonical-roster-gated (capital-gate 2026-10-04)',
    at: t0, finishedAt: new Date().toISOString(), dry: DRY, target: vestsTarget,
    tally: { delegatedVerified: delegated, skippedAlready: skipped, failed },
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
  console.log(`[head-del] DONE · del=${delegated} skip=${skipped} fail=${failed} · receipt → ${OUT}`);
}
main().catch(e => { console.error('[head-del] fatal:', String(e.message || e).slice(0, 180)); process.exit(0); }); // fail-soft
