#!/usr/bin/env node
/**
 * guardian-loop.cjs — Task 116: THE PERSISTENT ALWAYS-UP LOOP (dual-slot form)
 *
 * Lessons, measured:
 *  · 115: the ad-hoc shell `while true … sleep` loop was reaped with the session.
 *  · 116-a: even a detached wrapper died in the same OOM sweep that killed next dev
 *    — a SINGLE reviver is a single point of failure.
 *
 * This wrapper IS the loop now, in DUAL-SLOT form: slot 1 and slot 2 are
 * independent processes (own pid-file, own tick phase — slot 2 starts 60s
 * offset), each firing one `guardian.cjs --loop` pass every 120s. The guardian
 * TTL-lock (4 min) dedupes overlapping passes, so two slots are harmless;
 * an OOM sweep must now kill BOTH, at different phases, to silence always-up.
 *
 * Spawned detached+unref'd by guardian_boot.cjs on every `bun run dev` (both
 * slots). Singleton per slot: .guardian-loop-<slot>.pid + kill-0 check.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const AGENT_DIR = __dirname;
const GUARDIAN = path.join(AGENT_DIR, 'guardian.cjs');
const LOG = path.join(AGENT_DIR, 'guardian.log');
const INTERVAL_MS = 120_000;

const SLOT = process.argv.includes('--slot') ? (process.argv[process.argv.indexOf('--slot') + 1] || '1') : '1';
const PID_FILE = path.join(AGENT_DIR, '.guardian-loop-' + SLOT + '.pid');
const START_OFFSET_MS = SLOT === '2' ? 60_000 : 0; // phase offset — sweeps rarely kill both phases

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

// per-slot singleton — another live same-slot loop wins, we exit quietly
try {
  const prev = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
  if (prev && prev !== process.pid && alive(prev)) process.exit(0);
} catch (_) { /* no pid file */ }
try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (_) {}

function log(msg) {
  try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] loop' + SLOT + '(' + process.pid + '): ' + msg + '\n'); } catch (_) {}
}

function firePass() {
  // STASIS note (R24-b 2026-10-05): the guardian only REVIVES daemons — it never signs.
  // Capital gates live inside the daemons themselves (per-site stasisStop vs lib/capital_gate.cjs),
  // so a revived process re-enters the brake at its own sign sites — see DAEMONS.md.
  try {
    const out = fs.openSync(LOG, 'a');
    const child = spawn(process.execPath, [GUARDIAN, '--loop'], { cwd: AGENT_DIR, detached: true, stdio: ['ignore', out, out] });
    child.unref();
  } catch (e) { log('spawn failed: ' + (e.message || e)); }
}

log('THE-PERSISTENT-LOOP slot ' + SLOT + ' up (every ' + INTERVAL_MS / 1000 + 's, phase +' + START_OFFSET_MS / 1000 + 's)');
const first = setTimeout(firePass, START_OFFSET_MS);
first.unref?.();
const timer = setInterval(firePass, INTERVAL_MS);
timer.unref?.();
// keep the event loop alive forever
setInterval(() => {}, 60_000);
