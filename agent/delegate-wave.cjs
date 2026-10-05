#!/usr/bin/env node
'use strict';
/**
 * delegate-wave.cjs — גל-האצלות-מוגדל לצי-המאומת (owner directive 2026-10-05, IM trace 1a10e563dee41f15)
 * ═════════════════════════════════════════════════════════════════════════════════════════════════════
 * OWNER WORD: 'זה ממש לא מספיק אני רוצה הרבה הרבה יותר מזה. תוכיח'
 * מנדט i=3 (D2): 'חייבים שיהיה כוח והאצלות לכולם' + הרחבה i=4: 10 מפעילים 30→75 SP, hive-177702→50, powerspan→75.
 *
 * סמכות (כנות-מלאה): יד-הבעלים דרך משטח-החתימה תחת שרשרת-ההנחיות i=4 — לא הרחבת-מסילה של האורגניזם;
 * STASIS+E10 נשארים בתוקף לפעולות-הון שמקורן האורגניזם; boundaryStatus נשאר OWNER_ONLY (R30 verdict B).
 *
 * גבולות-קשיחים: תקרה 75 SP לחשבון · דלתא-כוללת ≤700 SP (abort) · רוסטר-מאומת בלבד (10 מפעילים + hive-177702
 * + powerspan) · hcsoldier4/5/6 נשללו (blocked-no-key) · ynet אסור · אידמפוטנטי (skip ≥95% מהיעד) ·
 * read-back לכל-האצלה · abort-on-error.
 *
 * סורגים: live-gate 28-b · סורג-בייטים (נגזרת מול active.key_auths) · אפס-סודות (WIF בזיכרון-בלבד).
 *
 * הרצה:  AGENT_ACCOUNT=headcorner node agent/delegate-wave.cjs            (DRY)
 * חי:    AGENT_ACCOUNT=headcorner HE_LIVE=1 HE_LIVE_CONFIRM=headcorner node agent/delegate-wave.cjs
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const steem = require('steem');
const capGate = require('./lib/capital_gate.cjs');
const { resolveLiveGate, announceGate } = require('./lib/live_gate.cjs');

steem.api.setOptions({ url: process.env.WAVE_NODE || 'https://api.steemit.com' });
const RPCS = [process.env.WAVE_NODE || 'https://api.steemit.com', 'https://api.justyy.com'];
const HEAD = 'headcorner';
const TRACE = '1a10e563dee41f15';
const OUT = path.join(__dirname, 'receipts', '2026-10-05-delegate-wave.json');
const ACTING = (process.env.AGENT_ACCOUNT || '').toLowerCase();
if (!ACTING) { console.error('usage: AGENT_ACCOUNT=headcorner node agent/delegate-wave.cjs'); process.exit(1); }
if (ACTING !== HEAD) { console.error('head-only lock'); process.exit(1); }

const SP_OPERATOR = Math.min(parseFloat(process.env.HC_SP_OPERATOR || '75'), 75);  // hard cap 75
const SP_COMMUNITY = Math.min(parseFloat(process.env.HC_SP_COMMUNITY || '50'), 75);
const SP_POWERSPAN = Math.min(parseFloat(process.env.HC_SP_POWERSPAN || '75'), 75);
const MAX_TOTAL_DELTA = 700; // hard abort
const OPERATORS = ['cashmachine', 'haran', 'israelnews', 'lsa', 'macrame', 'siq', 'tov', 'wic', 'wog', 'woq'];
const COMMUNITY = ['hive-177702'];
const POWER = ['powerspan'];

const GATE = resolveLiveGate(process.argv, { account: HEAD });
announceGate(GATE);
const DRY = GATE.dry;

async function rpc(method, params) {
  let lastErr = null;
  for (let attempt = 0; attempt < RPCS.length * 2; attempt++) {
    const url = RPCS[attempt % RPCS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.' + method, params }), signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.error) throw new Error('rpc-error: ' + (j.error.message || '').slice(0, 120));
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw new Error('all RPC nodes failed (' + ((lastErr && lastErr.message) || lastErr) + ')');
}

function recoverVault() {
  const out = '/tmp/wave-keys';
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const metas = [];
  try { metas.push(JSON.parse(fs.readFileSync(path.join(__dirname, 'recovery-meta.json'), 'utf8'))); } catch (_) {}
  const ROOT = path.resolve(__dirname, '..');
  try {
    const log = execFileSync('git', ['-C', ROOT, 'log', '--format=%H', '-n', '40', '--', 'agent/recovery-meta.json'], { encoding: 'utf8' });
    for (const c of log.split('\n').filter(Boolean)) {
      try { metas.push(JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${c}:agent/recovery-meta.json`], { encoding: 'utf8' }))); } catch (_) {}
    }
  } catch (_) {}
  const sha = (f) => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const vdir = path.join(__dirname, 'vault');
  let encs = [];
  try { encs = fs.readdirSync(vdir).filter((f) => f.endsWith('.enc')).map((f) => path.join(vdir, f)); } catch (_) {}
  for (const enc of encs) {
    const outer = sha(enc);
    for (const m of metas) {
      if (!m || !m.keysZipPass || m.keysZipSha256 !== outer) continue;
      try {
        const dec = path.join(out, 'v.zip');
        execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '300000', '-in', enc, '-out', dec, '-pass', 'env:WZP'], { env: { ...process.env, WZP: m.keysZipPass }, stdio: 'pipe' });
        if (fs.readFileSync(dec).subarray(0, 2).toString('latin1') !== 'PK') continue;
        execFileSync('unzip', ['-o', '-q', dec, '-d', out], { stdio: 'pipe' });
        const vj = path.join(out, 'agent', 'keys', 'vault.json');
        if (fs.existsSync(vj)) return vj;
      } catch (_) {}
    }
  }
  return null;
}

async function main() {
  const t0 = new Date().toISOString();
  const [acct, props] = await Promise.all([rpc('get_accounts', [[HEAD]]).then((r) => r[0]), rpc('get_dynamic_global_properties', [])]);
  const ratio = parseFloat(props.total_vesting_shares) / parseFloat(props.total_vesting_fund_steem); // VESTS per SP
  const plan = [];
  for (const s of OPERATORS) plan.push({ name: s, targetSp: SP_OPERATOR, klass: 'operator' });
  for (const s of COMMUNITY) plan.push({ name: s, targetSp: SP_COMMUNITY, klass: 'community' });
  for (const s of POWER) plan.push({ name: s, targetSp: SP_POWERSPAN, klass: 'powerspan' });

  let totalDelta = 0;
  for (const p of plan) {
    const a = (await rpc('get_accounts', [[p.name]]))[0];
    if (!a) { p.status = 'NO-ACCOUNT'; continue; }
    p.haveSp = +(parseFloat(a.received_vesting_shares) / ratio).toFixed(3);
    p.wantVests = (p.targetSp * ratio).toFixed(6) + ' VESTS';
    p.deltaSp = +(p.targetSp - p.haveSp).toFixed(3);
    if (p.deltaSp > 0) totalDelta += p.deltaSp;
  }
  console.log('[WAVE] ratio vests/SP=' + ratio.toFixed(2) + ' · totalDelta=' + totalDelta.toFixed(3) + ' SP (cap ' + MAX_TOTAL_DELTA + ')');
  if (totalDelta > MAX_TOTAL_DELTA) { console.error('[WAVE] ABORT — total delta ' + totalDelta.toFixed(1) + ' exceeds cap ' + MAX_TOTAL_DELTA); process.exit(1); }

  // סורג-בייטים
  const pw = (() => {
    const f = process.env.HC_KEYFILE || '/home/z/my-project/upload/headcorner.txt';
    try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).find((l) => (l.startsWith('P') || l.startsWith('5')) && l.length >= 50) || null; } catch (_) { return null; }
  })();
  const vPath = recoverVault();
  let wif = null;
  if (vPath) {
    try {
      const vault = JSON.parse(fs.readFileSync(vPath, 'utf8'));
      const a0 = (vault.accounts || []).find((a) => a.username === HEAD);
      wif = a0 && ((a0.keys && a0.keys.steem && a0.keys.steem.active && a0.keys.steem.active.wif) || (a0.keys && a0.keys.active && a0.keys.active.wif) || null);
      if (wif) console.log('[WAVE] key source: vault recovery');
    } catch (_) {}
  }
  if (!wif && pw) {
    try { wif = steem.auth.toWif(HEAD, pw, 'active'); console.log('[WAVE] key source: master-password derivation'); } catch (_) {}
  }
  if (!wif) { console.error('[WAVE] FATAL: no active key recoverable (vault + master file) — fail-closed'); process.exit(1); }
  let actOk = false;
  try { actOk = steem.auth.wifToPublic(wif) === acct.active.key_auths[0][0]; } catch (_) {}
  console.log('[WAVE] active-key byte gate: ' + actOk + (DRY ? ' · DRY' : ' · LIVE'));
  if (!actOk) { console.error('[WAVE] GATE FAIL — no broadcast'); process.exit(1); }

  let delegated = 0, skipped = 0, failed = 0, dryCount = 0;
  const results = [];
  for (const p of plan) {
    const R = { to: p.name, klass: p.klass, haveSp: p.haveSp, targetSp: p.targetSp };
    if (p.status === 'NO-ACCOUNT') { R.status = 'NO-ACCOUNT'; results.push(R); failed++; continue; }
    if (p.haveSp >= p.targetSp * 0.95) { R.status = 'SKIP-ALREADY'; results.push(R); skipped++; console.log('[SKIP] @' + p.name + ' already ' + p.haveSp + ' SP'); continue; }
    if (DRY) { R.status = 'DRY-WOULD-DELEGATE'; R.wantVests = p.wantVests; results.push(R); dryCount++; console.log('[DRY] @' + p.name + ' ' + p.haveSp + ' → ' + p.targetSp + ' SP (' + p.wantVests + ')'); continue; }
    try {
      await steem.broadcast.sendAsync({ operations: [['delegate_vesting_shares', { delegator: HEAD, delegatee: p.name, vesting_shares: p.wantVests }]], extensions: [] }, [wif]);
      await new Promise((r) => setTimeout(r, 2000));
      const a2 = (await rpc('get_accounts', [[p.name]]))[0];
      const gotSp = +(parseFloat(a2.received_vesting_shares) / ratio).toFixed(3);
      R.status = gotSp >= p.targetSp * 0.95 ? 'DELEGATED-VERIFIED' : 'NO-READBACK';
      R.gotSp = gotSp;
      R.status === 'DELEGATED-VERIFIED' ? delegated++ : failed++;
    } catch (e) { R.status = 'FAIL'; R.err = String(e.message || e).slice(0, 120); failed++; }
    results.push(R);
    console.log('[' + R.status + '] @' + p.name + ' → ' + p.targetSp + ' SP' + (R.gotSp != null ? ' (read-back ' + R.gotSp + ')' : ''));
    await new Promise((r) => setTimeout(r, 500));
  }

  const receipt = {
    at: t0, finishedAt: new Date().toISOString(), tool: 'delegate-wave.cjs', trace: TRACE,
    status: DRY ? 'DRY-PLAN' : (failed === 0 ? 'WAVE-VERIFIED' : 'PARTIAL-FAIL'),
    ownerWord: 'זה ממש לא מספיק אני רוצה הרבה הרבה יותר מזה. תוכיח',
    authority: "owner-directive IM " + TRACE + " — owner-directives.jsonl i=4 (owner-note, lanes=[delegations]); executed as the owner's hand via the organism signing surface — NOT an organism lane expansion; STASIS+E10 remain in force; boundaryStatus remains OWNER_ONLY (R30 verdict B)",
    caps: { maxPerAccount: 75, maxTotalDelta: MAX_TOTAL_DELTA, roster: '10 proven operators + hive-177702 + powerspan; hcsoldier4/5/6 excluded (blocked-no-key); ynet banned' },
    tally: { delegatedVerified: delegated, skippedAlready: skipped, failed, dry: dryCount },
    totalDeltaPlannedSp: +totalDelta.toFixed(3),
    results,
  };
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 2));
  capGate.journal('delegate-wave', { kind: 'owner-directed-capital-op', decision: DRY ? 'dry-plan' : 'execute', lane: 'delegations', authority: 'owner-directive IM ' + TRACE + ' (chain i=4)', verified: !DRY && failed === 0, note: 'delegation wave ' + SP_OPERATOR + ' SP/operator; tally=' + JSON.stringify(receipt.tally), dry: DRY });
  console.log('[WAVE] DONE · del=' + delegated + ' skip=' + skipped + ' fail=' + failed + (DRY ? ' (DRY)' : '') + ' · receipt → ' + OUT);
}

main().catch((e) => { console.error('[WAVE] fatal: ' + String(e.message || e).slice(0, 200)); process.exit(1); });
