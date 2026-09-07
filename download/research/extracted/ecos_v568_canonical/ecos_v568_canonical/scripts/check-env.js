#!/usr/bin/env node
'use strict';

/**
 * ECOS — Environment Configuration Audit (V127 OPS-01)
 * 
 * Run: node scripts/check-env.js [--strict]
 * 
 * Checks all required + optional env vars and reports status.
 * --strict: exit(1) if any REQUIRED var is missing.
 */

const VARS = [
  // ── Core ─────────────────────────────────────────────────────────────────
  { name: 'NODE_ENV',         tier: 'required', default: 'development', desc: 'Environment (development|production|test)' },
  { name: 'PORT',             tier: 'required', default: '3000',        desc: 'HTTP server port' },
  { name: 'JWT_SECRET',       tier: 'required', default: null,          desc: 'JWT signing secret — MUST be set in production (≥32 chars)' },

  // ── Database ──────────────────────────────────────────────────────────────
  { name: 'DATABASE_URL',     tier: 'required', default: null,          desc: 'Postgres connection string — required in production' },
  { name: 'PGHOST',           tier: 'optional', default: null,          desc: 'Postgres host (alternative to DATABASE_URL)' },
  { name: 'PGPORT',           tier: 'optional', default: '5432',        desc: 'Postgres port' },
  { name: 'PGDATABASE',       tier: 'optional', default: null,          desc: 'Postgres database name' },
  { name: 'PGUSER',           tier: 'optional', default: null,          desc: 'Postgres user' },
  { name: 'PGPASSWORD',       tier: 'optional', default: null,          desc: 'Postgres password' },

  // ── Stripe ────────────────────────────────────────────────────────────────
  { name: 'STRIPE_API_KEY',           tier: 'required-for-payments', default: null, desc: 'Stripe secret key (sk_live_... or sk_test_...) — required for real payments (STR-01)' },
  { name: 'STRIPE_WEBHOOK_SECRET',    tier: 'required-for-payments', default: null, desc: 'Stripe webhook signing secret (whsec_...) — required for deposit webhooks' },
  { name: 'STRIPE_PUBLISHABLE_KEY',   tier: 'optional',              default: null, desc: 'Stripe publishable key for frontend (pk_live_... or pk_test_...)' },

  // ── Email Delivery (V145-SMTP-01) ────────────────────────────────────────
  { name: 'RESEND_API_KEY', tier: 'required-for-email', default: null, desc: 'Resend API key (re_...) — required for real email verification + password reset. See https://resend.com' },
  { name: 'SMTP_DSN',       tier: 'required-for-email', default: null, desc: 'SMTP connection string (smtps://user:pass@host:465) — alternative to RESEND_API_KEY' },
  { name: 'EMAIL_FROM',     tier: 'optional',           default: 'ECOS <noreply@ecos.ai>', desc: 'Sender address shown in verification + reset emails' },
  { name: 'ECOS_BASE_URL',  tier: 'optional',           default: 'http://localhost:3000',  desc: 'Public base URL — used in email token links (no trailing slash)' },

  // ── Confidence / AI ───────────────────────────────────────────────────────
  { name: 'REFINEMENT_THRESHOLD',   tier: 'optional', default: '0.65',  desc: 'Confidence threshold for self-refinement (0.0–1.0)' },
  { name: 'BLOCK_THRESHOLD',        tier: 'optional', default: '0.30',  desc: 'Confidence threshold for BLOCK verdict' },
  { name: 'HITL_THRESHOLD',         tier: 'optional', default: '0.50',  desc: 'Confidence threshold for HITL queue' },
  { name: 'AUTO_FLOW_THRESHOLD',    tier: 'optional', default: '0.70',  desc: 'Confidence threshold for auto-flow' },
  { name: 'ANTHROPIC_API_KEY',      tier: 'optional', default: null,    desc: 'Anthropic API key for live inference' },

  // ── MMR / Chain ───────────────────────────────────────────────────────────
  { name: 'CHECKPOINT_INTERVAL',    tier: 'optional', default: '50',    desc: 'MMR leaves between auto-checkpoints' },
  { name: 'COMPACTION_THRESHOLD',   tier: 'optional', default: '500',   desc: 'MMR leaf count to trigger compaction' },
  { name: 'AUTO_BACKFILL',          tier: 'optional', default: 'false', desc: 'Run audit backfill on startup (true/false)' },

  // ── Rate limiting ─────────────────────────────────────────────────────────
  { name: 'RATE_LIMIT_CHAT',        tier: 'optional', default: '60',    desc: 'Max chat requests per minute per IP' },
  { name: 'RATE_LIMIT_TASK',        tier: 'optional', default: '60',    desc: 'Max task requests per minute per IP' },
  { name: 'RATE_LIMIT_DEPOSIT',     tier: 'optional', default: '10',    desc: 'Max deposit requests per minute per IP' },

  // ── Validator ─────────────────────────────────────────────────────────────
  { name: 'NEXT_PUBLIC_VALIDATOR_TOKEN', tier: 'optional', default: null, desc: 'Validator auth token for frontend (move to login flow in V128)' },
  { name: 'VALIDATOR_MIN_REPUTATION',    tier: 'optional', default: '0.5', desc: 'Minimum validator reputation to receive tasks' },

  // ── Compliance / Notifications ────────────────────────────────────────────
  { name: 'WEBHOOK_URL',            tier: 'optional', default: null,    desc: 'External webhook URL for BLOCK/HITL notifications' },
  { name: 'ECOS_CRYPTO_ENABLED',    tier: 'optional', default: 'false', desc: 'Enable CryptoRail (experimental)' },

  // ── Deployment ────────────────────────────────────────────────────────────
  { name: 'AGENT_ID_FILE',          tier: 'optional', default: '.ecos_agent_id', desc: 'Path to persistent agent identity file' },
  { name: 'LOG_LEVEL',              tier: 'optional', default: 'info',   desc: 'Logger level (trace|debug|info|warn|error)' },
  { name: 'CORS_ORIGINS',           tier: 'optional', default: '*',      desc: 'Comma-separated allowed CORS origins' },
];

const isStrict = process.argv.includes('--strict');
const isProduction = (process.env.NODE_ENV || 'development') === 'production';

let missingRequired = 0;
let missingPayments = 0;
let warnings = 0;

const cols = { name: 40, tier: 22, value: 30 };

function pad(str, len) {
  return String(str || '').slice(0, len).padEnd(len);
}

console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
console.log('║            ECOS V127 — Environment Configuration Audit                    ║');
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

console.log(`  Environment : ${process.env.NODE_ENV || 'development (default)'}`);
console.log(`  Mode        : ${isStrict ? 'STRICT (exit 1 on missing required)' : 'CHECK ONLY'}\n`);
console.log(`  ${'VAR'.padEnd(cols.name)} ${'TIER'.padEnd(cols.tier)} ${'STATUS'}`);
console.log(`  ${'-'.repeat(cols.name)} ${'-'.repeat(cols.tier)} ${'-'.repeat(30)}`);

for (const v of VARS) {
  const val = process.env[v.name];
  let status;

  if (val !== undefined && val !== '') {
    const display = v.name.toLowerCase().includes('secret') || v.name.toLowerCase().includes('key') || v.name.toLowerCase().includes('password')
      ? '***'
      : val.length > 28 ? val.slice(0, 25) + '...' : val;
    status = `✅  ${display}`;
  } else if (v.default !== null) {
    status = `⚙️   (default: ${v.default})`;
  } else {
    if (v.tier === 'required') {
      status = '❌  MISSING — REQUIRED';
      missingRequired++;
      if (isProduction) warnings++;
    } else if (v.tier === 'required-for-payments') {
      status = '⚠️   missing — payments disabled';
      missingPayments++;
    } else {
      status = '○   not set (optional)';
    }
  }

  // Validate format if set
  if (val) {
    if (v.name === 'STRIPE_API_KEY' && !val.startsWith('sk_')) {
      status = `⚠️   SET but invalid format (expected sk_live_ or sk_test_)`;
      warnings++;
    }
    if (v.name === 'STRIPE_WEBHOOK_SECRET' && !val.startsWith('whsec_')) {
      status = `⚠️   SET but invalid format (expected whsec_)`;
      warnings++;
    }
    if (v.name === 'JWT_SECRET' && val === 'ecos-dev-secret') {
      if (isProduction) {
        status = `❌  BLOCKED — default dev secret in production`;
        warnings++;
      } else {
        status = `⚠️   dev-secret — do NOT use in production`;
      }
    }
    if (v.name === 'JWT_SECRET' && val.length < 32 && isProduction) {
      status = `⚠️   SET but too short (< 32 chars) for production`;
      warnings++;
    }
  }

  console.log(`  ${pad(v.name, cols.name)} ${pad(v.tier, cols.tier)} ${status}`);
}

// Summary
console.log('\n' + '─'.repeat(80));
console.log(`\n  SUMMARY:`);
console.log(`    Required missing : ${missingRequired}`);
console.log(`    Payment vars missing : ${missingPayments} ${missingPayments > 0 ? '(Stripe/payments will run in mock mode)' : ''}`);
console.log(`    Warnings         : ${warnings}`);

if (missingPayments > 0) {
  console.log('\n  📋 STRIPE LIVE (STR-01):');
  console.log('     Set STRIPE_API_KEY=sk_live_... and STRIPE_WEBHOOK_SECRET=whsec_...');
  console.log('     to enable real payment processing.');
  console.log('     See: https://dashboard.stripe.com/apikeys');
}

if (missingRequired > 0) {
  console.log(`\n  ❌ ${missingRequired} required var(s) missing.`);
  if (isStrict) {
    console.log('  Exiting with code 1 (--strict mode).\n');
    process.exit(1);
  }
}

if (warnings === 0 && missingRequired === 0) {
  console.log('\n  ✅ All required vars present. Ready to start.\n');
} else {
  console.log('\n  Run with --strict to fail CI on missing required vars.\n');
}
