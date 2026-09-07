import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { runManager } from "@/lib/engine/runner";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";

export const runtime = "nodejs";

const body = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(2000).optional(),
  expectedRevision: z.number().int().min(0),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { approvalId } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // Ownership check: approval → run → user.
  const row = db
    .select({ userId: schema.runs.userId, tenantId: schema.approvals.tenantId, workspaceId: schema.approvals.workspaceId })
    .from(schema.approvals)
    .innerJoin(schema.runs, eq(schema.approvals.runId, schema.runs.id))
    .where(eq(schema.approvals.id, approvalId))
    .get();
  if (!row || row.userId !== session.user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const scope = resolvePilotScope(session.user.id, { tenantId: row.tenantId ?? undefined, workspaceId: row.workspaceId ?? undefined });
    if (scope.tenantId !== row.tenantId || scope.workspaceId !== row.workspaceId) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const ok = await runManager.resolveApproval(
      approvalId,
      parsed.data.decision === "approve" ? "approved" : "rejected",
      session.user.id,
      parsed.data.reason,
      parsed.data.expectedRevision,
    );
    return NextResponse.json({ ok });
  } catch (error) {
    if (error instanceof Error && error.message === "approval_revision_conflict") {
      return NextResponse.json({ error: "approval_revision_conflict" }, { status: 409 });
    }
    throw error;
  }
}
