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
  // Task 116 — THE PERSISTENT ALWAYS-UP LOOP (dual-slot): the ad-hoc shell loop
  // from 115 was reaped with the session, and the single 116-a wrapper died in
  // the same OOM sweep as next dev. Two slots, phase-offset 60s, own pid-files,
  // TTL-lock dedupes their passes — an OOM sweep must kill BOTH to silence us.
  for (const slot of ['1', '2']) {
    if (fs.existsSync(path.join(agentDir, 'guardian-loop.cjs'))) {
      const out = fs.openSync(path.join(agentDir, 'guardian.log'), 'a');
      const child = spawn(process.execPath, ['guardian-loop.cjs', '--slot', slot], { cwd: agentDir, detached: true, stdio: ['ignore', out, out] });
      child.unref();
      console.log('[guardian] persistent loop slot ' + slot + ' dispatched (pid ' + child.pid + ')');
    }
  }
} catch (_) { /* never block dev start */ }
