#!/usr/bin/env node
/**
 * scripts/migrate.mjs — TFA Migration Bundle (J2)
 *
 * Runs all CREATE TABLE IF NOT EXISTS DDL statements in dependency order.
 * Idempotent: safe to run multiple times on the same database.
 * Importable: exports { migrate } for use by tests / startup code.
 * Runnable:   node scripts/migrate.mjs [--db-url <url>] [--dry-run] [--silent]
 *
 * USAGE
 * -----
 *   node scripts/migrate.mjs                     # dry-run (no DB_URL)
 *   DB_URL=postgresql://... node scripts/migrate.mjs
 *   node scripts/migrate.mjs --dry-run           # print SQL only
 *   node scripts/migrate.mjs --silent            # suppress output
 *
 * EXIT CODES
 *   0 — all migrations applied (or dry-run completed)
 *   1 — one or more migrations failed
 */

// ─── Migration definitions (dependency order) ─────────────────────────────────

export const MIGRATIONS = [
  {
    name: "audit_records",
    description: "Audit chain store (pg-audit-sync, pg-audit)",
    sql: `
      CREATE TABLE IF NOT EXISTS audit_records (
        id          TEXT,
        tenant_id   TEXT,
        action_id   TEXT,
        action_type TEXT,
        source      TEXT,
        outcome     TEXT,
        reason      TEXT,
        occurred_at TEXT,
        prev_hash   TEXT,
        hash        TEXT,
        signature   TEXT
      )
    `.trim(),
  },
  {
    name: "idempotency_records",
    description: "HTTP idempotency store",
    sql: `
      CREATE TABLE IF NOT EXISTS idempotency_records (
        tenant_id  TEXT,
        key        TEXT,
        path_key   TEXT,
        state      TEXT,
        status     TEXT,
        body       TEXT,
        created_at TEXT
      )
    `.trim(),
  },
  {
    name: "tenant_plans",
    description: "Tenant plan registry (pg-plan-sync)",
    sql: `
      CREATE TABLE IF NOT EXISTS tenant_plans (
        tenant_id   TEXT,
        plan        TEXT,
        updated_at  TEXT
      )
    `.trim(),
  },
  {
    name: "api_keys",
    description: "API key store",
    sql: `
      CREATE TABLE IF NOT EXISTS api_keys (
        key_id        TEXT,
        tenant_id     TEXT,
        name          TEXT,
        hashed_secret TEXT,
        scopes        TEXT,
        created_at    TEXT,
        revoked_at    TEXT,
        expires_at    TEXT
      )
    `.trim(),
  },
  {
    name: "agent_identities",
    description: "Agent identity + delegation chain store",
    sql: `
      CREATE TABLE IF NOT EXISTS agent_identities (
        id         TEXT,
        tenant_id  TEXT,
        type       TEXT,
        public_key TEXT,
        parent_id  TEXT,
        created_at TEXT,
        metadata   TEXT
      )
    `.trim(),
  },
  {
    name: "ledger_accounts",
    description: "Ledger accounts (pg-ledger)",
    sql: `
      CREATE TABLE IF NOT EXISTS ledger_accounts (
        id           TEXT,
        tenant_id    TEXT,
        owner_id     TEXT,
        type         TEXT,
        name         TEXT,
        balance_text TEXT,
        created_at   TEXT
      )
    `.trim(),
  },
  {
    name: "ledger_transactions",
    description: "Ledger transactions (pg-ledger)",
    sql: `
      CREATE TABLE IF NOT EXISTS ledger_transactions (
        id                TEXT,
        tenant_id         TEXT,
        kind              TEXT,
        debit_account_id  TEXT,
        credit_account_id TEXT,
        amount_text       TEXT,
        memo              TEXT,
        initiated_by      TEXT,
        created_at        TEXT
      )
    `.trim(),
  },
  {
    name: "journal_entries",
    description: "Ledger journal entries (pg-ledger)",
    sql: `
      CREATE TABLE IF NOT EXISTS journal_entries (
        id             TEXT,
        tenant_id      TEXT,
        transaction_id TEXT,
        account_id     TEXT,
        type           TEXT,
        amount_text    TEXT,
        memo           TEXT,
        created_at     TEXT
      )
    `.trim(),
  },
  {
    name: "tfa_ledger_accounts",
    description: "Ledger accounts (drizzle-payment-provider)",
    sql: `
      CREATE TABLE IF NOT EXISTS tfa_ledger_accounts (
        id           TEXT NOT NULL,
        tenant_id    TEXT NOT NULL,
        owner_id     TEXT NOT NULL,
        type         TEXT NOT NULL,
        name         TEXT NOT NULL,
        balance_text TEXT NOT NULL,
        created_at   TEXT NOT NULL
      )
    `.trim(),
  },
  {
    name: "tfa_ledger_transactions",
    description: "Ledger transactions (drizzle-payment-provider)",
    sql: `
      CREATE TABLE IF NOT EXISTS tfa_ledger_transactions (
        id                TEXT NOT NULL,
        tenant_id         TEXT NOT NULL,
        kind              TEXT NOT NULL,
        debit_account_id  TEXT NOT NULL,
        credit_account_id TEXT NOT NULL,
        amount_text       TEXT NOT NULL,
        memo              TEXT NOT NULL,
        initiated_by      TEXT NOT NULL,
        created_at        TEXT NOT NULL
      )
    `.trim(),
  },
  {
    name: "tfa_journal_entries",
    description: "Ledger journal entries (drizzle-payment-provider)",
    sql: `
      CREATE TABLE IF NOT EXISTS tfa_journal_entries (
        id             TEXT NOT NULL,
        tenant_id      TEXT NOT NULL,
        transaction_id TEXT NOT NULL,
        account_id     TEXT NOT NULL,
        type           TEXT NOT NULL,
        amount_text    TEXT NOT NULL,
        memo           TEXT NOT NULL,
        created_at     TEXT NOT NULL
      )
    `.trim(),
  },
  {
    name: "escrow_agreements",
    description: "Escrow agreement store (pg-escrow-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS escrow_agreements (
        id                TEXT,
        tenant_id         TEXT,
        opportunity_id    TEXT,
        payer_account_id  TEXT,
        worker_account_id TEXT,
        escrow_account_id TEXT,
        amount            TEXT,
        state             TEXT,
        created_at        TEXT,
        fund_audit_id     TEXT,
        settle_audit_id   TEXT,
        funded_by         TEXT,
        disputed_by       TEXT,
        dispute_reason    TEXT,
        fee_basis_points  TEXT,
        fee_amount        TEXT,
        fee_account_id    TEXT,
        fee_audit_id      TEXT
      )
    `.trim(),
  },
  {
    name: "settlement_agreements",
    description: "Settlement agreement store (pg-settlement-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS settlement_agreements (
        id                TEXT,
        tenant_id         TEXT,
        opportunity_id    TEXT,
        payer_account_id  TEXT,
        worker_account_id TEXT,
        escrow_account_id TEXT,
        total_amount      TEXT,
        released_amount   TEXT,
        state             TEXT,
        created_at        TEXT,
        settled_by        TEXT,
        release_audit_ids TEXT,
        reversal_audit_id TEXT,
        fund_audit_id     TEXT,
        disputed_by       TEXT,
        dispute_reason    TEXT,
        threshold_amount  TEXT
      )
    `.trim(),
  },
  {
    name: "consumed_threshold_approvals",
    description: "Threshold approval replay protection (pg-threshold-approval-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS consumed_threshold_approvals (
        id          TEXT,
        consumed_at TEXT
      )
    `.trim(),
  },
  {
    name: "marketplace_opportunities",
    description: "Marketplace opportunity catalog (pg-catalog)",
    sql: `
      CREATE TABLE IF NOT EXISTS marketplace_opportunities (
        id                 TEXT,
        tenant_id          TEXT,
        title              TEXT,
        description        TEXT,
        required_strengths TEXT,
        budget_mc          TEXT
      )
    `.trim(),
  },
  {
    name: "track_record_cache",
    description: "Track record cache (pg-track-record-cache)",
    sql: `
      CREATE TABLE IF NOT EXISTS track_record_cache (
        tenant_id         TEXT,
        identity_id       TEXT,
        settled_as_worker INTEGER,
        settled_as_funder INTEGER,
        refunded          INTEGER,
        denied            INTEGER,
        settled_volume    TEXT,
        score             INTEGER,
        explanation       TEXT,
        computed_at       TEXT
      )
    `.trim(),
  },
  {
    name: "personality_profiles",
    description: "Personality profile store (pg-personality-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS personality_profiles (
        user_id     TEXT,
        tenant_id   TEXT,
        traits      TEXT,
        evidence    TEXT,
        confidence  TEXT,
        analyzed_at TEXT
      )
    `.trim(),
  },
  {
    name: "success_paths",
    description: "Success path store (pg-success-path-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS success_paths (
        id                    TEXT,
        user_id               TEXT,
        tenant_id             TEXT,
        target_opportunity_id TEXT,
        current_fit_score     TEXT,
        projected_fit_score   TEXT,
        steps                 TEXT,
        total_hours           TEXT,
        created_at            TEXT
      )
    `.trim(),
  },
  {
    name: "collaboration_matches_cache",
    description: "Collaboration match cache (pg-collaboration-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS collaboration_matches_cache (
        user_id    TEXT,
        tenant_id  TEXT,
        matches    TEXT,
        updated_at TEXT
      )
    `.trim(),
  },
  {
    name: "kg_signals",
    description: "Knowledge graph signals (pg-kg-source)",
    sql: `
      CREATE TABLE IF NOT EXISTS kg_signals (
        user_id   TEXT,
        tenant_id TEXT,
        node_type TEXT,
        category  TEXT,
        weight    TEXT
      )
    `.trim(),
  },
  {
    name: "execution_workflows",
    description: "Execution workflow store (pg-execution-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS execution_workflows (
        id                   TEXT,
        tenant_id            TEXT,
        action_id            TEXT,
        intent_id            TEXT,
        status               TEXT,
        created_at           TEXT,
        updated_at           TEXT,
        lease_expires_at     TEXT,
        claimed_by           TEXT,
        execution_ref        TEXT,
        approval_id          TEXT,
        evidence_refs        TEXT,
        retry_of_workflow_id TEXT
      )
    `.trim(),
  },
  {
    name: "execution_log_entries",
    description: "Execution log store (pg-execution-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS execution_log_entries (
        workflow_id  TEXT,
        tenant_id    TEXT,
        seq          INTEGER,
        timestamp    TEXT,
        from_status  TEXT,
        to_status    TEXT,
        actor        TEXT,
        reason       TEXT,
        hash         TEXT,
        prev_hash    TEXT
      )
    `.trim(),
  },
  {
    name: "webhook_registrations",
    description: "Webhook registration store (pg-webhook-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS webhook_registrations (
        id         TEXT,
        tenant_id  TEXT,
        url        TEXT,
        events     TEXT,
        secret     TEXT,
        created_at TEXT,
        active     TEXT
      )
    `.trim(),
  },
  {
    name: "introduction_requests",
    description: "Cross-tenant introduction store (pg-introduction-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS introduction_requests (
        id                       TEXT,
        source_tenant_id         TEXT,
        target_tenant_id         TEXT,
        proof_target_kind        TEXT,
        proof_target_identity_id TEXT,
        signature                TEXT,
        created_at               TEXT
      )
    `.trim(),
  },
  {
    name: "transparency_leaves",
    description: "Transparency log leaf entries (pg-transparency-log-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS transparency_leaves (
        tenant_id  TEXT,
        leaf_hash  TEXT,
        leaf_index INTEGER,
        receipt_id TEXT,
        created_at TEXT
      )
    `.trim(),
  },
  {
    name: "transparency_roots",
    description: "Transparency log root anchors (pg-transparency-log-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS transparency_roots (
        tenant_id   TEXT,
        root_hash   TEXT,
        leaf_count  INTEGER,
        anchored_at TEXT
      )
    `.trim(),
  },
  {
    name: "read_model_actors",
    description: "Indexer read-model actors (pg-read-model-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS read_model_actors (
        id                           TEXT,
        tenant_id                    TEXT,
        actor_id                     TEXT,
        actor_type                   TEXT,
        first_seen_at                TEXT,
        last_active_at               TEXT,
        total_actions                INTEGER,
        total_value_moved_microunits TEXT
      )
    `.trim(),
  },
  {
    name: "read_model_executions",
    description: "Indexer read-model executions (pg-read-model-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS read_model_executions (
        id             TEXT,
        tenant_id      TEXT,
        workflow_id    TEXT,
        action_id      TEXT,
        intent_id      TEXT,
        status         TEXT,
        created_at     TEXT,
        updated_at     TEXT,
        actor          TEXT,
        evidence_count INTEGER,
        approval_id    TEXT,
        passport_id    TEXT,
        escrow_id      TEXT
      )
    `.trim(),
  },
  {
    name: "read_model_approvals",
    description: "Indexer read-model approvals (pg-read-model-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS read_model_approvals (
        id             TEXT,
        tenant_id      TEXT,
        action_id      TEXT,
        risk_class     TEXT,
        approval_class TEXT,
        decision_trace TEXT,
        outcome        TEXT,
        timestamp      TEXT,
        execution_id   TEXT
      )
    `.trim(),
  },
  {
    name: "read_model_escrows",
    description: "Indexer read-model escrows (pg-read-model-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS read_model_escrows (
        id                         TEXT,
        tenant_id                  TEXT,
        agreement_id               TEXT,
        opportunity_id             TEXT,
        payer_account_id           TEXT,
        worker_account_id          TEXT,
        total_amount_microunits    TEXT,
        released_amount_microunits TEXT,
        state                      TEXT,
        created_at                 TEXT,
        updated_at                 TEXT,
        execution_id               TEXT,
        release_passport_id        TEXT
      )
    `.trim(),
  },
  {
    name: "read_model_passports",
    description: "Indexer read-model passports (pg-read-model-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS read_model_passports (
        id                  TEXT,
        tenant_id           TEXT,
        passport_id         TEXT,
        audit_id            TEXT,
        issued_at           TEXT,
        outcome             TEXT,
        ledger_effect_id    TEXT,
        attestation_present INTEGER,
        hash                TEXT,
        execution_id        TEXT,
        approval_id         TEXT
      )
    `.trim(),
  },
  {
    name: "read_model_disputes",
    description: "Indexer read-model disputes (pg-read-model-store)",
    sql: `
      CREATE TABLE IF NOT EXISTS read_model_disputes (
        id          TEXT,
        tenant_id   TEXT,
        escrow_id   TEXT,
        raised_by   TEXT,
        reason      TEXT,
        state       TEXT,
        created_at  TEXT,
        resolved_at TEXT
      )
    `.trim(),
  },
  {
    name: "mcp_nonce_registry",
    description: "MCP nonce registry (nonce-registry)",
    sql: `
      CREATE TABLE IF NOT EXISTS mcp_nonce_registry (
        nonce      TEXT,
        expires_at TEXT
      )
    `.trim(),
  },
];

// ─── Core migrate function (importable) ───────────────────────────────────────

/**
 * Run all migrations against the given pool.
 * @param {object} pool  pg-compatible pool with `.query(sql, params?)` method
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun]  If true, return plan without executing
 * @param {boolean} [opts.silent]  If true, suppress console output
 * @returns {{ applied: string[], skipped: string[], failed: {name:string,error:string}[], dryRun: boolean }}
 */
export async function migrate(pool, opts = {}) {
  const { dryRun = false, silent = false } = opts;
  const log = silent ? () => {} : (...args) => console.log(...args);

  const applied = [];
  const skipped = [];
  const failed = [];

  log(`TFA Migration Bundle — ${MIGRATIONS.length} tables — ${dryRun ? "DRY RUN" : "LIVE"}`);
  log("─".repeat(60));

  for (const m of MIGRATIONS) {
    const label = `  [${m.name}]`;
    if (dryRun) {
      log(`${label} (dry-run) ${m.description}`);
      applied.push(m.name);
      continue;
    }
    try {
      await pool.query(m.sql);
      log(`${label} ✓ ${m.description}`);
      applied.push(m.name);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      log(`${label} ✗ ${msg}`);
      failed.push({ name: m.name, error: msg });
    }
  }

  log("─".repeat(60));
  const status = dryRun
    ? `dry-run: ${applied.length} tables listed`
    : `applied: ${applied.length} / failed: ${failed.length}`;
  log(`Result  : ${status}`);

  return { applied, skipped, failed, dryRun };
}

// ─── CLI entry point ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun =
    args.includes("--dry-run") || !process.env.DB_URL;
  const silent = args.includes("--silent");

  const dbUrlIdx = args.indexOf("--db-url");
  const dbUrl =
    dbUrlIdx !== -1
      ? args[dbUrlIdx + 1]
      : process.env.DB_URL;

  let pool;
  if (!dryRun) {
    // Dynamic import of 'pg' — only needed in live mode.
    // In tests / dry-run, pg is never imported (zero-dependency).
    let pg;
    try {
      pg = await import("pg");
    } catch {
      console.error(
        "ERROR: 'pg' package not found. Install it or use --dry-run / set no DB_URL."
      );
      process.exit(1);
    }
    const Pool = pg.default?.Pool ?? pg.Pool;
    pool = new Pool({ connectionString: dbUrl });
  } else {
    // Dry-run: fake pool that will never be called
    pool = {
      query: async () => ({ rows: [] }),
    };
  }

  const result = await migrate(pool, { dryRun, silent });

  if (!dryRun && pool.end) {
    await pool.end();
  }

  if (result.failed.length > 0) {
    process.exit(1);
  }
}

// Run when called directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("migrate.mjs") ||
    process.argv[1].endsWith("migrate"));

if (isMain) {
  main().catch((err) => {
    console.error("migrate.mjs fatal:", err);
    process.exit(1);
  });
}
