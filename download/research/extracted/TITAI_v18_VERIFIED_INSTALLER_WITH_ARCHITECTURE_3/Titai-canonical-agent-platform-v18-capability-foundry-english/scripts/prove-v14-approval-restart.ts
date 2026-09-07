import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

interface ChildResult { ok: boolean; decision: string; error?: string }
const root = mkdtempSync(join(tmpdir(), "titai-v14-approval-"));
const databasePath = join(root, "pilot.sqlite");
const barrierPath = join(root, "barrier.txt");
const baseEnv = {
  ...process.env, DATABASE_PATH: databasePath, TITAI_SQLITE_DRIVER: "node:sqlite",
  TITAI_ALLOW_DESTRUCTIVE_SEED: "1", TITAI_DEMO_PASSWORD: "test-Pilot-Approval-Password-2026!",
  AUTH_SECRET: "test-v14-approval-auth-secret-32-bytes", ENCRYPTION_KEY: "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25nISE=", NODE_NO_WARNINGS: "1",
};
function runSync(args: string[]) {
  const r = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), ...args], { cwd: process.cwd(), env: baseEnv, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`setup_failed:${r.stderr || r.stdout}`);
}
function child(args: string[]): Promise<ChildResult> {
  return new Promise((resolvePromise, reject) => {
    const p = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig", "tsconfig.scripts.json", resolve("scripts/fixtures/v14-approval-process-worker.ts"), ...args], { cwd: process.cwd(), env: baseEnv, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; p.stdout.on("data", (d) => out += d); p.stderr.on("data", (d) => err += d);
    p.on("exit", () => { const line = out.trim().split(/\r?\n/).filter(Boolean).at(-1); if (!line) return reject(new Error(`child_no_output:${err}`)); try { resolvePromise(JSON.parse(line)); } catch { reject(new Error(`bad_child_output:${out}:${err}`)); } });
  });
}
try {
  runSync(["scripts/migrate.ts"]);
  runSync(["--tsconfig", "tsconfig.scripts.json", "scripts/seed.ts"]);
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys=ON");
  const approval = db.prepare(`SELECT a.id, a.run_id, a.revision, r.user_id, r.tenant_id, r.workspace_id
    FROM approvals a JOIN runs r ON r.id=a.run_id WHERE a.status='pending' LIMIT 1`).get() as { id: string; run_id: string; revision: number; user_id: string; tenant_id: string; workspace_id: string };
  if (!approval) throw new Error("pending_approval_missing");
  const jobId = `durable:${approval.run_id}`;
  const now = Date.parse("2026-07-11T12:00:00Z");
  db.prepare(`INSERT INTO durable_jobs
    (id, tenant_id, workspace_id, workflow_name, payload, status, checkpoint, result, error, attempt, max_attempts,
     available_at, lease_owner, lease_token, lease_acquired_at, lease_expires_at, lease_heartbeat_at, version, created_at, updated_at)
    VALUES (?, ?, ?, 'approval-restart', ?, 'queued', ?, NULL, NULL, 0, 3, ?, NULL, 0, NULL, NULL, NULL, 0, ?, ?)`)
    .run(jobId, approval.tenant_id, approval.workspace_id, JSON.stringify({ runId: approval.run_id }), JSON.stringify({ nextStepIndex: 0, outputs: {}, completedStepIds: [], revision: 0 }), now, now, now);
  db.prepare("UPDATE approvals SET durable_job_id=?, continuation_key=?, continuation_checkpoint=? WHERE id=?")
    .run(jobId, "v14-continuation", JSON.stringify({ stepId: "approval", toolCallId: "tool-v14", toolName: "simulate_deploy", argumentsHash: "a".repeat(64) }), approval.id);
  db.prepare("UPDATE runs SET runner_mode='durable_opt_in', status='awaiting_approval' WHERE id=?").run(approval.run_id);
  db.close();

  writeFileSync(barrierPath, "wait\n");
  const args = [databasePath, approval.id, approval.user_id, "approved", String(approval.revision), barrierPath];
  const first = child(args); const second = child(args);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100)); writeFileSync(barrierPath, "go\n");
  const outcomes = await Promise.all([first, second]);
  const winners = outcomes.filter((outcome) => outcome.ok);
  if (winners.length !== 1) throw new Error(`approval_race_expected_one_winner:${JSON.stringify(outcomes)}`);
  const check = new DatabaseSync(databasePath, { readOnly: true });
  const persisted = check.prepare("SELECT status, revision, resolved_by, durable_job_id FROM approvals WHERE id=?").get(approval.id) as Record<string, unknown>;
  const durable = check.prepare("SELECT status, lease_owner, version FROM durable_jobs WHERE id=?").get(jobId) as Record<string, unknown>;
  const run = check.prepare("SELECT status, runner_mode FROM runs WHERE id=?").get(approval.run_id) as Record<string, unknown>;
  check.close();
  if (persisted.status !== "approved" || persisted.revision !== 1 || persisted.resolved_by !== approval.user_id) throw new Error(`approval_not_persisted:${JSON.stringify(persisted)}`);
  if (!["queued", "leased", "completed"].includes(String(durable.status))) throw new Error(`durable_continuation_not_resumable:${JSON.stringify(durable)}`);
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), passed: true, processCount: 3, outcomes, persisted, durable, run, oneWinner: winners.length === 1 };
  const out = resolve("docs/canonical/evidence/v14"); mkdirSync(out, { recursive: true }); writeFileSync(join(out, "approval-restart-process-proof.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log("v14 approval restart proof passed: persisted request survived process exit and exactly one resolver won.");
} finally { rmSync(root, { recursive: true, force: true }); }
