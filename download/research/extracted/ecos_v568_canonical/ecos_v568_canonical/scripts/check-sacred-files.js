#!/usr/bin/env node
/**
 * check-sacred-files.js — Sacred Files Governance Protocol [V103-P3]
 *
 * Verifies that lib/fiatLedger.js and lib/auditLog.js have not been
 * modified from their protocol-invariant MD5 hashes.
 *
 * Runs automatically before every `npm test` via the "pretest" hook.
 * Also runs in CI via .github/workflows/sacred-guard.yml.
 *
 * Usage:
 *   node scripts/check-sacred-files.js
 *
 * Exit codes:
 *   0 — all sacred files intact
 *   1 — one or more sacred files violated (prints offending file + actual hash)
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.resolve(__dirname, '..');

const SACRED = [
  {
    file:     'lib/fiatLedger.js',
    expected: '563e9b1f9e67091a5b6527c0a92568e5',
    heldSince: 'V38',
  },
  {
    file:     'lib/auditLog.js',
    expected: 'e5a5c2c27801d2d03991bc8e5a1df8cb',
    heldSince: 'V38',
  },
];

let allOk = true;

console.log('[sacred-guard] Checking sacred files…');

for (const { file, expected, heldSince } of SACRED) {
  const absPath = path.join(ROOT, file);

  if (!fs.existsSync(absPath)) {
    console.error(`[sacred-guard] ✗ MISSING: ${file}`);
    allOk = false;
    continue;
  }

  const actual = crypto
    .createHash('md5')
    .update(fs.readFileSync(absPath))
    .digest('hex');

  if (actual === expected) {
    console.log(`[sacred-guard] ✓ ${file} (MD5: ${actual}, held since ${heldSince})`);
  } else {
    console.error(`[sacred-guard] ✗ VIOLATION: ${file}`);
    console.error(`               expected : ${expected}`);
    console.error(`               actual   : ${actual}`);
    console.error(`               This file is a Sacred File (held since ${heldSince}).`);
    console.error(`               Revert it from the last canonical ZIP before proceeding.`);
    allOk = false;
  }
}

if (allOk) {
  console.log('[sacred-guard] All sacred files intact. ✓');
  process.exit(0);
} else {
  console.error('\n[sacred-guard] SACRED FILE VIOLATION — aborting.\n');
  process.exit(1);
}
