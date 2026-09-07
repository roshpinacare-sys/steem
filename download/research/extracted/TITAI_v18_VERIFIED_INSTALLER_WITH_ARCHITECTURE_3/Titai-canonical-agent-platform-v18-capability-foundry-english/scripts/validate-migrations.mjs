import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const migrationsDir = resolve(root, "drizzle");
const files = readdirSync(migrationsDir)
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort();

if (files.length === 0) {
  throw new Error("No SQL migrations were found.");
}

const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON");

for (const file of files) {
  const sql = readFileSync(resolve(migrationsDir, file), "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const [index, statement] of statements.entries()) {
    try {
      db.exec(`${statement};`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${file} statement ${index + 1} failed: ${message}`);
    }
  }
}

const required = {
  tenants: ["id", "name"],
  workspaces: ["id", "tenant_id", "name"],
  workspace_memberships: ["user_id", "tenant_id", "workspace_id", "role"],
  agents: ["owner_id", "tenant_id", "workspace_id", "visibility"],
  runs: ["idempotency_key", "tenant_id", "workspace_id", "visibility", "max_output_tokens", "max_context_tokens", "deadline_at", "runner_mode", "routing_decision", "memory_snapshot"],
  run_steps: ["run_id", "tenant_id", "workspace_id"],
  approvals: ["expires_at", "revision", "tenant_id", "workspace_id", "continuation_key", "durable_job_id", "continuation_checkpoint"],
  policies: ["owner_id", "tenant_id", "workspace_id", "visibility", "is_builtin"],
  templates: ["owner_id", "tenant_id", "workspace_id", "visibility"],
  provider_configs: ["api_key_version"],
  audit_redactions: ["audit_id", "reason", "redacted_at"],
  durable_jobs: ["status", "checkpoint", "lease_owner", "lease_expires_at", "version"],
  durable_receipts: ["key", "job_id", "input_hash", "status"],
  durable_outbox: ["idempotency_key", "status", "lease_owner", "published_at"],
  artifacts: ["run_id", "tenant_id", "workspace_id", "visibility", "idempotency_key", "size_bytes"],
  memories: ["owner_id", "tenant_id", "workspace_id", "visibility", "kind", "content_hash", "provenance", "status", "corrects_id", "expires_at"],
  model_profiles: ["owner_id", "tenant_id", "workspace_id", "visibility", "provider", "model", "planning_quality", "privacy_score", "evaluation_confidence"],
  verification_attestations: ["run_id", "tenant_id", "workspace_id", "builder_identity", "verifier_identity", "release_candidate_hash"],
  capability_publishers: ["id", "key_id", "public_key_pem", "tenant_id", "workspace_id"],
  capability_packages: ["package_id", "version", "manifest_hash", "package_hash", "state", "tenant_id", "workspace_id", "imported_at"],
  capability_evidence: ["capability_package_id", "kind", "status", "hash"],
  capability_installations: ["capability_package_id", "tenant_id", "workspace_id", "state", "installed_at"],
  capability_candidates: ["tenant_id", "workspace_id", "candidate_hash", "candidate", "state"],
  compiled_missions: ["tenant_id", "workspace_id", "mission_hash", "plan", "status"],
  improvement_candidates: ["tenant_id", "workspace_id", "builder_id", "stage"],
  mission_team_handoffs: ["team_id", "mission_hash", "tenant_id", "workspace_id", "signature", "sequence"],
};

const missingColumns = {};
for (const [table, columns] of Object.entries(required)) {
  const actual = new Set(
    db.prepare(`PRAGMA table_info(\`${table}\`)`).all().map((row) => row.name),
  );
  const missing = columns.filter((column) => !actual.has(column));
  if (missing.length > 0) missingColumns[table] = missing;
}

const indexes = new Set(
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((row) => row.name),
);
const requiredIndexes = [
  "runs_user_idempotency_uq",
  "audit_redactions_audit_uq",
  "durable_jobs_status_available_idx",
  "durable_outbox_idempotency_key_unique",
  "memories_owner_status_idx",
  "model_profiles_owner_enabled_idx",
  "artifacts_run_idempotency_uq",
  "approvals_continuation_uq",
];
const missingIndexes = requiredIndexes.filter((name) => !indexes.has(name));
const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all();

const result = {
  ok:
    Object.keys(missingColumns).length === 0 &&
    missingIndexes.length === 0 &&
    foreignKeyViolations.length === 0,
  migrationFiles: files,
  missingColumns,
  missingIndexes,
  foreignKeyViolations,
};

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(
  `Migration validation passed: ${files.length} files, ${Object.keys(required).length} required tables checked.`,
);
