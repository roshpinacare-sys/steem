import { describe, expect, it } from "vitest";
import { DurableWorkflowEngine } from "@/lib/durable/engine";
import { MemoryDurableStore } from "@/lib/durable/memory-store";
import { DurableWorker } from "@/lib/durable/worker";

const workflow = {
  name: "worker-proof",
  steps: [
    {
      id: "finish",
      operation: "finish",
      kind: "pure" as const,
      async run() {
        return "done";
      },
    },
  ],
  buildResult(outputs: Readonly<Record<string, unknown>>) {
    return outputs.finish;
  },
};

describe("durable worker", () => {
  it("dispatches bounded due work through the registered workflow", async () => {
    const store = new MemoryDurableStore();
    const engine = new DurableWorkflowEngine(store, workflow);
    const now = new Date("2026-07-10T12:00:00.000Z");
    await engine.createJob({ id: "one", payload: {}, now });
    await engine.createJob({ id: "two", payload: {}, now });
    const worker = new DurableWorker(store, { [workflow.name]: engine });

    const first = await worker.runOnce({
      workerId: "worker",
      now: () => now,
      maxJobsPerPass: 1,
    });
    expect(first.dispatched).toBe(1);
    expect((await store.listJobs()).filter((job) => job.status === "completed")).toHaveLength(1);

    const second = await worker.runOnce({
      workerId: "worker",
      now: () => now,
      maxJobsPerPass: 1,
    });
    expect(second.dispatched).toBe(1);
    expect((await store.listJobs()).every((job) => job.status === "completed")).toBe(true);
  });

  it("reports unknown workflow names without claiming them", async () => {
    const store = new MemoryDurableStore();
    const now = new Date("2026-07-10T12:00:00.000Z");
    await store.createJob({
      id: "unknown",
      workflowName: "missing",
      payload: {},
      status: "queued",
      checkpoint: { nextStepIndex: 0, outputs: {}, completedStepIds: [], revision: 0 },
      attempt: 0,
      maxAttempts: 2,
      availableAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const worker = new DurableWorker(store, {});
    const result = await worker.runOnce({ workerId: "worker", now: () => now });
    expect(result.unknownWorkflows).toEqual([
      { jobId: "unknown", workflowName: "missing" },
    ]);
    expect((await store.getJob("unknown"))?.status).toBe("queued");
  });
});
