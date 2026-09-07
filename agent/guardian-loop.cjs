#!/usr/bin/env node
/**
 * guardian-loop.cjs — Task 116: THE PERSISTENT ALWAYS-UP LOOP (durable form)
 *
 * Lesson from 115: the "persistent detached guardian LOOP" was an ad-hoc shell
 * `while true … sleep 120` — the sandbox reaped it with the session and the
 * always-up layer silently died (guardian runs ONCE per invocation by design).
 *
 * This wrapper IS the loop now: every 120s it dispatches one `guardian.cjs
 * --loop` pass (fresh process, TTL-locked, exactly like every documented pass),
 * and it is itself spawned detached+unref'd by guardian_boot.cjs on every
 * `bun run dev` — so the always-up layer no longer depends on any session.
 *
 * Singleton: agent/.guardian-loop.pid + kill-0 check (a stale pid never blocks).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const AGENT_DIR = __dirname;
const PID_FILE = path.join(AGENT_DIR, '.guardian-loop.pid');
const GUARDIAN = path.join(AGENT_DIR, 'guardian.cjs');
const LOG = path.join(AGENT_DIR, 'guardian.log');
const INTERVAL_MS = 120_000;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

// singleton — another live loop wins, we exit quietly
try {
  const prev = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (prev && prev !== process.pid && alive(prev)) process.exit(0);
} catch (_) { /* no pid file */ }
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (_) {}

function log(msg) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] loop(' + process.pid + '): ' + msg + '\n'); } catch (_) {}
}

function firePass() {
  try {
    const out = fs.openSync(LOG, 'a');
    const child = spawn(process.execPath, [GUARDIAN, '--loop'], { cwd: AGENT_DIR, detached: true, stdio: ['ignore', out, out] });
    child.unref();
  } catch (e) { log('spawn failed: ' + (e.message || e)); }
}

log('THE-PERSISTENT-LOOP up (every ' + INTERVAL_MS / 1000 + 's)');
firePass(); // first pass immediately
const timer = setInterval(firePass, INTERVAL_MS);
timer.unref?.();
// keep the event loop alive forever
setInterval(() => {}, 60_000);
