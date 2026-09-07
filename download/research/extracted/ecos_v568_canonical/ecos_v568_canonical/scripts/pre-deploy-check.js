#!/usr/bin/env node
/**
 * scripts/pre-deploy-check.js — ECOS V148
 * ─────────────────────────────────────────────────────────────────────────────
 * [V148-PDC-01] Pre-deployment readiness gate.
 *
 * Runs a comprehensive set of checks BEFORE deploy to Render/Fly.
 * Catches misconfigured env vars, missing secrets, and dependency issues
 * before they cause production failures.
 *
 * Usage:
 *   node scripts/pre-deploy-check.js           # reads .env if present
 *   node scripts/pre-deploy-check.js --strict  # exit(1) on any WARN
 *   node --env-file=.env scripts/pre-deploy-check.js
 *
 * Exit codes:
 *   0 — all checks passed (or only WARNs in non-strict mode)
 *   1 — one or more ERRORs found
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const STRICT = process.argv.includes('--strict');
const ROOT   = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────
// Try loading .env if present and no DATABASE_URL in env yet
// ─────────────────────────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !process.env[key]) process.env[key] = val;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Check runner
// ─────────────────────────────────────────────────────────────────────────────
const results = [];
let errors = 0;
let warns  = 0;

function check(level, name, passed, detail = '') {
  const icon = passed ? '✅' : level === 'ERROR' ? '❌' : '⚠️ ';
  results.push({ level: passed ? 'OK' : level, name, detail, icon });
  if (!passed) {
    if (level === 'ERROR') errors++;
    else warns++;
  }
}

function checkEnvRequired(key, desc) {
  const val = process.env[key];
  if (!val) {
    check('ERROR', `ENV:${key}`, false, `${desc} — set ${key} in .env / deployment settings`);
  } else if (val.includes('placeholder') || val === 'changeme' || val === 'your_secret_here') {
    check('ERROR', `ENV:${key}`, false, `Value looks like a placeholder: "${val.slice(0, 30)}..."`);
  } else {
    check('OK', `ENV:${key}`, true, `Set (${val.length} chars)`);
  }
}

function checkEnvOptional(key, desc, validator = null) {
  const val = process.env[key];
  if (!val) {
    check('WARN', `ENV:${key}`, false, `Optional but recommended — ${desc}`);
  } else if (validator && !validator(val)) {
    check('WARN', `ENV:${key}`, false, `Value set but failed format check`);
  } else {
    check('OK', `ENV:${key}`, true, `Set`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Critical secrets
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Section 1: Critical Secrets ─────────────────────────────');
checkEnvRequired('DATABASE_URL', 'Postgres connection string');
checkEnvRequired('JWT_SECRET',   'JWT signing secret (min 32 chars recommended)');

const jwtSecret = process.env.JWT_SECRET || '';
if (jwtSecret && jwtSecret.length < 32) {
  check('WARN', 'ENV:JWT_SECRET:length', false, `Length ${jwtSecret.length} < 32 chars — use a longer secret in production`);
}

const knownBadSecrets = ['ecos-dev-secret', 'changeme', 'secret', 'password', 'letmein'];
if (knownBadSecrets.includes(jwtSecret.toLowerCase())) {
  check('ERROR', 'ENV:JWT_SECRET:weak', false, `JWT_SECRET is a known-weak default value`);
} else if (jwtSecret.length >= 32) {
  check('OK', 'ENV:JWT_SECRET:strength', true, 'Strength OK');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Stripe
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Section 2: Stripe ────────────────────────────────────────');
const stripeKey = process.env.STRIPE_API_KEY || '';
if (!stripeKey) {
  check('WARN', 'ENV:STRIPE_API_KEY', false, 'Stripe disabled — payouts will use mock mode');
} else if (!stripeKey.startsWith('sk_')) {
  check('ERROR', 'ENV:STRIPE_API_KEY', false, 'Must start with sk_ (use sk_live_ or sk_test_)');
} else {
  const isLive = stripeKey.startsWith('sk_live_');
  const isTst  = stripeKey.startsWith('sk_test_');
  check('OK', 'ENV:STRIPE_API_KEY', true, isLive ? 'Live key ✓' : isTst ? 'Test key (set sk_live_ for production)' : 'Key set');
}
checkEnvOptional('STRIPE_WEBHOOK_SECRET', 'Required for webhook signature verification',
  v => v.startsWith('whsec_'));
checkEnvOptional('STRIPE_PLATFORM_ACCOUNT', 'Stripe platform account ID for Connect splits');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Email / SMTP
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Section 3: Email ─────────────────────────────────────────');
const hasResend = !!process.env.RESEND_API_KEY;
const hasSmtp   = !!process.env.SMTP_DSN;

if (!hasResend && !hasSmtp) {
  check('WARN', 'EMAIL:provider', false, 'No RESEND_API_KEY or SMTP_DSN — emails will log to stdout only');
} else {
  if (hasResend) check('OK', 'EMAIL:resend', true, 'Resend API key configured');
  if (hasSmtp)   check('OK', 'EMAIL:smtp',   true, 'SMTP DSN configured');
}
checkEnvOptional('EMAIL_FROM', 'From address for transactional emails');
checkEnvRequired('ECOS_BASE_URL', 'Public base URL (used in email links)');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Node.js version
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Section 4: Runtime ───────────────────────────────────────');
const nodeVer = process.versions.node.split('.').map(Number);
const nodeOk  = nodeVer[0] >= 18 && (nodeVer[0] > 18 || nodeVer[1] >= 17);
check(nodeOk ? 'OK' : 'ERROR', 'RUNTIME:node', nodeOk,
  `Node ${process.versions.node} (≥18.17 required)`);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Sacred file integrity
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Section 5: Sacred File Integrity ─────────────────────────');
const { createHash } = require('node:crypto');
const SACRED = {
  'lib/fiatLedger.js': '563e9b1f9e67091a5b6527c0a92568e5',
  'lib/auditLog.js':   'e5a5c2c27801d2d03991bc8e5a1df8cb',
};
for (const [rel, expected] of Object.entries(SACRED)) {
  const fullPath = path.join(ROOT, rel);
  if (!fs.existsSync(fullPath)) {
    check('ERROR', `SACRED:${rel}`, false, 'File missing!');
    continue;
  }
  const actual = createHash('md5').update(fs.readFileSync(fullPath)).digest('hex');
  check(actual === expected ? 'OK' : 'ERROR', `SACRED:${rel}`,
    actual === expected, actual === expected ? 'MD5 matches' : `MD5 mismatch: got ${actual}, want ${expected}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Package sanity
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Section 6: Package ────────────────────────────────────────');
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('OK', 'PKG:version', true, `version = ${pkg.version}`);
  check('OK', 'PKG:name',    true, `name = ${pkg.name}`);
  const nodeModules = path.join(ROOT, 'node_modules');
  check(fs.existsSync(nodeModules) ? 'OK' : 'ERROR', 'PKG:node_modules',
    fs.existsSync(nodeModules), fs.existsSync(nodeModules) ? 'node_modules exists' : 'Run npm install first');
} catch (err) {
  check('ERROR', 'PKG:parse', false, `Cannot parse package.json: ${err.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Key files exist
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Section 7: Key Files ──────────────────────────────────────');
const KEY_FILES = [
  'ecos-api-server.js',
  'lib/fiatLedger.js',
  'lib/auditLog.js',
  'lib/authService.js',
  'lib/smtpEmailProvider.js',
  'lib/stripeConnectService.js',
  'lib/payoutNotifier.js',
  'db/schema.sql',
  'scripts/smoke-live.js',
];
for (const f of KEY_FILES) {
  const ok = fs.existsSync(path.join(ROOT, f));
  check(ok ? 'OK' : 'WARN', `FILE:${f}`, ok, ok ? 'Present' : 'Missing');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Deploy config
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Section 8: Deploy Config ─────────────────────────────────');
const hasRender = fs.existsSync(path.join(ROOT, 'render.yaml'));
const hasFly    = fs.existsSync(path.join(ROOT, 'fly.toml'));
const hasDocker = fs.existsSync(path.join(ROOT, 'Dockerfile'));
check('OK', 'DEPLOY:render',     hasRender, hasRender ? 'render.yaml present' : 'Missing');
check('OK', 'DEPLOY:fly',        hasFly,    hasFly    ? 'fly.toml present'    : 'Missing');
check('OK', 'DEPLOY:dockerfile', hasDocker, hasDocker ? 'Dockerfile present'  : 'Missing');

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════');
console.log('  ECOS V148 Pre-Deploy Check Results');
console.log('══════════════════════════════════════════════════════════════\n');

let longestName = 0;
for (const r of results) longestName = Math.max(longestName, r.name.length);

for (const r of results) {
  if (r.level === 'OK') continue; // Only show non-OK in compact summary
}

// Show all non-OK
const issues = results.filter(r => r.level !== 'OK');
if (issues.length === 0) {
  console.log('  ✅  All checks passed. Ready to deploy!');
} else {
  console.log('  Issues found:\n');
  for (const r of issues) {
    console.log(`  ${r.icon}  [${r.level}] ${r.name}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
}

const ok = results.filter(r => r.level === 'OK').length;
console.log(`\n  Summary: ${ok} passed · ${warns} warnings · ${errors} errors`);
console.log(`  Checks run: ${results.length}`);


// ════════════════════════════════════════════════════════════════════════════
// [V154-PDC] V154 Additional Checks
// ════════════════════════════════════════════════════════════════════════════

// Check 9: V154 lib files exist
section('V154 New Files');

[
  'lib/adminStatsService.js',
  'lib/withdrawalHistoryService.js',
  'db/migration_phase29.sql',
].forEach(f => {
  const fPath = path.join(ROOT, f);
  if (fs.existsSync(fPath)) {
    pass(`${f} — present`);
  } else {
    error(`${f} — MISSING (V154 file not found)`);
  }
});

// Check 10: ecos-api-server.js contains V154 routes
section('V154 API Routes');

const serverSrc = (() => {
  try { return fs.readFileSync(path.join(ROOT, 'ecos-api-server.js'), 'utf8'); }
  catch { return ''; }
})();

const v154Routes = [
  '/api/v1/admin/stats',
  '/api/v1/admin/events',
  '/api/v1/dashboard/summary',
  '/api/v1/withdrawals/history',
];
for (const route of v154Routes) {
  if (serverSrc.includes(route)) {
    pass(`Route ${route} registered`);
  } else {
    warn(`Route ${route} not found in ecos-api-server.js — check V154 merge`);
  }
}

// Check 11: Security headers in server
section('V154 Security');
if (serverSrc.includes('X-Content-Type-Options') || serverSrc.includes('nosniff')) {
  pass('Security headers middleware present');
} else {
  warn('X-Content-Type-Options not found — security headers may be missing');
}

// Check 12: package.json version is 154.x
section('V154 Version');
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (pkg.version && pkg.version.startsWith('154.')) {
    pass(`package.json version ${pkg.version}`);
  } else {
    warn(`package.json version is ${pkg.version} (expected 154.x)`);
  }
} catch (e) {
  error(`Could not read package.json: ${e.message}`);
}


if (errors > 0) {
  console.log('\n  ❌  Deploy blocked — fix errors above before deploying.\n');
  process.exit(1);
} else if (warns > 0 && STRICT) {
  console.log('\n  ⚠️   Deploy blocked (--strict mode) — fix warnings above.\n');
  process.exit(1);
} else if (errors === 0) {
  console.log('\n  ✅  Ready to deploy!\n');
  if (warns > 0) console.log('  (Warnings are non-blocking without --strict)\n');
}
