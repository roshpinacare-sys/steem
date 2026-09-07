import { sha256 } from "./canonical-json";
import type { DurableJob, DurableSnapshot } from "./types";

export interface DurableVerificationInput {
  builderId: string;
  verifierId: string;
  job: DurableJob;
  snapshot: DurableSnapshot;
  expectedCompletedSteps: string[];
  sideEffectCount: number;
}

export interface DurableVerificationReport {
  status: "verified" | "rejected";
  verifierId: string;
  checkedAt: string;
  evidenceHash: string;
  checks: Array<{ id: string; passed: boolean; detail: string }>;
}

export function verifyDurableProof(
  input: DurableVerificationInput,
  now = new Date(),
): DurableVerificationReport {
  const checks = [
    {
      id: "independent_verifier",
      passed: input.builderId !== input.verifierId,
      detail: "Verifier identity must differ from builder identity.",
    },
    {
      id: "job_completed",
      passed: input.job.status === "completed",
      detail: `Observed job status: ${input.job.status}.`,
    },
    {
      id: "all_steps_checkpointed",
      passed:
        JSON.stringify(input.job.checkpoint.completedStepIds) ===
        JSON.stringify(input.expectedCompletedSteps),
      detail: `Completed steps: ${input.job.checkpoint.completedStepIds.join(", ")}.`,
    },
    {
      id: "exactly_once_side_effect",
      passed: input.sideEffectCount === 1,
      detail: `Observed side-effect count: ${input.sideEffectCount}.`,
    },
    {
      id: "completed_receipt_present",
      passed: input.snapshot.receipts.some(
        (receipt) =>
          receipt.jobId === input.job.id && receipt.status === "completed",
      ),
      detail: "At least one completed idempotency receipt must exist.",
    },
    {
      id: "no_active_lease_after_completion",
      passed: !input.job.lease,
      detail: input.job.lease ? "Lease remained attached." : "No active lease remained.",
    },
  ];
  return {
    status: checks.every((check) => check.passed) ? "verified" : "rejected",
    verifierId: input.verifierId,
    checkedAt: now.toISOString(),
    evidenceHash: sha256({ job: input.job, snapshot: input.snapshot, checks }),
    checks,
  };
}
