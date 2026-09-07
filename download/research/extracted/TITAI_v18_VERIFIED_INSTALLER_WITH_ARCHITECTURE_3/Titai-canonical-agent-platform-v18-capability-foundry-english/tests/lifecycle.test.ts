import { describe, expect, it } from "vitest";
import {
  APPROVAL_STATES,
  RUN_STATES,
  STEP_STATES,
  assertApprovalTransition,
  assertRunTransition,
  assertStepTransition,
  canTransitionApproval,
  canTransitionRun,
  canTransitionStep,
  isTerminalRunState,
} from "@/lib/canonical/lifecycle";

describe("run lifecycle", () => {
  it("accepts the normal execution and approval path", () => {
    expect(canTransitionRun("queued", "running")).toBe(true);
    expect(canTransitionRun("running", "awaiting_approval")).toBe(true);
    expect(canTransitionRun("awaiting_approval", "running")).toBe(true);
    expect(canTransitionRun("running", "completed")).toBe(true);
  });

  it("rejects completion without execution", () => {
    expect(() => assertRunTransition("queued", "completed")).toThrow(
      /Illegal run transition/,
    );
  });

  it("keeps all terminal states terminal", () => {
    for (const state of RUN_STATES.filter(isTerminalRunState)) {
      for (const next of RUN_STATES) {
        expect(canTransitionRun(state, next)).toBe(false);
      }
    }
  });
});

describe("step lifecycle", () => {
  it("permits pending -> running -> completed", () => {
    assertStepTransition("pending", "running");
    assertStepTransition("running", "completed");
  });

  it("rejects reopening a completed step", () => {
    expect(() => assertStepTransition("completed", "running")).toThrow(
      /Illegal step transition/,
    );
  });

  it("defines every state", () => {
    for (const from of STEP_STATES) {
      for (const to of STEP_STATES) {
        expect(typeof canTransitionStep(from, to)).toBe("boolean");
      }
    }
  });
});

describe("approval lifecycle", () => {
  it("allows one terminal decision", () => {
    assertApprovalTransition("pending", "approved");
    assertApprovalTransition("pending", "rejected");
    assertApprovalTransition("pending", "expired");
  });

  it("rejects changing an already resolved approval", () => {
    for (const from of APPROVAL_STATES.filter((x) => x !== "pending")) {
      expect(canTransitionApproval(from, "approved")).toBe(false);
      expect(canTransitionApproval(from, "rejected")).toBe(false);
    }
  });
});
