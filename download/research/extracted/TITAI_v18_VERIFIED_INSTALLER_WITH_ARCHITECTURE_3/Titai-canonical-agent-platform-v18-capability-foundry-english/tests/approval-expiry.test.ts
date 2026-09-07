import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema, expireStaleApprovals } from "@/lib/db";
import { createId } from "@/lib/ids";

function makeRunWithApproval(requestedAt: Date) {
  const userId = createId();
  db.insert(schema.users)
    .values({
      id: userId,
      email: `exp-${userId}@titai.dev`,
      name: "T",
      passwordHash: "x",
    })
    .run();
  const run = db
    .insert(schema.runs)
    .values({
      userId,
      objective: "expiry test",
      status: "awaiting_approval",
    })
    .returning()
    .get();
  const approval = db
    .insert(schema.approvals)
    .values({
      runId: run.id,
      toolName: "simulate_deploy",
      riskLevel: "high",
      requestPayload: { arguments: {} },
      status: "pending",
      requestedAt,
      expiresAt: new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000),
    })
    .returning()
    .get();
  return { run, approval };
}

describe("approval expiry", () => {
  it("expires approvals older than 24h and interrupts their runs", () => {
    const old = makeRunWithApproval(new Date(Date.now() - 25 * 3600_000));
    const fresh = makeRunWithApproval(new Date());

    const expired = expireStaleApprovals();
    expect(expired).toBeGreaterThanOrEqual(1);

    const oldApproval = db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, old.approval.id))
      .get()!;
    expect(oldApproval.status).toBe("expired");

    const oldRun = db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, old.run.id))
      .get()!;
    expect(oldRun.status).toBe("interrupted");

    const freshApproval = db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, fresh.approval.id))
      .get()!;
    expect(freshApproval.status).toBe("pending");
    const freshRun = db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, fresh.run.id))
      .get()!;
    expect(freshRun.status).toBe("awaiting_approval");
  });
});
