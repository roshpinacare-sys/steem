import { describe, expect, it } from "vitest";
import { summarizeRunEvidence } from "@/lib/engine/evidence-summary";
import type { ClientRunEvent } from "@/lib/engine/event-types";

function event(
  id: number,
  type: ClientRunEvent["type"],
  payload: unknown = {},
): ClientRunEvent {
  return { id, seq: id - 1, type, payload };
}

describe("run evidence summary", () => {
  it("recognizes a reconstructable completed run", () => {
    const summary = summarizeRunEvidence([
      event(1, "run.started"),
      event(2, "plan.created", {
        steps: [{ id: "s1", name: "inspect", description: "", dependsOn: [] }],
      }),
      event(3, "step.started", { stepId: "s1" }),
      event(4, "tool.call", { stepId: "s1", toolCallId: "t1", name: "calculator" }),
      event(5, "tool.result", { stepId: "s1", toolCallId: "t1", ok: true }),
      event(6, "artifact.created", { stepId: "s1", artifactId: "a1" }),
      event(7, "step.completed", { stepId: "s1" }),
      event(8, "run.completed"),
    ]);

    expect(summary.state).toBe("evidence_complete");
    expect(summary.coverage).toBe(100);
    expect(summary.reconstructable).toBe(true);
    expect(summary.gaps).toEqual([]);
  });

  it("detects unresolved side effects and incomplete completion evidence", () => {
    const summary = summarizeRunEvidence([
      event(1, "run.started"),
      event(2, "plan.created", {
        steps: [{ id: "s1", name: "inspect", description: "", dependsOn: [] }],
      }),
      event(3, "tool.call", { stepId: "s1", toolCallId: "t1", name: "http_fetch" }),
      event(4, "run.completed"),
    ]);

    expect(summary.state).toBe("evidence_incomplete");
    expect(summary.reconstructable).toBe(false);
    expect(summary.gaps.map((gap) => gap.code)).toContain("unresolved-tool-call");
    expect(summary.gaps.map((gap) => gap.code)).toContain(
      "completed-run-with-incomplete-step",
    );
  });

  it("detects a broken event sequence", () => {
    const events = [
      { id: 1, seq: 0, type: "run.started", payload: {} },
      { id: 3, seq: 3, type: "run.failed", payload: {} },
    ] satisfies ClientRunEvent[];
    const summary = summarizeRunEvidence(events);
    expect(summary.sequenceIntegrity).toBe(false);
    expect(summary.gaps[0]?.code).toBe("event-sequence-gap");
  });
  it("detects orphan result and approval resolution events", () => {
    const summary = summarizeRunEvidence([
      event(1, "run.started"),
      event(2, "plan.created", { steps: [] }),
      event(3, "tool.result", { toolCallId: "missing-call", ok: true }),
      event(4, "approval.resolved", { approvalId: "missing-request", decision: "approved" }),
      event(5, "run.failed"),
    ]);

    expect(summary.gaps.map((gap) => gap.code)).toContain("orphan-tool-result");
    expect(summary.gaps.map((gap) => gap.code)).toContain(
      "orphan-approval-resolution",
    );
    expect(summary.reconstructable).toBe(false);
  });

});
