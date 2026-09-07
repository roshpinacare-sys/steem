#!/usr/bin/env node
/**
 * ECOS — Issue Validator JWT Token — V64
 * ─────────────────────────────────────────────────────────────────────────────
 * יוצר JWT חתום ל-validatorId נתון.
 * השתמש בו לפיתוח, בדיקות, ו-onboarding ידני של ולידטורים.
 *
 * שימוש:
 *   node scripts/issue-validator-token.js --id validator::alice
 *   node scripts/issue-validator-token.js --id validator::alice --ttl 3600
 *   VALIDATOR_JWT_SECRET=mysecret node scripts/issue-validator-token.js --id validator::bob
 *
 * .env נטען ידנית (אין dotenv dependency — הפרויקט משתמש ב-Node.js built-ins בלבד).
 * אלטרנטיבה: node --env-file=.env scripts/issue-validator-token.js --id validator::alice
 *
 * הדפסה:
 *   Bearer <token>   — העתק כ-header: Authorization: Bearer <token>
 *
 * [FIX-V64-DOTENV] הוחלף require('dotenv') בטעינת .env ידנית (pure Node.js).
 *   dotenv לא מותקן בפרויקט (dependency חסרה ב-package.json).
 *   כתוצאה מ-V63: `node scripts/issue-validator-token.js` קרסה עם MODULE_NOT_FOUND.
 */

'use strict';

const fs   = require('node:fs');
const path = require('node:path');

// ── Load .env manually (no dotenv dependency) ─────────────────────────────────
// Mirrors what `node --env-file=.env` does: parse KEY=VALUE lines, skip comments.
// Already-set env vars are NOT overwritten (consistent with dotenv behaviour).
(function loadDotEnv() {
  const envPath = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return; // .env is optional
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;          // skip comments + blank
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) continue;                              // skip malformed lines
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim()
      .replace(/^['"]|['"]$/g, '');                       // strip optional quotes
    if (key && !(key in process.env)) {                   // don't overwrite existing
      process.env[key] = val;
    }
  }
})();

const { issueValidatorToken } = require('../middleware/validatorAuth');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let validatorId = null;
let ttlSeconds  = 86400; // 24h default

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--id'  && args[i + 1]) { validatorId = args[++i]; }
  if (args[i] === '--ttl' && args[i + 1]) { ttlSeconds  = parseInt(args[++i], 10); }
}

if (!validatorId) {
  console.error('Usage: node scripts/issue-validator-token.js --id <validatorId> [--ttl <seconds>]');
  console.error('Example: node scripts/issue-validator-token.js --id validator::alice --ttl 86400');
  process.exit(1);
}

if (!process.env.VALIDATOR_JWT_SECRET) {
  console.error('[ERROR] VALIDATOR_JWT_SECRET is not set.');
  console.error('Options:');
  console.error('  1. Add to engine/.env:  VALIDATOR_JWT_SECRET=<secret>');
  console.error('  2. Pass inline:         VALIDATOR_JWT_SECRET=mysecret node scripts/issue-validator-token.js --id validator::alice');
  console.error('  3. Use --env-file:      node --env-file=.env scripts/issue-validator-token.js --id validator::alice');
  console.error('');
  console.error('Generate a secret:');
  console.error("  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"");
  process.exit(1);
}

// ── Issue token ───────────────────────────────────────────────────────────────
try {
  const token  = issueValidatorToken(validatorId, ttlSeconds);
  const expiry = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║         ECOS Validator JWT Token                     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Validator : ${validatorId}`);
  console.log(`  Expires   : ${expiry}`);
  console.log(`  TTL       : ${ttlSeconds}s`);
  console.log('');
  console.log('  Authorization Header:');
  console.log(`  Bearer ${token}`);
  console.log('');
  console.log('  Full header:');
  console.log(`  Authorization: Bearer ${token}`);
  console.log('');
} catch (err) {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
}
