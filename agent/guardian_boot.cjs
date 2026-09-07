#!/usr/bin/env node
/** guardian_boot.cjs — pre-dev hook: dispatch guardian self-heal async, never block dev start. */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
try {
  const agentDir = path.join(__dirname);
  if (fs.existsSync(path.join(agentDir, 'guardian.cjs'))) {
    const out = fs.openSync(path.join(agentDir, 'guardian.log'), 'a');
    const child = spawn(process.execPath, ['guardian.cjs', '--boot'], { cwd: agentDir, detached: true, stdio: ['ignore', out, out] });
    child.unref();
    console.log('[guardian] boot self-heal dispatched (pid ' + child.pid + ')');
  }
  // Task 116 — THE PERSISTENT ALWAYS-UP LOOP (durable form): the ad-hoc shell
  // loop from 115 was reaped with the session; from now on every dev boot
  // spawns the wrapper (singleton via .guardian-loop.pid), so the always-up
  // layer survives without any session of ours.
  if (fs.existsSync(path.join(agentDir, 'guardian-loop.cjs'))) {
    const out = fs.openSync(path.join(agentDir, 'guardian.log'), 'a');
    const child = spawn(process.execPath, ['guardian-loop.cjs'], { cwd: agentDir, detached: true, stdio: ['ignore', out, out] });
    child.unref();
    console.log('[guardian] persistent loop dispatched (pid ' + child.pid + ')');
  }
} catch (_) { /* never block dev start */ }
