import { describe, expect, it } from "vitest";
import { DurableWorkflowEngine } from "@/lib/durable/engine";
import { DurablePauseError, type DurableWorkflow } from "@/lib/durable/types";
import { MemoryDurableStore } from "@/lib/durable/memory-store";

interface ApprovalPayload {
  approved: boolean;
}

describe("durable approval restart continuation", () => {
  it("parks without failing, resumes after approval, and executes the side effect once", async () => {
    const store = new MemoryDurableStore();
    let approved = false;
    let sideEffects = 0;
    const workflow: DurableWorkflow<ApprovalPayload, { artifactId: string }> = {
      name: "approval_restart_pilot",
      steps: [
        {
          id: "approval_gate",
          operation: "approval.wait",
          kind: "idempotent",
          async run() {
            if (!approved) throw new DurablePauseError("approval:pilot", 60_000);
            return { approved: true };
          },
        },
        {
          id: "write_artifact",
          operation: "artifact.write",
          kind: "side_effect",
          idempotencyInput: ({ jobId }) => ({ jobId, name: "pilot.txt", content: "verified" }),
          async run() {
            sideEffects += 1;
            return { artifactId: "artifact-pilot" };
          },
        },
      ],
      buildResult(outputs) {
        return outputs.write_artifact as { artifactId: string };
      },
    };
    const engine = new DurableWorkflowEngine(store, workflow);
    await engine.createJob({
      id: "approval-pilot",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      payload: { approved: false },
      now: new Date("2026-07-11T00:00:00Z"),
    });

    const first = await engine.run("approval-pilot", {
      workerId: "worker-before-restart",
      now: () => new Date("2026-07-11T00:00:01Z"),
    });
    expect(first.status).toBe("waiting");
    expect((await store.getJob("approval-pilot"))?.status).toBe("queued");
    expect(sideEffects).toBe(0);

    approved = true;
    const second = await engine.run("approval-pilot", {
      workerId: "worker-after-restart",
      now: () => new Date("2026-07-11T00:01:02Z"),
    });
    expect(second.status).toBe("completed");
    expect(sideEffects).toBe(1);
    const job = await store.getJob("approval-pilot");
    expect(job?.tenantId).toBe("tenant-a");
    expect(job?.workspaceId).toBe("workspace-a");
    expect(job?.checkpoint.completedStepIds).toEqual(["approval_gate", "write_artifact"]);

    const third = await engine.run("approval-pilot", {
      workerId: "worker-duplicate",
      now: () => new Date("2026-07-11T00:02:00Z"),
    });
    expect(third.status).toBe("lease_unavailable");
    expect(sideEffects).toBe(1);
  });
});
