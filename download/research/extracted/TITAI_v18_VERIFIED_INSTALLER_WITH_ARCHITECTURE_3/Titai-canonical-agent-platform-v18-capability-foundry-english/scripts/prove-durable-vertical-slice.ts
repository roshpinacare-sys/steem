import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DurableWorkflowEngine, InjectedCrashError } from "@/lib/durable/engine";
import { JsonFileDurableStore } from "@/lib/durable/json-file-store";
import { MemoryDurableStore } from "@/lib/durable/memory-store";
import { createEncryptedBackup, restoreEncryptedBackup } from "@/lib/durable/backup";
import { verifyDurableProof } from "@/lib/durable/verification";
import { sha256 } from "@/lib/durable/canonical-json";
import type { DurableWorkflow } from "@/lib/durable/types";

interface ProofPayload {
  objective: string;
  artifactPath: string;
  counterPath: string;
}

const proofDir = resolve("docs/canonical/evidence");
const jsonReportPath = join(proofDir, "durable-vertical-slice.json");
const markdownReportPath = join(proofDir, "durable-vertical-slice.md");

async function main() {
  const sandbox = await mkdtemp(join(tmpdir(), "titai-durable-proof-"));
  try {
    const storePath = join(sandbox, "durable-store.json");
    const artifactPath = join(sandbox, "artifact.json");
    const counterPath = join(sandbox, "side-effect-count.txt");
    await writeFile(counterPath, "0", "utf8");

    const workflow: DurableWorkflow<ProofPayload, { artifactHash: string }> = {
      name: "titai-v9-durable-proof",
      steps: [
        {
          id: "validate_objective",
          operation: "validate_objective",
          kind: "pure",
          async run({ payload }) {
            if (payload.objective.trim().length < 8) throw new Error("objective_too_short");
            return { normalized: payload.objective.trim() };
          },
        },
        {
          id: "write_artifact",
          operation: "write_proof_artifact",
          kind: "side_effect",
          idempotencyInput({ payload, outputs }) {
            return {
              artifactPath: payload.artifactPath,
              objective: outputs.validate_objective,
            };
          },
          async run({ payload, outputs }) {
            const count = Number(await readFile(payload.counterPath, "utf8")) + 1;
            await writeFile(payload.counterPath, String(count), "utf8");
            const artifact = {
              objective: outputs.validate_objective,
              createdBy: "durable-builder",
              sideEffectOrdinal: count,
            };
            await writeFile(payload.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
            return { path: payload.artifactPath, hash: sha256(artifact) };
          },
        },
        {
          id: "inspect_artifact",
          operation: "inspect_proof_artifact",
          kind: "pure",
          async run({ payload, outputs }) {
            const artifact = JSON.parse(await readFile(payload.artifactPath, "utf8"));
            const expected = (outputs.write_artifact as { hash: string }).hash;
            const actual = sha256(artifact);
            if (actual !== expected) throw new Error("artifact_hash_mismatch");
            return { actual, matches: true };
          },
        },
      ],
      buildResult(outputs) {
        return {
          artifactHash: (outputs.inspect_artifact as { actual: string }).actual,
        };
      },
    };

    const initialStore = new JsonFileDurableStore(storePath);
    await initialStore.load();
    const initialEngine = new DurableWorkflowEngine(initialStore, workflow);
    const start = new Date("2026-07-10T18:00:00.000Z");
    const job = await initialEngine.createJob({
      id: "durable-proof-job",
      payload: {
        objective: "Create one recoverable proof artifact",
        artifactPath,
        counterPath,
      },
      now: start,
    });

    let injectedCrashObserved = false;
    try {
      await initialEngine.run(job.id, {
        workerId: "durable-builder",
        leaseMs: 1_000,
        now: () => start,
        faultInjector({ point, stepId }) {
          if (point === "after_side_effect" && stepId === "write_artifact") {
            throw new InjectedCrashError(point);
          }
        },
      });
    } catch (error) {
      if (!(error instanceof InjectedCrashError)) throw error;
      injectedCrashObserved = true;
    }

    const recoveredStore = new JsonFileDurableStore(storePath);
    await recoveredStore.load();
    const recoveryEngine = new DurableWorkflowEngine(recoveredStore, workflow);
    const recoveryTime = new Date(start.getTime() + 1_001);
    const recoveryOutcome = await recoveryEngine.run(job.id, {
      workerId: "durable-recovery-worker",
      leaseMs: 1_000,
      now: () => recoveryTime,
    });
    if (recoveryOutcome.status !== "completed") {
      throw new Error(`recovery_failed:${recoveryOutcome.status}`);
    }

    const sideEffectCount = Number(await readFile(counterPath, "utf8"));
    const completedJob = await recoveredStore.getJob(job.id);
    if (!completedJob) throw new Error("completed_job_missing");
    const snapshot = await recoveredStore.snapshot(recoveryTime);

    const backupEnvelope = createEncryptedBackup(
      snapshot,
      "local-proof-passphrase-v9",
      recoveryTime,
    );
    const restoredSnapshot = restoreEncryptedBackup(
      backupEnvelope,
      "local-proof-passphrase-v9",
    );
    const restoredStore = new MemoryDurableStore();
    await restoredStore.restore(restoredSnapshot);
    const restoredJob = await restoredStore.getJob(job.id);
    if (!restoredJob) throw new Error("restored_job_missing");

    const verification = verifyDurableProof(
      {
        builderId: "durable-builder",
        verifierId: "independent-verifier",
        job: completedJob,
        snapshot,
        expectedCompletedSteps: [
          "validate_objective",
          "write_artifact",
          "inspect_artifact",
        ],
        sideEffectCount,
      },
      recoveryTime,
    );

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workflow: workflow.name,
      result: verification.status,
      injectedCrashObserved,
      firstWorker: "durable-builder",
      recoveryWorker: "durable-recovery-worker",
      independentVerifier: verification.verifierId,
      sideEffectCount,
      attemptCount: completedJob.attempt,
      completedSteps: completedJob.checkpoint.completedStepIds,
      receiptStatuses: snapshot.receipts.map((receipt) => ({
        stepId: receipt.stepId,
        status: receipt.status,
        key: receipt.key,
      })),
      backup: {
        format: backupEnvelope.format,
        cipher: backupEnvelope.cipher,
        kdf: backupEnvelope.kdf,
        plaintextSha256: backupEnvelope.plaintextSha256,
        restoredJobStatus: restoredJob.status,
        restoredCheckpointRevision: restoredJob.checkpoint.revision,
      },
      verification,
      limitations: [
        "This proves the portable durable core with a JSON file adapter, not yet the production SQLite runner adapter.",
        "A crash after receipt creation but before side-effect completion intentionally requires manual reconciliation.",
        "The proof uses a local temporary directory and no network or commercial API.",
      ],
    };

    await mkdir(proofDir, { recursive: true });
    await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(
      markdownReportPath,
      `# Durable Vertical Slice Evidence\n\n` +
        `- Result: **${verification.status}**\n` +
        `- Injected crash observed: **${injectedCrashObserved}**\n` +
        `- Recovery worker completed the job: **${recoveryOutcome.status === "completed"}**\n` +
        `- External side effect executions: **${sideEffectCount}**\n` +
        `- Durable attempts: **${completedJob.attempt}**\n` +
        `- Completed steps: ${completedJob.checkpoint.completedStepIds.join(" -> ")}\n` +
        `- Backup cipher: ${backupEnvelope.cipher}\n` +
        `- Backup KDF: ${backupEnvelope.kdf}\n` +
        `- Restored job status: ${restoredJob.status}\n` +
        `- Evidence hash: \`${verification.evidenceHash}\`\n\n` +
        `## Verification Checks\n\n` +
        verification.checks
          .map((check) => `- ${check.passed ? "PASS" : "FAIL"} — ${check.id}: ${check.detail}`)
          .join("\n") +
        `\n\n## Honest Boundary\n\n` +
        report.limitations.map((item) => `- ${item}`).join("\n") +
        `\n`,
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          result: verification.status,
          injectedCrashObserved,
          sideEffectCount,
          attempts: completedJob.attempt,
          evidenceHash: verification.evidenceHash,
          report: jsonReportPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
