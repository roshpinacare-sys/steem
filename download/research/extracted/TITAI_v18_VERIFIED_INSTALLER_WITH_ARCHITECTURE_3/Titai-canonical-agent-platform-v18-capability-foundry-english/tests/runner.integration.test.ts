import { describe, it, expect, beforeAll } from "vitest";
import { eq, and, asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { runManager } from "@/lib/engine/runner";
import { verifyAuditChain } from "@/lib/engine/audit";
import { DEFAULT_POLICY } from "@/lib/engine/policy";
import { ALL_TOOL_NAMES } from "@/lib/engine/tools";
import { createId } from "@/lib/ids";
import type { StartRunInput } from "@/lib/engine/runner";
import type { RunStatus } from "@/lib/db/schema";

let userId: string;

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting");
    await new Promise((r) => setTimeout(r, 15));
  }
}

function runStatus(runId: string): RunStatus {
  return db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get()!
    .status;
}

function baseInput(objective: string): Omit<StartRunInput, "userId"> {
  return {
    tenantId: "tenant-test",
    workspaceId: "workspace-test",
    objective,
    agentId: null,
    agentVersionId: null,
    agentName: "Test Agent",
    agentTier: "engineering",
    systemPrompt: "You are a test agent.",
    provider: "simulation",
    model: "sim-1",
    temperature: 0.5,
    maxSteps: 8,
    maxToolIterations: 4,
    tools: ALL_TOOL_NAMES,
    skillVersionIds: [],
    dryRun: false,
    maxOutputTokens: 4096,
    maxContextTokens: 32_000,
  };
}

beforeAll(() => {
  userId = createId();
  db.insert(schema.users)
    .values({
      id: userId,
      email: `test-${userId}@titai.dev`,
      name: "Test",
      passwordHash: "x",
    })
    .run();
  db.insert(schema.policies)
    .values({
      name: DEFAULT_POLICY.name,
      description: DEFAULT_POLICY.description,
      priority: DEFAULT_POLICY.priority,
      rules: DEFAULT_POLICY.rules,
    })
    .run();
});

describe("runner integration (simulation)", () => {
  it("parks on approval then resumes to completion", async () => {
    const { runId } = await runManager.startRun({
      ...baseInput("build and deploy the new feature"),
      userId,
    });

    // The build script hits simulate_deploy → policy routes to human.
    await waitFor(() => runStatus(runId) === "awaiting_approval");

    const approval = db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.runId, runId),
          eq(schema.approvals.status, "pending"),
        ),
      )
      .get();
    expect(approval).toBeTruthy();
    expect(approval!.toolName).toBe("simulate_deploy");
    expect(approval!.riskLevel).toBe("high");

    const ok = await runManager.resolveApproval(approval!.id, "approved", userId);
    expect(ok).toBe(true);

    await waitFor(() => runStatus(runId) === "completed");

    // Events are ordered and include the full lifecycle.
    const events = db
      .select()
      .from(schema.runEvents)
      .where(eq(schema.runEvents.runId, runId))
      .orderBy(asc(schema.runEvents.seq))
      .all();
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("run.started");
    expect(types).toContain("plan.created");
    expect(types).toContain("approval.requested");
    expect(types).toContain("approval.resolved");
    expect(types).toContain("run.completed");
    // seq is strictly increasing
    for (let i = 1; i < events.length; i++) {
      expect(events[i].seq).toBeGreaterThan(events[i - 1].seq);
    }

    // Steps projection matches the plan and all completed.
    const steps = db
      .select()
      .from(schema.runSteps)
      .where(eq(schema.runSteps.runId, runId))
      .all();
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.every((s) => s.status === "completed")).toBe(true);

    // Artifacts were produced.
    const artifacts = db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.runId, runId))
      .all();
    expect(artifacts.length).toBeGreaterThanOrEqual(1);

    // Audit chain still verifies after all the writes.
    expect(verifyAuditChain().ok).toBe(true);
  });

  it("rejecting an approval still completes the run (tool denied)", async () => {
    const { runId } = await runManager.startRun({
      ...baseInput("build and deploy a risky change"),
      userId,
    });
    await waitFor(() => runStatus(runId) === "awaiting_approval");
    const approval = db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.runId, runId),
          eq(schema.approvals.status, "pending"),
        ),
      )
      .get();
    await runManager.resolveApproval(approval!.id, "rejected", userId);
    await waitFor(() =>
      ["completed", "failed"].includes(runStatus(runId)),
    );
    expect(["completed", "failed"]).toContain(runStatus(runId));
  });

  it("a research objective completes with no approval needed", async () => {
    const { runId } = await runManager.startRun({
      ...baseInput("research and compare caching strategies"),
      userId,
    });
    await waitFor(() => runStatus(runId) === "completed", 10000);
    expect(runStatus(runId)).toBe("completed");
  });

  it("cancel mid-run transitions to cancelled", async () => {
    const { runId } = await runManager.startRun({
      ...baseInput("research a very long topic in depth"),
      userId,
    });
    await waitFor(() => runStatus(runId) === "running");
    await runManager.cancelRun(runId, userId);
    await waitFor(() => runStatus(runId) === "cancelled");
    expect(runStatus(runId)).toBe("cancelled");
  });
});
