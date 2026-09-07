import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { openSQLite } from "../src/lib/db/sqlite-client";
import { applyCanonicalMigrations } from "../src/lib/db/migrations";

interface WorkerResult { ok: boolean; action: string; claimed?: boolean; token?: number | null; committed?: boolean; error?: string }
const root = mkdtempSync(join(tmpdir(), "titai-v14-multiprocess-"));
const databasePath = join(root, "pilot.sqlite");
const barrierPath = join(root, "barrier.txt");
const sqlite = openSQLite(databasePath, { driver: "node:sqlite" });
applyCanonicalMigrations({ client: sqlite, migrationsFolder: resolve("drizzle") });
const createdAt = "2026-07-11T10:00:00.000Z";
sqlite.prepare(`INSERT INTO durable_jobs
  (id, tenant_id, workspace_id, workflow_name, payload, status, checkpoint, result, error,
   attempt, max_attempts, available_at, lease_owner, lease_token, lease_acquired_at,
   lease_expires_at, lease_heartbeat_at, version, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 3, ?, NULL, 0, NULL, NULL, NULL, 0, ?, ?)`)
  .run("v14-race-job", "tenant-a", "workspace-a", "v14-race", JSON.stringify({}), "queued",
    JSON.stringify({ nextStepIndex: 0, outputs: {}, completedStepIds: [], revision: 0 }),
    createdAt, createdAt, createdAt);
sqlite.close();

const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
const workerFile = resolve("scripts/fixtures/v14-durable-process-worker.ts");
function worker(args: string[]): Promise<WorkerResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [tsxCli, "--tsconfig", "tsconfig.scripts.json", workerFile, ...args], {
      cwd: process.cwd(), env: { ...process.env, NODE_NO_WARNINGS: "1" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("exit", () => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      if (!line) return reject(new Error(`worker_no_output:${stderr}`));
      try { resolvePromise(JSON.parse(line) as WorkerResult); }
      catch { reject(new Error(`worker_invalid_output:${stdout}:${stderr}`)); }
    });
  });
}

try {
  writeFileSync(barrierPath, "wait\n");
  const at = "2026-07-11T10:00:00.100Z";
  const aPromise = worker(["claim", databasePath, "v14-race-job", "worker-a", at, "0", barrierPath]);
  const bPromise = worker(["claim", databasePath, "v14-race-job", "worker-b", at, "0", barrierPath]);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  writeFileSync(barrierPath, "go\n");
  const [a, b] = await Promise.all([aPromise, bPromise]);
  const winners = [a, b].filter((item) => item.claimed);
  if (winners.length !== 1 || !winners[0].token) throw new Error(`lease_race_failed:${JSON.stringify({ a, b })}`);
  const firstWinnerId = a.claimed ? "worker-a" : "worker-b";
  const firstToken = winners[0].token;

  const takeover = await worker(["claim", databasePath, "v14-race-job", "worker-c", "2026-07-11T10:00:00.400Z", "0"]);
  if (!takeover.claimed || !takeover.token || takeover.token <= firstToken) {
    throw new Error(`takeover_failed:${JSON.stringify(takeover)}`);
  }
  const stale = await worker(["checkpoint", databasePath, "v14-race-job", firstWinnerId, "2026-07-11T10:00:00.410Z", String(firstToken)]);
  if (stale.ok || !stale.error?.startsWith("lease_")) throw new Error(`stale_commit_not_rejected:${JSON.stringify(stale)}`);
  const current = await worker(["checkpoint", databasePath, "v14-race-job", "worker-c", "2026-07-11T10:00:00.410Z", String(takeover.token)]);
  if (!current.ok || !current.committed) throw new Error(`current_commit_failed:${JSON.stringify(current)}`);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    databaseDriver: "node:sqlite",
    processCount: 4,
    leaseRace: { contenders: [a, b], winnerCount: winners.length },
    takeover,
    staleCommit: stale,
    currentCommit: current,
    passed: true,
  };
  const out = resolve("docs/canonical/evidence/v14");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "multiprocess-lease-proof.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`v14 multi-process proof passed: one lease winner, token ${firstToken} fenced by token ${takeover.token}.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
