#!/usr/bin/env node
/**
 * ECOS Migration Safety Check — V109
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies that the required DB schema objects are present before operations
 * that depend on them. Prevents silent failures when a migration has not been
 * applied (e.g. a fresh DB deployment or schema drift after a restore).
 *
 * Usage:
 *   node scripts/check-migration.js [--phase <N>] [--quiet]
 *
 * Exit codes:
 *   0 — all required tables + columns present
 *   1 — one or more required objects missing (prints details)
 *   2 — DATABASE_URL not set (DB check skipped; exits 0 unless --strict)
 *
 * Environment:
 *   DATABASE_URL — Postgres connection string (optional)
 *   CHECK_STRICT  — if set, exit 2 becomes exit 1 (require DB availability)
 */

'use strict';

const process = require('node:process');

// ── Required objects per migration phase ─────────────────────────────────────

const PHASE_REQUIREMENTS = {
  1: {
    tables: ['audit_log', 'approvals', 'idempotency_keys'],
    columns: [],
  },
  2: {
    tables: ['agent_identity'],
    columns: [],
  },
  3: {
    tables: ['knowledge_patches'],
    columns: [],
  },
  4: {
    tables: ['memory_entries', 'execution_runs', 'execution_journal_entries'],
    columns: [
      ['execution_runs', 'run_id'],
      ['memory_entries', 'vector_json'],
    ],
  },
  5: {
    tables: ['snapshots', 'replay_checkpoints', 'embedding_migration_log'],
    columns: [
      ['knowledge_patches', 'embedding_type'],
      ['snapshots', 'integrity_hash'],
      ['replay_checkpoints', 'replay_proof'],
    ],
  },
  6: {
    tables: ['agent_bus_messages'],
    columns: [
      ['agent_bus_messages', 'channel'],
    ],
  },
  7: {
    tables: ['memory_audit_trail', 'stripe_deposit_events'],
    columns: [
      ['memory_audit_trail', 'content_hash'],
      ['replay_checkpoints', 'source_version'],
      ['stripe_deposit_events', 'stripe_event_id'],
    ],
  },
};

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const phaseArg = (() => {
  const i = args.indexOf('--phase');
  return i !== -1 ? parseInt(args[i + 1], 10) : null;
})();
const quiet  = args.includes('--quiet');
const strict = args.includes('--strict') || !!process.env.CHECK_STRICT;

function log(msg) { if (!quiet) console.log(msg); }
function err(msg) { console.error(msg); }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    log('[check-migration] DATABASE_URL not set — skipping DB migration check');
    if (strict) {
      err('[check-migration] ERROR: --strict requires DATABASE_URL');
      process.exit(1);
    }
    process.exit(0);
  }

  let pool;
  try {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: dbUrl, max: 1, connectionTimeoutMillis: 5000 });
  } catch {
    log('[check-migration] pg module not available — skipping DB migration check');
    process.exit(0);
  }

  const phases = phaseArg
    ? [phaseArg]
    : Object.keys(PHASE_REQUIREMENTS).map(Number);

  const missing   = [];
  const missingCols = [];

  try {
    for (const phase of phases) {
      const req = PHASE_REQUIREMENTS[phase];
      if (!req) { err(`[check-migration] Unknown phase: ${phase}`); continue; }

      // Check tables
      for (const tbl of req.tables) {
        const { rows } = await pool.query(
          `SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1`,
          [tbl]
        );
        if (rows.length === 0) missing.push({ phase, table: tbl });
      }

      // Check columns
      for (const [tbl, col] of (req.columns || [])) {
        const { rows } = await pool.query(
          `SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
          [tbl, col]
        );
        if (rows.length === 0) missingCols.push({ phase, table: tbl, column: col });
      }
    }
  } finally {
    await pool.end().catch(() => {});
  }

  if (missing.length === 0 && missingCols.length === 0) {
    log('[check-migration] ✓ All required migration objects present');
    process.exit(0);
  }

  err('[check-migration] ✗ Missing migration objects:');
  for (const m of missing) {
    err(`  Phase ${m.phase}: TABLE "${m.table}" not found — run migration_phase${m.phase}.sql`);
  }
  for (const m of missingCols) {
    err(`  Phase ${m.phase}: COLUMN "${m.table}.${m.column}" not found — run migration_phase${m.phase}.sql`);
  }
  process.exit(1);
}

main().catch(e => {
  err('[check-migration] Unexpected error: ' + e.message);
  process.exit(1);
});
