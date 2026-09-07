export type PilotGateState = "pass" | "block";

export interface PilotRunFacts {
  runStatus?: string;
  tenantId?: string | null;
  workspaceId?: string | null;
  runnerMode?: string | null;
  durableJobStatus?: string | null;
  durableReceiptStatuses?: string[];
  approvalStatuses?: string[];
  artifactCount?: number;
  acceptedVerificationCount?: number;
  releaseHashBound?: boolean;
  modelRoutingObserved?: boolean;
  governedMemoryObserved?: boolean;
  capabilityDecisionObserved?: boolean;
  recoveryObserved?: boolean;
}

export interface PilotRunGate {
  id: string;
  label: string;
  state: PilotGateState;
  evidence: string;
}

export interface PilotRunReadiness {
  classification: "DEVELOPMENT ONLY" | "CONTROLLED INTERNAL PILOT";
  ready: boolean;
  blockers: number;
  gates: PilotRunGate[];
}

function gate(id: string, label: string, passed: boolean, evidence: string): PilotRunGate {
  return { id, label, state: passed ? "pass" : "block", evidence };
}

export function evaluatePilotRunFacts(facts: PilotRunFacts): PilotRunReadiness {
  const receipts = facts.durableReceiptStatuses ?? [];
  const approvals = facts.approvalStatuses ?? [];
  const gates = [
    gate(
      "scope",
      "Tenant and workspace are explicit",
      Boolean(facts.tenantId && facts.workspaceId),
      facts.tenantId && facts.workspaceId
        ? `${facts.tenantId} / ${facts.workspaceId}`
        : "Tenant or workspace scope is missing.",
    ),
    gate(
      "durable_mode",
      "Step-durable execution is selected",
      Boolean(facts.runnerMode?.startsWith("durable_")),
      facts.runnerMode ?? "Runner mode is unknown.",
    ),
    gate(
      "durable_job",
      "Durable job is terminal and safe",
      facts.durableJobStatus === "completed",
      facts.durableJobStatus ?? "No durable job evidence.",
    ),
    gate(
      "receipts",
      "Side-effect receipts are unambiguous",
      receipts.length > 0 && receipts.every((status) => status === "completed"),
      receipts.length ? receipts.join(", ") : "No receipt evidence.",
    ),
    gate(
      "approvals",
      "Human approvals are terminal and non-expired",
      approvals.length > 0 && approvals.every((status) => ["approved", "rejected"].includes(status)),
      approvals.length ? approvals.join(", ") : "No persisted approval evidence.",
    ),
    gate(
      "model_route",
      "Model routing decision is recorded",
      facts.modelRoutingObserved === true,
      facts.modelRoutingObserved ? "model.routed observed" : "No model-routing event.",
    ),
    gate(
      "memory",
      "Governed-memory decision is recorded",
      facts.governedMemoryObserved === true,
      facts.governedMemoryObserved ? "memory.selected observed" : "No governed-memory event.",
    ),
    gate(
      "capability",
      "Tool capability decision is recorded",
      facts.capabilityDecisionObserved === true,
      facts.capabilityDecisionObserved ? "tool capability evidence observed" : "No capability evidence.",
    ),
    gate(
      "artifact",
      "Pilot artifact exists",
      (facts.artifactCount ?? 0) > 0,
      `${facts.artifactCount ?? 0} artifact(s).`,
    ),
    gate(
      "run_terminal",
      "Run completed without reconciliation",
      facts.runStatus === "completed" && facts.durableJobStatus !== "needs_reconciliation",
      `run=${facts.runStatus ?? "unknown"}; durable=${facts.durableJobStatus ?? "unknown"}`,
    ),
    gate(
      "verification",
      "Accepted verification is bound to a release hash",
      (facts.acceptedVerificationCount ?? 0) > 0 && facts.releaseHashBound === true,
      `${facts.acceptedVerificationCount ?? 0} accepted attestation(s); release hash bound=${facts.releaseHashBound === true}`,
    ),
  ];
  const blockers = gates.filter((item) => item.state === "block").length;
  return {
    classification: blockers === 0 ? "CONTROLLED INTERNAL PILOT" : "DEVELOPMENT ONLY",
    ready: blockers === 0,
    blockers,
    gates,
  };
}
