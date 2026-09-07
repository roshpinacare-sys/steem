import "../_flush.mjs";
/**
 * tests/migrate/migrate.test.ts — Migration bundle (J2) tests
 *
 * All tests run offline against InMemoryPool (zero deps, no real DB).
 * node tests/migrate/migrate.test.ts
 */
import { test, assert, eq } from "../_harness.mjs";
import { migrate, MIGRATIONS } from "../../scripts/migrate.mjs";

// ─── InMemoryPool stub ────────────────────────────────────────────────────────

/** Minimal pg-compatible pool: records executed SQL, simulates query. */
function makePool(opts: { failTable?: string } = {}) {
  const executed: string[] = [];
  const pool = {
    executed,
    async query(sql: string) {
      if (opts.failTable && sql.includes(opts.failTable)) {
        throw new Error(`simulated DB error for ${opts.failTable}`);
      }
      executed.push(sql.trim().split("\n")[0].trim()); // record first line
      return { rows: [] };
    },
  };
  return pool;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("MIGRATIONS array is non-empty", () => {
  assert(Array.isArray(MIGRATIONS), "MIGRATIONS should be an array");
  assert(MIGRATIONS.length > 0, "MIGRATIONS should have entries");
});

test("each migration has name, description, sql", () => {
  for (const m of MIGRATIONS) {
    assert(typeof m.name === "string" && m.name.length > 0, `name missing: ${JSON.stringify(m)}`);
    assert(typeof m.description === "string" && m.description.length > 0, `description missing in ${m.name}`);
    assert(typeof m.sql === "string" && m.sql.includes("CREATE TABLE IF NOT EXISTS"), `sql invalid in ${m.name}`);
  }
});

test("all migration names are unique", () => {
  const names = MIGRATIONS.map((m) => m.name);
  const unique = new Set(names);
  eq(unique.size, names.length, "duplicate migration names found");
});

test("migrate: all tables applied in order", async () => {
  const pool = makePool();
  const result = await migrate(pool, { silent: true });

  eq(result.failed.length, 0, "no failures expected");
  eq(result.applied.length, MIGRATIONS.length, "all tables applied");
  eq(result.skipped.length, 0, "no skipped");
  eq(result.dryRun, false, "not dry-run");
});

test("migrate: idempotent — second run also succeeds", async () => {
  const pool = makePool();
  const r1 = await migrate(pool, { silent: true });
  const r2 = await migrate(pool, { silent: true });
  eq(r1.failed.length, 0, "first run clean");
  eq(r2.failed.length, 0, "second run clean (idempotent)");
  eq(r2.applied.length, MIGRATIONS.length, "second run applies all");
});

test("migrate: dry-run lists all tables without querying pool", async () => {
  const pool = makePool();
  const result = await migrate(pool, { dryRun: true, silent: true });

  eq(result.dryRun, true, "dryRun flag reflected");
  eq(result.applied.length, MIGRATIONS.length, "all listed in dry-run");
  eq(pool.executed.length, 0, "no queries executed in dry-run");
  eq(result.failed.length, 0, "no failures in dry-run");
});

test("migrate: partial failure — other tables still run", async () => {
  // Simulate pg-catalog failing; others succeed
  const pool = makePool({ failTable: "marketplace_opportunities" });
  const result = await migrate(pool, { silent: true });

  eq(result.failed.length, 1, "exactly one failure");
  eq(result.failed[0].name, "marketplace_opportunities", "correct failure name");
  assert(result.applied.length >= MIGRATIONS.length - 1, "remaining applied");
});

test("migrate: failed entry has non-empty error string", async () => {
  const pool = makePool({ failTable: "escrow_agreements" });
  const result = await migrate(pool, { silent: true });

  const f = result.failed.find((x) => x.name === "escrow_agreements");
  assert(f !== undefined, "escrow_agreements in failed");
  assert(typeof f!.error === "string" && f!.error.length > 0, "error message present");
});

test("migrate: silent option suppresses output (no throw)", async () => {
  const pool = makePool();
  // Should not throw even when silent
  const result = await migrate(pool, { silent: true });
  eq(result.failed.length, 0, "silent run succeeds");
});

test("each migration SQL contains correct table name", () => {
  for (const m of MIGRATIONS) {
    const normalized = m.sql.replace(/\s+/g, " ").toLowerCase();
    assert(
      normalized.includes(m.name.toLowerCase()),
      `SQL for ${m.name} doesn't mention table name`
    );
  }
});

test("audit_records table is first migration (dependency anchor)", () => {
  eq(MIGRATIONS[0].name, "audit_records", "audit_records should be first");
});

test("all known pg-store tables are present", () => {
  const names = new Set(MIGRATIONS.map((m) => m.name));
  const required = [
    "audit_records",
    "idempotency_records",
    "tenant_plans",
    "api_keys",
    "agent_identities",
    "ledger_accounts",
    "ledger_transactions",
    "journal_entries",
    "tfa_ledger_accounts",
    "tfa_ledger_transactions",
    "tfa_journal_entries",
    "escrow_agreements",
    "settlement_agreements",
    "consumed_threshold_approvals",
    "marketplace_opportunities",
    "track_record_cache",
    "personality_profiles",
    "success_paths",
    "collaboration_matches_cache",
    "kg_signals",
    "execution_workflows",
    "execution_log_entries",
    "webhook_registrations",
    "introduction_requests",
    "transparency_leaves",
    "transparency_roots",
    "read_model_actors",
    "read_model_executions",
    "read_model_approvals",
    "read_model_escrows",
    "read_model_passports",
    "read_model_disputes",
    "mcp_nonce_registry",
  ];
  for (const r of required) {
    assert(names.has(r), `missing required table: ${r}`);
  }
  eq(required.length, 33, "expected 33 required tables");
});

test("migrate: result object shape is correct", async () => {
  const pool = makePool();
  const result = await migrate(pool, { silent: true });
  assert("applied" in result, "has applied");
  assert("skipped" in result, "has skipped");
  assert("failed" in result, "has failed");
  assert("dryRun" in result, "has dryRun");
  assert(Array.isArray(result.applied), "applied is array");
  assert(Array.isArray(result.skipped), "skipped is array");
  assert(Array.isArray(result.failed), "failed is array");
});
