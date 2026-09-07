import "server-only";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { gateway } from "./gateway";
import { getTool, toolSpecs } from "./tools";
import { composeSystemPrompt, type InjectableSkill } from "./skills";
import { validateToolArguments } from "./tools/validate";
import { decideToolCapability } from "./tool-capability";
import { executeBoundedTool } from "./tool-runtime";
import { applyContextBudget } from "./context-budget";
import { emitRunEvent } from "./events";
import { appendAudit } from "./audit";
import {
  evaluatePolicies,
  type PolicyRow,
  type PolicyDecision,
} from "./policy";
import { createId } from "@/lib/ids";
import { createHash } from "node:crypto";
import type {
  ChatMessage,
  ProviderName,
  RiskLevel,
  SimulationScript,
  ToolCall,
  ToolContext,
} from "./types";
import { pickSimulationScript } from "./fixtures/simulation-scripts";
import type { RunnerMode } from "./runner-mode";
import { parseRunnerMode } from "./runner-mode";
import { runnerModeUsesDurableExecution, runnerModeUsesShadow } from "./runner-mode";
import { DurableWorkflowEngine } from "@/lib/durable/engine";
import { DurablePauseError } from "@/lib/durable/types";
import { createStepDurableWorkflow, type DurablePlanStepState } from "@/lib/durable/step-runner";
import { SqliteDurableStore } from "@/lib/durable/sqlite-store";
import { validateExecutionPlan, type ExecutionPlan } from "./plan";
import type { AgentTier, Approval, MemoryKind, Run, RunStep } from "@/lib/db/schema";
import {
  assertApprovalTransition,
  assertRunTransition,
  assertStepTransition,
  type ApprovalLifecycleState,
  type RunLifecycleState,
  type StepLifecycleState,
} from "@/lib/canonical/lifecycle";

export interface StartRunInput {
  userId: string;
  tenantId: string;
  workspaceId: string;
  objective: string;
  agentId?: string | null;
  agentVersionId?: string | null;
  agentName: string;
  agentTier: AgentTier;
  systemPrompt: string;
  provider: ProviderName;
  model: string;
  temperature: number;
  maxSteps: number;
  maxToolIterations: number;
  tools: string[];
  skillVersionIds: string[];
  dryRun: boolean;
  idempotencyKey?: string;
  deadlineAt?: Date;
  maxOutputTokens: number;
  maxContextTokens: number;
  runnerMode?: RunnerMode;
  useDurableRunner?: boolean;
  routingDecision?: {
    selected?: { provider: ProviderName; model: string; profileId?: string };
    fallback?: { provider: ProviderName; model: string; profileId?: string };
    reason: string;
    evaluatedAt: string;
  };
  memorySnapshot?: Array<{
    id: string;
    contentHash: string;
    score: number;
    estimatedTokens: number;
    kind: MemoryKind;
    provenance: unknown;
  }>;
  memoryQuarantined?: Array<{ id: string; contentHash: string; reasons: string[] }>;
}

interface ActiveRun {
  userId: string;
  abort: AbortController;
  pendingApproval?: {
    approvalId: string;
    resolve: (d: "approved" | "rejected") => void;
  };
}

class RunManager {
  private active = new Map<string, ActiveRun>();
  private recovering = new Set<string>();

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  async startRun(input: StartRunInput): Promise<{ runId: string; reused: boolean }> {
    const activeForUser = [...this.active.values()].filter(
      (entry) => entry.userId === input.userId,
    ).length;
    if (this.active.size >= 4) {
      throw new Error("global_active_run_limit_reached");
    }
    if (activeForUser >= 2) {
      throw new Error("user_active_run_limit_reached");
    }

    // BEGIN IMMEDIATE serializes competing creators on SQLite. This makes the
    // user-scoped idempotency contract deterministic across multiple workers,
    // rather than relying only on the process-local active map.
    const create = db.$client.transaction(() => {
      if (input.idempotencyKey) {
        const existing = db
          .select()
          .from(schema.runs)
          .where(
            and(
              eq(schema.runs.userId, input.userId),
              eq(schema.runs.idempotencyKey, input.idempotencyKey),
            ),
          )
          .get();
        if (existing) {
          const sameRequest =
            existing.objective === input.objective &&
            existing.tenantId === input.tenantId &&
            existing.workspaceId === input.workspaceId &&
            existing.agentId === (input.agentId ?? null) &&
            existing.provider === input.provider &&
            existing.model === input.model &&
            existing.dryRun === input.dryRun &&
            existing.maxOutputTokens === input.maxOutputTokens &&
            existing.maxContextTokens === input.maxContextTokens;
          if (!sameRequest) throw new Error("idempotency_key_conflict");
          return { run: existing, reused: true as const };
        }
      }

      const run = db
        .insert(schema.runs)
        .values({
          agentId: input.agentId ?? null,
          agentVersionId: input.agentVersionId ?? null,
          agentName: input.agentName,
          agentTier: input.agentTier,
          skillVersionIds: input.skillVersionIds,
          userId: input.userId,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          visibility: "private",
          idempotencyKey: input.idempotencyKey ?? null,
          objective: input.objective,
          status: "queued",
          provider: input.provider,
          model: input.model,
          dryRun: input.dryRun,
          maxOutputTokens: input.maxOutputTokens,
          maxContextTokens: input.maxContextTokens,
          deadlineAt: input.deadlineAt ?? null,
          runnerMode: input.runnerMode ?? "legacy",
          routingDecision: input.routingDecision ?? null,
          memorySnapshot: input.memorySnapshot ?? [],
        })
        .returning()
        .get();
      return { run, reused: false as const };
    });
    const created = create.immediate();
    if (created.reused) return { runId: created.run.id, reused: true };

    const controller = new AbortController();
    this.active.set(created.run.id, { userId: input.userId, abort: controller });

    if (runnerModeUsesDurableExecution(input.runnerMode ?? "legacy", input.useDurableRunner)) {
      if (input.provider !== "simulation" && !input.dryRun) {
        this.active.delete(created.run.id);
        transitionRun(created.run.id, "failed", {
          error: "durable_cutover_requires_simulation_or_dry_run",
          finishedAt: new Date(),
        });
        throw new Error("durable_cutover_requires_simulation_or_dry_run");
      }
      void this.executeDurableEnvelope(created.run.id, input).catch((err) => {
        console.error(`[titai] durable run ${created.run.id} crashed:`, err);
      });
    } else {
      if (runnerModeUsesShadow(input.runnerMode ?? "legacy")) this.createShadowRecord(created.run.id, input);
      void this.executeRun(created.run.id, input).catch((err) => {
        console.error(`[titai] run ${created.run.id} crashed:`, err);
      });
    }

    return { runId: created.run.id, reused: false };
  }


  async recoverDurableRuns(userId: string): Promise<number> {
    const store = new SqliteDurableStore();
    const now = Date.now();
    const jobs = await store.listJobs();
    let scheduled = 0;
    for (const job of jobs) {
      if (job.workflowName !== "agent_run_steps_v2") continue;
      if (!["queued", "leased"].includes(job.status)) continue;
      if (new Date(job.availableAt).getTime() > now) continue;
      if (job.lease && new Date(job.lease.expiresAt).getTime() > now) continue;
      const payload = job.payload as { runId?: unknown };
      if (typeof payload.runId !== "string") continue;
      const runId = payload.runId;
      if (this.active.has(runId) || this.recovering.has(runId)) continue;
      const input = this.rebuildStartRunInput(runId, userId);
      if (!input) continue;
      if (input.provider !== "simulation" && !input.dryRun) continue;
      this.recovering.add(runId);
      this.active.set(runId, { userId, abort: new AbortController() });
      scheduled += 1;
      void this.executeDurableEnvelope(runId, input)
        .catch((error) => {
          console.error(`[titai] durable recovery ${runId} failed:`, error);
        })
        .finally(() => this.recovering.delete(runId));
    }
    return scheduled;
  }

  private rebuildStartRunInput(runId: string, userId: string): StartRunInput | undefined {
    const run = db
      .select()
      .from(schema.runs)
      .where(and(eq(schema.runs.id, runId), eq(schema.runs.userId, userId)))
      .get();
    if (!run || !run.agentVersionId) return undefined;
    const version = db
      .select()
      .from(schema.agentVersions)
      .where(eq(schema.agentVersions.id, run.agentVersionId))
      .get();
    if (!version) return undefined;
    const skillVersions = run.skillVersionIds.length
      ? db
          .select()
          .from(schema.skillVersions)
          .where(inArray(schema.skillVersions.id, run.skillVersionIds))
          .all()
      : [];
    const skillIds = [...new Set(skillVersions.map((item) => item.skillId))];
    const skills = skillIds.length
      ? db.select().from(schema.skills).where(inArray(schema.skills.id, skillIds)).all()
      : [];
    const injectable: InjectableSkill[] = skillVersions.map((item) => {
      const skill = skills.find((candidate) => candidate.id === item.skillId);
      return {
        name: skill?.name ?? `Skill ${item.skillId}`,
        description: skill?.description ?? "Recovered pinned skill version.",
        body: item.body,
      };
    });
    return {
      userId,
      tenantId: run.tenantId ?? `tenant-${userId}`,
      workspaceId: run.workspaceId ?? `workspace-${userId}`,
      objective: run.objective,
      agentId: run.agentId,
      agentVersionId: run.agentVersionId,
      agentName: run.agentName,
      agentTier: run.agentTier,
      systemPrompt: composeSystemPrompt(version.systemPrompt, injectable),
      provider: run.provider,
      model: run.model,
      temperature: version.temperature,
      maxSteps: version.maxSteps,
      maxToolIterations: version.maxToolIterations,
      tools: version.tools,
      skillVersionIds: run.skillVersionIds,
      dryRun: run.dryRun,
      deadlineAt: run.deadlineAt ?? undefined,
      maxOutputTokens: run.maxOutputTokens,
      maxContextTokens: run.maxContextTokens,
      runnerMode: parseRunnerMode(run.runnerMode),
      useDurableRunner: true,
      routingDecision: run.routingDecision ?? undefined,
      memorySnapshot: run.memorySnapshot,
      memoryQuarantined: [],
    };
  }

  async resolveApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    userId: string,
    reason?: string,
    expectedRevision?: number,
  ): Promise<boolean> {
    const approval = db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, approvalId))
      .get();
    if (!approval || approval.status !== "pending") return false;
    if (expectedRevision !== undefined && approval.revision !== expectedRevision) {
      throw new Error("approval_revision_conflict");
    }
    const ownedRun = db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, approval.runId))
      .get();
    if (!ownedRun || ownedRun.userId !== userId) return false;

    const revision = transitionApproval(approvalId, decision, {
      reason: reason ?? null,
      resolvedBy: userId,
      resolvedAt: new Date(),
    }, expectedRevision);

    emitRunEvent(approval.runId, "approval.resolved", {
      approvalId,
      decision,
      reason,
      toolName: approval.toolName,
      revision,
    });
    appendAudit({
      actorType: "user",
      actorId: userId,
      action: "approval.resolve",
      subjectType: "approval",
      subjectId: approvalId,
      payload: { decision, reason, toolName: approval.toolName },
    });

    const entry = this.active.get(approval.runId);
    if (entry?.pendingApproval?.approvalId === approvalId) {
      transitionRun(approval.runId, "running");
      entry.pendingApproval.resolve(decision);
      entry.pendingApproval = undefined;
      return true;
    }

    const durableJobId = approval.durableJobId ?? `durable:${approval.runId}`;
    const durableJob = db
      .select()
      .from(schema.durableJobs)
      .where(eq(schema.durableJobs.id, durableJobId))
      .get();
    if (durableJob) {
      const now = new Date();
      if (decision === "approved") {
        const currentRun = db.select().from(schema.runs).where(eq(schema.runs.id, approval.runId)).get();
        if (currentRun?.status === "awaiting_approval") transitionRun(approval.runId, "running");
        db.update(schema.durableJobs)
          .set({
            status: "queued",
            availableAt: now,
            leaseOwner: null,
            leaseAcquiredAt: null,
            leaseHeartbeatAt: null,
            leaseExpiresAt: null,
            updatedAt: now,
            version: durableJob.version + 1,
          })
          .where(eq(schema.durableJobs.id, durableJobId))
          .run();
        void this.recoverDurableRuns(userId);
      } else {
        const currentRun = db.select().from(schema.runs).where(eq(schema.runs.id, approval.runId)).get();
        if (currentRun?.status === "awaiting_approval") {
          transitionRun(approval.runId, "failed", { error: "approval_rejected", finishedAt: now });
        }
        db.update(schema.durableJobs)
          .set({ status: "failed", error: "approval_rejected", updatedAt: now, version: durableJob.version + 1 })
          .where(eq(schema.durableJobs.id, durableJobId))
          .run();
      }
      return true;
    }

    // Legacy runs still depend on a process-local continuation.
    transitionRun(approval.runId, "interrupted", { finishedAt: new Date() });
    return true;
  }

  async cancelRun(runId: string, userId: string): Promise<boolean> {
    const entry = this.active.get(runId);
    const run = db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .get();
    if (!run || run.userId !== userId) return false;
    if (["completed", "failed", "cancelled"].includes(run.status)) return false;

    if (entry) {
      entry.abort.abort();
      entry.pendingApproval?.resolve("rejected");
      entry.pendingApproval = undefined;
    }
    transitionRun(runId, "cancelled", { finishedAt: new Date() });
    emitRunEvent(runId, "run.cancelled", {});
    appendAudit({
      actorType: "user",
      actorId: run.userId,
      action: "run.cancel",
      subjectType: "run",
      subjectId: runId,
    });
    return true;
  }

  private createShadowRecord(runId: string, input: StartRunInput): void {
    const now = new Date();
    db.insert(schema.durableJobs)
      .values({
        id: `shadow:${runId}`,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        workflowName: "agent_run_shadow_v1",
        payload: {
          runId,
          objectiveHash: createHash("sha256").update(input.objective).digest("hex"),
          provider: input.provider,
          model: input.model,
        },
        status: "queued",
        checkpoint: { nextStepIndex: 0, outputs: {}, completedStepIds: [], revision: 0 },
        attempt: 0,
        maxAttempts: 1,
        availableAt: now,
        version: 0,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: schema.durableJobs.id })
      .run();
  }

  private completeShadowRecord(runId: string, terminalStatus: string): void {
    const row = db
      .select()
      .from(schema.durableJobs)
      .where(eq(schema.durableJobs.id, `shadow:${runId}`))
      .get();
    if (!row) return;
    db.update(schema.durableJobs)
      .set({
        status: terminalStatus === "completed" ? "completed" : "failed",
        result: { runId, terminalStatus },
        checkpoint: {
          nextStepIndex: 1,
          outputs: { terminalStatus },
          completedStepIds: ["observe_legacy_run"],
          revision: row.checkpoint.revision + 1,
        },
        updatedAt: new Date(),
        version: row.version + 1,
      })
      .where(eq(schema.durableJobs.id, row.id))
      .run();
  }

  private async executeDurableEnvelope(runId: string, input: StartRunInput): Promise<void> {
    const existingEntry = this.active.get(runId);
    if (!existingEntry) {
      this.active.set(runId, { userId: input.userId, abort: new AbortController() });
    }
    const entry = this.active.get(runId)!;
    const remainingMs = input.deadlineAt
      ? Math.max(1, input.deadlineAt.getTime() - Date.now())
      : undefined;
    const signal = remainingMs
      ? AbortSignal.any([entry.abort.signal, AbortSignal.timeout(remainingMs)])
      : entry.abort.signal;
    const creds = await resolveCreds(input.userId, input.provider, input.model);
    const simulationScript = input.provider === "simulation"
      ? pickSimulationScript(input.objective)
      : undefined;
    const store = new SqliteDurableStore();

    const adapter = {
      initialize: async () => {
        const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
        if (!run) throw new Error(`run_not_found:${runId}`);
        if (["completed", "failed", "cancelled"].includes(run.status)) return;
        if (run.status === "awaiting_approval") {
          const approval = db
            .select()
            .from(schema.approvals)
            .where(eq(schema.approvals.runId, runId))
            .orderBy(schema.approvals.requestedAt)
            .all()
            .at(-1);
          if (!approval || approval.status === "pending") {
            const retryAfterMs = approval
              ? Math.max(1_000, approval.expiresAt.getTime() - Date.now())
              : 60_000;
            throw new DurablePauseError("approval_pending", retryAfterMs);
          }
          if (approval.status === "approved") {
            transitionRun(runId, "running");
          } else {
            transitionRun(runId, "failed", { error: `approval_${approval.status}`, finishedAt: new Date() });
            throw new Error(`approval_${approval.status}`);
          }
        }
        if (run.status === "queued") {
          transitionRun(runId, "running", { startedAt: new Date() });
          const objectiveHash = createHash("sha256").update(input.objective).digest("hex");
          emitRunEvent(runId, "run.started", {
            objectiveHash,
            objectiveChars: input.objective.length,
            agentName: input.agentName,
            agentTier: input.agentTier,
            provider: input.provider,
            model: creds.model,
            systemPromptHash: createHash("sha256").update(input.systemPrompt).digest("hex"),
            systemPromptChars: input.systemPrompt.length,
            dryRun: input.dryRun,
            deadlineAt: input.deadlineAt?.toISOString() ?? null,
            maxOutputTokens: input.maxOutputTokens,
            maxContextTokens: input.maxContextTokens,
          });
          emitRunEvent(runId, "model.routed", input.routingDecision ?? {
            selected: { provider: input.provider, model: input.model },
            reason: "Direct durable selection; no measured profile was supplied.",
            evaluatedAt: new Date().toISOString(),
          });
          emitRunEvent(runId, "memory.selected", {
            selected: input.memorySnapshot ?? [],
            quarantined: input.memoryQuarantined ?? [],
            selectedCount: input.memorySnapshot?.length ?? 0,
            quarantinedCount: input.memoryQuarantined?.length ?? 0,
            policy: "governed_memory_v1",
          });
          appendAudit({
            actorType: "user",
            actorId: input.userId,
            action: "run.start",
            subjectType: "run",
            subjectId: runId,
            payload: { objectiveHash, objectiveChars: input.objective.length, provider: input.provider },
          });
        }
      },
      loadOrCreatePlan: async () => {
        const existing = db
          .select()
          .from(schema.runSteps)
          .where(eq(schema.runSteps.runId, runId))
          .orderBy(schema.runSteps.idx)
          .all();
        if (existing.length) {
          return existing.map((step) => ({ id: step.id, dependsOn: step.dependsOn.map((name) => {
            const dependency = existing.find((candidate) => candidate.name === name);
            if (!dependency) throw new Error(`persisted_plan_missing_dependency:${step.id}:${name}`);
            return dependency.id;
          }) }));
        }
        const plan = await this.makePlan(runId, input, creds, simulationScript, signal);
        const rows = db.$client.transaction(() => plan.steps.map((step, idx) => db
          .insert(schema.runSteps)
          .values({
            runId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            idx,
            name: step.name,
            description: step.description ?? "",
            dependsOn: (step.dependsOn ?? []).filter((dependency) =>
              plan.steps.some((candidate) => candidate.name === dependency),
            ),
            status: "pending",
          })
          .returning()
          .get())).immediate();
        emitRunEvent(runId, "plan.created", {
          steps: rows.map((step) => ({
            id: step.id,
            name: step.name,
            description: step.description,
            dependsOn: step.dependsOn,
          })),
        });
        return rows.map((step) => ({
          id: step.id,
          dependsOn: step.dependsOn.map((name) => {
            const dependency = rows.find((candidate) => candidate.name === name);
            if (!dependency) throw new Error(`persisted_plan_missing_dependency:${step.id}:${name}`);
            return dependency.id;
          }),
        }));
      },
      getStepState: async (stepId: string): Promise<DurablePlanStepState> => {
        const step = db.select().from(schema.runSteps).where(eq(schema.runSteps.id, stepId)).get();
        if (!step) throw new Error(`run_step_not_found:${stepId}`);
        return step.status as DurablePlanStepState;
      },
      recoverRunningStep: async (stepId: string) => {
        const step = db.select().from(schema.runSteps).where(eq(schema.runSteps.id, stepId)).get();
        if (!step) throw new Error(`run_step_not_found:${stepId}`);
        if (step.status === "running") {
          transitionStep(stepId, "retrying", {
            error: "Recovered after worker lease loss before a durable checkpoint.",
          });
          emitRunEvent(runId, "recovery.checkpoint", {
            stepId,
            recovery: "running_to_retrying",
          });
        }
      },
      executeStep: async (stepId: string) => {
        const step = db.select().from(schema.runSteps).where(eq(schema.runSteps.id, stepId)).get();
        if (!step) throw new Error(`run_step_not_found:${stepId}`);
        if (step.status === "completed") {
          return { stepId, ok: true, output: step.output ?? undefined };
        }
        if (!["pending", "retrying"].includes(step.status)) {
          return { stepId, ok: false, error: `step_not_executable:${step.status}` };
        }
        let tokensIn = 0;
        let tokensOut = 0;
        const ok = await this.executeStep(
          runId,
          step,
          input,
          creds,
          simulationScript,
          signal,
          (inputTokens, outputTokens) => {
            tokensIn += inputTokens;
            tokensOut += outputTokens;
          },
        );
        if (tokensIn || tokensOut) {
          const current = db
            .select({ tokenUsage: schema.runs.tokenUsage })
            .from(schema.runs)
            .where(eq(schema.runs.id, runId))
            .get();
          db.update(schema.runs)
            .set({
              tokenUsage: {
                input: (current?.tokenUsage.input ?? 0) + tokensIn,
                output: (current?.tokenUsage.output ?? 0) + tokensOut,
              },
            })
            .where(eq(schema.runs.id, runId))
            .run();
        }
        const refreshed = db.select().from(schema.runSteps).where(eq(schema.runSteps.id, stepId)).get();
        return {
          stepId,
          ok,
          output: refreshed?.output ?? undefined,
          error: refreshed?.error ?? undefined,
        };
      },
      finalize: async (_payload: { runId: string }, summary: { completed: string[]; failed: string[]; blocked: string[] }) => {
        const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
        if (!run) throw new Error(`run_not_found:${runId}`);
        if (["completed", "failed", "cancelled"].includes(run.status)) {
          return { runId, terminalStatus: run.status, completedStepIds: summary.completed };
        }
        const failed = summary.failed.length > 0 || summary.blocked.length > 0;
        const next = failed ? "failed" : "completed";
        transitionRun(runId, next, { finishedAt: new Date() });
        const updated = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
        emitRunEvent(runId, failed ? "run.failed" : "run.completed", {
          tokenUsage: updated?.tokenUsage ?? { input: 0, output: 0 },
          durableStepIds: summary.completed,
        });
        appendAudit({
          actorType: "agent",
          actorId: input.agentId ?? null,
          action: failed ? "run.fail" : "run.complete",
          subjectType: "run",
          subjectId: runId,
          payload: { execution: "step_durable_v2" },
        });
        return { runId, terminalStatus: next, completedStepIds: summary.completed };
      },
    };

    const workflow = createStepDurableWorkflow(adapter, input.maxSteps);
    const engine = new DurableWorkflowEngine(store, workflow);
    const durableJobId = `durable:${runId}`;
    const existing = await store.getJob(durableJobId);
    if (!existing) {
      await engine.createJob({ id: durableJobId, payload: { runId }, tenantId: input.tenantId, workspaceId: input.workspaceId, maxAttempts: Math.max(3, input.maxSteps + 2) });
      emitRunEvent(runId, "runner.mode", {
        mode: input.runnerMode ?? "legacy",
        durableJobId,
        execution: "step_durable_v2",
        scope: "simulation_or_dry_run",
        limitations: [
          "External non-idempotent tools remain blocked from durable cutover.",
          "Human approval continuation is persisted separately but not yet resumed inside a model conversation.",
        ],
      });
    }

    try {
      const outcome = await engine.run(durableJobId, {
        workerId: `web:${process.pid}`,
        leaseMs: Math.max(
          60_000,
          (input.deadlineAt?.getTime() ?? Date.now() + 60_000) - Date.now() + 5_000,
        ),
        signal,
      });
      if (outcome.status === "waiting") {
        emitRunEvent(runId, "recovery.checkpoint", {
          durableJobId,
          recovery: "approval_wait_persisted",
          reason: outcome.reason,
        });
      } else if (outcome.status === "needs_reconciliation") {
        const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
        if (run && !["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
          transitionRun(runId, "interrupted", {
            error: "durable_step_requires_reconciliation",
            finishedAt: new Date(),
          });
          emitRunEvent(runId, "run.interrupted", {
            reason: "durable_step_requires_reconciliation",
            durableJobId,
          });
        }
      } else if (outcome.status === "failed") {
        const run = db.select().from(schema.runs).where(eq(schema.runs.id, runId)).get();
        if (run && !["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
          transitionRun(runId, "failed", { error: outcome.error, finishedAt: new Date() });
          emitRunEvent(runId, "run.failed", { error: outcome.error, durableJobId });
        }
      }
    } finally {
      const run = db.select({ status: schema.runs.status }).from(schema.runs).where(eq(schema.runs.id, runId)).get();
      if (run && ["completed", "failed", "cancelled", "interrupted"].includes(run.status)) {
        this.active.delete(runId);
      }
    }
  }

  // ─── internal ──────────────────────────────────────────────────────────

  private async executeRun(runId: string, input: StartRunInput): Promise<void> {
    const entry = this.active.get(runId)!;
    const userSignal = entry.abort.signal;
    const remainingMs = input.deadlineAt
      ? Math.max(1, input.deadlineAt.getTime() - Date.now())
      : undefined;
    const signal = remainingMs
      ? AbortSignal.any([userSignal, AbortSignal.timeout(remainingMs)])
      : userSignal;
    const simulationScript =
      input.provider === "simulation"
        ? pickSimulationScript(input.objective)
        : undefined;

    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const creds = await resolveCreds(input.userId, input.provider, input.model);
      transitionRun(runId, "running", { startedAt: new Date() });
      const objectiveHash = createHash("sha256").update(input.objective).digest("hex");
      emitRunEvent(runId, "run.started", {
        objectiveHash,
        objectiveChars: input.objective.length,
        agentName: input.agentName,
        agentTier: input.agentTier,
        provider: input.provider,
        model: creds.model,
        systemPromptHash: createHash("sha256").update(input.systemPrompt).digest("hex"),
        systemPromptChars: input.systemPrompt.length,
        dryRun: input.dryRun,
        deadlineAt: input.deadlineAt?.toISOString() ?? null,
        maxOutputTokens: input.maxOutputTokens,
        maxContextTokens: input.maxContextTokens,
      });
      emitRunEvent(runId, "model.routed", input.routingDecision ?? {
        selected: { provider: input.provider, model: input.model },
        reason: "Direct legacy selection; no measured profile was supplied.",
        evaluatedAt: new Date().toISOString(),
      });
      emitRunEvent(runId, "memory.selected", {
        selected: input.memorySnapshot ?? [],
        quarantined: input.memoryQuarantined ?? [],
        selectedCount: input.memorySnapshot?.length ?? 0,
        quarantinedCount: input.memoryQuarantined?.length ?? 0,
        policy: "governed_memory_v1",
      });
      if (!runnerModeUsesDurableExecution(input.runnerMode ?? "legacy", input.useDurableRunner)) {
        emitRunEvent(runId, "runner.mode", {
          mode: input.runnerMode ?? "legacy",
          durableRequested: input.useDurableRunner,
          execution: "legacy",
        });
      }

      appendAudit({
        actorType: "user",
        actorId: input.userId,
        action: "run.start",
        subjectType: "run",
        subjectId: runId,
        payload: {
          objectiveHash,
          objectiveChars: input.objective.length,
          provider: input.provider,
        },
      });

      // ─── PLAN ─────────────────────────────────────────────────────────
      const plan = await this.makePlan(runId, input, creds, simulationScript, signal);
      const stepRows = plan.steps.map((s, idx) =>
        db
          .insert(schema.runSteps)
          .values({
            runId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            idx,
            name: s.name,
            description: s.description ?? "",
            dependsOn: (s.dependsOn ?? []).filter((d) =>
              plan.steps.some((x) => x.name === d),
            ),
            status: "pending",
          })
          .returning()
          .get(),
      );
      emitRunEvent(runId, "plan.created", {
        steps: stepRows.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          dependsOn: s.dependsOn,
        })),
      });

      // ─── EXECUTE (dependency waves) ───────────────────────────────────
      const done = new Set<string>();
      let failed = false;

      while (done.size < stepRows.length) {
        assertRunCanContinue(signal, userSignal, input.deadlineAt);
        const ready = stepRows.filter(
          (s) =>
            !done.has(s.name) &&
            s.status !== "failed" &&
            s.dependsOn.every((d) => done.has(d)),
        );
        if (ready.length === 0) {
          failed = true;
          for (const blocked of stepRows.filter((s) => !done.has(s.name))) {
            if (blocked.status === "pending") {
              transitionStep(blocked.id, "blocked", {
                error: "No dependency-ready step remained.",
                finishedAt: new Date(),
              });
            }
          }
          break;
        }

        for (const step of ready) {
          assertRunCanContinue(signal, userSignal, input.deadlineAt);
          const ok = await this.executeStep(
            runId,
            step,
            input,
            creds,
            simulationScript,
            signal,
            (i, o) => {
              tokensIn += i;
              tokensOut += o;
            },
          );
          done.add(step.name);
          if (!ok) {
            failed = true;
            break;
          }
        }
        if (failed) break;
      }

      assertRunCanContinue(signal, userSignal, input.deadlineAt);

      transitionRun(runId, failed ? "failed" : "completed", {
        finishedAt: new Date(),
        tokenUsage: { input: tokensIn, output: tokensOut },
      });
      emitRunEvent(runId, failed ? "run.failed" : "run.completed", {
        tokenUsage: { input: tokensIn, output: tokensOut },
      });
      appendAudit({
        actorType: "agent",
        actorId: input.agentId ?? null,
        action: failed ? "run.fail" : "run.complete",
        subjectType: "run",
        subjectId: runId,
      });
      if (runnerModeUsesShadow(input.runnerMode ?? "legacy")) {
        this.completeShadowRecord(runId, failed ? "failed" : "completed");
      }
    } catch (err) {
      if (userSignal.aborted) return; // cancel path already recorded
      const message = err instanceof Error ? err.message : "Run failed";
      transitionRun(runId, "failed", { error: message, finishedAt: new Date() });
      emitRunEvent(runId, "run.failed", { error: message });
      if (runnerModeUsesShadow(input.runnerMode ?? "legacy")) this.completeShadowRecord(runId, "failed");
    } finally {
      this.active.delete(runId);
    }
  }

  private async makePlan(
    runId: string,
    input: StartRunInput,
    creds: ResolvedCreds,
    simulationScript: SimulationScript | undefined,
    signal: AbortSignal,
  ): Promise<ExecutionPlan> {
    const planPrompt =
      "Break the objective into a short ordered list of steps (2-5). " +
      "Respond ONLY with JSON: {\"steps\":[{\"name\":\"short_id\",\"description\":\"...\",\"dependsOn\":[]}]}.";
    const messages: ChatMessage[] = [
      { role: "system", content: input.systemPrompt },
      {
        role: "user",
        content: `Objective: ${input.objective}\n\n${planPrompt}`,
      },
    ];
    if (input.provider === "simulation") {
      messages.push({ role: "user", content: `__SIM__${JSON.stringify({ mode: "plan" })}` });
    }

    const attempt = async (): Promise<ExecutionPlan | null> => {
      const res = await gateway.chat({
        provider: input.provider,
        model: creds.model,
        messages: applyContextBudget(messages, input.maxContextTokens * 4).messages,
        temperature: 0.3,
        stream: false,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        simulationScript,
        signal,
        maxOutputTokens: Math.min(1024, input.maxOutputTokens),
      });
      if (!res.ok) return null;
      const parsed = extractJson(res.output);
      try {
        return validateExecutionPlan(parsed, input.maxSteps);
      } catch {
        return null;
      }
    };

    let plan = await attempt();
    if (!plan) {
      messages.push({
        role: "user",
        content: "That was not valid JSON. Respond with ONLY the JSON object.",
      });
      plan = await attempt();
    }
    if (!plan) {
      // Degrade to a single step — a run must never fail on plan parsing.
      plan = {
        steps: [
          { name: "execute", description: input.objective, dependsOn: [] },
        ],
      };
    }
    return plan;
  }

  private async executeStep(
    runId: string,
    step: RunStep,
    input: StartRunInput,
    creds: ResolvedCreds,
    simulationScript: SimulationScript | undefined,
    signal: AbortSignal,
    addTokens: (i: number, o: number) => void,
  ): Promise<boolean> {
    transitionStep(step.id, "running", { startedAt: new Date() });
    emitRunEvent(runId, "step.started", {
      stepId: step.id,
      name: step.name,
      description: step.description,
    });

    const conversation: ChatMessage[] = [
      { role: "system", content: input.systemPrompt },
      {
        role: "user",
        content: `Overall objective: ${input.objective}\n\nCurrent step: ${step.name} — ${step.description}`,
      },
    ];

    const toolNames = input.tools;
    let lastText = "";

    let exhaustedWithToolCalls = false;

    for (let iter = 0; iter < input.maxToolIterations; iter++) {
      assertRunCanContinue(signal, this.active.get(runId)!.abort.signal, input.deadlineAt);

      const messages = [...conversation];
      if (input.provider === "simulation") {
        messages.push({
          role: "user",
          content: `__SIM__${JSON.stringify({ mode: "step", step: step.name, iteration: iter })}`,
        });
      }

      const buffer = new DeltaBuffer(runId, step.id);
      let usageReportedByEvent = false;
      const res = await gateway.chat({
        provider: input.provider,
        model: creds.model,
        messages: applyContextBudget(messages, input.maxContextTokens * 4).messages,
        tools: toolNames.length ? toolSpecs(toolNames) : undefined,
        temperature: input.temperature,
        stream: true,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        simulationScript,
        simulationDelayMs: input.provider === "simulation" ? 22 : undefined,
        signal,
        maxOutputTokens: input.maxOutputTokens,
        onEvent: (e) => {
          if (e.type === "delta") buffer.push(e.text);
          if (e.type === "usage") {
            usageReportedByEvent = true;
            addTokens(e.input, e.output);
          }
        },
      });
      buffer.flush();
      if (res.usage && !usageReportedByEvent) {
        addTokens(res.usage.input, res.usage.output);
      }

      if (!res.ok) {
        transitionStep(step.id, "failed", {
          error: res.error,
          finishedAt: new Date(),
        });
        emitRunEvent(runId, "step.failed", { stepId: step.id, error: res.error });
        return false;
      }

      if (res.output) {
        lastText = res.output;
        emitRunEvent(runId, "assistant.message", {
          stepId: step.id,
          text: res.output,
        });
      }

      if (res.toolCalls.length === 0) {
        exhaustedWithToolCalls = false;
        break; // step produced final text
      }
      exhaustedWithToolCalls = iter === input.maxToolIterations - 1;

      // Assistant turn that requested tools.
      conversation.push({
        role: "assistant",
        content: res.output,
        toolCalls: res.toolCalls,
      });

      for (const toolCall of res.toolCalls) {
        assertRunCanContinue(signal, this.active.get(runId)!.abort.signal, input.deadlineAt);
        const toolMessage = await this.handleToolCall(
          runId,
          step,
          input,
          toolCall,
          signal,
        );
        conversation.push(toolMessage);
        if (toolMessage.content.includes('"__run_cancelled__"')) return false;
      }
    }

    if (exhaustedWithToolCalls) {
      const error = `Tool-iteration budget exhausted after ${input.maxToolIterations} iterations.`;
      transitionStep(step.id, "failed", { error, finishedAt: new Date() });
      emitRunEvent(runId, "step.failed", { stepId: step.id, error });
      return false;
    }

    transitionStep(step.id, "completed", {
      output: lastText,
      finishedAt: new Date(),
    });
    emitRunEvent(runId, "step.completed", { stepId: step.id, output: lastText });
    return true;
  }

  private async handleToolCall(
    runId: string,
    step: RunStep,
    input: StartRunInput,
    toolCall: ToolCall,
    signal: AbortSignal,
  ): Promise<ChatMessage> {
    const tool = getTool(toolCall.name);
    const risk: RiskLevel = tool?.risk ?? "high";

    emitRunEvent(runId, "tool.call", {
      stepId: step.id,
      toolCallId: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      risk,
      capability: {
        schemaVersion: tool?.schemaVersion ?? null,
        effect: tool?.effect ?? "unknown",
        idempotency: tool?.idempotency ?? "unknown",
        network: tool?.network ?? false,
        filesystem: tool?.filesystem ?? false,
      },
    });

    if (!tool) {
      const err = { error: `Unknown tool: ${toolCall.name}` };
      emitRunEvent(runId, "tool.result", {
        stepId: step.id,
        toolCallId: toolCall.id,
        name: toolCall.name,
        ok: false,
        result: err,
      });
      return toolResultMessage(toolCall.id, err);
    }

    const capability = decideToolCapability({
      tool,
      allowedTools: input.tools,
      dryRun: input.dryRun,
      hasHumanApproval: false,
      allowNetwork: true,
      allowFilesystem: true,
    });
    if (!capability.allowed) {
      const denied = {
        denied: true,
        reason: "tool_capability_denied",
        details: capability.reasons,
      };
      emitRunEvent(runId, "tool.result", {
        stepId: step.id,
        toolCallId: toolCall.id,
        name: toolCall.name,
        ok: false,
        denied: true,
        result: denied,
      });
      appendAudit({
        actorType: "system",
        actorId: null,
        action: "tool.capability_deny",
        subjectType: "run",
        subjectId: runId,
        payload: { tool: toolCall.name, reasons: capability.reasons },
      });
      return toolResultMessage(toolCall.id, denied);
    }

    // ─── policy decision ────────────────────────────────────────────────
    const argumentCheck = validateToolArguments(tool.parameters, toolCall.arguments);
    if (!argumentCheck.ok) {
      const invalid = { error: "invalid_tool_arguments", details: argumentCheck.errors };
      emitRunEvent(runId, "tool.result", {
        stepId: step.id,
        toolCallId: toolCall.id,
        name: toolCall.name,
        ok: false,
        result: invalid,
      });
      return toolResultMessage(toolCall.id, invalid);
    }

    const policies = loadPolicies(input.userId);
    const decision = evaluatePolicies(policies, {
      toolName: toolCall.name,
      risk,
      agentTier: input.agentTier,
      arguments: toolCall.arguments,
    });
    appendAudit({
      actorType: "system",
      actorId: null,
      action: "policy.decision",
      subjectType: "run",
      subjectId: runId,
      payload: { tool: toolCall.name, effect: decision.effect, reason: decision.reason },
    });

    if (decision.effect === "deny") {
      const denied = { denied: true, reason: decision.reason };
      emitRunEvent(runId, "tool.result", {
        stepId: step.id,
        toolCallId: toolCall.id,
        name: toolCall.name,
        ok: false,
        denied: true,
        result: denied,
      });
      return toolResultMessage(toolCall.id, denied);
    }

    if (decision.effect === "human") {
      const outcome = await this.parkForApproval(
        runId,
        step,
        toolCall,
        risk,
        decision,
        input,
      );
      if (signal.aborted) {
        return toolResultMessage(toolCall.id, { __run_cancelled__: true });
      }
      if (outcome === "rejected") {
        const rejected = { rejected: true, reason: "Rejected by operator" };
        emitRunEvent(runId, "tool.result", {
          stepId: step.id,
          toolCallId: toolCall.id,
          name: toolCall.name,
          ok: false,
          rejected: true,
          result: rejected,
        });
        return toolResultMessage(toolCall.id, rejected);
      }
      // approved → fall through to execute
    }

    return this.executeTool(runId, step, input, toolCall);
  }

  private async parkForApproval(
    runId: string,
    step: RunStep,
    toolCall: ToolCall,
    risk: RiskLevel,
    decision: PolicyDecision,
    input: StartRunInput,
  ): Promise<"approved" | "rejected"> {
    const run = db
      .select({
        deadlineAt: schema.runs.deadlineAt,
        status: schema.runs.status,
        tenantId: schema.runs.tenantId,
        workspaceId: schema.runs.workspaceId,
      })
      .from(schema.runs)
      .where(eq(schema.runs.id, runId))
      .get();
    const defaultExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const expiresAt = run?.deadlineAt && run.deadlineAt < defaultExpiry
      ? run.deadlineAt
      : defaultExpiry;
    const argumentsHash = createHash("sha256")
      .update(JSON.stringify(toolCall.arguments))
      .digest("hex");
    const continuationKey = createHash("sha256")
      .update(JSON.stringify({ runId, stepId: step.id, toolName: toolCall.name, argumentsHash }))
      .digest("hex");
    const existing = db
      .select()
      .from(schema.approvals)
      .where(and(
        eq(schema.approvals.runId, runId),
        eq(schema.approvals.continuationKey, continuationKey),
      ))
      .get();
    if (existing) {
      if (existing.status === "approved") return "approved";
      if (["rejected", "expired"].includes(existing.status)) return "rejected";
      if (runnerModeUsesDurableExecution(input.runnerMode ?? "legacy", input.useDurableRunner)) {
        throw new DurablePauseError(`approval:${existing.id}`, Math.max(1_000, existing.expiresAt.getTime() - Date.now()));
      }
    }
    const approval = existing ?? db
      .insert(schema.approvals)
      .values({
        runId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        continuationKey,
        durableJobId: `durable:${runId}`,
        continuationCheckpoint: {
          stepId: step.id,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          argumentsHash,
        },
        stepId: step.id,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        riskLevel: risk,
        requestPayload: {
          arguments: toolCall.arguments,
          policyReason: decision.reason,
        },
        status: "pending",
        expiresAt,
      })
      .returning()
      .get();

    if (run?.status === "running") transitionRun(runId, "awaiting_approval");
    if (!existing) {
      emitRunEvent(runId, "approval.requested", {
        approvalId: approval.id,
        stepId: step.id,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        risk,
        arguments: toolCall.arguments,
        policyReason: decision.reason,
        revision: approval.revision,
        continuationKey,
      });
      appendAudit({
        actorType: "system",
        actorId: null,
        action: "approval.request",
        subjectType: "approval",
        subjectId: approval.id,
        payload: { tool: toolCall.name, risk, continuationKey },
      });
    }

    if (runnerModeUsesDurableExecution(input.runnerMode ?? "legacy", input.useDurableRunner)) {
      throw new DurablePauseError(`approval:${approval.id}`, Math.max(1_000, expiresAt.getTime() - Date.now()));
    }

    const entry = this.active.get(runId)!;
    return new Promise<"approved" | "rejected">((resolve, reject) => {
      const delay = Math.max(1, expiresAt.getTime() - Date.now());
      const timer = setTimeout(() => {
        const current = db
          .select({ status: schema.approvals.status })
          .from(schema.approvals)
          .where(eq(schema.approvals.id, approval.id))
          .get();
        if (current?.status === "pending") {
          transitionApproval(approval.id, "expired", { resolvedAt: new Date() });
          emitRunEvent(runId, "approval.resolved", {
            approvalId: approval.id,
            decision: "expired",
            toolName: approval.toolName,
          });
          entry.pendingApproval = undefined;
          reject(new Error("approval_expired"));
        }
      }, delay);
      timer.unref?.();
      entry.pendingApproval = {
        approvalId: approval.id,
        resolve: (decision) => {
          clearTimeout(timer);
          resolve(decision);
        },
      };
    });
  }

  private async executeTool(
    runId: string,
    step: RunStep,
    input: StartRunInput,
    toolCall: ToolCall,
  ): Promise<ChatMessage> {
    const tool = getTool(toolCall.name)!;
    const entry = this.active.get(runId)!;
    const idempotencyKey = createHash("sha256")
      .update(JSON.stringify({ runId, stepId: step.id, toolCall }))
      .digest("hex");
    const ctx: Omit<ToolContext, "signal"> = {
      runId,
      stepId: step.id,
      dryRun: input.dryRun,
      idempotencyKey,
      writeArtifact: ({ name, kind, content, idempotencyKey: artifactKey }) => {
        if (input.dryRun) return `dry-run:${idempotencyKey}`;
        const effectiveKey = artifactKey ?? idempotencyKey;
        const existing = db
          .select()
          .from(schema.artifacts)
          .where(
            and(
              eq(schema.artifacts.runId, runId),
              eq(schema.artifacts.idempotencyKey, effectiveKey),
            ),
          )
          .get();
        if (existing) return existing.id;
        const artifact = db
          .insert(schema.artifacts)
          .values({
            id: createId(),
            runId,
            tenantId: input.tenantId,
            workspaceId: input.workspaceId,
            visibility: "private",
            stepId: step.id,
            name,
            kind,
            content,
            sizeBytes: Buffer.byteLength(content, "utf8"),
            idempotencyKey: effectiveKey,
          })
          .returning()
          .get();
        emitRunEvent(runId, "artifact.created", {
          artifactId: artifact.id,
          stepId: step.id,
          name,
          kind,
          sizeBytes: content.length,
        });
        return artifact.id;
      },
    };

    const bounded = await executeBoundedTool(
      tool,
      toolCall.arguments,
      ctx,
      entry.abort.signal,
    );
    const result = bounded.result;

    emitRunEvent(runId, "tool.result", {
      stepId: step.id,
      toolCallId: toolCall.id,
      name: toolCall.name,
      ok: result.ok,
      result: result.output ?? { error: result.error },
    });
    appendAudit({
      actorType: "agent",
      actorId: input.agentId ?? null,
      action: "tool.execute",
      subjectType: "run",
      subjectId: runId,
      payload: { tool: toolCall.name, ok: result.ok },
    });

    return toolResultMessage(
      toolCall.id,
      result.ok ? result.output : { error: result.error },
    );
  }
}

// ─── delta coalescing ──────────────────────────────────────────────────────
class DeltaBuffer {
  private buf = "";
  constructor(
    private runId: string,
    private stepId: string,
    private threshold = 42,
  ) {}
  push(text: string) {
    this.buf += text;
    if (this.buf.length >= this.threshold) this.flush();
  }
  flush() {
    if (!this.buf) return;
    emitRunEvent(this.runId, "assistant.delta", {
      stepId: this.stepId,
      text: this.buf,
    });
    this.buf = "";
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────
function toolResultMessage(toolCallId: string, output: unknown): ChatMessage {
  return {
    role: "tool",
    toolCallId,
    content: typeof output === "string" ? output : JSON.stringify(output),
  };
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function loadPolicies(userId: string): PolicyRow[] {
  return db
    .select()
    .from(schema.policies)
    .where(
      or(
        eq(schema.policies.isBuiltin, true),
        eq(schema.policies.ownerId, userId),
      ),
    )
    .all()
    .map((p) => ({
      id: p.id,
      name: p.name,
      enabled: p.enabled,
      priority: p.priority,
      rules: p.rules,
    }));
}

interface ResolvedCreds {
  apiKey?: string;
  baseUrl?: string;
  model: string;
}

async function resolveCreds(
  userId: string,
  provider: ProviderName,
  model: string,
): Promise<ResolvedCreds> {
  if (provider === "simulation") return { model: model || "sim-1" };

  const config = db
    .select()
    .from(schema.providerConfigs)
    .where(eq(schema.providerConfigs.userId, userId))
    .all()
    .find((c) => c.provider === provider);

  if (config && !config.enabled) {
    throw new Error(`provider_disabled:${provider}`);
  }

  let apiKey: string | undefined;
  if (config?.apiKeyCiphertext && config.apiKeyIv && config.apiKeyTag) {
    const { decryptSecret } = await import("@/lib/crypto");
    try {
      apiKey = decryptSecret(
        {
          version: config.apiKeyVersion as 1 | 2,
          ciphertext: config.apiKeyCiphertext,
          iv: config.apiKeyIv,
          tag: config.apiKeyTag,
        },
        `${userId}:${provider}`,
      );
    } catch {
      apiKey = undefined;
    }
  }
  // Env fallback for local dev / CI.
  apiKey ??= envKeyFor(provider);

  return {
    apiKey,
    baseUrl: config?.baseUrl ?? undefined,
    model: model || config?.defaultModel || "",
  };
}

function envKeyFor(provider: ProviderName): string | undefined {
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "google":
      return process.env.GOOGLE_API_KEY;
    case "openrouter":
      return process.env.OPENROUTER_API_KEY;
    default:
      return undefined;
  }
}

function assertRunCanContinue(
  combinedSignal: AbortSignal,
  userSignal: AbortSignal,
  deadlineAt?: Date,
): void {
  if (userSignal.aborted) throw new Error("run_cancelled");
  if (
    (deadlineAt && Date.now() >= deadlineAt.getTime()) ||
    (combinedSignal.aborted && !userSignal.aborted)
  ) {
    throw new Error("run_deadline_exceeded");
  }
}

function transitionRun(
  runId: string,
  next: RunLifecycleState,
  patch: Partial<Run> = {},
): void {
  const current = db
    .select({ status: schema.runs.status })
    .from(schema.runs)
    .where(eq(schema.runs.id, runId))
    .get();
  if (!current) throw new Error(`Run not found: ${runId}`);
  assertRunTransition(current.status, next);
  db.update(schema.runs)
    .set({ ...patch, status: next })
    .where(eq(schema.runs.id, runId))
    .run();
}

function transitionStep(
  stepId: string,
  next: StepLifecycleState,
  patch: Partial<RunStep> = {},
): void {
  const current = db
    .select({ status: schema.runSteps.status })
    .from(schema.runSteps)
    .where(eq(schema.runSteps.id, stepId))
    .get();
  if (!current) throw new Error(`Run step not found: ${stepId}`);
  assertStepTransition(current.status, next);
  db.update(schema.runSteps)
    .set({ ...patch, status: next })
    .where(eq(schema.runSteps.id, stepId))
    .run();
}

function transitionApproval(
  approvalId: string,
  next: ApprovalLifecycleState,
  patch: Partial<Approval> = {},
  expectedRevision?: number,
): number {
  const current = db
    .select({ status: schema.approvals.status, revision: schema.approvals.revision })
    .from(schema.approvals)
    .where(eq(schema.approvals.id, approvalId))
    .get();
  if (!current) throw new Error(`Approval not found: ${approvalId}`);
  if (expectedRevision !== undefined && current.revision !== expectedRevision) {
    throw new Error("approval_revision_conflict");
  }
  assertApprovalTransition(current.status, next);
  const nextRevision = current.revision + 1;
  const result = db.update(schema.approvals)
    .set({ ...patch, status: next, revision: nextRevision })
    .where(and(
      eq(schema.approvals.id, approvalId),
      eq(schema.approvals.status, current.status),
      eq(schema.approvals.revision, current.revision),
    ))
    .run();
  if (result.changes !== 1) throw new Error("approval_revision_conflict");
  return nextRevision;
}

// ─── singleton ──────────────────────────────────────────────────────────────
const globalForRunner = globalThis as unknown as { __titaiRunManager?: RunManager };
export const runManager: RunManager =
  globalForRunner.__titaiRunManager ?? new RunManager();
globalForRunner.__titaiRunManager = runManager;
