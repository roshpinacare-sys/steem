export type DurableApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "cancelled";

export interface DurableApprovalWait {
  id: string;
  jobId: string;
  runId: string;
  stepId: string;
  toolCallId: string;
  requestedBy: string;
  status: DurableApprovalStatus;
  revision: number;
  requestedAt: string;
  expiresAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  reason?: string;
}

export function createDurableApprovalWait(input: Omit<DurableApprovalWait, "status" | "revision" | "requestedAt"> & { requestedAt?: string }): DurableApprovalWait {
  const requestedAt = input.requestedAt ?? new Date().toISOString();
  if (new Date(input.expiresAt).getTime() <= new Date(requestedAt).getTime()) {
    throw new Error("approval_expiry_must_follow_request");
  }
  return { ...input, status: "pending", revision: 0, requestedAt };
}

export function resolveDurableApprovalWait(
  wait: DurableApprovalWait,
  input: { decision: "approved" | "rejected"; actorId: string; expectedRevision: number; now?: Date; reason?: string },
): DurableApprovalWait {
  if (wait.revision !== input.expectedRevision) throw new Error("approval_revision_conflict");
  if (wait.status !== "pending") throw new Error(`approval_already_terminal:${wait.status}`);
  const now = input.now ?? new Date();
  if (now.getTime() >= new Date(wait.expiresAt).getTime()) throw new Error("approval_expired");
  return {
    ...wait,
    status: input.decision,
    revision: wait.revision + 1,
    resolvedAt: now.toISOString(),
    resolvedBy: input.actorId,
    reason: input.reason,
  };
}

export function expireDurableApprovalWait(wait: DurableApprovalWait, now = new Date()): DurableApprovalWait {
  if (wait.status !== "pending") return wait;
  if (now.getTime() < new Date(wait.expiresAt).getTime()) return wait;
  return { ...wait, status: "expired", revision: wait.revision + 1, resolvedAt: now.toISOString(), reason: "deadline_elapsed" };
}

export function canResumeAfterApproval(wait: DurableApprovalWait): boolean {
  return wait.status === "approved";
}
