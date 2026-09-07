import "server-only";
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { runManager } from "./runner";
import { composeSystemPrompt, type InjectableSkill } from "./skills";
import { getAgentSkills, getCurrentVersion } from "@/lib/db/queries/agents";
import type { ProviderName } from "./types";
import type { AgentTier } from "@/lib/db/schema";
import { buildGovernedMemoryContext } from "@/lib/memory/prompt-context";
import { resolveModelRoute } from "@/lib/models/db-routing";
import { currentRunnerMode } from "./runner-mode";
import { resolvePilotScope } from "@/lib/auth/pilot-scope";

export interface StartRunRequest {
  userId: string;
  objective: string;
  agentId: string;
  providerOverride?: ProviderName;
  modelOverride?: string;
  dryRun?: boolean;
  idempotencyKey?: string;
  deadlineSeconds?: number;
  maxOutputTokens?: number;
  maxContextTokens?: number;
  useDurableRunner?: boolean;
  includeMemory?: boolean;
  tenantId?: string;
  workspaceId?: string;
}

export interface StartRunResult {
  ok: boolean;
  runId?: string;
  error?: string;
  reused?: boolean;
}

/**
 * Resolve an agent + its current version + attached skills into a concrete
 * run, snapshotting the exact skill versions injected, then launch it.
 */
export async function startAgentRun(
  req: StartRunRequest,
): Promise<StartRunResult> {
  let scope;
  try {
    scope = resolvePilotScope(req.userId, { tenantId: req.tenantId, workspaceId: req.workspaceId });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "pilot_scope_denied" };
  }
  const agent = db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, req.agentId))
    .get();
  if (!agent || agent.ownerId !== req.userId) {
    return { ok: false, error: "agent_not_found" };
  }
  if (agent.tenantId && agent.tenantId !== scope.tenantId) return { ok: false, error: "agent_tenant_mismatch" };
  if (agent.workspaceId && agent.workspaceId !== scope.workspaceId) return { ok: false, error: "agent_workspace_mismatch" };
  if (!agent.tenantId || !agent.workspaceId) {
    db.update(schema.agents)
      .set({ tenantId: scope.tenantId, workspaceId: scope.workspaceId })
      .where(eq(schema.agents.id, agent.id))
      .run();
  }
  const version = getCurrentVersion(agent);
  if (!version) return { ok: false, error: "agent_has_no_version" };

  // Resolve attached skills → concrete skill versions.
  const links = getAgentSkills(agent.id);
  const skillVersionIds: string[] = [];
  const injectable: InjectableSkill[] = [];
  if (links.length) {
    const skillIds = links.map((l) => l.skillId);
    const skillRows = db
      .select()
      .from(schema.skills)
      .where(inArray(schema.skills.id, skillIds))
      .all();
    for (const link of links) {
      const skill = skillRows.find((s) => s.id === link.skillId);
      if (!skill) continue;
      const versionId = link.pinnedVersionId ?? skill.currentVersionId;
      if (!versionId) continue;
      const sv = db
        .select()
        .from(schema.skillVersions)
        .where(eq(schema.skillVersions.id, versionId))
        .get();
      if (!sv) continue;
      skillVersionIds.push(sv.id);
      injectable.push({
        name: skill.name,
        description: skill.description,
        body: sv.body,
      });
    }
  }

  const maxContextTokens = req.maxContextTokens ?? 32_000;
  const baseSystemPrompt = composeSystemPrompt(version.systemPrompt, injectable);
  const requestedProvider = req.providerOverride ?? version.provider;
  const requestedModel = req.modelOverride ?? version.model;
  const routeDecision = resolveModelRoute({
    userId: req.userId,
    requestedProvider,
    requestedModel,
    scope: { tenantId: scope.tenantId, workspaceId: scope.workspaceId },
    constraints: {
      requiresTools: version.tools.length > 0,
      requiresStructuredOutput: true,
      minimumContextTokens: maxContextTokens,
      minimumEvaluationConfidence: 0,
      allowFallback: true,
    },
  });
  if (!routeDecision.selected) return { ok: false, error: "no_eligible_model" };

  const memoryBudget = Math.max(0, Math.min(4_000, Math.floor(maxContextTokens * 0.15)));
  const memoryCandidates = req.includeMemory === false || memoryBudget === 0
    ? []
    : db
        .select()
        .from(schema.memories)
        .where(
          and(
            eq(schema.memories.ownerId, req.userId),
            eq(schema.memories.tenantId, scope.tenantId),
            eq(schema.memories.workspaceId, scope.workspaceId),
            eq(schema.memories.status, "active"),
            or(isNull(schema.memories.expiresAt), gt(schema.memories.expiresAt, new Date())),
          ),
        )
        .orderBy(desc(schema.memories.updatedAt))
        .limit(200)
        .all();
  const memorySelection = buildGovernedMemoryContext(memoryCandidates, {
    query: req.objective,
    taskTags: [agent.tier, ...injectable.map((skill) => skill.name)],
    maxTokens: memoryBudget,
  });
  const systemPrompt = memorySelection.block
    ? `${baseSystemPrompt}\n\n${memorySelection.block}`
    : baseSystemPrompt;
  const provider = routeDecision.selected.provider;
  const model = routeDecision.selected.model;
  const runnerMode = currentRunnerMode();

  try {
    const { runId, reused } = await runManager.startRun({
    userId: req.userId,
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    objective: req.objective,
    agentId: agent.id,
    agentVersionId: version.id,
    agentName: agent.name,
    agentTier: agent.tier as AgentTier,
    systemPrompt,
    provider,
    model,
    temperature: version.temperature,
    maxSteps: version.maxSteps,
    maxToolIterations: version.maxToolIterations,
    tools: version.tools,
    skillVersionIds,
    dryRun: req.dryRun ?? false,
    idempotencyKey: req.idempotencyKey,
    deadlineAt: req.deadlineSeconds
      ? new Date(Date.now() + req.deadlineSeconds * 1000)
      : undefined,
    maxOutputTokens: req.maxOutputTokens ?? 4096,
    maxContextTokens,
    runnerMode,
    useDurableRunner: req.useDurableRunner ?? false,
    routingDecision: {
      selected: {
        provider,
        model,
        profileId: routeDecision.selected.id,
      },
      fallback: routeDecision.fallback
        ? {
            provider: routeDecision.fallback.provider,
            model: routeDecision.fallback.model,
            profileId: routeDecision.fallback.id,
          }
        : undefined,
      reason: routeDecision.reason,
      evaluatedAt: routeDecision.evaluatedAt,
    },
    memorySnapshot: memorySelection.selected.map(({ memory, score, estimatedTokens }) => ({
      id: memory.id,
      contentHash: memory.contentHash,
      score,
      estimatedTokens,
      kind: memory.kind,
      provenance: memory.provenance,
    })),
    memoryQuarantined: memorySelection.quarantined.map(({ memory, reasons }) => ({
      id: memory.id,
      contentHash: memory.contentHash,
      reasons,
    })),
    });
    return { ok: true, runId, reused };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "run_start_failed",
    };
  }
}
