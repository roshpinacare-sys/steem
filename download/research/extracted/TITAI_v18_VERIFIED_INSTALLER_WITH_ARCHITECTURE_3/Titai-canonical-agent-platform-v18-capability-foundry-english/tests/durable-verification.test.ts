import { describe, expect, it } from "vitest";
import { verifyDurableProof } from "@/lib/durable/verification";
import type { DurableJob, DurableSnapshot } from "@/lib/durable/types";

const job: DurableJob = {
  id: "verified-job",
  workflowName: "proof",
  payload: {},
  status: "completed",
  checkpoint: {
    nextStepIndex: 2,
    outputs: { one: true, two: true },
    completedStepIds: ["one", "two"],
    revision: 2,
  },
  result: { ok: true },
  attempt: 2,
  maxAttempts: 5,
  availableAt: "2026-07-10T12:00:00.000Z",
  createdAt: "2026-07-10T12:00:00.000Z",
  updatedAt: "2026-07-10T12:01:00.000Z",
};

const snapshot: DurableSnapshot = {
  schemaVersion: 1,
  exportedAt: "2026-07-10T12:01:00.000Z",
  jobs: [job],
  receipts: [
    {
      key: "receipt",
      jobId: job.id,
      stepId: "two",
      operation: "write",
      inputHash: "hash",
      status: "completed",
      output: { ok: true },
      startedAt: "2026-07-10T12:00:30.000Z",
      completedAt: "2026-07-10T12:00:31.000Z",
      workerId: "builder",
    },
  ],
};

describe("durable proof verification", () => {
  it("accepts evidence reviewed by an independent verifier", () => {
    const report = verifyDurableProof({
      builderId: "builder",
      verifierId: "verifier",
      job,
      snapshot,
      expectedCompletedSteps: ["one", "two"],
      sideEffectCount: 1,
    });
    expect(report.status).toBe("verified");
    expect(report.checks.every((check) => check.passed)).toBe(true);
  });

  it("rejects self-verification", () => {
    const report = verifyDurableProof({
      builderId: "builder",
      verifierId: "builder",
      job,
      snapshot,
      expectedCompletedSteps: ["one", "two"],
      sideEffectCount: 1,
    });
    expect(report.status).toBe("rejected");
    expect(report.checks.find((check) => check.id === "independent_verifier")?.passed).toBe(false);
  });
});
