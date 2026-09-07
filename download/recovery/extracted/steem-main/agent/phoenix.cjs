#!/usr/bin/env node
/* phoenix.cjs — Task 68: בודק-התחייה ("מהצד" — המערכת שתחליף).
 *
 * "ודא שגם אם הסביבה שלך נמחקת נוכל לעלות כשהכל מחובר ומאובטח ומעוגן":
 * בדיקה-אחת שמודדת את כל-תנאי-התחייה ומדפיסה פסק-דין. לא-מתקן, מודד-ומדריך.
 *
 *   --check     בדיקה מלאה (כתיבה → agent/phoenix_state.json)
 *   --quiet     יציאה-שקטה (קוד-יציאה 0=ירוק 1=אדום) — לסקריפטים
 *
 * תחומי-בדיקה:
 *   repo      — git תקין, origin מוגדר, sync-מצב, gitkeeper חי
 *   secrets   — .env + vault קיימים (בלי-לחשוף תוכן), מספר-חשבונות-ב-vault
 *   runtime   — דימון חי (agent-status.json טרי), שרת עונה (/api/state)
 *   sovereign — קרנל + וקטורים עוברים, ג'נזיס+hash, צומת-מצב, עיגונים
 *   anchors   — צ'קפוינט-אחרון מעוגן? txids מאומתים?
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SOV = path.join(ROOT, 'sovereign');
const OUT = path.join(__dirname, 'phoenix_state.json');
const QUIET = process.argv.includes('--quiet');
const SELFTEST_VECTOR = '366ad47703426892cd51ffaa10f639d97bf8b5ca985eb29bf733bedb01b7082d';

const checks = [];
const add = (area, name, pass, detail) => { checks.push({ area, name, pass: !!pass, detail: String(detail || '').slice(0, 180) }); };

function fileExists(p) { try { fs.accessSync(p); return true; } catch (_) { return false; } }

function checkRepo() {
  try {
    const remote = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
    add('repo', 'origin defined', !!remote, remote.replace(/\/\/[^@]+@/, '//***@'));
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
    add('repo', 'branch=main', branch === 'main', branch);
    const dirty = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean).length;
    add('repo', 'worktree clean or gitkeeper pending', dirty <= 40, dirty + ' pending files (gitkeeper catches in ≤30m)');
    const st = fileExists(path.join(__dirname, 'gitkeeper_state.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'gitkeeper_state.json'), 'utf8')) : null;
    add('repo', 'gitkeeper last result', !!st, st ? st.result + ' @ ' + (st.at || '?') : 'no state');
  } catch (e) { add('repo', 'git reachable', false, e.message); }
}

function checkSecrets() {
  const envOk = fileExists(path.join(__dirname, '.env'));
  add('secrets', 'agent/.env present', envOk, envOk ? 'POSTING_WIF/ACTIVE_WIF (content never read here)' : 'MISSING — operator must re-enter');
  let n = 0;
  try { const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'keys', 'vault.json'), 'utf8')); n = (v.accounts || []).length; } catch (_) {}
  add('secrets', 'vault.json present', n > 0, n ? n + ' accounts (soldiers+delegations)' : 'MISSING — re-arm via /api/ops/vault/master');
}

async function checkRuntime() {
  let daemonAge = -1, loops = 0;
  try {
    const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'agent-status.json'), 'utf8'));
    daemonAge = Math.round((Date.now() - new Date(st.updatedAt || st.at || 0).getTime()) / 1000);
    loops = Object.keys(st.loops || {}).length;
  } catch (_) {}
  add('runtime', 'daemon status fresh', daemonAge >= 0 && daemonAge < 3600, daemonAge < 0 ? 'no agent-status.json' : daemonAge + 's old · ' + loops + ' loops');
  try {
    const r = await fetch('http://127.0.0.1:3000/api/state', { signal: AbortSignal.timeout(8000) });
    add('runtime', 'dev server responds', r.ok, 'GET /api/state → ' + r.status);
  } catch (e) { add('runtime', 'dev server responds', false, e.message); }
}

function checkSovereign() {
  add('sovereign', 'kernel present', fileExists(path.join(SOV, 'core', 'kernel.cjs')), 'sovereign/core/kernel.cjs');
  try {
    const K = require(path.join(SOV, 'core', 'kernel.cjs'));
    const t = K.selfTest();
    add('sovereign', 'kernel self-test vectors', t.replay && t.finalRoot === SELFTEST_VECTOR, 'final=' + t.finalRoot.slice(0, 16) + '…');
  } catch (e) { add('sovereign', 'kernel self-test vectors', false, e.message); }
  try {
    const g = JSON.parse(fs.readFileSync(path.join(SOV, 'genesis', 'genesis.json'), 'utf8'));
    add('sovereign', 'genesis + hash', !!(g.genesisHash && g.state), 'genesisHash=' + String(g.genesisHash).slice(0, 16) + '… · supply=' + (g.state && g.state.meta ? g.state.meta.supply / 1000 : '?') + ' SAOS');
  } catch (e) { add('sovereign', 'genesis + hash', false, 'run derive-genesis.cjs --live'); }
  try {
    const st = JSON.parse(fs.readFileSync(path.join(SOV, 'node', 'state.json'), 'utf8'));
    add('sovereign', 'node state (height>0)', (st.height || 0) > 0, 'height=' + st.height + ' · cps=' + (st.checkpoints || []).length + ' · verified=' + (st.verified || []).length);
  } catch (e) { add('sovereign', 'node state (height>0)', false, 'run saosnet.cjs --boot --live'); }
}

function checkAnchors() {
  try {
    const st = JSON.parse(fs.readFileSync(path.join(SOV, 'node', 'state.json'), 'utf8'));
    const cps = st.checkpoints || [];
    const last = cps[cps.length - 1] || null;
    const steem = last && last.anchors && last.anchors.steem;
    add('anchors', 'last checkpoint steem-anchored', !!steem, steem ? 'txid ' + steem : last ? 'pending — retry armed (head RC regen / fleet fallback)' : 'no checkpoints yet');
    const atts = last ? (last.attests || []) : [];
    const ver = atts.filter((a) => a.verified).length;
    add('anchors', 'quorum attests verified ≥2', ver >= 2, ver + '/' + atts.length + ' verified' + (atts.length ? ' (' + atts.map((a) => '@' + a.by).join(' ') + ')' : ''));
  } catch (e) { add('anchors', 'last checkpoint steem-anchored', false, e.message); }
}

async function main() {
  checkRepo();
  checkSecrets();
  await checkRuntime();
  checkSovereign();
  checkAnchors();
  const passed = checks.filter((c) => c.pass).length;
  const verdict = passed === checks.length ? 'REINCARNATION-READY' : 'GAPS: ' + checks.filter((c) => !c.pass).map((c) => c.area + '/' + c.name).join(' · ');
  const out = { at: new Date().toISOString(), verdict, passed, total: checks.length, checks };
  try { fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); } catch (_) {}
  if (!QUIET) {
    console.log('═'.repeat(72));
    console.log('PHOENIX — בודק-התחייה · ' + passed + '/' + checks.length + ' ירוק');
    for (const c of checks) console.log((c.pass ? ' ✓ ' : ' ✗ ') + '[' + c.area + '] ' + c.name + ' — ' + c.detail);
    console.log('═'.repeat(72));
    console.log('VERDICT: ' + verdict);
  }
  process.exit(passed === checks.length ? 0 : 1);
}
main().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
