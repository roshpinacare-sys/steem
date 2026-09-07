import { describe, expect, it } from "vitest";
import { evaluatePilotRunFacts } from "@/lib/release/pilot-run-gates";

const complete = {
  runStatus: "completed",
  tenantId: "tenant-a",
  workspaceId: "workspace-a",
  runnerMode: "durable_opt_in",
  durableJobStatus: "completed",
  durableReceiptStatuses: ["completed"],
  approvalStatuses: ["approved"],
  artifactCount: 1,
  acceptedVerificationCount: 1,
  releaseHashBound: true,
  modelRoutingObserved: true,
  governedMemoryObserved: true,
  capabilityDecisionObserved: true,
  recoveryObserved: true,
};

describe("pilot run evidence gates", () => {
  it("classifies only a fully evidenced run as controlled internal pilot", () => {
    const result = evaluatePilotRunFacts(complete);
    expect(result.ready).toBe(true);
    expect(result.blockers).toBe(0);
    expect(result.classification).toBe("CONTROLLED INTERNAL PILOT");
  });

  it("treats unknown evidence as blocking", () => {
    const result = evaluatePilotRunFacts({});
    expect(result.ready).toBe(false);
    expect(result.gates.every((gate) => gate.state === "block")).toBe(true);
  });

  it("blocks unknown or failed receipts even when the run claims completion", () => {
    const result = evaluatePilotRunFacts({ ...complete, durableReceiptStatuses: ["completed", "unknown"] });
    expect(result.ready).toBe(false);
    expect(result.gates.find((gate) => gate.id === "receipts")?.state).toBe("block");
  });
});
