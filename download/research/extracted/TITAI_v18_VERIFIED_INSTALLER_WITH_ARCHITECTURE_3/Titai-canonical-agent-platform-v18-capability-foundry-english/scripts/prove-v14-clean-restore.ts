import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApplicationBackup, restoreApplicationBackup } from "../src/lib/backup/application-backup";
import { canonicalJson } from "../src/lib/utils";

const root = mkdtempSync(join(tmpdir(), "titai-v14-restore-"));
const sourcePath = join(root, "source.sqlite");
const backupPath = join(root, "pilot.titai-backup");
const restoredPath = join(root, "restored.sqlite");
const passphrase = "v14-clean-restore-passphrase";
const env = {
  ...process.env,
  DATABASE_PATH: sourcePath,
  TITAI_SQLITE_DRIVER: "node:sqlite",
  TITAI_ALLOW_DESTRUCTIVE_SEED: "1",
  TITAI_DEMO_PASSWORD: "test-Pilot-Restore-Password-2026!",
  AUTH_SECRET: "test-v14-restore-auth-secret-32-bytes",
  ENCRYPTION_KEY: "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25nISE=",
  NODE_NO_WARNINGS: "1",
};
function runCommand(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0) throw new Error(`command_failed:${command}:${args.join(" ")}:${result.stderr || result.stdout}`);
}
function sha256(value: Buffer | string): string { return createHash("sha256").update(value).digest("hex"); }
function counts(db: DatabaseSync): Record<string, number> {
  const tables = ["users", "tenants", "workspaces", "workspace_memberships", "runs", "run_steps", "approvals", "artifacts", "audit_log", "durable_jobs", "durable_receipts", "verification_attestations"];
  return Object.fromEntries(tables.map((table) => [table, Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number | bigint }).n)]));
}
function verifyAudit(db: DatabaseSync): { ok: boolean; length: number; finalHash: string } {
  const rows = db.prepare("SELECT * FROM audit_log ORDER BY id ASC").all() as Array<Record<string, unknown>>;
  let previous = "GENESIS";
  for (const row of rows) {
    if (row.prev_hash !== previous) return { ok: false, length: rows.length, finalHash: previous };
    const content = {
      ts: Number(row.ts), actorType: row.actor_type, actorId: row.actor_id ?? null,
      action: row.action, subjectType: row.subject_type ?? null, subjectId: row.subject_id ?? null,
      payload: row.payload ? JSON.parse(String(row.payload)) : null,
    };
    const expected = sha256(`${previous}\n${canonicalJson(content)}`);
    if (expected !== row.hash) return { ok: false, length: rows.length, finalHash: previous };
    previous = String(row.hash);
  }
  return { ok: true, length: rows.length, finalHash: previous };
}

try {
  runCommand(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/migrate.ts"]);
  runCommand(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig", "tsconfig.scripts.json", "scripts/seed.ts"]);
  const source = new DatabaseSync(sourcePath);
  source.exec("PRAGMA foreign_keys=ON");
  const completedRun = source.prepare("SELECT id, tenant_id, workspace_id FROM runs WHERE status='completed' LIMIT 1").get() as { id: string; tenant_id: string; workspace_id: string };
  if (!completedRun) throw new Error("seed_completed_run_missing");
  const artifact = source.prepare("SELECT id, content FROM artifacts WHERE run_id=? LIMIT 1").get(completedRun.id) as { id: string; content: string };
  if (!artifact) throw new Error("seed_artifact_missing");
  const now = Date.parse("2026-07-11T11:00:00.000Z");
  source.prepare(`INSERT INTO durable_jobs
    (id, tenant_id, workspace_id, workflow_name, payload, status, checkpoint, result, error, attempt, max_attempts,
     available_at, lease_owner, lease_token, lease_acquired_at, lease_expires_at, lease_heartbeat_at, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, NULL, 1, 3, ?, NULL, 1, NULL, NULL, NULL, 2, ?, ?)`)
    .run("v14-restored-job", completedRun.tenant_id, completedRun.workspace_id, "pilot-artifact", "{}",
      JSON.stringify({ nextStepIndex: 1, outputs: { artifactId: artifact.id }, completedStepIds: ["artifact"], revision: 1 }),
      JSON.stringify({ artifactId: artifact.id }), now, now, now);
  source.prepare(`INSERT INTO durable_receipts
    (key, job_id, tenant_id, workspace_id, step_id, operation, input_hash, status, output, error, started_at, completed_at, worker_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, NULL, ?, ?, ?)`)
    .run("v14-receipt", "v14-restored-job", completedRun.tenant_id, completedRun.workspace_id, "artifact", "artifact.write",
      sha256("artifact-input"), JSON.stringify({ artifactId: artifact.id }), now, now, "worker-v14");
  source.prepare(`INSERT INTO verification_attestations
    (id, run_id, tenant_id, workspace_id, requirement_revision, task_revision, source_tree_hash, test_command,
     test_output_hash, artifact_hash, release_candidate_hash, builder_identity, verifier_identity, status, limitations, evidence_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', '[]', ?, ?)`)
    .run("v14-attestation", completedRun.id, completedRun.tenant_id, completedRun.workspace_id, "pilot-r1", "task-r1", "a".repeat(64),
      "npm run test:v14", "b".repeat(64), sha256(artifact.content), "c".repeat(64), "builder-v14", "verifier-v14",
      "d".repeat(64), now);
  source.exec("PRAGMA wal_checkpoint(FULL)");
  const sourceCounts = counts(source);
  const sourceAudit = verifyAudit(source);
  const sourceArtifactHash = sha256(artifact.content);
  source.close();
  if (!sourceAudit.ok) throw new Error("source_audit_invalid");

  const migrationFiles = (await import("node:fs")).readdirSync(resolve("drizzle")).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const backup = createApplicationBackup({ databasePath: sourcePath, outputPath: backupPath, passphrase, appVersion: "v14", migrationFiles });
  let wrongPasswordRejected = false;
  try { restoreApplicationBackup({ backupPath, targetPath: join(root, "wrong.sqlite"), passphrase: "wrong-password-value" }); }
  catch { wrongPasswordRejected = true; }
  if (!wrongPasswordRejected) throw new Error("wrong_password_not_rejected");
  const restore = restoreApplicationBackup({ backupPath, targetPath: restoredPath, passphrase });

  const restored = new DatabaseSync(restoredPath, { readOnly: true });
  const restoredCounts = counts(restored);
  const restoredAudit = verifyAudit(restored);
  const restoredArtifact = restored.prepare("SELECT content FROM artifacts WHERE id=?").get(artifact.id) as { content: string };
  const pendingApproval = restored.prepare("SELECT status, revision, tenant_id, workspace_id FROM approvals WHERE status='pending' LIMIT 1").get() as Record<string, unknown> | undefined;
  const receipt = restored.prepare("SELECT status, output, tenant_id, workspace_id FROM durable_receipts WHERE key='v14-receipt'").get() as Record<string, unknown>;
  const attestation = restored.prepare("SELECT status, builder_identity, verifier_identity, artifact_hash FROM verification_attestations WHERE id='v14-attestation'").get() as Record<string, unknown>;
  const fkViolations = restored.prepare("PRAGMA foreign_key_check").all();
  const quick = restored.prepare("PRAGMA quick_check").get() as { quick_check: string };
  restored.close();

  if (JSON.stringify(sourceCounts) !== JSON.stringify(restoredCounts)) throw new Error("restored_counts_mismatch");
  if (!restoredAudit.ok || restoredAudit.finalHash !== sourceAudit.finalHash) throw new Error("restored_audit_mismatch");
  if (sha256(restoredArtifact.content) !== sourceArtifactHash) throw new Error("restored_artifact_hash_mismatch");
  if (!pendingApproval || pendingApproval.status !== "pending") throw new Error("pending_approval_not_restored");
  if (receipt.status !== "completed") throw new Error("completed_receipt_not_restored");
  if (attestation.status !== "accepted" || attestation.builder_identity === attestation.verifier_identity) throw new Error("verification_binding_not_restored");
  if (quick.quick_check !== "ok" || fkViolations.length > 0) throw new Error("restored_database_integrity_failed");

  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), passed: true,
    sourceCounts, restoredCounts, sourceAudit, restoredAudit,
    backup: { databaseSha256: backup.databaseSha256, bytes: backup.databaseBytes },
    restore: { databaseSha256: restore.databaseSha256, bytes: restore.databaseBytes },
    artifactHash: sourceArtifactHash,
    pendingApproval,
    completedReceipt: receipt,
    verification: attestation,
    wrongPasswordRejected,
    foreignKeyViolations: fkViolations.length,
    quickCheck: quick.quick_check,
    effectiveRpo: "zero rows lost for the frozen snapshot",
  };
  const out = resolve("docs/canonical/evidence/v14"); mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "clean-restore-proof.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`v14 clean restore passed: ${backup.databaseBytes} bytes, ${sourceAudit.length} audit entries, zero row loss.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
