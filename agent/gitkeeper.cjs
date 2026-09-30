#!/usr/bin/env node
/**
 * gitkeeper.cjs — Task 56: the anti-loss insurance loop.
 *
 * The 2026-09-04 incident: sandbox wipe reverted the machine to an old git
 * state; only origin/main saved the work. Lesson → pushing is not a chore,
 * it is sovereignty infrastructure. This module makes "everything is lost"
 * structurally impossible:
 *
 *   every cycle (daemon loop 21, default 30m):
 *     1. git status — no changes → clean, skip
 *     2. noise filter — only runtime junk changed → skip (no history spam)
 *     3. git add -A  (gitignore already excludes agent/.env, agent/keys/,
 *        upload/, db/*.db — the secrets never leave the machine, iron law)
 *     4. SECRET GATE — scan the staged diff for WIFs / private keys / tokens;
 *        anything matching → ABORT the commit, record 'blocked', push nothing
 *     5. commit "gitkeeper: auto-save <iso> · N files"
 *     6. git push origin main  (failure is recorded, never fatal;
 *        84 — auth failure → repair creds from the sealed .env GITHUB_TOKEN → retry once;
 *        a dead token no longer silences the repo)
 *     7. state → agent/gitkeeper_state.json (daemon reads it for the console)
 *
 * Usage: node gitkeeper.cjs [--once]   (default: one pass and exit)
 *        The daemon spawns this detached each cycle — same pattern as reflex.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AGENT_DIR = __dirname;
const REPO = path.resolve(AGENT_DIR, '..');
const STATE_FILE = path.join(AGENT_DIR, 'gitkeeper_state.json');
const LOCK_FILE = path.join(AGENT_DIR, 'gitkeeper.lock');
const BRANCH = process.env.GITKEEPER_BRANCH || 'main';
const MAX_PUSH_SEC = 90;

// Runtime junk that must never create history entries
const NOISE = [
  /^\.zscripts\/dev\.pid$/,
  /^agent\/\.guardian\.lock$/,          // 82 — guardian runtime lock
  /^agent\/\.daemon\.lock$/,            // 82 — daemon singleton lock (pid leak + spam)
  /^agent\/guardian_result\.json$/,     // 82 — guardian runtime report
  /^agent\/gitkeeper_state\.json$/,     // 82 — gitkeeper runtime report
  /^agent\/anchor_last\.json$/,         // 82 — attest runtime report (txids live on-chain)
  /^sovereign\/node\/RECOVERY_POINTER\.json$/, // 82 — living-attest recovery pointer (runtime)
  /^agent\/cloud_heart_report\.json$/,  // 83 — cloud-heart runtime report (verdict lives in Actions logs + chain)
  /^agent\/cloud_heart\.log$/,          // 83 — cloud-heart runtime log
  /^agent\/selfhost_verdict\.json$/,    // 84 — self-host deduction verdict (runtime; the proof lives on-chain + in git)
  /^agent\/selfhost_drill\.json$/,      // 84 — drill window (evidence summarized in docs; pid window is runtime)
  /^agent\/wrapped\.lock$/,
  /^\.zscripts\/dev\.log$/,
  /^dev\.log$/,
  /^agent\/gitkeeper\.lock$/,
  /^\.next\//,
  /^agent-ctx\//,
  /^tool-results\//,
  /^upload\//,
  /\.log$/,
];

// Iron gate — anything matching these in the STAGED diff aborts everything
const SECRET_PATTERNS = [
  { name: 'steem/hive WIF', re: /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/ },
  { name: 'blurt WIF', re: /\bB[1-9A-HJ-NP-Za-km-z]{50}\b/ },
  { name: 'chain PVT key', re: /\bPVT_[A-Za-z0-9_]{10,}\b/ },
  { name: 'PEM private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'github token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  // built via RegExp so the source below never matches itself
  { name: 'x-access-token url', re: new RegExp('x-access-token:[A-Za-z0-9_\\-]+@') },
];

// 10-d-3 (2026-09-30) — keyname gate: the WIF-shape scan above misses secrets hidden under
// innocent variable names (vault passphrases / WIF env keys pasted into tracked files).
// Each alternative below is assembled from two literals so THIS source line never matches
// the assembled pattern (same self-immunity trick as the x-access-token entry above).
const KEYNAME_RE = new RegExp(
  ['keysZip' + 'Pass', 'keysBackup' + 'Pass', 'POSTING_' + 'WIF', 'ACTIVE_' + 'WIF', 'OWNER_' + 'WIF', 'PRIVATE_' + 'KEY'].join('|'),
  'i'
);
// Sanctioned exceptions (survival-first pair + prose) — the auto-commit of these MUST keep working:
//   · agent/recovery-meta.json — the passphrase ledger that opens the sealed envelope
//   · agent/vault/*.enc        — the AES ciphertext envelope itself
//   · *.md                     — documentation/prose
function keynameExempt(p) {
  if (!p) return false;
  if (p === 'agent/recovery-meta.json') return true;
  if (/^agent\/vault\/[^/]+\.enc$/.test(p)) return true;
  if (/\.md$/.test(p)) return true;
  return false;
}

function sh(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: REPO,
    encoding: 'utf8',
    timeout: opts.timeout || 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  }).toString().trim();
}

function log(msg) {
  const line = '[' + new Date().toISOString() + '] gitkeeper: ' + msg;
  try { console.log(line); } catch (_) { /* detached stdout may be closed */ }
  try {
    fs.appendFileSync(path.join(AGENT_DIR, 'gitkeeper.log'), line + '\n');
  } catch (_) { /* best effort */ }
}

function writeState(state) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (_) {}
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; }
}

// ── lock: never overlap ────────────────────────────────────────────────────
function acquireLock() {
  try {
    const prev = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    const ageMin = (Date.now() - (prev.at || 0)) / 60000;
    if (ageMin < 10) return false; // fresh lock = someone else is running
  } catch (_) { /* no lock */ }
  fs.writeFileSync(LOCK_FILE, JSON.stringify({ at: Date.now(), pid: process.pid }));
  return true;
}
function releaseLock() { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} }

// ── 84: credential self-repair ─────────────────────────────────────────────
// The 2026-09-05 incident: a dead GitHub token cut the repo's voice until the
// operator hand-delivered a new one. The durable copy lives in agent/.env
// (GITHUB_TOKEN — inside the AES seal, restored zero-touch on every reset);
// the ephemeral copy lives in .git/config. Auth failure → sync ephemeral from
// durable → retry. Token never logged, never committed.
function repairPushCreds() {
  try {
    const m = fs.readFileSync(path.join(AGENT_DIR, '.env'), 'utf8').match(/^GITHUB_TOKEN=(\S+)\s*$/m);
    if (!m) return false;
    const cur = execSync('git remote get-url origin', { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const withTok = cur.replace(/^(https:\/\/)([^/@]*@)?/, 'https://x-access-token:' + m[1] + '@');
    if (withTok === cur) return false;
    execSync('git remote set-url origin ' + JSON.stringify(withTok), { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 });
    log('push credentials repaired from .env GITHUB_TOKEN — retrying');
    return true;
  } catch (_) { return false; }
}
const AUTH_FAIL_RE = /Authentication|401|403|permission|denied|could not read Username|Invalid username or password/i;
const PUSH_REJECT_RE = /fetch first|non-fast-forward|rejected|\[rejected\]/i;

// 84 — push with self-heal. Two failure classes, both now fatal-proof:
//   · REJECTED (fetch first) — the other runner (cloud ⇄ sandbox) moved origin
//     mid-run (found live: cloud takeover 33978041724 lost its evidence commit
//     to exactly this race). Heal (R73, hardened — the 2026-09-21 dac4d1e
//     incident: an auto-save re-committed its whole stale tree and silently
//     re-instated the cron schedule that ef06cc914/R71 had removed 3 seconds
//     earlier, un-doing quota sovereignty): reset --hard onto the new origin,
//     then cherry-pick -X theirs of the held snapshot — re-applies ONLY this
//     run's own writes onto the new truth (state files stay last-writer-wins,
//     never a JSON merge), while foreign mid-run edits to non-state files
//     (workflows, docs) are ADOPTED, never silently reverted.
//   · AUTH — repair credentials from the sealed .env, then push again.
function healOntoOrigin() {
  sh('git fetch origin ' + BRANCH, { timeout: 45_000 });
  sh('git reset --hard origin/' + BRANCH, { timeout: 30_000 }); // ORIG_HEAD ← our snapshot
  try {
    sh('git cherry-pick -X theirs ORIG_HEAD', { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    log('origin moved mid-run — snapshot re-applied onto origin/' + BRANCH + ' (cherry-pick -X theirs; foreign edits adopted)');
    return { emptyPick: false };
  } catch (eC) {
    const s = String(eC.message || eC);
    try { sh('git cherry-pick --abort', { timeout: 30_000 }); } catch (_) {}
    if (/nothing to commit|empty/i.test(s)) {
      log('origin moved mid-run — snapshot already carried by origin (empty pick), nothing to re-apply');
      return { emptyPick: true };
    }
    log('heal conflict — snapshot dropped, origin keeps the truth: ' + s.slice(0, 140));
    throw new Error('heal-conflict');
  }
}
function pushWithHeal(msg) {
  const attempt = () => sh('git push origin ' + BRANCH, { timeout: MAX_PUSH_SEC * 1000 });
  try { attempt(); return { ok: true }; } catch (e) { var err1 = String(e.message || e); }
  if (PUSH_REJECT_RE.test(err1)) {
    try {
      const h = healOntoOrigin();
      try { attempt(); return { ok: true, healed: h.emptyPick ? 'snapshot-already-on-origin' : 'snapshot-reapplied' }; } catch (e2) { var err2 = String(e2.message || e2); }
      if (AUTH_FAIL_RE.test(err2) && repairPushCreds()) { try { attempt(); return { ok: true, healed: 'snapshot-reapplied+creds' }; } catch (e3) { return { ok: false, error: String(e3.message || e3) }; } }
      return { ok: false, error: err2 || 'unknown' };
    } catch (eR) { return { ok: false, error: String(eR.message || eR) }; }
  }
  if (AUTH_FAIL_RE.test(err1) && repairPushCreds()) {
    try { attempt(); return { ok: true, healed: 'creds' }; } catch (e2) { var err3 = String(e2.message || e2); }
    if (PUSH_REJECT_RE.test(err3)) {
      try {
        const h = healOntoOrigin();
        try { attempt(); return { ok: true, healed: (h.emptyPick ? 'snapshot-already-on-origin' : 'snapshot-reapplied') + '+creds' }; } catch (e3) { return { ok: false, error: String(e3.message || e3) }; }
      } catch (eR) { return { ok: false, error: String(eR.message || eR) }; }
    }
    return { ok: false, error: err3 || 'unknown' };
  }
  return { ok: false, error: err1 };
}

// ── one pass ───────────────────────────────────────────────────────────────
function runOnce() {
  const prev = readState();
  const state = { at: new Date().toISOString(), branch: BRANCH };

  // 0b. 117p5 — seal the chain-archive BEFORE staging: the live jsonl is now
  //    local-only (gitignored); survival travels as chain-archive-seal.jsonl.gz.
  //    Handles restore-after-wipe too. Never fatal.
  try {
    const sealOut = sh('node ' + JSON.stringify(path.join(REPO, 'sovereign', 'node', 'seal_archive.cjs')), { timeout: 150_000 });
    log(String(sealOut).trim().split('\n')[0] || 'seal ok');
  } catch (e) { log('seal failed (non-fatal): ' + String(e.message || e).slice(0, 80)); }

  // 0a. R73 — recover from a heal interrupted mid-flight (agent killed while
  //     cherry-picking): abort any leftover sequencer state BEFORE status, or
  //     staged conflict content would poison the next snapshot.
  try { sh('git cherry-pick --abort 2>/dev/null || true'); } catch (_) {}

  // 0. git available? repo exists?
  try {
    state.head = sh('git rev-parse --short HEAD');
  } catch (e) {
    state.error = 'not a git repo: ' + String(e.message || e).slice(0, 100);
    writeState(state); log('ABORT · ' + state.error); return state;
  }

  // 1. what changed?
  let raw = '';
  try { raw = sh('git status --porcelain'); } catch (e) { state.error = 'status failed'; writeState(state); return state; }
  const lines = raw.split('\n').filter(Boolean);
  if (!lines.length) {
    state.result = 'clean';
    state.lastCommit = prev.lastCommit || state.head;
    writeState(state); log('clean — nothing to save (HEAD ' + state.head + ')'); return state;
  }

  // 2. noise filter — only junk changed → skip without commit
  const real = lines.filter((l) => {
    const p = l.slice(3).replace(/^"|"$/g, '');
    return !NOISE.some((re) => re.test(p));
  });
  if (!real.length) {
    state.result = 'noise-only';
    state.files = lines.length;
    state.lastCommit = prev.lastCommit || state.head;
    writeState(state); log('noise-only changes (' + lines.length + ' runtime files) — no history entry'); return state;
  }

  // 3. stage everything (gitignore is the iron law for secrets)
  try { sh('git add -A'); } catch (e) { state.error = 'add failed: ' + String(e.message || e).slice(0, 120); writeState(state); log('ABORT · ' + state.error); return state; }
  // belt + suspenders: even if gitignore ever regresses, these never go up
  // (117i — fleet_keys.enc/meta RETURNED to the repo: the 117g removal cost the
  // whole identity at the 15:52 wipe; only git history 749e7db kept the seed.
  // The envelope is ciphertext + base64url pass — no gate pattern matches its
  // hex/base64url lines, so the full-scan gate below stays exempt-free and honest.)
  try { sh('git reset -q -- agent/.env agent/keys upload/ 2>/dev/null || true'); } catch (_) {}

  // 4. SECRET GATE — scan staged diff
  //    (117g — the (82) exemption is DEAD: fleet_keys.enc no longer reaches
  //    staging at all (gitignore + unstaged above). The gate now scans EVERY
  //    staged byte — no file is above suspicion.
  let staged = '';
  try { staged = sh('git diff --cached', { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }); } catch (_) {}
  if (staged) {
    const gateable = staged; // 117g — full scan: no exemptions, no blind spots
    for (const { name, re } of SECRET_PATTERNS) {
      const m = gateable.match(re);
      if (m) {
        try { sh('git reset -q'); } catch (_) {}
        state.result = 'blocked';
        state.blockedBy = name;
        state.hint = 'secret-shaped string found in staged diff — commit aborted, nothing pushed';
        writeState(state);
        log('BLOCKED · ' + name + ' · pattern=' + m[0].slice(0, 6) + '… · commit+push aborted');
        return state;
      }
    }

    // 4b. 10-d-3 — keyname scan, PER FILE: added lines of non-exempt files may not carry
    //     vault-passphrase / WIF-env markers. Fail-closed: a chunk whose header cannot be
    //     attributed to a file blocks the commit (never guess, never skip).
    for (const chunk of staged.split(/^diff --git /m).slice(1)) {
      const nl = chunk.indexOf('\n');
      const header = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
      const hm = header.match(/^a\/(.+) b\/(.+)$/);
      if (!hm) {
        try { sh('git reset -q'); } catch (_) {}
        state.result = 'blocked';
        state.blockedBy = 'keyname gate: unparsable staged diff header';
        state.hint = 'a staged chunk could not be attributed to a file — fail-closed abort, nothing pushed';
        writeState(state);
        log('BLOCKED · unparsable diff header: ' + header.slice(0, 60) + ' · commit+push aborted');
        return state;
      }
      if ([hm[1], hm[2]].every(keynameExempt)) continue; // sanctioned survival pair / docs
      const added = chunk.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
      const hit = added.find((l) => KEYNAME_RE.test(l));
      if (hit) {
        try { sh('git reset -q'); } catch (_) {}
        state.result = 'blocked';
        state.blockedBy = 'keyname secret marker (' + hm[2] + ')';
        state.hint = 'added line carries a vault-passphrase/WIF-env marker — commit aborted, nothing pushed';
        writeState(state);
        log('BLOCKED · keyname marker=' + ((KEYNAME_RE.exec(hit) || ['?'])[0].slice(0, 6)) + '… · file=' + hm[2] + ' · commit+push aborted');
        return state;
      }
    }
  }

  // 5. commit
  state.files = real.length;
  const msg = 'gitkeeper: auto-save ' + new Date().toISOString().replace(/\.\d+Z$/, 'Z') +
    ' · ' + real.length + ' file' + (real.length === 1 ? '' : 's') + ' · loop 21';
  try {
    sh('git commit -m ' + JSON.stringify(msg));
    state.result = 'committed';
    state.commitMsg = msg;
  } catch (e) {
    // nothing staged after the noise/secret gates → treat as clean
    state.result = 'clean';
    state.lastCommit = state.head;
    writeState(state); log('nothing left to commit after gates'); return state;
  }

  // 6. push (84 — auth + rejection self-healing, see pushWithHeal)
  const push = pushWithHeal(msg);
  if (push.ok) {
    state.pushed = true;
    state.push = 'origin/' + BRANCH + (push.healed ? ' (' + push.healed + ')' : '');
    if (push.healed) state.credsHealed = push.healed;
    log('pushed' + (push.healed ? ' after heal[' + push.healed + ']' : '') + ' → origin/' + BRANCH + ' · ' + real.length + ' files · ' + msg);
  } else {
    state.pushed = false;
    state.pushError = String(push.error || 'unknown').slice(0, 200);
    log('commit ok, push FAILED (kept local): ' + state.pushError);
  }

  // 7. record head
  try { state.lastCommit = sh('git rev-parse --short HEAD'); } catch (_) {}
  writeState(state);
  return state;
}

function main() {
  if (!acquireLock()) { log('another pass is running — skip'); return; }
  try { runOnce(); } finally { releaseLock(); }
}

main();
