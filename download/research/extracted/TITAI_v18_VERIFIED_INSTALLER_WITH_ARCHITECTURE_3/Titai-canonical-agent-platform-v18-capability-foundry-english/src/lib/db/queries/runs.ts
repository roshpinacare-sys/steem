import "server-only";
import { eq, desc, and, inArray, count } from "drizzle-orm";
import { db, schema, expireStaleApprovals } from "@/lib/db";
import type { Run, RunStep, Approval, Artifact } from "@/lib/db/schema";

export interface RunScopeFilter { tenantId: string; workspaceId: string }

export function listRuns(userId: string, limit = 50, scope?: RunScopeFilter): Run[] {
  return db
    .select()
    .from(schema.runs)
    .where(scope ? and(eq(schema.runs.userId, userId), eq(schema.runs.tenantId, scope.tenantId), eq(schema.runs.workspaceId, scope.workspaceId)) : eq(schema.runs.userId, userId))
    .orderBy(desc(schema.runs.createdAt))
    .limit(limit)
    .all();
}

export function getRun(userId: string, runId: string, scope?: RunScopeFilter): Run | undefined {
  return db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.userId, userId), ...(scope ? [eq(schema.runs.tenantId, scope.tenantId), eq(schema.runs.workspaceId, scope.workspaceId)] : [])))
    .get();
}

export function getRunSteps(runId: string, scope?: RunScopeFilter): RunStep[] {
  return db
    .select()
    .from(schema.runSteps)
    .where(scope ? and(eq(schema.runSteps.runId, runId), eq(schema.runSteps.tenantId, scope.tenantId), eq(schema.runSteps.workspaceId, scope.workspaceId)) : eq(schema.runSteps.runId, runId))
    .orderBy(schema.runSteps.idx)
    .all();
}

export function getRunArtifacts(runId: string, scope?: RunScopeFilter): Artifact[] {
  return db
    .select()
    .from(schema.artifacts)
    .where(scope ? and(eq(schema.artifacts.runId, runId), eq(schema.artifacts.tenantId, scope.tenantId), eq(schema.artifacts.workspaceId, scope.workspaceId)) : eq(schema.artifacts.runId, runId))
    .orderBy(desc(schema.artifacts.createdAt))
    .all();
}

export function listActiveRuns(userId: string): Run[] {
  return db
    .select()
    .from(schema.runs)
    .where(
      and(
        eq(schema.runs.userId, userId),
        inArray(schema.runs.status, ["queued", "running", "awaiting_approval"]),
      ),
    )
    .orderBy(desc(schema.runs.createdAt))
    .all();
}

export function listPendingApprovals(userId: string, scope?: RunScopeFilter): Approval[] {
  // Expire anything past TTL before serving the queue.
  try {
    expireStaleApprovals();
  } catch {
    /* table may not exist on first boot */
  }
  const rows = db
    .select({ approval: schema.approvals })
    .from(schema.approvals)
    .innerJoin(schema.runs, eq(schema.approvals.runId, schema.runs.id))
    .where(
      and(
        eq(schema.runs.userId, userId),
        ...(scope ? [eq(schema.approvals.tenantId, scope.tenantId), eq(schema.approvals.workspaceId, scope.workspaceId)] : []),
        eq(schema.approvals.status, "pending"),
      ),
    )
    .orderBy(desc(schema.approvals.requestedAt))
    .all();
  return rows.map((r) => r.approval);
}

export interface RunStats {
  total: number;
  completed: number;
  failed: number;
  pendingApprovals: number;
  successRate: number;
  totalTokens: number;
}

export function getRunStats(userId: string): RunStats {
  const all = db
    .select({ status: schema.runs.status, c: count() })
    .from(schema.runs)
    .where(eq(schema.runs.userId, userId))
    .groupBy(schema.runs.status)
    .all();
  const map = Object.fromEntries(all.map((r) => [r.status, r.c]));
  const total = all.reduce((acc, r) => acc + r.c, 0);
  const completed = map["completed"] ?? 0;
  const failed = map["failed"] ?? 0;
  const finished = completed + failed;
  const pending = listPendingApprovals(userId).length;

  const usageRows = db
    .select({ usage: schema.runs.tokenUsage })
    .from(schema.runs)
    .where(eq(schema.runs.userId, userId))
    .all();
  const totalTokens = usageRows.reduce(
    (acc, r) => acc + (r.usage?.input ?? 0) + (r.usage?.output ?? 0),
    0,
  );

  return {
    total,
    completed,
    failed,
    pendingApprovals: pending,
    successRate: finished > 0 ? Math.round((completed / finished) * 100) : 0,
    totalTokens,
  };
}
