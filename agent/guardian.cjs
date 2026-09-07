#!/usr/bin/env node
/**
 * guardian.cjs — Task 82: THE ALWAYS-UP ENGINE (anti-rollback + self-heal)
 *
 * The operator's directive: "הרשת שלנו לא תיפול בגלל הסנדבוקס שלך — צריך למצוא
 * דרך לאבטח את הרשת שתהיה אונליין תמיד · שלא תוכל לחזור לגרסה ישנה — קריטי,
 * זה קורה כל יום · אתה צריך לדעת להפעיל את כולם".
 *
 * Iron promises (all verifiable, nothing claimed):
 *   1. ANTI-ROLLBACK — on every boot + every 10 min: fetch origin/main.
 *      Local HEAD behind or diverged → stash local noise (never silently
 *      destroyed) → reset --hard origin/main. ORIGIN IS THE SINGLE TRUTH.
 *      A sandbox restored from an OLD snapshot heals to latest within minutes.
 *   2. SELF-HEAL — agent/node_modules (bun install), agent/.env skeleton,
 *      agent daemon respawn, sovereign-chain freshness (stale >20 min and no
 *      daemon → fire a beat).
 *   3. ZERO-TOUCH FLEET RESTORE — if fleet keys are gone but the sealed
 *      fleet vault exists (agent/fleet_keys.enc, committed to the private
 *      repo), decrypt and restore ALL accounts + restart the daemon. One
 *      sandbox reset no longer costs the fleet.
 *   4. AUTO-SEAL — fleet keys present and newer than the seal → re-seal.
 *   5. PUSH-CREDENTIAL HEAL (84) — the 2026-09-05 incident: the operator had
 *      to hand-deliver a fresh GitHub token because the old one died with a
 *      sandbox. Lesson → the push token is sovereignty infrastructure too.
 *      .env GITHUB_TOKEN (inside the seal!) is the durable copy; every boot
 *      repairs .git/config from it, and gitkeeper retries a failed push
 *      after repair. A reset can no longer cut the repo's voice.
 *
 * Wired from: src/instrumentation.ts (every dev-server boot) +
 *             package.json/dev.sh pre-dev + agent daemon loop #29 (10 min).
 * Result → agent/guardian_result.json · log → agent/guardian.log
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const AGENT_DIR = __dirname;
const ROOT = path.join(AGENT_DIR, '..');
const RESULT = path.join(AGENT_DIR, 'guardian_result.json');
const LOG = path.join(AGENT_DIR, 'guardian.log');
const LOCK = path.join(AGENT_DIR, '.guardian.lock');
const LOCK_TTL_MS = 4 * 60 * 1000; // boot-hook + loop can overlap; TTL dedupes

const MODE = process.argv.includes('--boot') ? 'boot'
  : process.argv.includes('--predev') ? 'predev'
  : process.argv.includes('--loop') ? 'loop'
  : 'manual';

function log(msg) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] guardian(' + MODE + '): ' + msg + '\n'); } catch (_) {}
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, Object.assign({ cwd: ROOT, timeout: 60_000, encoding: 'utf8' }, opts)).trim();
}

function acquireLock() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
    if (Date.now() - Number(raw.at) < LOCK_TTL_MS) {
      log('skip — fresh guard holds the lock (pid ' + raw.pid + ', mode ' + raw.mode + ')');
      return false;
    }
  } catch (_) { /* no lock */ }
  try { fs.writeFileSync(LOCK, JSON.stringify({ at: Date.now(), pid: process.pid, mode: MODE })); } catch (_) {}
  return true;
}

function spawnDetached(file, args, cwd) {
  try {
    const out = fs.openSync(LOG, 'a');
    const child = spawn(process.execPath, [file, ...args], { cwd, detached: true, stdio: ['ignore', out, out] });
    child.unref();
    return child.pid || null;
  } catch (e) { log('spawn failed ' + file + ': ' + (e.message || e)); return null; }
}

/* ---------------------------------------------------------------- *
 * 0. PUSH-CREDENTIAL HEAL (84) — repair .git/config from the sealed .env
 *    Runs BEFORE syncRepo: fetch + push both need a live token. The token
 *    never appears in logs, state, or commits — only inside the remote URL
 *    (ephemeral .git/config) and the AES seal.
 * ---------------------------------------------------------------- */
function readEnvToken() {
  try {
    const m = fs.readFileSync(path.join(AGENT_DIR, '.env'), 'utf8').match(/^GITHUB_TOKEN=(\S+)\s*$/m);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

function healPushCreds(res) {
  const tok = readEnvToken();
  if (!tok) { res.actions.push('push-creds:none-in-env'); return; }
  let cur = '';
  try { cur = sh('git', ['remote', 'get-url', 'origin']); } catch (_) { res.actions.push('push-creds:no-remote'); return; }
  const withTok = cur.replace(/^(https:\/\/)([^/@]*@)?/, 'https://x-access-token:' + tok + '@');
  if (withTok === cur) { res.actions.push('push-creds-ok'); return; }
  try {
    sh('git', ['remote', 'set-url', 'origin', withTok]);
    res.actions.push('PUSH-CREDS-REPAIRED(from sealed .env · token never logged)');
    log('push credentials repaired from .env GITHUB_TOKEN (mismatch in .git/config)');
  } catch (e) { res.actions.push('push-creds-repair-FAILED:' + String(e.message || e).slice(0, 40)); }
}

/* ---------------------------------------------------------------- *
 * 1. ANTI-ROLLBACK — origin/main is the single truth
 * ---------------------------------------------------------------- */
function syncRepo(res) {
  let headBefore = 'unknown', origin = 'unknown';
  try { headBefore = sh('git', ['rev-parse', '--short', 'HEAD']); } catch (_) { res.actions.push('no-git'); return; }
  try { sh('git', ['fetch', 'origin', 'main', '--quiet'], { timeout: 45_000 }); } catch (e) {
    res.actions.push('fetch-failed(offline?)');
    log('fetch failed — continuing with local healing: ' + (e.message || e).slice(0, 80));
    res.headBefore = headBefore; res.headAfter = headBefore;
    return;
  }
  try { origin = sh('git', ['rev-parse', '--short', 'origin/main']); } catch (_) { res.actions.push('no-origin-ref'); return; }
  res.headBefore = headBefore; res.origin = origin;
  if (headBefore === origin) { res.actions.push('repo-current'); return; }

  // behind? (HEAD is ancestor of origin/main)
  let behind = false, diverged = false;
  try { sh('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']); behind = true; } catch (e) {
    // distinguish diverged from ahead
    try { sh('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']); diverged = false; } catch (_) { diverged = true; }
  }
  if (!behind && !diverged) { res.actions.push('ahead-unpushed(gitkeeper-will-push)'); res.headAfter = headBefore; return; }

  // heal: stash unpushed noise (recoverable), then hard-reset to origin
  try {
    sh('git', ['stash', 'push', '-u', '-m', 'guardian-pre-heal ' + new Date().toISOString()], { timeout: 30_000 });
    res.actions.push('stashed-local-noise');
  } catch (_) { /* nothing to stash or stash failed — reset is still safe */ }
  try {
    sh('git', ['reset', '--hard', 'origin/main'], { timeout: 30_000 });
    res.actions.push(diverged ? 'DIVERGENCE-HEALED(reset→origin/main)' : 'ROLLBACK-HEALED(reset→origin/main)');
    res.headAfter = sh('git', ['rev-parse', '--short', 'HEAD']);
    log('ANTI-ROLLBACK: ' + headBefore + ' → ' + res.headAfter + ' (origin ' + origin + ')');
    // rolling upgrade: the daemon that survived in memory runs pre-heal code —
    // kill it; healDaemon below respawns it fresh from the healed tree
    const killed = killDaemons();
    if (killed) res.actions.push('daemon-recycled(' + killed + ' pre-heal proc)');
  } catch (e) {
    res.actions.push('reset-failed:' + String(e.message || e).slice(0, 60));
    res.headAfter = headBefore;
  }
}

/* ---------------------------------------------------------------- *
 * 2. SELF-HEAL — deps, env, daemon, chain freshness
 * ---------------------------------------------------------------- */
function healDeps(res) {
  try {
    fs.accessSync(path.join(AGENT_DIR, 'node_modules', 'steem', 'package.json'));
    res.actions.push('deps-ok');
  } catch (_) {
    try { sh('bun', ['install'], { cwd: AGENT_DIR, timeout: 180_000 }); res.actions.push('deps-reinstalled(bun)'); }
    catch (e) { try { sh('npm', ['install', '--no-audit', '--no-fund'], { cwd: AGENT_DIR, timeout: 300_000 }); res.actions.push('deps-reinstalled(npm)'); } catch (e2) { res.actions.push('deps-FAILED'); log('deps install failed: ' + (e2.message || e2)); } }
  }
}

function healEnv(res) {
  const envPath = path.join(AGENT_DIR, '.env');
  if (fs.existsSync(envPath)) { res.actions.push('env-ok'); return; }
  try {
    fs.writeFileSync(envPath, [
      '# guardian: restored monitoring skeleton (safe defaults — honest DRY_RUN)',
      '# operator: paste master key in Console → כספת to go REAL (daemon auto-restarts)',
      'AGENT_ACCOUNT=headcorner',
      'DRY_RUN=true',
      '',
    ].join('\n'));
    res.actions.push('env-skeleton-written');
  } catch (e) { res.actions.push('env-FAILED'); }
}

function daemonAlive() {
  try { return /\d/.test(sh('pgrep', ['-f', 'node agent.cjs'])); } catch (_) { return false; }
}

// 82 — recycle ALL daemon pids (used after anti-rollback heal: the surviving
// process would keep running pre-heal code from memory)
function killDaemons() {
  try {
    const pids = sh('pgrep', ['-f', 'agent.cjs']).split('\n').map((s) => Number(s.trim())).filter((n) => n && n !== process.pid);
    let killed = 0;
    for (const p of pids) { try { process.kill(p, 'SIGTERM'); killed++; } catch (_) { /* already gone */ } }
    return killed;
  } catch (_) { return 0; }
}

function healDaemon(res) {
  if (daemonAlive()) {
    res.actions.push('daemon-alive');
    // 107 (אימוץ-W19 של-הסוכן-השני) — pid-file self-heal: קובץ-ה-pid הציבורי
    // (agent_daemon.pid) נקרא על-ידי טייסת-האמת; כשהדמון-חי והקובץ לא תואם
    // את ה-pgrep — מתקנים חי (מקור-האמת: התהליך-הרץ).
    try {
      const pidPath = require('path').join(AGENT_DIR, 'agent_daemon.pid');
      let filePid = null;
      try { filePid = parseInt(require('fs').readFileSync(pidPath, 'utf8').trim(), 10) || null; } catch (_) { filePid = null; }
      const livePids = sh('pgrep', ['-f', 'node agent.cjs']).split('\n').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
      const livePid = livePids[0] || null;
      if (livePid && filePid !== livePid) {
        require('fs').writeFileSync(pidPath, String(livePid) + '\n');
        res.actions.push('pid-file-healed(' + (filePid || 'none') + '→' + livePid + ')');
      }
    } catch (_) { /* best effort */ }
    return;
  }
  const pid = spawnDetached('agent.cjs', [], AGENT_DIR);
  res.actions.push(pid ? 'daemon-respawned(pid ' + pid + ')' : 'daemon-respawn-FAILED');
  res.daemonPid = pid;
  try { require('child_process').execSync('sleep 4', { stdio: 'ignore' }); } catch (_) {}
  if (pid && daemonAlive()) res.actions.push('daemon-verified-alive');
}

function healChain(res) {
  let c = null;
  try { c = JSON.parse(fs.readFileSync(path.join(ROOT, 'sovereign', 'node', 'chain.json'), 'utf8')); } catch (_) { c = null; }
  if (!c || !c.blocks || !c.blocks.length) {
    // chain state lost (old snapshot / wiped worktree) — the LIVING ATTEST on
    // Steem/Hive knows what the world expects; write the recovery pointer
    try {
      const out = sh(process.execPath, [path.join(AGENT_DIR, 'chain_attest.cjs'), '--read'], { cwd: AGENT_DIR, timeout: 120_000 });
      const line = out.trim().split('\n').filter(Boolean).pop() || '';
      let verdict = 'unknown';
      try { verdict = JSON.parse(line).verdict || 'unknown'; } catch (_) { /* raw */ }
      res.actions.push('chain-MISSING→attest-pointer(' + verdict + ' · sovereign/node/RECOVERY_POINTER.json)');
      log('chain lost — living-attest recovery bar written: ' + line.slice(0, 140));
    } catch (e) {
      res.actions.push('chain-MISSING→attest-read-FAILED(' + String((e && e.message) || e).slice(0, 40) + ')');
    }
    return;
  }
  try {
    const last = new Date(c.blocks[c.blocks.length - 1].time).getTime();
    res.height = c.blocks ? c.blocks.length : 0;
    const staleMin = Math.round((Date.now() - last) / 60000);
    res.chainStaleMin = staleMin;
    if (staleMin > 20 && !daemonAlive()) {
      const pid = spawnDetached('saosnet.cjs', [], path.join(ROOT, 'sovereign', 'node'));
      res.actions.push(pid ? 'stale-chain(' + staleMin + 'min)-beat-fired(pid ' + pid + ')' : 'beat-fire-FAILED');
    } else {
      res.actions.push('chain-fresh(' + staleMin + 'min' + (daemonAlive() ? ' · daemon-drives' : '') + ')');
    }
  } catch (e) { res.actions.push('chain-check-skipped'); }
}

/* ---------------------------------------------------------------- *
 * 103 — ENGINE-ALWAYS-UP: grid98 (מנוע-הגריד/דקס — רגלי-החיילים-הסוחרים).
 * המנוע-מתעדע בשקט (OOM של-next-server הרג-אותו פעמיים היום) — ואף-אחד
 * לא-העיר-אותו. עכשיו: אם-פנקס-המנוע סטלה >5 דק' (טיק-אמור-כל-8ש') ואין-תהליך
 * חי → השכמה. שים-לב: מנוע-חי-עם-מנעול-תקוף-בלבד אינו-סטלה (pid-חי-מגן).
 * ---------------------------------------------------------------- */
function engineAlive() {
  try { return /\d/.test(sh('pgrep', ['-f', 'grid98.cjs'])); } catch (_) { return false; }
}
function healEngine(res) {
  try {
    const p = path.join(ROOT, 'sovereign', 'node', 'grid98-state.json');
    const g = JSON.parse(fs.readFileSync(p, 'utf8'));
    const ageSec = g && g.at ? Math.round((Date.now() - new Date(g.at).getTime()) / 1000) : null;
    res.engineAgeSec = ageSec;
    if (ageSec == null || ageSec > 300) {
      if (engineAlive()) { res.actions.push('engine-stale(' + ageSec + 's)-but-alive(holding-lock?)'); return; }
      const pid = spawnDetached('grid98.cjs', ['--live'], path.join(ROOT, 'sovereign', 'node'));
      res.actions.push(pid ? 'ENGINE-REVIVED(stale ' + ageSec + 's · pid ' + pid + ')' : 'engine-revive-FAILED');
      log('grid98 stale ' + ageSec + 's and no process — revived (pid ' + pid + ')');
    } else {
      res.actions.push('engine-fresh(' + ageSec + 's' + (engineAlive() ? ' · pid-alive' : ' · ledger-only') + ')');
    }
  } catch (_) { res.actions.push('engine-check-skipped'); }
}

/* ---------------------------------------------------------------- *
 * 108 — DOOR-ALWAYS-UP: THE-DOOR relayer (דבר-גורר-דבר) — מבצע-הדלתות
 * שמכריח טרנזקציות על רשתות-מרוחקות מהחוזה-החינמי שלנו. אותו-דפוס-הישרדות:
 * אין-תהליך → השכמה-מנותקת. relay-doors.log מתעדכן כל-טיק (45ש׳).
 * ---------------------------------------------------------------- */
function healRelay(res) {
  try {
    if (pgrepAlive('relay.cjs watch')) { res.actions.push('door-relayer-alive'); return; }
    let ageSec = null;
    try { const stt = fs.statSync(path.join(ROOT, 'sovereign', 'node', 'relay-doors.log')); ageSec = Math.round((Date.now() - stt.mtime.getTime()) / 1000); } catch (_) {}
    const pid = spawnDetached('relay.cjs', ['watch'], path.join(ROOT, 'sovereign', 'node'));
    res.actions.push(pid ? 'DOOR-RELAYER-SPAWNED(last ' + (ageSec == null ? 'never' : ageSec + 's') + ' · pid ' + pid + ')' : 'door-spawn-FAILED');
    log('relay relayer missing — spawned watch (pid ' + pid + ')');
  } catch (_) { res.actions.push('door-check-skipped'); }
}

/* 110 — DEX-ALWAYS-UP + SIBLING-ALWAYS-UP: מפעיל-הדקס ומאמת-האח חיים-תמיד */
function healDex(res) {
  try {
    if (pgrepAlive('trondex.cjs watch')) { res.actions.push('dex-operator-alive'); return; }
    const pid = spawnDetached('trondex.cjs', ['watch'], path.join(ROOT, 'sovereign', 'node'));
    res.actions.push(pid ? 'DEX-OPERATOR-SPAWNED(pid ' + pid + ')' : 'dex-spawn-FAILED');
    log('trondex operator missing — spawned watch (pid ' + pid + ')');
  } catch (_) { res.actions.push('dex-check-skipped'); }
}
function healSibling(res) {
  try {
    if (pgrepAlive('sibling.cjs watch')) { res.actions.push('sibling-verifier-alive'); return; }
    const pid = spawnDetached('sibling.cjs', ['watch'], path.join(ROOT, 'sovereign', 'node'));
    res.actions.push(pid ? 'SIBLING-VERIFIER-SPAWNED(pid ' + pid + ')' : 'sibling-spawn-FAILED');
    log('sibling verifier missing — spawned watch (pid ' + pid + ')');
  } catch (_) { res.actions.push('sibling-check-skipped'); }
}

/* 111 — HARVEST-ALWAYS-UP: קוצר-הערך תמיד-חי — מזהה-דלתאות-עמלות, סורק-מסילה,
 * משחרר-גלגל-החוזר. בלעדיו-הקציר-מתאדה (אותה-תבנית כמו-שחרור-האנרגיה של-האח W23). */
function healHarvest(res) {
  try {
    if (pgrepAlive('harvest.cjs watch')) { res.actions.push('harvest-alive'); return; }
    const pid = spawnDetached('harvest.cjs', ['watch'], path.join(ROOT, 'sovereign', 'node'));
    res.actions.push(pid ? 'HARVEST-SPAWNED(pid ' + pid + ')' : 'harvest-spawn-FAILED');
    log('harvest daemon missing — spawned watch (pid ' + pid + ')');
  } catch (_) { res.actions.push('harvest-check-skipped'); }
}

function healWallets(res) {
  try {
    if (pgrepAlive('wallets.cjs watch')) { res.actions.push('wallets-alive'); return; }
    const pid = spawnDetached('wallets.cjs', ['watch'], path.join(ROOT, 'sovereign', 'node'));
    res.actions.push(pid ? 'WALLETS-SPAWNED(pid ' + pid + ')' : 'wallets-spawn-FAILED');
    log('wallets daemon missing — spawned watch (pid ' + pid + ')');
  } catch (_) { res.actions.push('wallets-check-skipped'); }
}

/* ---------------------------------------------------------------- *
 * 114 — VAULT-ALWAYS-UP: הכספת-המוצפנת (vault.enc · AES-256-GCM) נבדקת-בכל-טיק:
 * verify מגזר-מחדש 12×4 כתובות מהזרע-המוצפן ומשווה-מול-העיגון-הציבורי.
 * חבר-פגום/חסר → restore אוטומטי מהמעטפת (הרפואה) · מעטפת-חסרה → איטום-מחדש.
 * ---------------------------------------------------------------- */
function healVault(res) {
  try {
    const vaultDir = path.join(ROOT, 'agent', 'keys');
    const enc = path.join(vaultDir, 'vault.enc');
    const members = ['wallets-seed.json', 'wallets-registry.json', 'vault.json', 'tron-mnemonic.txt'];
    // רפואה-קודמת-לטקס: חבר-חסר-על-הדיסק → שחזור-מהמעטפת (אם-יש-מעטפת)
    if (fs.existsSync(enc)) {
      for (const m of members) {
        if (!fs.existsSync(path.join(vaultDir, m))) {
          const r = sh('node', [path.join(ROOT, 'sovereign', 'node', 'vault.cjs'), 'restore', m], { timeout: 60_000 });
          log('VAULT-RESTORE ' + m + ' :: ' + String(r || '').slice(0, 120));
          res.actions.push('vault-restored(' + m + ')');
        }
      }
    } else if (members.every((m) => fs.existsSync(path.join(vaultDir, m)))) {
      // מעטפת-חסרה-אך-המקורות-חיים → איטום-מחדש (bootstrap)
      const r = sh('node', [path.join(ROOT, 'sovereign', 'node', 'vault.cjs'), 'seal'], { timeout: 120_000 });
      log('VAULT-RESEAL :: ' + String(r || '').slice(0, 120));
      res.actions.push('vault-resealed');
    }
    try { sh('node', [path.join(ROOT, 'sovereign', 'node', 'vault.cjs'), 'verify', '--quiet'], { timeout: 120_000 }); res.actions.push('vault-verified'); }
    catch (e) { log('VAULT-VERIFY-FAILED — נדרש-טיפול (ראה sovereign/node/vault-verify-last.json) :: ' + String(e.stdout || e.message || '').slice(0, 120)); res.actions.push('vault-verify-FAILED'); }
  } catch (e) { res.actions.push('vault-check-skipped(' + String(e.message || e).slice(0, 40) + ')'); }
}

/* 114 — DEPOSITS-ALWAYS-UP: תיבת-ההפקדות תמיד-חיה (סוקרת-10-רשתות כל-5 דק') */
function healDeposits(res) {
  try {
    if (pgrepAlive('deposits.cjs watch')) { res.actions.push('deposits-alive'); return; }
    const pid = spawnDetached('deposits.cjs', ['watch'], path.join(ROOT, 'sovereign', 'node'));
    res.actions.push(pid ? 'DEPOSITS-SPAWNED(pid ' + pid + ')' : 'deposits-spawn-FAILED');
    log('deposits daemon missing — spawned watch (pid ' + pid + ')');
  } catch (_) { res.actions.push('deposits-check-skipped'); }
}

/* ---------------------------------------------------------------- *
 * 106 — WEB-ALWAYS-UP: הדף-הוא-הפנים-של-הרשת (next dev :3000).
 * התקלה-של-106: הסשן-מת → השרת-מת-איתו → הדף-מת. הגרדיאן-החלים-מנוע-ושרשרת
 * אבל-לא-את-האינטרנט-עצמו. עכשיו: פינג-לשער-3000; מת-ואין-תהליך → השכמה
 * מנותקת (node next dev · תקרת-heap · יומן-דבוק — דפוס-השרדות-זהה-למנוע).
 * ---------------------------------------------------------------- */
function webAlive() {
  try {
    const out = sh('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '4', 'http://127.0.0.1:3000/api/weave/status'], { timeout: 8_000 });
    return /^2/.test(String(out).trim());
  } catch (_) { return false; }
}
function pgrepAlive(pat) { try { return /\d/.test(sh('pgrep', ['-f', pat])); } catch (_) { return false; } }
function healWeb(res) {
  try {
    if (webAlive()) { res.actions.push('web-ok(3000)'); return; }
    // dead port but stuck process? clear it so the revival owns the port
    const stuck = pgrepAlive('next-server') || pgrepAlive('next dev');
    if (stuck) { try { sh('pkill', ['-f', 'next-server']); sh('pkill', ['-f', 'next dev']); } catch (_) {} }
    const out = fs.openSync(path.join(ROOT, 'dev.log'), 'a');
    const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', '3000'], {
      cwd: ROOT, detached: true, stdio: ['ignore', out, out],
      env: Object.assign({}, process.env, { NODE_OPTIONS: '--max-old-space-size=1536' }),
    });
    child.unref();
    // short confirm-poll (~12s) — never blocks long; next cycle re-verifies anyway
    let confirmed = false;
    try {
      sh('bash', ['-c', 'for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:3000/ 2>/dev/null | grep -q 200 && exit 0; sleep 1; done; exit 1'], { timeout: 30_000 });
      confirmed = true;
    } catch (_) { /* warming — next cycle verifies */ }
    res.actions.push((confirmed ? 'WEB-REVIVED(confirmed' : 'WEB-REVIVED(warming') + ' · pid ' + child.pid + (stuck ? ' · stuck-cleared' : '') + ')');
    log('web :3000 dead — revived (pid ' + child.pid + ' confirmed=' + confirmed + ')');
  } catch (e) { res.actions.push('web-heal-FAILED:' + String((e && e.message) || e).slice(0, 60)); }
}

/* ---------------------------------------------------------------- *
 * 3+4. FLEET VAULT — zero-touch restore + auto-seal
 * ---------------------------------------------------------------- */
function vaultPaths() {
  return {
    enc: path.join(AGENT_DIR, 'fleet_keys.enc'),
    meta: path.join(AGENT_DIR, 'fleet_keys.meta.json'),
    vault: path.join(AGENT_DIR, 'keys', 'vault.json'),
  };
}

function healFleetKeys(res) {
  const { enc, meta, vault } = vaultPaths();
  const fleetPresent = fs.existsSync(vault);
  const sealed = fs.existsSync(enc) && fs.existsSync(meta);
  if (fleetPresent && sealed) {
    // 115 — the reseal trigger now scans EVERY file under keys/ (any extension):
    // the Task-113 hole — wallets-seed.json created after the last seal never
    // triggered a reseal (only vault.json/.env mtimes were compared) and the
    // sandbox wipe consumed the anchored seed. Newest-mtime across the whole
    // keyset is the trigger; a future wipe can then never lose a young key.
    let newestM = fs.statSync(vault).mtimeMs;
    try {
      for (const f of fs.readdirSync(path.join(AGENT_DIR, 'keys'))) {
        const m = fs.statSync(path.join(AGENT_DIR, 'keys', f)).mtimeMs;
        if (m > newestM) newestM = m;
      }
    } catch (_) {}
    let envM = 0;
    try { envM = fs.statSync(path.join(AGENT_DIR, '.env')).mtimeMs; } catch (_) {}
    if (newestM > fs.statSync(enc).mtimeMs || envM > fs.statSync(enc).mtimeMs) {
      const out = spawnDetached('fleet_vault.cjs', ['--seal'], AGENT_DIR);
      res.actions.push(out ? 'auto-RESEAL-fired(keys-newer)' : 'reseal-FAILED');
    } else res.actions.push('fleet-ok(sealed-fresh)');
    return;
  }
  if (!fleetPresent && sealed) {
    // THE ZERO-TOUCH RESTORE — sandbox wiped keys, private repo still holds the seal
    try {
      sh(process.execPath, [path.join(AGENT_DIR, 'fleet_vault.cjs'), '--open'], { cwd: AGENT_DIR, timeout: 60_000 });
      res.actions.push('FLEET-RESTORED-FROM-SEAL(zero-touch)');
      // (82) no healDaemon here — the main flow below spawns exactly once
      // (double-spawn raced the singleton and produced army=0 ghosts in drill B)
    } catch (e) {
      res.actions.push('fleet-restore-FAILED:' + String(e.message || e).slice(0, 60));
    }
    return;
  }
  res.actions.push(fleetPresent ? 'fleet-ok(unsealed-will-seal)' : 'fleet-absent(no-seal-yet)');
  if (fleetPresent && !sealed) {
    const out = spawnDetached('fleet_vault.cjs', ['--seal'], AGENT_DIR);
    if (out) res.actions.push('auto-SEAL-fired');
  }
}

/* ---------------------------------------------------------------- *
 * main
 * ---------------------------------------------------------------- */
function main() {
  const t0 = Date.now();
  if (!acquireLock()) { try { fs.writeFileSync(RESULT, JSON.stringify({ at: new Date().toISOString(), mode: MODE, skipped: 'lock-held' })); } catch (_) {} return; }
  const res = { at: new Date().toISOString(), mode: MODE, actions: [] };
  try {
    healPushCreds(res);   // 84 — BEFORE anything that talks to origin
    syncRepo(res);
    healDeps(res);
    healEnv(res);
    healFleetKeys(res);
    healDaemon(res);
    healChain(res);
    healEngine(res);
    healRelay(res);  // 108 — THE-DOOR relayer תמיד-חי (דבר-גורר-דבר)
    healDex(res);    // 110 — מפעיל-הדקס תמיד-חי (THE-DEX)
    healSibling(res); // 110 — מאמת-האח תמיד-חי (אימות-הדדי)
    healHarvest(res); // 111 — קוצר-הערך תמיד-חי (THE-HARVEST)
    healWallets(res); // 113 — ארנקי-הצבא תמיד-חי (THE-WALLETS: עיגון+תקצוב+תדלוק idempotent)
    healVault(res);   // 114 — הכספת-המוצפנת: verify-בכל-טיק · restore-אוטומטי · reseal
    healDeposits(res); // 114 — תיבת-ההפקדות תמיד-חיה (10 רשתות · wrap 1:1 אוטומטי)
    healWeb(res);   // 106 — הדף-תמיד-חי (השרת-שמת-עם-הסשן-חוזר-אוטומטית)
  } catch (e) {
    res.actions.push('guard-ERROR:' + String((e && e.message) || e).slice(0, 100));
  }
  res.ms = Date.now() - t0;
  try { fs.writeFileSync(RESULT, JSON.stringify(res, null, 2) + '\n'); } catch (_) {}
  log('GUARD DONE · ' + res.actions.join(' · ') + ' · ' + res.ms + 'ms');
}

main();
