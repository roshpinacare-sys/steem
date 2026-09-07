import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runManager } from "@/lib/engine/runner";
import { db, schema } from "@/lib/db";
import { desc, eq, and } from "drizzle-orm";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";
import { loadPilotRunReadiness } from "@/lib/release/pilot-run-evidence";
import {
  getRun,
  getRunSteps,
  getRunArtifacts,
} from "@/lib/db/queries/runs";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { runId } = await params;
  const scope = resolvePilotScope(session.user.id);
  const run = getRun(session.user.id, runId, scope);
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const verificationAttestations = db
    .select()
    .from(schema.verificationAttestations)
    .where(and(eq(schema.verificationAttestations.runId, runId), eq(schema.verificationAttestations.tenantId, scope.tenantId), eq(schema.verificationAttestations.workspaceId, scope.workspaceId)))
    .orderBy(desc(schema.verificationAttestations.createdAt))
    .all();
  return NextResponse.json({
    run,
    steps: getRunSteps(runId, scope),
    artifacts: getRunArtifacts(runId, scope),
    verificationAttestations,
    pilotReadiness: loadPilotRunReadiness({ runId, tenantId: scope.tenantId, workspaceId: scope.workspaceId }),
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { runId } = await params;
  const scope = resolvePilotScope(session.user.id);
  const run = getRun(session.user.id, runId, scope);
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ok = await runManager.cancelRun(runId, session.user.id);
  return NextResponse.json({ ok });
}
