import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { appendAudit } from "@/lib/engine/audit";
import { createVerificationAttestation } from "@/lib/verification/attestation";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";

export const runtime = "nodejs";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
const bodySchema = z.object({
  requirementRevision: z.string().min(1).max(200),
  taskRevision: z.string().min(1).max(200),
  sourceTreeHash: sha256,
  testCommand: z.string().min(1).max(2_000),
  testOutputHash: sha256,
  artifactHash: sha256.optional(),
  releaseCandidateHash: sha256,
  status: z.enum(["accepted", "rejected"]),
  limitations: z.array(z.string().min(1).max(1_000)).max(50).default([]),
});

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
  const run = db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.userId, session.user.id), eq(schema.runs.tenantId, scope.tenantId), eq(schema.runs.workspaceId, scope.workspaceId)))
    .get();
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const attestations = db
    .select()
    .from(schema.verificationAttestations)
    .where(and(eq(schema.verificationAttestations.runId, runId), eq(schema.verificationAttestations.tenantId, scope.tenantId), eq(schema.verificationAttestations.workspaceId, scope.workspaceId)))
    .orderBy(desc(schema.verificationAttestations.createdAt))
    .all();
  return NextResponse.json({ attestations });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { runId } = await params;
  const scope = resolvePilotScope(session.user.id);
  const run = db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.id, runId), eq(schema.runs.userId, session.user.id), eq(schema.runs.tenantId, scope.tenantId), eq(schema.runs.workspaceId, scope.workspaceId)))
    .get();
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const attestation = createVerificationAttestation({
    runId,
    ...parsed.data,
    builderIdentity: run.agentId ? `agent:${run.agentId}` : `run:${run.id}:builder`,
    verifierIdentity: `user:${session.user.id}`,
  });
  const row = db
    .insert(schema.verificationAttestations)
    .values({
      runId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      requirementRevision: attestation.requirementRevision,
      taskRevision: attestation.taskRevision,
      sourceTreeHash: attestation.sourceTreeHash,
      testCommand: attestation.testCommand,
      testOutputHash: attestation.testOutputHash,
      artifactHash: attestation.artifactHash ?? null,
      releaseCandidateHash: attestation.releaseCandidateHash,
      builderIdentity: attestation.builderIdentity,
      verifierIdentity: attestation.verifierIdentity,
      status: attestation.status,
      limitations: attestation.limitations,
      evidenceHash: attestation.evidenceHash,
      createdAt: new Date(attestation.createdAt),
    })
    .onConflictDoNothing({ target: schema.verificationAttestations.evidenceHash })
    .returning()
    .get();
  const persisted = row ?? db
    .select()
    .from(schema.verificationAttestations)
    .where(eq(schema.verificationAttestations.evidenceHash, attestation.evidenceHash))
    .get();
  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "verification.attest",
    subjectType: "run",
    subjectId: runId,
    payload: {
      status: attestation.status,
      evidenceHash: attestation.evidenceHash,
      sourceTreeHash: attestation.sourceTreeHash,
      releaseCandidateHash: attestation.releaseCandidateHash,
    },
  });
  return NextResponse.json({ attestation: persisted }, { status: row ? 201 : 200 });
}
