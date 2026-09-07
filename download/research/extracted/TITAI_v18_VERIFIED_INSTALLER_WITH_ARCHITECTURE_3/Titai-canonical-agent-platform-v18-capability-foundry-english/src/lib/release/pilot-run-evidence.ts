import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { evaluatePilotRunFacts, type PilotRunReadiness } from "./pilot-run-gates";

export function loadPilotRunReadiness(input: {
  runId: string;
  tenantId: string;
  workspaceId: string;
}): PilotRunReadiness {
  const run = db
    .select()
    .from(schema.runs)
    .where(
      and(
        eq(schema.runs.id, input.runId),
        eq(schema.runs.tenantId, input.tenantId),
        eq(schema.runs.workspaceId, input.workspaceId),
      ),
    )
    .get();
  if (!run) return evaluatePilotRunFacts({});
  const durableJob = db
    .select()
    .from(schema.durableJobs)
    .where(
      and(
        eq(schema.durableJobs.id, `durable:${input.runId}`),
        eq(schema.durableJobs.tenantId, input.tenantId),
        eq(schema.durableJobs.workspaceId, input.workspaceId),
      ),
    )
    .get();
  const receipts = durableJob
    ? db
        .select({ status: schema.durableReceipts.status })
        .from(schema.durableReceipts)
        .where(
          and(
            eq(schema.durableReceipts.jobId, durableJob.id),
            eq(schema.durableReceipts.tenantId, input.tenantId),
            eq(schema.durableReceipts.workspaceId, input.workspaceId),
          ),
        )
        .all()
    : [];
  const approvals = db
    .select({ status: schema.approvals.status })
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.runId, input.runId),
        eq(schema.approvals.tenantId, input.tenantId),
        eq(schema.approvals.workspaceId, input.workspaceId),
      ),
    )
    .all();
  const artifacts = db
    .select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .where(
      and(
        eq(schema.artifacts.runId, input.runId),
        eq(schema.artifacts.tenantId, input.tenantId),
        eq(schema.artifacts.workspaceId, input.workspaceId),
      ),
    )
    .all();
  const attestations = db
    .select({ status: schema.verificationAttestations.status, releaseCandidateHash: schema.verificationAttestations.releaseCandidateHash })
    .from(schema.verificationAttestations)
    .where(
      and(
        eq(schema.verificationAttestations.runId, input.runId),
        eq(schema.verificationAttestations.tenantId, input.tenantId),
        eq(schema.verificationAttestations.workspaceId, input.workspaceId),
      ),
    )
    .all();
  const events = db
    .select({ type: schema.runEvents.type, payload: schema.runEvents.payload })
    .from(schema.runEvents)
    .where(eq(schema.runEvents.runId, input.runId))
    .all();
  return evaluatePilotRunFacts({
    runStatus: run.status,
    tenantId: run.tenantId,
    workspaceId: run.workspaceId,
    runnerMode: run.runnerMode,
    durableJobStatus: durableJob?.status,
    durableReceiptStatuses: receipts.map((item) => item.status),
    approvalStatuses: approvals.map((item) => item.status),
    artifactCount: artifacts.length,
    acceptedVerificationCount: attestations.filter((item) => item.status === "accepted").length,
    releaseHashBound: attestations.some((item) => /^[a-f0-9]{64}$/i.test(item.releaseCandidateHash)),
    modelRoutingObserved: events.some((event) => event.type === "model.routed"),
    governedMemoryObserved: events.some((event) => event.type === "memory.selected"),
    capabilityDecisionObserved: events.some((event) => event.type === "tool.call" || event.type === "tool.result"),
    recoveryObserved: events.some((event) => event.type === "recovery.checkpoint"),
  });
}
