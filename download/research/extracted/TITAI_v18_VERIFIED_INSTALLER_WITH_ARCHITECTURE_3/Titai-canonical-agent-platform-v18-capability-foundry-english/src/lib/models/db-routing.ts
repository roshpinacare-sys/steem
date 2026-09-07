import "server-only";
import { and, eq, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ProviderName } from "@/lib/engine/types";
import {
  directModelProfile,
  routeModel,
  type ModelCapabilityProfile,
  type ModelRouteDecision,
  type ModelRoutingConstraints,
} from "./router";

export function rowToModelProfile(
  row: typeof schema.modelProfiles.$inferSelect,
): ModelCapabilityProfile {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    displayName: row.displayName,
    enabled: row.enabled,
    local: row.local,
    license: row.license ?? undefined,
    contextTokens: row.contextTokens,
    supportsTools: row.supportsTools,
    supportsStructuredOutput: row.supportsStructuredOutput,
    structuredOutputReliability: row.structuredOutputReliability,
    toolReliability: row.toolReliability,
    planningQuality: row.planningQuality,
    codeQuality: row.codeQuality,
    verificationQuality: row.verificationQuality,
    healthState: row.healthState,
    availability: row.availability,
    failureRate: row.failureRate,
    latencyMs: row.latencyMs,
    costPerMillionInput: row.costPerMillionInput,
    costPerMillionOutput: row.costPerMillionOutput,
    energyWhPerMillionTokens: row.energyWhPerMillionTokens,
    privacyScore: row.privacyScore,
    sovereigntyScore: row.sovereigntyScore,
    evaluationConfidence: row.evaluationConfidence,
    evaluatedAt: row.evaluatedAt?.toISOString(),
    artifactHash: row.artifactHash ?? undefined,
  };
}

export interface ModelProfileScope {
  tenantId: string;
  workspaceId: string;
}

export function listEligibleModelProfiles(
  userId: string,
  scope?: ModelProfileScope,
): ModelCapabilityProfile[] {
  return db
    .select()
    .from(schema.modelProfiles)
    .where(
      and(
        eq(schema.modelProfiles.enabled, true),
        or(
          eq(schema.modelProfiles.isBuiltin, true),
          scope
            ? and(
                eq(schema.modelProfiles.ownerId, userId),
                eq(schema.modelProfiles.tenantId, scope.tenantId),
                eq(schema.modelProfiles.workspaceId, scope.workspaceId),
              )
            : eq(schema.modelProfiles.ownerId, userId),
        ),
      ),
    )
    .all()
    .map(rowToModelProfile);
}

export function resolveModelRoute(options: {
  userId: string;
  requestedProvider: ProviderName;
  requestedModel: string;
  constraints?: Omit<ModelRoutingConstraints, "preferredProvider" | "preferredModel">;
  scope?: ModelProfileScope;
}): ModelRouteDecision {
  const profiles = listEligibleModelProfiles(options.userId, options.scope);
  const requestedModel = options.requestedModel ||
    (options.requestedProvider === "simulation" ? "sim-1" : "default");
  const direct = directModelProfile(options.requestedProvider, requestedModel, {
    evaluationConfidence: options.requestedProvider === "simulation" ? 1 : 0.15,
    availability: options.requestedProvider === "simulation" ? 1 : 0.6,
    planningQuality: options.requestedProvider === "simulation" ? 0.65 : 0.5,
    codeQuality: options.requestedProvider === "simulation" ? 0.6 : 0.5,
    verificationQuality: options.requestedProvider === "simulation" ? 0.7 : 0.5,
    latencyMs: options.requestedProvider === "simulation" ? 30 : 5_000,
  });
  const hasDirect = profiles.some(
    (candidate) =>
      candidate.provider === direct.provider && candidate.model === direct.model,
  );
  const candidates = hasDirect ? profiles : [...profiles, direct];
  return routeModel(candidates, {
    ...options.constraints,
    preferredProvider: options.requestedProvider,
    preferredModel: requestedModel,
    allowFallback: options.constraints?.allowFallback ?? true,
  });
}
