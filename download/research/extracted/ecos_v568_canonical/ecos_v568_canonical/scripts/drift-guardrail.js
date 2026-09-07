#!/usr/bin/env node
/**
 * scripts/drift-guardrail.js — ECOS V336 — Standalone CI drift guardrail
 *
 * Usage:
 *   node scripts/drift-guardrail.js [--warnThreshold=N] [--libDir=path]
 *
 * Exit codes:
 *   0 — guardrail PASSED (drifted families <= warnThreshold)
 *   1 — guardrail FAILED (drifted families > warnThreshold) — blocks merge
 *   2 — internal error (should never happen in production)
 *
 * No arguments required for standard CI use — defaults connect directly to lib/.
 * Requires no npm dependencies (R6).
 */
'use strict';

const path = require('path');
const ROOT = path.resolve(__dirname, '..');

try {
  const Mesh = require(path.join(ROOT, 'lib/moduleMesh287.js'));
  const L    = require(path.join(ROOT, 'lib/capabilityLineage334.js'));
  const W    = require(path.join(ROOT, 'lib/stubWriter336.js'));
  const C    = require(path.join(ROOT, 'lib/consolidationEngine335.js'));

  // Parse CLI args (no external dep)
  const args = process.argv.slice(2);
  let warnThreshold = 0;
  let libDir = path.join(ROOT, 'lib');

  for (const arg of args) {
    const m = arg.match(/^--warnThreshold=(\d+)$/);
    const d = arg.match(/^--libDir=(.+)$/);
    if (m) warnThreshold = parseInt(m[1], 10);
    if (d) libDir = path.resolve(d[1]);
  }

  console.log('ECOS V336 Drift Guardrail');
  console.log('  lib dir:        ' + libDir);
  console.log('  warnThreshold:  ' + warnThreshold);
  console.log('');

  const graph  = new Mesh.CapabilityGraph287().build([libDir]);
  const result = C.buildDriftGuardrail335(graph, L.detectInterfaceDrift334, { warnThreshold });

  console.log('  Status:     ' + (result.ok ? 'PASSED' : 'FAILED'));
  console.log('  Drifted:    ' + result.drifted + ' families');
  console.log('  Threshold:  ' + result.warnThreshold);
  console.log('  Exit code:  ' + result.exitCode);
  console.log('');
  if (result.families && result.families.length) {
    console.log('  Drifted families:');
    for (const f of result.families) {
      console.log('    ' + f.base + ' (' + f.severity + '): dropped ' + f.droppedSymbols.join(', '));
    }
    console.log('');
  }
  console.log('  ' + result.summary);
  console.log('');

  process.exit(result.exitCode);
} catch (e) {
  console.error('  [ERROR] drift-guardrail.js: ' + e.message);
  process.exit(2);
}
