import { describe, expect, it } from "vitest";
import { validateExecutionPlan } from "@/lib/engine/plan";
import { routeModel, directModelProfile } from "@/lib/models/router";
import { MemoryDurableStore } from "@/lib/durable/memory-store";
import { DurableWorkflowEngine } from "@/lib/durable/engine";
import type { DurableWorkflow } from "@/lib/durable/types";

function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const workflow: DurableWorkflow<{ value: number }, number> = {
  name: "race-property-workflow",
  steps: [{ id: "read", operation: "read", kind: "pure", async run({ payload }) { return payload.value; } }],
  buildResult(outputs) { return Number(outputs.read); },
};

describe("v12 deterministic property and race probes", () => {
  it("accepts 300 generated DAGs and rejects an injected back-edge cycle", () => {
    const random = prng(0x12cafe);
    for (let sample = 0; sample < 300; sample += 1) {
      const size = 2 + Math.floor(random() * 28);
      const steps = Array.from({ length: size }, (_, index) => {
        const candidates = Array.from({ length: index }, (_unused, dependency) => dependency)
          .filter(() => random() > 0.72)
          .slice(0, 4)
          .map((dependency) => `s${dependency}`);
        return { name: `s${index}`, description: `generated-${sample}`, dependsOn: candidates };
      });
      expect(validateExecutionPlan({ steps }, 40).steps).toHaveLength(size);
      const cyclic = steps.map((step) => ({ ...step, dependsOn: [...step.dependsOn] }));
      cyclic[0].dependsOn = [`s${size - 1}`];
      cyclic[size - 1].dependsOn = [...new Set([...cyclic[size - 1].dependsOn, "s0"])];
      expect(() => validateExecutionPlan({ steps: cyclic }, 40)).toThrow(/cycle/i);
    }
  });

  it("keeps routing deterministic across 200 candidate permutations", () => {
    const random = prng(0x51a7e);
    const base = Array.from({ length: 12 }, (_, index) => directModelProfile("simulation", `model-${index}`, {
      id: `model-${index}`,
      planningQuality: 0.5 + index / 30,
      codeQuality: 0.45 + index / 35,
      verificationQuality: 0.4 + index / 20,
      availability: 0.9,
      evaluationConfidence: 0.95,
      healthState: "healthy",
    }));
    const expected = routeModel(base, { taskClass: "verification", minimumVerificationQuality: 0.6 }, undefined, new Date("2026-07-11T00:00:00Z")).selected?.id;
    for (let sample = 0; sample < 200; sample += 1) {
      const shuffled = [...base];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const target = Math.floor(random() * (index + 1));
        [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
      }
      expect(routeModel(shuffled, { taskClass: "verification", minimumVerificationQuality: 0.6 }, undefined, new Date("2026-07-11T00:00:00Z")).selected?.id).toBe(expected);
    }
  });

  it("allows exactly one concurrent worker to acquire a fresh lease", async () => {
    const store = new MemoryDurableStore();
    const engine = new DurableWorkflowEngine(store, workflow);
    const now = new Date("2026-07-11T00:00:00.000Z");
    await engine.createJob({ id: "race", payload: { value: 7 }, now });
    const claims = await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.claimJob("race", `worker-${index}`, now, 1_000)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await store.getJob("race"))?.lease?.token).toBe(1);
  });

  it("prevents a stale fenced worker from completing after lease takeover", async () => {
    const store = new MemoryDurableStore();
    const engine = new DurableWorkflowEngine(store, workflow);
    const start = new Date("2026-07-11T00:00:00.000Z");
    await engine.createJob({ id: "fence-race", payload: { value: 1 }, now: start });
    const first = await store.claimJob("fence-race", "shared", start, 10);
    const afterExpiry = new Date(start.getTime() + 11);
    const second = await store.claimJob("fence-race", "shared", afterExpiry, 100);
    expect(first?.lease?.token).toBe(1);
    expect(second?.lease?.token).toBe(2);
    await expect(store.completeJob("fence-race", "shared", 1, 1, afterExpiry)).rejects.toThrow(/lease_not_owned/);
    await expect(store.completeJob("fence-race", "shared", 2, 1, afterExpiry)).resolves.toBeUndefined();
  });
});
