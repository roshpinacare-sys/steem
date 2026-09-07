import { describe, expect, it } from "vitest";
import { DurableWorkflowEngine, InjectedCrashError } from "@/lib/durable/engine";
import { MemoryDurableStore } from "@/lib/durable/memory-store";
import type { DurableWorkflow } from "@/lib/durable/types";

interface Payload {
  value: number;
}

function workflow(counter: { value: number }): DurableWorkflow<Payload, { total: number }> {
  return {
    name: "durable-test",
    steps: [
      {
        id: "prepare",
        operation: "prepare_value",
        kind: "pure",
        async run({ payload }) {
          return payload.value * 2;
        },
      },
      {
        id: "commit",
        operation: "increment_external_counter",
        kind: "side_effect",
        idempotencyInput({ outputs }) {
          return { prepared: outputs.prepare };
        },
        async run({ outputs }) {
          counter.value += 1;
          return { committed: outputs.prepare, count: counter.value };
        },
      },
      {
        id: "verify",
        operation: "verify_commit",
        kind: "pure",
        async run({ outputs }) {
          return outputs.commit;
        },
      },
    ],
    buildResult(outputs) {
      return { total: Number((outputs.commit as { committed: number }).committed) };
    },
  };
}

describe("durable workflow engine", () => {
  it("resumes after a crash without repeating the side effect", async () => {
    const store = new MemoryDurableStore();
    const counter = { value: 0 };
    const engine = new DurableWorkflowEngine(store, workflow(counter));
    const start = new Date("2026-07-10T12:00:00.000Z");
    const job = await engine.createJob({ id: "job-1", payload: { value: 21 }, now: start });

    await expect(
      engine.run(job.id, {
        workerId: "builder",
        leaseMs: 1_000,
        now: () => start,
        faultInjector({ point, stepId }) {
          if (point === "after_side_effect" && stepId === "commit") {
            throw new InjectedCrashError(point);
          }
        },
      }),
    ).rejects.toThrow("injected_crash:after_side_effect");

    expect(counter.value).toBe(1);
    const crashed = await store.getJob(job.id);
    expect(crashed?.status).toBe("leased");
    expect(crashed?.checkpoint.completedStepIds).toEqual(["prepare"]);

    const afterLease = new Date(start.getTime() + 1_001);
    const outcome = await engine.run(job.id, {
      workerId: "recovery-worker",
      leaseMs: 1_000,
      now: () => afterLease,
    });

    expect(outcome.status).toBe("completed");
    expect(counter.value).toBe(1);
    const completed = await store.getJob(job.id);
    expect(completed?.checkpoint.completedStepIds).toEqual([
      "prepare",
      "commit",
      "verify",
    ]);
    expect(completed?.result).toEqual({ total: 42 });
    expect((await store.snapshot()).receipts).toHaveLength(1);
  });

  it("prevents a second worker from stealing a live lease", async () => {
    const store = new MemoryDurableStore();
    const engine = new DurableWorkflowEngine(store, workflow({ value: 0 }));
    const now = new Date("2026-07-10T12:00:00.000Z");
    const job = await engine.createJob({ id: "job-lease", payload: { value: 1 }, now });
    expect(await store.claimJob(job.id, "worker-a", now, 10_000)).toBeTruthy();

    const outcome = await engine.run(job.id, {
      workerId: "worker-b",
      now: () => new Date(now.getTime() + 100),
    });
    expect(outcome).toEqual({ status: "lease_unavailable" });
  });

  it("requires reconciliation when a crash leaves an ambiguous started receipt", async () => {
    const store = new MemoryDurableStore();
    const counter = { value: 0 };
    const engine = new DurableWorkflowEngine(store, workflow(counter));
    const start = new Date("2026-07-10T12:00:00.000Z");
    const job = await engine.createJob({
      id: "job-reconcile",
      payload: { value: 2 },
      now: start,
    });

    await expect(
      engine.run(job.id, {
        workerId: "worker-a",
        leaseMs: 500,
        now: () => start,
        faultInjector({ point, stepId }) {
          if (point === "after_receipt_started" && stepId === "commit") {
            throw new InjectedCrashError(point);
          }
        },
      }),
    ).rejects.toThrow("injected_crash:after_receipt_started");

    const resumed = await engine.run(job.id, {
      workerId: "worker-b",
      leaseMs: 500,
      now: () => new Date(start.getTime() + 501),
    });
    expect(resumed.status).toBe("needs_reconciliation");
    expect(counter.value).toBe(0);
    expect((await store.getJob(job.id))?.status).toBe("needs_reconciliation");
  });

  it("rejects duplicate step identifiers", () => {
    const store = new MemoryDurableStore();
    expect(
      () =>
        new DurableWorkflowEngine(store, {
          name: "bad",
          steps: [
            { id: "same", operation: "a", kind: "pure", async run() {} },
            { id: "same", operation: "b", kind: "pure", async run() {} },
          ],
          buildResult() {
            return null;
          },
        }),
    ).toThrow("duplicate_durable_step:same");
  });
});
