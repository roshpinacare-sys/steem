#!/usr/bin/env node
/**
 * SAOS FLEET-CLAIM ENGINE v1 — כלכלה-עצמית: הצי תובע את הפרסים של-עצמו (Z-20)
 *
 * מה-זה: סריקת pending rewards לכל-12 החשבונות → claim_reward_balance (posting-only)
 * למי-שיש-מה לתבוע → קריאה-חוזרת (pending חוזר ל-0) → קבלה נטולת-סודות.
 * אידמפוטנטי: אין-פנדינג → SKIP. ההכנסה מתגלגלת ל-SP (מימוש-פוטנציאל עצמי).
 *
 * הרצה: node agent/fleet-claim.cjs   (VAULT_RECOVERY מהריפו-הפרטי · DRY=1 לבדיקה)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const steem = require('steem');
// owner directive 2026-10-04 (STASIS): sign-time brake — every broadcast re-checks the breaker (stale-process lesson)
const capGate = require('./lib/capital_gate.cjs');
function stasisStop(tool) {
  try { return !!capGate.stasisHalt(tool); } catch (e) { console.log('[CAPITAL-GATE] ' + tool + ' — gate module error, lane halts fail-closed: ' + String((e && e.message) || e).slice(0, 80)); return true; }
}

steem.api.setOptions({ url: 'https://api.steemit.com' });
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.RECEIPT_OUT || path.join(ROOT, 'agent', 'fleet-claim-receipt.json');
const FLEET = ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq', 'ynet', 'headcorner'];

// 10-d-3 (2026-09-30) — LIVE-GATE before vault/key recovery: fleet-wide broadcast surface
// (12 accounts claim). The confirming identity is the fleet head (owns the vault) —
// arm: --live (or HE_LIVE=1) AND HE_LIVE_CONFIRM=headcorner. DRY=1 still forces dry.
// Fail-closed default.
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');
const GATE = resolveLiveGate(process.argv, { account: 'headcorner' });
const DRY = process.env.DRY === '1' || GATE.dry;
announceGate(GATE);
if (GATE.dry) console.log('[fleet-claim] gate dry — no claim broadcast (arm: --live + HE_LIVE_CONFIRM=headcorner)');

function recoverVault() {
  const out = '/tmp/fc-keys';
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
        execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '300000', '-in', enc, '-out', dec, '-pass', 'env:FCZP'], { env: { ...process.env, FCZP: m.keysZipPass }, stdio: 'pipe' });
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
  const vaultPath = process.env.VAULT || recoverVault();
  if (!vaultPath) { console.log('[fleet-claim] NO-VAULT — fail-soft'); return; }
  const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  const keymap = {};
  for (const a of (vault.accounts || [])) {
    if (!FLEET.includes(a.username)) continue;
    const k = a.keys || {};
    const wif = (k.posting && k.posting.wif) || (k.steem && k.steem.posting && k.steem.posting.wif) || null;
    if (wif) keymap[a.username] = wif;
  }
  console.log(`[fleet-claim] keys: ${Object.keys(keymap).length}/${FLEET.length}${DRY ? ' · DRY' : ''} · zero secrets printed`);

  const globals = await P(cb => steem.api.getDynamicGlobalProperties(cb));
  const ratio = parseFloat(globals.total_vesting_fund_steem) / parseFloat(globals.total_vesting_shares);
  const accts = await P(cb => steem.api.getAccounts(FLEET, cb));

  const results = []; let claimed = 0, skipped = 0, failed = 0;
  for (const a of accts) {
    const R = { account: a.name };
    const rs = a.reward_steem_balance, sbd = a.reward_sbd_balance, rv = a.reward_vesting_balance;
    const hasPending = parseFloat(rs) > 0 || parseFloat(sbd) > 0 || parseFloat(rv) > 0;
    if (!hasPending) { R.status = 'SKIP-NOTHING-PENDING'; skipped++; }
    else if (!keymap[a.name]) { R.status = 'SKIP-NO-KEY'; R.pending = { rs, sbd, rv }; skipped++; }
    else {
      // סורג-אמת גם-כאן: נגזרת מול posting.key_auths
      let gate = false;
      try { gate = steem.auth.wifToPublic(keymap[a.name]) === a.posting.key_auths[0][0]; } catch (_) {}
      if (!gate) { R.status = 'SKIP-KEY-MISMATCH'; skipped++; }
      else if (DRY) { R.status = 'DRY-WOULD-CLAIM'; R.pending = { rs, sbd, rv }; }
      else {
        try {
          if (stasisStop('fleet-claim')) throw new Error('STASIS-HALT — capital lane closed (capital gate 2026-10-04)'); // sign-time brake
          await P(cb => steem.broadcast.claimRewardBalance(keymap[a.name], a.name, rs, sbd, rv, cb));
          await sleep(2000);
          const a2 = (await P(cb => steem.api.getAccounts([a.name], cb)))[0];
          const cleared = parseFloat(a2.reward_steem_balance) === 0 && parseFloat(a2.reward_sbd_balance) === 0 && parseFloat(a2.reward_vesting_balance) === 0;
          R.status = cleared ? 'CLAIMED-VERIFIED' : 'NO-READBACK';
          R.claimed = { rs, sbd, rv };
          cleared ? claimed++ : failed++;
        } catch (e) { R.status = 'FAIL'; R.err = String(e.message || e).slice(0, 90); failed++; }
      }
    }
    results.push(R);
    console.log(`[${R.status}] @${a.name}${R.pending ? ` pending=${R.pending.rs} ${R.pending.sbd} ${R.pending.rv} (≈${(parseFloat(R.pending.rs) + parseFloat(R.pending.rv) * ratio).toFixed(2)} SP)` : ''}`);
    await sleep(300);
  }

  const receipt = {
    ok: true, tool: 'fleet-claim.cjs', doctrine: 'self-economy — the fleet claims its own rewards, posting-only, idempotent, keys in memory only',
    at: t0, finishedAt: new Date().toISOString(), dry: DRY,
    tally: { claimedVerified: claimed, skipped, failed },
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
  console.log(`[fleet-claim] DONE · claimed=${claimed} skip=${skipped} fail=${failed} · receipt → ${OUT}`);
}
main().catch(e => { console.error('[fleet-claim] fatal:', String(e.message || e).slice(0, 180)); process.exit(0); }); // fail-soft
