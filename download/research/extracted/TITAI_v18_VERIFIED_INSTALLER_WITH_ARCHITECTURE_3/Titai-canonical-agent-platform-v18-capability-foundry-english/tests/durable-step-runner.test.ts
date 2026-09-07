import { describe, expect, it } from "vitest";
import { DurableWorkflowEngine, InjectedCrashError } from "@/lib/durable/engine";
import { MemoryDurableStore } from "@/lib/durable/memory-store";
import {
  createStepDurableWorkflow,
  type DurablePlanStepState,
  type DurableStepRunAdapter,
} from "@/lib/durable/step-runner";

interface Payload { runId: string }

function fixture() {
  const states: Record<string, DurablePlanStepState> = { discover: "pending", build: "pending", verify: "pending" };
  const executions: Record<string, number> = { discover: 0, build: 0, verify: 0 };
  const adapter: DurableStepRunAdapter<Payload, { status: string; completed: string[] }> = {
    async initialize() {},
    async loadOrCreatePlan() {
      return [
        { id: "discover", dependsOn: [] },
        { id: "build", dependsOn: ["discover"] },
        { id: "verify", dependsOn: ["build"] },
      ];
    },
    async getStepState(stepId) { return states[stepId]; },
    async recoverRunningStep(stepId) { states[stepId] = "retrying"; },
    async executeStep(stepId) {
      if (states[stepId] === "completed") return { stepId, ok: true, output: "existing" };
      executions[stepId] += 1;
      states[stepId] = "running";
      states[stepId] = "completed";
      return { stepId, ok: true, output: `${stepId}-output` };
    },
    async finalize(_payload, summary) {
      return { status: summary.failed.length || summary.blocked.length ? "failed" : "completed", completed: summary.completed };
    },
  };
  return { adapter, states, executions };
}

describe("step-level durable agent workflow", () => {
  it("resumes after an idempotent step crash without executing the completed step twice", async () => {
    const store = new MemoryDurableStore();
    const { adapter, executions } = fixture();
    const engine = new DurableWorkflowEngine(store, createStepDurableWorkflow(adapter, 3));
    const start = new Date("2026-07-11T00:00:00.000Z");
    await engine.createJob({ id: "step-job", payload: { runId: "run-1" }, now: start, maxAttempts: 4 });

    await expect(engine.run("step-job", {
      workerId: "worker-a",
      leaseMs: 100,
      now: () => start,
      faultInjector({ point, stepId }) {
        if (point === "after_idempotent_step" && stepId === "execute_slot_0") {
          throw new InjectedCrashError(point);
        }
      },
    })).rejects.toThrow("injected_crash:after_idempotent_step");

    expect(executions.discover).toBe(1);
    const recovered = await engine.run("step-job", {
      workerId: "worker-b",
      leaseMs: 100,
      now: () => new Date(start.getTime() + 101),
    });
    expect(recovered.status).toBe("completed");
    expect(executions).toEqual({ discover: 1, build: 1, verify: 1 });
    expect(recovered.status === "completed" ? recovered.job.result : null).toEqual({
      status: "completed",
      completed: ["discover", "build", "verify"],
    });
  });

  it("rejects cyclic plans before any execution", async () => {
    const store = new MemoryDurableStore();
    let executions = 0;
    const adapter: DurableStepRunAdapter<Payload, unknown> = {
      async initialize() {},
      async loadOrCreatePlan() { return [{ id: "a", dependsOn: ["b"] }, { id: "b", dependsOn: ["a"] }]; },
      async getStepState() { return "pending"; },
      async recoverRunningStep() {},
      async executeStep() { executions += 1; return { stepId: "a", ok: true }; },
      async finalize() { return {}; },
    };
    const engine = new DurableWorkflowEngine(store, createStepDurableWorkflow(adapter, 3));
    await engine.createJob({ id: "cycle", payload: { runId: "run-cycle" } });
    const outcome = await engine.run("cycle", { workerId: "worker", leaseMs: 1_000 });
    expect(outcome.status).toBe("failed");
    expect(executions).toBe(0);
    expect(outcome.status === "failed" ? outcome.error : "").toContain("durable_plan_cycle_detected");
  });
});
