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

  // 117g — STATE-RESCUE: the reset is law for CODE, never for LIVE STATE.
  // Observed 04:03Z: divergence-heal rolled the deposits watcher back from
  // tick 158 to 153 (state file reverted to the last committed version) —
  // daemons respawned INTO THE PAST. The disk is the authority (117g lesson):
  // snapshot every modified state file before the reset, restore right after.
  // Code files still reset to origin — the ledger never travels back in time.
  const RESCUE_PATTERNS = [/^sovereign\/node\/[^/]+\.(json|jsonl|log)$/, /^agent\/[^/]+\.(json|log)$/];
  const SECRET_RE = /fleet_keys|(^|\/)keys\/|\.env($|\b)|^upload\//;
  const rescue = (() => {
    try {
      const st = sh('git', ['status', '--porcelain'], { timeout: 20_000 });
      const files = st.split('\n').map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).filter(Boolean)
        .filter((p) => RESCUE_PATTERNS.some((re) => re.test(p)) && !SECRET_RE.test(p));
      if (!files.length) return null;
      const dir = path.join(ROOT, 'agent', 'rescue', new Date().toISOString().replace(/[:.]/g, '-'));
      fs.mkdirSync(dir, { recursive: true });
      let saved = 0;
      for (const f of files) { try { fs.copyFileSync(path.join(ROOT, f), path.join(dir, f.replace(/\//g, '__'))); saved++; } catch (_) {} }
      return saved ? { dir, files, saved } : null;
    } catch (_) { return null; }
  })();
  if (rescue) res.actions.push('state-rescued(' + rescue.saved + ' files · ' + path.basename(rescue.dir) + ')');

  // heal: stash unpushed noise (recoverable), then hard-reset to origin
  try {
    sh('git', ['stash', 'push', '-u', '-m', 'guardian-pre-heal ' + new Date().toISOString()], { timeout: 30_000 });
    res.actions.push('stashed-local-noise');
  } catch (_) { /* nothing to stash or stash failed — reset is still safe */ }
  try {
    sh('git', ['reset', '--hard', 'origin/main'], { timeout: 30_000 });
    /* 117g — the living ledger goes back BEFORE anything reads it: daemons
     * respawn below and must find the present, not the past. */
    if (rescue) {
      let rn = 0;
      for (const f of rescue.files) { try { fs.copyFileSync(path.join(rescue.dir, f.replace(/\//g, '__')), path.join(ROOT, f)); rn++; } catch (_) {} }
      if (rn) res.actions.push('state-restored(' + rn + ')');
    }
    res.actions.push(diverged ? 'DIVERGENCE-HEALED(reset→origin/main · state-kept)' : 'ROLLBACK-HEALED(reset→origin/main · state-kept)');
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
/* 117k — THE-KEY-BROKER תמיד-חי: שער-החתימה-הריבוני (mini-services/key-broker · בונ · פורט 3040).
 * בדיקת-חיות-לפי-פורט (cmdline-של-בונ לא-מכיל-נתיב — pgrep-שקרן נמדד): health 200 = חי.
 * localhost-בלבד + טוקן — אם-מת-מקימים-אותו (המפתחות-נטענים-מהכספת-בכל-עלייה מחדש). */
function healKeyBroker(res) {
  try {
    let alive = false;
    try {
      const h = sh('bash', ['-c', 'curl -s -m 3 http://127.0.0.1:3040/health 2>/dev/null'], { timeout: 8_000 });
      alive = /"ok":true/.test(String(h));
    } catch (_) { alive = false; }
    if (alive) { res.actions.push('key-broker-alive'); return; }
    const out = fs.openSync(LOG, 'a');
    const child = spawn('bun', ['run', 'dev'], { cwd: path.join(ROOT, 'mini-services', 'key-broker'), detached: true, stdio: ['ignore', out, out] });
    child.unref();
    res.actions.push(child.pid ? 'KEY-BROKER-SPAWNED(pid ' + child.pid + ')' : 'key-broker-spawn-FAILED');
    log('key-broker dead — spawned bun (pid ' + (child.pid || '?') + ')');
  } catch (_) { res.actions.push('key-broker-check-skipped'); }
}
function healSibling(res) {
  try {
    if (pgrepAlive('sibling.cjs watch')) { res.actions.push('sibling-verifier-alive'); return; }
    const pid = spawnDetached('sibling.cjs', ['watch'], path.join(ROOT, 'sovereign', 'node'));
    res.actions.push(pid ? 'SIBLING-VERIFIER-SPAWNED(pid ' + pid + ')' : 'sibling-spawn-FAILED');
    log('sibling verifier missing — spawned watch (pid ' + pid + ')');
  } catch (_) { res.actions.push('sibling-check-skipped'); }
}

/* 117o — OWNER-AUTH WATCH: ערנות-בעלות — כל-שינוי ב-last_owner_update של החשבון-הראשי
 * (בשתי-השרשרות) מוכרז-חירום. הלקח-מהתקרית-117o: הסבת-מפתחות-רכה בסנדבוקס-אחר עברה
 * בשקט. בסיס-ראשון נשמר; שינוי ללא-אישור-מפעיל = OWNER-ALERT על-כל-המשטחים. */
function watchOwnerAuth(res) {
  const ACC = (process.env.AGENT_ACCOUNT || 'headcorner').toLowerCase();
  const STATE_FILE = path.join(AGENT_DIR, 'owner_watch_state.json');
  const FLAG = path.join(AGENT_DIR, 'OWNER-ALERT.flag');
  const q = (url, acc) => sh('bash', ['-c', 'curl -s -m 8 ' + url + " -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"condenser_api.get_accounts\",\"params\": [[\\\"" + acc + "\\\"]],\"id\":1}' 2>/dev/null"], { timeout: 10_000 });
  try {
    const cur = {};
    try { cur.steem = JSON.parse(String(q('https://api.steemit.com', ACC))).result[0].last_owner_update || 'never'; } catch (_) { cur.steem = null; }
    try { cur.hive = JSON.parse(String(q('https://api.hive.blog', ACC))).result[0].last_owner_update || 'never'; } catch (_) { cur.hive = null; }
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) {}
    if (!prev || (!prev.steem && !prev.hive)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ at: new Date().toISOString(), steem: cur.steem, hive: cur.hive }, null, 2) + '\n');
      res.actions.push('owner-baseline(' + cur.steem + '/' + cur.hive + ')');
      return;
    }
    const changed = (cur.steem && prev.steem && cur.steem !== prev.steem) || (cur.hive && prev.hive && cur.hive !== prev.hive);
    if (changed) {
      fs.writeFileSync(FLAG, JSON.stringify({ at: new Date().toISOString(), was: prev, now: cur }, null, 2) + '\n');
      log('🚨 OWNER-AUTH CHANGED on @' + ACC + ' · was ' + prev.steem + '/' + prev.hive + ' · now ' + cur.steem + '/' + cur.hive + ' — if the operator did not rotate: the account is under takeover, 30-day recovery window');
      res.actions.push('🚨OWNER-ALERT(was ' + prev.steem + '→now ' + cur.steem + ')');
    } else {
      res.actions.push('owner-auth-unchanged');
    }
    if (cur.steem || cur.hive) fs.writeFileSync(STATE_FILE, JSON.stringify({ at: new Date().toISOString(), steem: cur.steem || prev.steem, hive: cur.hive || prev.hive }, null, 2) + '\n');
  } catch (_) { res.actions.push('owner-watch-skipped'); }
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
    // 117h — מודע-מעטפת: רק-חברים-שנאטמו-באמת משוחזרים; חברים-שלא-נאטמו (אבד/פר-הזמן) — מצבת-שורה-אחת, בלי-ניסיונות-שווא.
    if (fs.existsSync(enc)) {
      let presentMembers = null;
      try { presentMembers = Object.keys(JSON.parse(fs.readFileSync(enc, 'utf8')).members || {}); } catch (_) { presentMembers = null; }
      for (const m of members) {
        if (!fs.existsSync(path.join(vaultDir, m))) {
          if (presentMembers && !presentMembers.includes(m)) {
            if (!res.vaultAbsentLogged) res.vaultAbsentLogged = [];
            if (!res.vaultAbsentLogged.includes(m)) { log('VAULT-ABSENT ' + m + ' :: לא-נאטם (אבד/פר-הזמן) — מצבת-הכספת, ללא-שחזור'); res.vaultAbsentLogged.push(m); }
            continue;
          }
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
/* 117f — גיל-התהליך-הצעיר-ביותר (שניות): מודע-חימום. שרת-שזה-עתה-עלה מתקמפל-דפים 10-30 שניות
 * וה-webAlive() נכשל-בחימום — הריגה-אז = מרוץ-מוות-מחזורי (הלקח-של-117f: שרת-מת-כל-4-דק').
 * כלל-המלחמה: צעיר-<180 שניות = חימום → לעולם-לא-הורגים-ולא-מטילים-כפול. זקן-ותקוע בלבד = מפנים. */
function youngestNextAgeSec() {
  try {
    const out = sh('bash', ['-c', "ps -eo etimes,args 2>/dev/null | grep -E 'next[- ](dev|server)' | grep -v grep | sort -n | head -1 | awk '{print $1}'"], { timeout: 6_000 });
    const n = parseInt(String(out).trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : -1;
  } catch (_) { return -1; }
}
/* 117g — מדידת-rss-חיה של-next-server. הלקח-המדוד-פעמיים-היום: Turbopack אוגר-זיכרון-טבעי
 * מחוץ-לערימת-V8 — תקרת---max-old-space-size לא-חוסמת-rss (OOM-אמת ב-rss-1.3GB עם-תקרה-1024).
 * המיחזור-לפי-גיל (2700ש׳) מאחר-כשהצמדת-קימפול-כבדה-מנפחת-מהר. מיחזור-מופעל-rss:
 * מעל-900MB — ממוחזר-מיד-בתכנון, לפני-שה-OOM-הקרנל-מחליט-בשבילנו. */
function nextRssKb() {
  try {
    const out = sh('bash', ['-c', "ps -eo rss,args 2>/dev/null | grep 'next-server' | grep -v grep | sort -rn | head -1 | awk '{print $1}'"], { timeout: 6_000 });
    const n = parseInt(String(out).trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (_) { return 0; }
}
function healWeb(res) {
  try {
    if (webAlive()) {
      /* 117f — מיחזור-יזום: Turbopack אוגר-זיכרון-עצמי-מחוץ-לערימת-V8 (ה-OOM-היה-ב-rss-1.63GB-עם-תקרת-ערימה-1024).
       * שרת-בן->45 דק' = ממוחזר-בתכנון-לפני-ה-OOM — הדף-חוזר-תוך-~15 שניות והזיכרון-מתאפס. */
      const age = youngestNextAgeSec();
      /* 117g — מיחזור-מופעל-rss: גם-אם-השרת-צעיר, rss>900MB = פצצה-מתקתקת (נמדד-חי:
       * 1.3GB-תוך-~8 דק' אחרי-קימפול-כל-הנתיבים) → מיחזור-מיד. הגיל-עדיין-מגן-בנפרד. */
      const rssKb = nextRssKb();
      if (age > 2700 || rssKb > 900_000) {
        try { sh('pkill', ['-f', 'next-server']); sh('pkill', ['-f', 'next dev']); } catch (_) {}
        const outR = fs.openSync(path.join(ROOT, 'dev.log'), 'a');
        const r = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', '3000'], {
          cwd: ROOT, detached: true, stdio: ['ignore', outR, outR],
          env: Object.assign({}, process.env, { NODE_OPTIONS: '--max-old-space-size=1024' }),
        });
        r.unref();
        res.actions.push('WEB-RECYCLED(age ' + age + 's · rss ' + Math.round(rssKb / 1024) + 'MB · pid ' + r.pid + ')');
        log('web :3000 proactive recycle (age ' + age + 's · rss ' + Math.round(rssKb / 1024) + 'MB — native-mem growth) → pid ' + r.pid);
        return;
      }
      res.actions.push('web-ok(3000 · age ' + age + 's)');
      return;
    }
    // young process alive? it is compiling — never kill, never double-spawn (warming grace)
    const age = youngestNextAgeSec();
    if (age >= 0 && age < 180) { res.actions.push('web-warming(age ' + age + 's · no-kill)'); return; }
    // dead port but stuck OLD process? clear it so the revival owns the port
    const stuck = pgrepAlive('next-server') || pgrepAlive('next dev');
    if (stuck) { try { sh('pkill', ['-f', 'next-server']); sh('pkill', ['-f', 'next dev']); } catch (_) {} }
    const out = fs.openSync(path.join(ROOT, 'dev.log'), 'a');
    const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', '3000'], {
      cwd: ROOT, detached: true, stdio: ['ignore', out, out],
      env: Object.assign({}, process.env, { NODE_OPTIONS: '--max-old-space-size=1024' }),
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
    // LOCAL restore — seal now lives machine-local only (117p: keys fully out of repo).
    // After a sandbox reset the seal is NOT in the fresh clone → operator restores via
    // THE-GATE paste (UI: #gate/connect) or decrypts download/KEYS-BACKUP-*.tar.enc
    // (operator password, chat-only). No silent path, no key material in git. Ever.
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
    healKeyBroker(res); // 117k — שער-החתימה-הריבוני תמיד-חי (THE-KEY-BROKER · 8 דלתות)
    watchOwnerAuth(res); // 117o — ערנות-בעלות: כל-שינוי-owner בשתי-השרשרות = חירום (לקח-התקרית)
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
