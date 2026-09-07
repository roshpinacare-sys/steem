import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getRun, getRunArtifacts } from "@/lib/db/queries/runs";
import { db, schema } from "@/lib/db";
import { desc, eq, and } from "drizzle-orm";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";
import { loadPilotRunReadiness } from "@/lib/release/pilot-run-evidence";
import { getAllEvents } from "@/lib/engine/events";
import { RunDetail } from "@/components/runs/run-detail";
import type { ClientRunEvent } from "@/lib/engine/event-types";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const user = await requireUser();
  const { runId } = await params;
  const scope = resolvePilotScope(user.id);
  const run = getRun(user.id, runId, scope);
  if (!run) notFound();

  const events: ClientRunEvent[] = getAllEvents(runId).map((e) => ({
    id: e.id,
    seq: e.seq,
    type: e.type,
    payload: e.payload,
  }));
  const artifacts = getRunArtifacts(runId, scope);
  const verificationAttestations = db
    .select()
    .from(schema.verificationAttestations)
    .where(and(eq(schema.verificationAttestations.runId, runId), eq(schema.verificationAttestations.tenantId, scope.tenantId), eq(schema.verificationAttestations.workspaceId, scope.workspaceId)))
    .orderBy(desc(schema.verificationAttestations.createdAt))
    .all();

  return (
    <RunDetail
      run={run}
      initialArtifacts={artifacts}
      initialEvents={events}
      initialVerificationAttestations={verificationAttestations}
      initialPilotReadiness={loadPilotRunReadiness({ runId, tenantId: scope.tenantId, workspaceId: scope.workspaceId })}
    />
  );
}
