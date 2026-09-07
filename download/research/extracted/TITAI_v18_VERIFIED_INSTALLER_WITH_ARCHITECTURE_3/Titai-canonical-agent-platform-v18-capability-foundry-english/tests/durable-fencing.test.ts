import { describe, expect, it } from "vitest";
import { DurableWorkflowEngine } from "@/lib/durable/engine";
import { MemoryDurableStore } from "@/lib/durable/memory-store";
import type { DurableWorkflow } from "@/lib/durable/types";

const workflow: DurableWorkflow<{ value: number }, number> = {
  name: "fencing-test",
  steps: [{ id: "read", operation: "read", kind: "pure", async run({ payload }) { return payload.value; } }],
  buildResult(outputs) { return Number(outputs.read); },
};

describe("durable lease fencing", () => {
  it("rejects a stale lease token even when the worker identity is reused", async () => {
    const store = new MemoryDurableStore();
    const engine = new DurableWorkflowEngine(store, workflow);
    const t0 = new Date("2026-07-11T00:00:00.000Z");
    await engine.createJob({ id: "fenced", payload: { value: 3 }, now: t0 });
    const first = await store.claimJob("fenced", "worker-shared", t0, 100);
    expect(first?.lease?.token).toBe(1);
    const t1 = new Date(t0.getTime() + 101);
    const second = await store.claimJob("fenced", "worker-shared", t1, 100);
    expect(second?.lease?.token).toBe(2);

    await expect(store.updateCheckpoint(
      "fenced",
      "worker-shared",
      1,
      { nextStepIndex: 1, outputs: { stale: true }, completedStepIds: ["stale"], revision: 1 },
      t1,
    )).rejects.toThrow("lease_not_owned");

    await expect(store.updateCheckpoint(
      "fenced",
      "worker-shared",
      2,
      { nextStepIndex: 1, outputs: { current: true }, completedStepIds: ["current"], revision: 1 },
      t1,
    )).resolves.toBeUndefined();
  });
});
