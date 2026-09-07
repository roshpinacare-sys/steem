import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { PROVIDERS } from "@/lib/constants";
import { createId } from "@/lib/ids";
import { appendAudit } from "@/lib/engine/audit";
import { rowToModelProfile } from "@/lib/models/db-routing";
import { routeModel } from "@/lib/models/router";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";

export const runtime = "nodejs";

const score = z.number().min(0).max(1);
const profileSchema = z.object({
  provider: z.enum(PROVIDERS as [string, ...string[]]),
  model: z.string().min(1).max(160),
  displayName: z.string().min(1).max(160),
  enabled: z.boolean().default(true),
  local: z.boolean().default(false),
  license: z.string().max(160).optional(),
  contextTokens: z.number().int().min(1_000).max(10_000_000),
  supportsTools: z.boolean().default(true),
  supportsStructuredOutput: z.boolean().default(true),
  structuredOutputReliability: score,
  toolReliability: score,
  planningQuality: score,
  codeQuality: score,
  verificationQuality: score,
  healthState: z.enum(["healthy", "degraded", "unavailable"]).default("healthy"),
  availability: score,
  failureRate: score,
  latencyMs: z.number().int().min(0).max(3_600_000),
  costPerMillionInput: z.number().min(0).max(1_000_000),
  costPerMillionOutput: z.number().min(0).max(1_000_000),
  energyWhPerMillionTokens: z.number().min(0).max(10_000_000),
  privacyScore: score,
  sovereigntyScore: score,
  evaluationConfidence: score,
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  evaluatedAt: z.string().datetime().optional(),
});

const routeSchema = z.object({
  action: z.literal("route"),
  requiredPrivacy: z.enum(["public", "internal", "restricted"]).optional(),
  requiresOffline: z.boolean().optional(),
  requiresTools: z.boolean().optional(),
  requiresStructuredOutput: z.boolean().optional(),
  minimumContextTokens: z.number().int().min(1_000).max(10_000_000).optional(),
  maximumLatencyMs: z.number().int().min(0).max(3_600_000).optional(),
  maximumCostPerMillionTokens: z.number().min(0).max(1_000_000).optional(),
  minimumEvaluationConfidence: score.optional(),
  minimumPlanningQuality: score.optional(),
  minimumCodeQuality: score.optional(),
  minimumVerificationQuality: score.optional(),
  taskClass: z.enum(["planning", "coding", "verification", "tool", "general"]).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const scope = resolvePilotScope(session.user.id);
  const rows = db
    .select()
    .from(schema.modelProfiles)
    .where(
      or(
        eq(schema.modelProfiles.isBuiltin, true),
        and(
          eq(schema.modelProfiles.ownerId, session.user.id),
          eq(schema.modelProfiles.tenantId, scope.tenantId),
          eq(schema.modelProfiles.workspaceId, scope.workspaceId),
        ),
      ),
    )
    .all();
  return NextResponse.json({ profiles: rows.map(rowToModelProfile) });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const scope = resolvePilotScope(session.user.id);
  const raw = await req.json().catch(() => null);
  const routeRequest = routeSchema.safeParse(raw);
  if (routeRequest.success) {
    const profiles = db
      .select()
      .from(schema.modelProfiles)
      .where(
        and(
          eq(schema.modelProfiles.enabled, true),
          or(
            eq(schema.modelProfiles.isBuiltin, true),
            and(
              eq(schema.modelProfiles.ownerId, session.user.id),
              eq(schema.modelProfiles.tenantId, scope.tenantId),
              eq(schema.modelProfiles.workspaceId, scope.workspaceId),
            ),
          ),
        ),
      )
      .all()
      .map(rowToModelProfile);
    return NextResponse.json({ decision: routeModel(profiles, routeRequest.data) });
  }

  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid", details: parsed.error.flatten() }, { status: 400 });
  }
  const now = new Date();
  const row = db
    .insert(schema.modelProfiles)
    .values({
      id: createId(),
      ownerId: session.user.id,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      visibility: "private",
      provider: parsed.data.provider as never,
      model: parsed.data.model,
      displayName: parsed.data.displayName,
      enabled: parsed.data.enabled,
      isBuiltin: false,
      local: parsed.data.local,
      license: parsed.data.license ?? null,
      contextTokens: parsed.data.contextTokens,
      supportsTools: parsed.data.supportsTools,
      supportsStructuredOutput: parsed.data.supportsStructuredOutput,
      structuredOutputReliability: parsed.data.structuredOutputReliability,
      toolReliability: parsed.data.toolReliability,
      planningQuality: parsed.data.planningQuality,
      codeQuality: parsed.data.codeQuality,
      verificationQuality: parsed.data.verificationQuality,
      healthState: parsed.data.healthState,
      availability: parsed.data.availability,
      failureRate: parsed.data.failureRate,
      latencyMs: parsed.data.latencyMs,
      costPerMillionInput: parsed.data.costPerMillionInput,
      costPerMillionOutput: parsed.data.costPerMillionOutput,
      energyWhPerMillionTokens: parsed.data.energyWhPerMillionTokens,
      privacyScore: parsed.data.privacyScore,
      sovereigntyScore: parsed.data.sovereigntyScore,
      evaluationConfidence: parsed.data.evaluationConfidence,
      artifactHash: parsed.data.artifactHash ?? null,
      evaluatedAt: parsed.data.evaluatedAt ? new Date(parsed.data.evaluatedAt) : now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.modelProfiles.ownerId,
        schema.modelProfiles.provider,
        schema.modelProfiles.model,
      ],
      set: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        visibility: "private",
        displayName: parsed.data.displayName,
        enabled: parsed.data.enabled,
        local: parsed.data.local,
        license: parsed.data.license ?? null,
        contextTokens: parsed.data.contextTokens,
        supportsTools: parsed.data.supportsTools,
        supportsStructuredOutput: parsed.data.supportsStructuredOutput,
        structuredOutputReliability: parsed.data.structuredOutputReliability,
        toolReliability: parsed.data.toolReliability,
        planningQuality: parsed.data.planningQuality,
        codeQuality: parsed.data.codeQuality,
        verificationQuality: parsed.data.verificationQuality,
        healthState: parsed.data.healthState,
        availability: parsed.data.availability,
        failureRate: parsed.data.failureRate,
        latencyMs: parsed.data.latencyMs,
        costPerMillionInput: parsed.data.costPerMillionInput,
        costPerMillionOutput: parsed.data.costPerMillionOutput,
        energyWhPerMillionTokens: parsed.data.energyWhPerMillionTokens,
        privacyScore: parsed.data.privacyScore,
        sovereigntyScore: parsed.data.sovereigntyScore,
        evaluationConfidence: parsed.data.evaluationConfidence,
        artifactHash: parsed.data.artifactHash ?? null,
        evaluatedAt: parsed.data.evaluatedAt ? new Date(parsed.data.evaluatedAt) : now,
        updatedAt: now,
      },
    })
    .returning()
    .get();
  appendAudit({
    actorType: "user",
    actorId: session.user.id,
    action: "model_profile.upsert",
    subjectType: "model_profile",
    subjectId: row.id,
    payload: {
      provider: row.provider,
      model: row.model,
      evaluationConfidence: row.evaluationConfidence,
    },
  });
  return NextResponse.json({ profile: rowToModelProfile(row) }, { status: 201 });
}
