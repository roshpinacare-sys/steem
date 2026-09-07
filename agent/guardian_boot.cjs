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
} catch (_) { /* never block dev start */ }
