#!/usr/bin/env node
'use strict';
/**
 * scripts/audit-tests.js — ECOS V502 — Honest Test Audit Generator
 *
 * Runs EVERY tests/*.test.js under plain node and buckets each suite truthfully:
 *   - pass        : ran under node and exited 0
 *   - cannotRun   : could not execute here (needs vitest / ESM / a missing dev dep)
 *   - realFail    : ran under node and FAILED (a genuine red flag)
 *
 * Writes TEST_AUDIT.json (machine) and prints a summary. No sampling. This exists because
 * prior "verification" only spot-checked a handful of suites and over-claimed "all green";
 * this tells the whole truth, every time. Run: node scripts/audit-tests.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');

const CANNOT_RUN_RX = /Cannot find package '[^']+'|from ['\"]vitest['\"]|(describe|beforeEach|afterEach|it|test|expect) is not defined|Unexpected token|Cannot find module '[A-Za-z@][^']*'/i;

function runSuite(file) {
  try {
    // Preload the vitest globals shim so suites using describe/it/expect WITHOUT importing
    // vitest (globals style) can run too. ESM/import suites resolve node_modules/vitest normally.
    const _globals = require('path').join(ROOT, 'node_modules/vitest/globals.cjs');
    const _pre = require('fs').existsSync(_globals) ? `--require ${JSON.stringify(_globals)} ` : '';
    execSync(`NODE_ENV=test node ${_pre}${JSON.stringify(file)}`, { cwd: ROOT, stdio: 'pipe', timeout: 60000 });
    return { status: 'pass', detail: '' };
  } catch (e) {
    const out = ((e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : ''));
    if (CANNOT_RUN_RX.test(out)) {
      const m = out.match(/Cannot find package '[^']+'|ERR_MODULE_NOT_FOUND|\w+ is not defined|Unexpected token[^\n]*/i);
      return { status: 'cannotRun', detail: (m ? m[0] : 'needs vitest/ESM').slice(0, 80) };
    }
    const m = out.match(/AssertionError[^\n]*|Error:[^\n]*|✗[^\n]*|not ok[^\n]*/i);
    return { status: 'realFail', detail: (m ? m[0] : 'exit ' + (e.status || '?')).slice(0, 120) };
  }
}

function main() {
  const files = fs.readdirSync(TESTS_DIR).filter(f => f.endsWith('.test.js')).sort();
  const result = { generatedAt: new Date().toISOString(), total: files.length, pass: [], cannotRun: [], realFail: [] };
  for (const f of files) {
    const r = runSuite(path.join(TESTS_DIR, f));
    if (r.status === 'pass') result.pass.push(f);
    else if (r.status === 'cannotRun') result.cannotRun.push({ suite: f, reason: r.detail });
    else result.realFail.push({ suite: f, reason: r.detail });
  }
  result.counts = { pass: result.pass.length, cannotRun: result.cannotRun.length, realFail: result.realFail.length };
  fs.writeFileSync(path.join(ROOT, 'TEST_AUDIT.json'), JSON.stringify(result, null, 2));
  console.log('=== ECOS Test Audit (no sampling) ===');
  console.log('total suites :', result.total);
  console.log('pass         :', result.counts.pass, '(ran under node, exit 0)');
  console.log('cannotRun    :', result.counts.cannotRun, '(needs vitest/ESM — NOT verifiable here)');
  console.log('realFail     :', result.counts.realFail, '(ran + FAILED)');
  if (result.realFail.length) { console.log('--- real failures ---'); result.realFail.forEach(x => console.log('  ' + x.suite + ' :: ' + x.reason)); }
  console.log('written: TEST_AUDIT.json');
  process.exit(0);
}

main();
