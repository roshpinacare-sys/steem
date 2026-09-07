import { describe, expect, it } from "vitest";
import { canResumeAfterApproval, createDurableApprovalWait, expireDurableApprovalWait, resolveDurableApprovalWait } from "@/lib/durable/approval-continuation";

const base = () => createDurableApprovalWait({
  id: "a1", jobId: "j1", runId: "r1", stepId: "s1", toolCallId: "tc1", requestedBy: "agent-1",
  requestedAt: "2026-07-11T00:00:00.000Z", expiresAt: "2026-07-11T00:05:00.000Z",
});

describe("durable approval continuation contract", () => {
  it("survives serialization and permits one revision-checked resolution", () => {
    const restored = JSON.parse(JSON.stringify(base()));
    const approved = resolveDurableApprovalWait(restored, { decision: "approved", actorId: "human-1", expectedRevision: 0, now: new Date("2026-07-11T00:01:00.000Z") });
    expect(canResumeAfterApproval(approved)).toBe(true);
    expect(approved.revision).toBe(1);
    expect(() => resolveDurableApprovalWait(approved, { decision: "rejected", actorId: "human-2", expectedRevision: 1 })).toThrow(/already_terminal/);
  });

  it("rejects stale concurrent resolution", () => {
    const wait = base();
    expect(() => resolveDurableApprovalWait(wait, { decision: "approved", actorId: "human-1", expectedRevision: 7 })).toThrow("approval_revision_conflict");
  });

  it("expires durably and cannot resume", () => {
    const expired = expireDurableApprovalWait(base(), new Date("2026-07-11T00:05:00.000Z"));
    expect(expired.status).toBe("expired");
    expect(canResumeAfterApproval(expired)).toBe(false);
  });

  it("rejects impossible expiry windows", () => {
    expect(() => createDurableApprovalWait({ id: "a", jobId: "j", runId: "r", stepId: "s", toolCallId: "t", requestedBy: "x", requestedAt: "2026-07-11T00:05:00.000Z", expiresAt: "2026-07-11T00:05:00.000Z" })).toThrow("approval_expiry_must_follow_request");
  });
});
