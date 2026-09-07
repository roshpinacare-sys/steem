#!/usr/bin/env node
/**
 * scripts/consolidation-sweep.js — ECOS V337 — Automated Consolidation Sweep
 *
 * Usage:
 *   node scripts/consolidation-sweep.js [--dryRun] [--sliceSize=N] [--libDir=path] [--baseDir=path]
 *
 * What it does:
 *   1. Builds the capability graph from lib/
 *   2. Runs executeConsolidationSlice335 (N deepest retirable families)
 *   3. Calls writeConsolidationStubs336 (dryRun:true by default — safe for CI)
 *   4. Runs buildFamilyHealthReport337 to show health BEFORE and summary AFTER
 *   5. Prints a full sweep manifest and exits with code 0 (success) or 1 (write errors)
 *
 * Exit codes:
 *   0 — sweep complete (dry-run or all stubs written successfully)
 *   1 — one or more stub write errors
 *   2 — internal error
 *
 * No npm dependencies required (R3).
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

try {
  const Mesh = require(path.join(ROOT, 'lib/moduleMesh287.js'));
  const L    = require(path.join(ROOT, 'lib/capabilityLineage334.js'));
  const C    = require(path.join(ROOT, 'lib/consolidationEngine335.js'));
  const W    = require(path.join(ROOT, 'lib/stubWriter336.js'));
  const H    = require(path.join(ROOT, 'lib/familyHealthReport337.js'));

  // Parse CLI args
  const args = process.argv.slice(2);
  let dryRun    = true;   // safe default
  let sliceSize = 5;
  let libDir    = path.join(ROOT, 'lib');
  let baseDir   = ROOT;

  for (const arg of args) {
    if (arg === '--no-dry-run' || arg === '--write') dryRun = false;
    if (arg === '--dryRun' || arg === '--dry-run') dryRun = true;
    const s = arg.match(/^--sliceSize=(\d+)$/);
    const d = arg.match(/^--libDir=(.+)$/);
    const b = arg.match(/^--baseDir=(.+)$/);
    if (s) sliceSize = parseInt(s[1], 10);
    if (d) libDir = path.resolve(d[1]);
    if (b) baseDir = path.resolve(b[1]);
  }

  console.log('ECOS V337 Consolidation Sweep');
  console.log('  libDir:     ' + libDir);
  console.log('  baseDir:    ' + baseDir);
  console.log('  sliceSize:  ' + sliceSize);
  console.log('  dryRun:     ' + dryRun);
  console.log('');

  const graph = new Mesh.CapabilityGraph287().build([libDir]);

  // Health BEFORE
  const healthBefore = H.buildFamilyHealthReport337(graph, L.detectInterfaceDrift334, L.planConsolidation334, {
    topN: sliceSize, sortBy: 'score',
  });
  console.log('Health (worst ' + sliceSize + ' families before sweep):');
  for (const f of healthBefore.families.slice(0, sliceSize)) {
    console.log('  [' + f.tier.toUpperCase().padEnd(8) + '] ' + f.base.padEnd(40) + ' score=' + f.score + ' depth=' + f.depth);
  }
  console.log('');

  // Consolidation slice
  const slice = C.executeConsolidationSlice335(graph, L.planConsolidation334, { sliceSize });
  console.log('Consolidation slice: ' + slice.totalStubs + ' stubs across ' + slice.families.length + ' families');

  // Write stubs
  const writeResult = W.writeConsolidationStubs336(slice, { dryRun, baseDir });
  console.log('');
  console.log('Stub writer result:');
  console.log('  ' + writeResult.summary);
  if (writeResult.files && writeResult.files.length) {
    for (const f of writeResult.files.slice(0, 20)) {
      const tag = f.action === 'write' ? (dryRun ? 'WOULD-WRITE' : 'WRITTEN') : f.action.toUpperCase();
      console.log('  [' + tag.padEnd(11) + '] ' + (f.retire || f.path));
    }
    if (writeResult.files.length > 20) {
      console.log('  ... and ' + (writeResult.files.length - 20) + ' more');
    }
  }
  console.log('');

  // Summary
  const hasErrors = (writeResult.files || []).some(f => f.action === 'error');
  console.log('Sweep complete — ' + (hasErrors ? 'ERRORS DETECTED' : 'OK'));
  console.log('  Written:  ' + writeResult.written);
  console.log('  Skipped:  ' + writeResult.skipped);
  console.log('  Errors:   ' + (hasErrors ? 'YES' : 'none'));
  console.log('');

  process.exit(hasErrors ? 1 : 0);
} catch (e) {
  console.error('  [ERROR] consolidation-sweep.js: ' + e.message);
  process.exit(2);
}
