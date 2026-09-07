import {
  sqliteTable,
  text,
  integer,
  real,
  unique,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import type {
  ProviderName,
  ToolCall,
  RiskLevel as EngineRiskLevel,
} from "@/lib/engine/types";
import type { PolicyRule } from "@/lib/engine/policy";
import type { RunEventType } from "@/lib/engine/events";
import { createId } from "@/lib/ids";

// ─── Enums (as TS unions; SQLite stores text) ────────────────────────────
export type AgentTier = "executive" | "engineering" | "quality" | "release";
export type AgentStatus = "draft" | "active" | "archived";
export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export type StepStatus =
  | "pending"
  | "running"
  | "retrying"
  | "completed"
  | "failed"
  | "skipped"
  | "blocked";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type RiskLevel = EngineRiskLevel;
export type TemplateKind = "agent" | "objective";
export type UserRole = "admin" | "member";
export type WorkspaceRole = "owner" | "operator" | "verifier" | "viewer";
export type ResourceVisibility = "private" | "workspace" | "tenant";
export type CapabilityPackageKindDb = "skill" | "tool" | "agent" | "workflow" | "connector" | "policy" | "evaluator" | "prompt_template" | "memory_transformer" | "artifact_renderer" | "ui_extension";
export type CapabilityPackageStateDb = "available" | "quarantined" | "under_review" | "qualified" | "installed" | "active" | "degraded" | "revoked" | "deprecated" | "rollback_required" | "incompatible";
export type CapabilityCandidateStateDb = "quarantined" | "qualified" | "signed" | "rejected";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => createId());
const now = () => integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date());

// ─── tenant and workspace scope ─────────────────────────────────────────
export const tenants = sqliteTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  createdAt: now(),
});

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: id(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: now(),
  },
  (t) => [index("workspaces_tenant_idx").on(t.tenantId)],
);

// ─── users ───────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<UserRole>().notNull().default("member"),
  locale: text("locale").notNull().default("en"),
  theme: text("theme").notNull().default("dark"),
  createdAt: now(),
});

export const workspaceMemberships = sqliteTable(
  "workspace_memberships",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull().default("operator"),
    createdAt: now(),
  },
  (t) => [
    unique("workspace_memberships_pk").on(t.userId, t.workspaceId),
    index("workspace_memberships_scope_idx").on(t.tenantId, t.workspaceId),
  ],
);

// ─── agents ────────────────────────────────────────────────────────────────
export const agents = sqliteTable(
  "agents",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    visibility: text("visibility").$type<ResourceVisibility>().notNull().default("private"),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    icon: text("icon").notNull().default("bot"),
    tier: text("tier").$type<AgentTier>().notNull().default("engineering"),
    status: text("status").$type<AgentStatus>().notNull().default("draft"),
    currentVersionId: text("current_version_id"),
    createdAt: now(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(
      () => new Date(),
    ),
  },
  (t) => [index("agents_owner_idx").on(t.ownerId)],
);

export const agentVersions = sqliteTable(
  "agent_versions",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    systemPrompt: text("system_prompt").notNull().default(""),
    provider: text("provider").$type<ProviderName>().notNull().default("simulation"),
    model: text("model").notNull().default(""),
    temperature: real("temperature").notNull().default(0.7),
    maxSteps: integer("max_steps").notNull().default(8),
    maxToolIterations: integer("max_tool_iterations").notNull().default(6),
    tools: text("tools", { mode: "json" }).$type<string[]>().notNull().default([]),
    createdAt: now(),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (t) => [unique("agent_versions_agent_version_uq").on(t.agentId, t.version)],
);

// ─── skills ─────────────────────────────────────────────────────────────────
export const skills = sqliteTable("skills", {
  id: id(),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  currentVersionId: text("current_version_id"),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  createdAt: now(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(
    () => new Date(),
  ),
});

export const skillVersions = sqliteTable(
  "skill_versions",
  {
    id: id(),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    frontmatter: text("frontmatter", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    body: text("body").notNull().default(""),
    raw: text("raw").notNull().default(""),
    createdAt: now(),
  },
  (t) => [unique("skill_versions_skill_version_uq").on(t.skillId, t.version)],
);

export const agentSkills = sqliteTable(
  "agent_skills",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    pinnedVersionId: text("pinned_version_id").references(
      () => skillVersions.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    unique("agent_skills_pk").on(t.agentId, t.skillId),
  ],
);

// ─── runs ────────────────────────────────────────────────────────────────────
export const runs = sqliteTable(
  "runs",
  {
    id: id(),
    agentId: text("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    agentVersionId: text("agent_version_id"),
    agentName: text("agent_name").notNull().default(""),
    agentTier: text("agent_tier").$type<AgentTier>().notNull().default("engineering"),
    skillVersionIds: text("skill_version_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    visibility: text("visibility").$type<ResourceVisibility>().notNull().default("private"),
    idempotencyKey: text("idempotency_key"),
    objective: text("objective").notNull(),
    status: text("status").$type<RunStatus>().notNull().default("queued"),
    provider: text("provider").$type<ProviderName>().notNull().default("simulation"),
    model: text("model").notNull().default(""),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(false),
    maxOutputTokens: integer("max_output_tokens").notNull().default(4096),
    maxContextTokens: integer("max_context_tokens").notNull().default(32_000),
    runnerMode: text("runner_mode").notNull().default("legacy"),
    routingDecision: text("routing_decision", { mode: "json" }).$type<{
      selected?: { provider: ProviderName; model: string; profileId?: string };
      fallback?: { provider: ProviderName; model: string; profileId?: string };
      reason: string;
      evaluatedAt: string;
    }>(),
    memorySnapshot: text("memory_snapshot", { mode: "json" }).$type<Array<{
      id: string;
      contentHash: string;
      score: number;
      estimatedTokens: number;
      kind: MemoryKind;
      provenance: unknown;
    }>>().notNull().default([]),
    deadlineAt: integer("deadline_at", { mode: "timestamp_ms" }),
    tokenUsage: text("token_usage", { mode: "json" })
      .$type<{ input: number; output: number }>()
      .notNull()
      .default({ input: 0, output: 0 }),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt: now(),
  },
  (t) => [
    index("runs_status_idx").on(t.status),
    index("runs_agent_idx").on(t.agentId),
    index("runs_user_idx").on(t.userId),
    index("runs_scope_idx").on(t.tenantId, t.workspaceId),
    unique("runs_user_idempotency_uq").on(t.userId, t.idempotencyKey),
  ],
);

export const runSteps = sqliteTable(
  "run_steps",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    dependsOn: text("depends_on", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    status: text("status").$type<StepStatus>().notNull().default("pending"),
    output: text("output"),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    unique("run_steps_run_idx_uq").on(t.runId, t.idx),
    index("run_steps_run_idx").on(t.runId),
  ],
);

/** Append-only event log — the source of truth. Integer PK doubles as SSE id. */
export const runEvents = sqliteTable(
  "run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").$type<RunEventType>().notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(
      () => new Date(),
    ),
  },
  (t) => [
    unique("run_events_run_seq_uq").on(t.runId, t.seq),
    index("run_events_run_idx").on(t.runId),
  ],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    continuationKey: text("continuation_key"),
    durableJobId: text("durable_job_id"),
    continuationCheckpoint: text("continuation_checkpoint", { mode: "json" }).$type<{ stepId: string; toolCallId: string; toolName: string; argumentsHash: string }>(),
    stepId: text("step_id").references(() => runSteps.id, {
      onDelete: "set null",
    }),
    toolCallId: text("tool_call_id").notNull().default(""),
    toolName: text("tool_name").notNull(),
    riskLevel: text("risk_level").$type<RiskLevel>().notNull().default("medium"),
    requestPayload: text("request_payload", { mode: "json" })
      .$type<{ arguments: Record<string, unknown>; policyReason?: string }>()
      .notNull(),
    status: text("status").$type<ApprovalStatus>().notNull().default("pending"),
    revision: integer("revision").notNull().default(0),
    reason: text("reason"),
    resolvedBy: text("resolved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    requestedAt: now(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date(Date.now() + 24 * 60 * 60 * 1000)),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("approvals_status_idx").on(t.status),
    index("approvals_run_idx").on(t.runId),
    index("approvals_scope_idx").on(t.tenantId, t.workspaceId),
    unique("approvals_continuation_uq").on(t.runId, t.continuationKey),
  ],
);

export const policies = sqliteTable("policies", {
  id: id(),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  visibility: text("visibility").$type<ResourceVisibility>().notNull().default("private"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  priority: integer("priority").notNull().default(100),
  rules: text("rules", { mode: "json" })
    .$type<PolicyRule[]>()
    .notNull()
    .default([]),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  createdAt: now(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(
    () => new Date(),
  ),
});

/** Hash-linked, tamper-evident audit chain. Integer PK = chain order. */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  actorType: text("actor_type").$type<"user" | "agent" | "system">().notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  payload: text("payload", { mode: "json" }).$type<unknown>(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});


export const auditRedactions = sqliteTable(
  "audit_redactions",
  {
    id: id(),
    auditId: integer("audit_id")
      .notNull()
      .references(() => auditLog.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    redactedAt: integer("redacted_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [unique("audit_redactions_audit_uq").on(t.auditId)],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    visibility: text("visibility").$type<ResourceVisibility>().notNull().default("private"),
    stepId: text("step_id").references(() => runSteps.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    kind: text("kind").$type<"markdown" | "json" | "text">().notNull().default("text"),
    content: text("content").notNull().default(""),
    sizeBytes: integer("size_bytes").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    createdAt: now(),
  },
  (t) => [
    index("artifacts_run_idx").on(t.runId),
    index("artifacts_scope_idx").on(t.tenantId, t.workspaceId),
    unique("artifacts_run_idempotency_uq").on(t.runId, t.idempotencyKey),
  ],
);

export const providerConfigs = sqliteTable(
  "provider_configs",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<ProviderName>().notNull(),
    label: text("label").notNull().default(""),
    apiKeyCiphertext: text("api_key_ciphertext"),
    apiKeyIv: text("api_key_iv"),
    apiKeyTag: text("api_key_tag"),
    apiKeyVersion: integer("api_key_version").notNull().default(1),
    apiKeyMask: text("api_key_mask"),
    baseUrl: text("base_url"),
    defaultModel: text("default_model").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(
      () => new Date(),
    ),
  },
  (t) => [unique("provider_configs_user_provider_uq").on(t.userId, t.provider)],
);

export const templates = sqliteTable("templates", {
  id: id(),
  ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  visibility: text("visibility").$type<ResourceVisibility>().notNull().default("private"),
  kind: text("kind").$type<TemplateKind>().notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  icon: text("icon").notNull().default("sparkles"),
  tier: text("tier").$type<AgentTier>(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(true),
  createdAt: now(),
});



// ─── governed memory ───────────────────────────────────────────────────────
export type MemoryKind =
  | "working"
  | "episodic"
  | "semantic"
  | "procedural"
  | "decision"
  | "preference"
  | "evidence"
  | "negative";
export type MemoryStatus = "active" | "corrected";
export type MemorySensitivity = "public" | "internal" | "restricted";

export const memories = sqliteTable(
  "memories",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    visibility: text("visibility").$type<ResourceVisibility>().notNull().default("private"),
    kind: text("kind").$type<MemoryKind>().notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
    provenance: text("provenance", { mode: "json" })
      .$type<{
        sourceType: "user" | "run" | "artifact" | "import" | "system";
        sourceRef?: string;
        capturedAt: string;
      }>()
      .notNull(),
    confidence: real("confidence").notNull().default(0.5),
    authority: real("authority").notNull().default(0.5),
    contradictionRisk: real("contradiction_risk").notNull().default(0),
    sensitivity: text("sensitivity")
      .$type<MemorySensitivity>()
      .notNull()
      .default("internal"),
    status: text("status").$type<MemoryStatus>().notNull().default("active"),
    correctsId: text("corrects_id").references((): AnySQLiteColumn => memories.id, {
      onDelete: "set null",
    }),
    contradictionGroup: text("contradiction_group"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: now(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("memories_owner_status_idx").on(t.ownerId, t.status),
    index("memories_scope_idx").on(t.tenantId, t.workspaceId),
    index("memories_owner_kind_idx").on(t.ownerId, t.kind),
    index("memories_expires_idx").on(t.expiresAt),
    index("memories_correction_idx").on(t.correctsId),
  ],
);


// ─── model capability registry ─────────────────────────────────────────────
export const modelProfiles = sqliteTable(
  "model_profiles",
  {
    id: id(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    visibility: text("visibility").$type<ResourceVisibility>().notNull().default("private"),
    provider: text("provider").$type<ProviderName>().notNull(),
    model: text("model").notNull(),
    displayName: text("display_name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
    local: integer("local", { mode: "boolean" }).notNull().default(false),
    license: text("license"),
    contextTokens: integer("context_tokens").notNull().default(32000),
    supportsTools: integer("supports_tools", { mode: "boolean" }).notNull().default(true),
    supportsStructuredOutput: integer("supports_structured_output", { mode: "boolean" })
      .notNull()
      .default(true),
    structuredOutputReliability: real("structured_output_reliability").notNull().default(0.5),
    toolReliability: real("tool_reliability").notNull().default(0.5),
    planningQuality: real("planning_quality").notNull().default(0.5),
    codeQuality: real("code_quality").notNull().default(0.5),
    verificationQuality: real("verification_quality").notNull().default(0.5),
    healthState: text("health_state").$type<"healthy" | "degraded" | "unavailable">().notNull().default("healthy"),
    availability: real("availability").notNull().default(0.5),
    failureRate: real("failure_rate").notNull().default(0.1),
    latencyMs: integer("latency_ms").notNull().default(5000),
    costPerMillionInput: real("cost_per_million_input").notNull().default(0),
    costPerMillionOutput: real("cost_per_million_output").notNull().default(0),
    energyWhPerMillionTokens: real("energy_wh_per_million_tokens").notNull().default(0),
    privacyScore: real("privacy_score").notNull().default(0.5),
    sovereigntyScore: real("sovereignty_score").notNull().default(0.5),
    evaluationConfidence: real("evaluation_confidence").notNull().default(0.2),
    artifactHash: text("artifact_hash"),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" }),
    createdAt: now(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    unique("model_profiles_owner_provider_model_uq").on(t.ownerId, t.provider, t.model),
    index("model_profiles_owner_enabled_idx").on(t.ownerId, t.enabled),
  ],
);

// ─── durable execution ─────────────────────────────────────────────────────
export type DurableDbJobStatus =
  | "queued"
  | "leased"
  | "completed"
  | "failed"
  | "cancelled"
  | "needs_reconciliation";
export type DurableDbReceiptStatus = "started" | "completed" | "failed" | "unknown";
export type OutboxStatus = "pending" | "processing" | "published" | "failed";

export const durableJobs = sqliteTable(
  "durable_jobs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    workflowName: text("workflow_name").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    status: text("status").$type<DurableDbJobStatus>().notNull().default("queued"),
    checkpoint: text("checkpoint", { mode: "json" }).$type<{
      nextStepIndex: number;
      outputs: Record<string, unknown>;
      completedStepIds: string[];
      revision: number;
    }>().notNull(),
    result: text("result", { mode: "json" }).$type<unknown>(),
    error: text("error"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: integer("available_at", { mode: "timestamp_ms" }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseToken: integer("lease_token").notNull().default(0),
    leaseAcquiredAt: integer("lease_acquired_at", { mode: "timestamp_ms" }),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
    leaseHeartbeatAt: integer("lease_heartbeat_at", { mode: "timestamp_ms" }),
    version: integer("version").notNull().default(0),
    createdAt: now(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("durable_jobs_status_available_idx").on(t.status, t.availableAt),
    index("durable_jobs_lease_idx").on(t.leaseExpiresAt),
  ],
);

export const durableReceipts = sqliteTable(
  "durable_receipts",
  {
    key: text("key").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => durableJobs.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    operation: text("operation").notNull(),
    inputHash: text("input_hash").notNull(),
    status: text("status").$type<DurableDbReceiptStatus>().notNull(),
    output: text("output", { mode: "json" }).$type<unknown>(),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    workerId: text("worker_id").notNull(),
  },
  (t) => [index("durable_receipts_job_idx").on(t.jobId)],
);

export const durableOutbox = sqliteTable(
  "durable_outbox",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    status: text("status").$type<OutboxStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: integer("available_at", { mode: "timestamp_ms" }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseToken: integer("lease_token").notNull().default(0),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp_ms" }),
    lastError: text("last_error"),
    createdAt: now(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("durable_outbox_status_available_idx").on(t.status, t.availableAt)],
);


// ─── immutable verification attestations ──────────────────────────────────
export type VerificationAttestationStatus = "accepted" | "rejected";

export const verificationAttestations = sqliteTable(
  "verification_attestations",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    requirementRevision: text("requirement_revision").notNull(),
    taskRevision: text("task_revision").notNull(),
    sourceTreeHash: text("source_tree_hash").notNull(),
    testCommand: text("test_command").notNull(),
    testOutputHash: text("test_output_hash").notNull(),
    artifactHash: text("artifact_hash"),
    releaseCandidateHash: text("release_candidate_hash").notNull(),
    builderIdentity: text("builder_identity").notNull(),
    verifierIdentity: text("verifier_identity").notNull(),
    status: text("status").$type<VerificationAttestationStatus>().notNull(),
    limitations: text("limitations", { mode: "json" }).$type<string[]>().notNull().default([]),
    evidenceHash: text("evidence_hash").notNull().unique(),
    createdAt: now(),
  },
  (t) => [index("verification_attestations_run_idx").on(t.runId, t.createdAt)],
);


// ─── v18 capability operating system ───────────────────────────────────────
export const capabilityPublishers = sqliteTable("capability_publishers", {
  id: text("id").primaryKey(),
  keyId: text("key_id").notNull(),
  displayName: text("display_name").notNull(),
  publicKeyPem: text("public_key_pem").notNull(),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  allowedPackageTypes: text("allowed_package_types", { mode: "json" }).$type<CapabilityPackageKindDb[]>().notNull().default([]),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  createdAt: now(),
}, (t) => [unique("capability_publishers_key_uq").on(t.id, t.keyId), index("capability_publishers_scope_idx").on(t.tenantId, t.workspaceId)]);

export const capabilityPackages = sqliteTable("capability_packages", {
  id: id(), packageId: text("package_id").notNull(), version: text("version").notNull(),
  packageType: text("package_type").$type<CapabilityPackageKindDb>().notNull(), name: text("name").notNull(), description: text("description").notNull().default(""),
  publisherId: text("publisher_id").notNull(), publisherKeyId: text("publisher_key_id").notNull(),
  manifest: text("manifest", { mode: "json" }).$type<Record<string, unknown>>().notNull(), manifestHash: text("manifest_hash").notNull(), packageHash: text("package_hash").notNull(),
  state: text("state").$type<CapabilityPackageStateDb>().notNull().default("quarantined"), inspection: text("inspection", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
  tenantId: text("tenant_id").references(() => tenants.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }), ownerId: text("owner_id").references(() => users.id, { onDelete: "set null" }),
  previousVersionId: text("previous_version_id").references((): AnySQLiteColumn => capabilityPackages.id, { onDelete: "set null" }),
  importedAt: integer("imported_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [unique("capability_packages_version_scope_uq").on(t.packageId, t.version, t.tenantId, t.workspaceId), index("capability_packages_scope_idx").on(t.tenantId, t.workspaceId), index("capability_packages_state_idx").on(t.state)]);

export const capabilityEvidence = sqliteTable("capability_evidence", {
  id: text("id").primaryKey(), capabilityPackageId: text("capability_package_id").notNull().references(() => capabilityPackages.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), status: text("status").notNull(), hash: text("hash").notNull(), environment: text("environment").notNull(), independent: integer("independent", { mode: "boolean" }).notNull().default(false), expiresAt: integer("expires_at", { mode: "timestamp_ms" }), createdAt: now(),
}, (t) => [index("capability_evidence_package_idx").on(t.capabilityPackageId), index("capability_evidence_status_idx").on(t.status)]);

export const capabilityInstallations = sqliteTable("capability_installations", {
  id: id(), capabilityPackageId: text("capability_package_id").notNull().references(() => capabilityPackages.id, { onDelete: "cascade" }), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), state: text("state").$type<CapabilityPackageStateDb>().notNull().default("installed"), permissionsApproved: integer("permissions_approved", { mode: "boolean" }).notNull().default(false), activatedAt: integer("activated_at", { mode: "timestamp_ms" }), deactivatedAt: integer("deactivated_at", { mode: "timestamp_ms" }), installedAt: integer("installed_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()), reason: text("reason"),
}, (t) => [unique("capability_installations_scope_uq").on(t.capabilityPackageId, t.tenantId, t.workspaceId), index("capability_installations_scope_idx").on(t.tenantId, t.workspaceId)]);

export const capabilityCandidates = sqliteTable("capability_candidates", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }), name: text("name").notNull(), description: text("description").notNull(), packageType: text("package_type").$type<CapabilityPackageKindDb>().notNull(), state: text("state").$type<CapabilityCandidateStateDb>().notNull().default("quarantined"), reuseDecision: text("reuse_decision").$type<"reuse" | "extend" | "compose" | "create">().notNull(), specificationHash: text("specification_hash").notNull(), candidateHash: text("candidate_hash").notNull(), candidate: text("candidate", { mode: "json" }).$type<Record<string, unknown>>().notNull(), createdAt: now(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [unique("capability_candidates_hash_scope_uq").on(t.candidateHash, t.tenantId, t.workspaceId), index("capability_candidates_scope_idx").on(t.tenantId, t.workspaceId), index("capability_candidates_state_idx").on(t.state)]);

export const compiledMissions = sqliteTable("compiled_missions", {
  id: text("id").primaryKey(), revision: integer("revision").notNull().default(1), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }), intent: text("intent", { mode: "json" }).$type<Record<string, unknown>>().notNull(), plan: text("plan", { mode: "json" }).$type<Record<string, unknown>>().notNull(), semanticDiff: text("semantic_diff", { mode: "json" }).$type<Array<Record<string, unknown>>>().notNull().default([]), findings: text("findings", { mode: "json" }).$type<Array<Record<string, unknown>>>().notNull().default([]), gaps: text("gaps", { mode: "json" }).$type<Array<Record<string, unknown>>>().notNull().default([]), missionHash: text("mission_hash").notNull(), status: text("status").notNull().default("draft"), createdAt: now(), approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
}, (t) => [index("compiled_missions_scope_idx").on(t.tenantId, t.workspaceId), unique("compiled_missions_hash_scope_uq").on(t.missionHash, t.tenantId, t.workspaceId)]);

export const improvementCandidates = sqliteTable("improvement_candidates", {
  id: text("id").primaryKey(), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), proposal: text("proposal", { mode: "json" }).$type<Record<string, unknown>>().notNull(), builderId: text("builder_id").notNull(), verifierId: text("verifier_id"), stage: text("stage").notNull(), patchHash: text("patch_hash"), updateCandidateHash: text("update_candidate_hash"), evidence: text("evidence", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}), createdAt: now(), updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => [index("improvement_candidates_scope_idx").on(t.tenantId, t.workspaceId), index("improvement_candidates_stage_idx").on(t.stage)]);

export const missionTeamHandoffs = sqliteTable("mission_team_handoffs", {
  id: text("id").primaryKey(), teamId: text("team_id").notNull(), missionHash: text("mission_hash").notNull(), tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), senderId: text("sender_id").notNull(), receiverId: text("receiver_id").notNull(), senderRole: text("sender_role").notNull(), receiverRole: text("receiver_role").notNull(), payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(), signature: text("signature").notNull(), sequence: integer("sequence").notNull(), consumedAt: integer("consumed_at", { mode: "timestamp_ms" }), createdAt: now(),
}, (t) => [index("mission_team_handoffs_mission_idx").on(t.missionHash), unique("mission_team_handoffs_sequence_uq").on(t.teamId, t.sequence)]);

// ─── relations ──────────────────────────────────────────────────────────────
export const tenantsRelations = relations(tenants, ({ many }) => ({
  workspaces: many(workspaces),
  memberships: many(workspaceMemberships),
}));

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  tenant: one(tenants, { fields: [workspaces.tenantId], references: [tenants.id] }),
  memberships: many(workspaceMemberships),
}));

export const agentsRelations = relations(agents, ({ many, one }) => ({
  versions: many(agentVersions),
  skills: many(agentSkills),
  owner: one(users, { fields: [agents.ownerId], references: [users.id] }),
}));

export const agentVersionsRelations = relations(agentVersions, ({ one }) => ({
  agent: one(agents, {
    fields: [agentVersions.agentId],
    references: [agents.id],
  }),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  versions: many(skillVersions),
}));

export const runsRelations = relations(runs, ({ many, one }) => ({
  steps: many(runSteps),
  events: many(runEvents),
  approvals: many(approvals),
  artifacts: many(artifacts),
  verificationAttestations: many(verificationAttestations),
  agent: one(agents, { fields: [runs.agentId], references: [agents.id] }),
}));

// keep a reference so `sql` import is used even if tree-shaken elsewhere
export const _schemaMeta = sql`1`;

// ─── inferred types ─────────────────────────────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMembership = typeof workspaceMemberships.$inferSelect;
export type User = typeof users.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type AgentVersion = typeof agentVersions.$inferSelect;
export type Skill = typeof skills.$inferSelect;
export type SkillVersion = typeof skillVersions.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunStep = typeof runSteps.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Policy = typeof policies.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;
export type AuditRedaction = typeof auditRedactions.$inferSelect;
export type Artifact = typeof artifacts.$inferSelect;
export type ProviderConfig = typeof providerConfigs.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type ModelProfile = typeof modelProfiles.$inferSelect;
export type DurableJobRow = typeof durableJobs.$inferSelect;
export type DurableReceiptRow = typeof durableReceipts.$inferSelect;
export type DurableOutboxRow = typeof durableOutbox.$inferSelect;
export type VerificationAttestation = typeof verificationAttestations.$inferSelect;
export type CapabilityPublisherRow = typeof capabilityPublishers.$inferSelect;
export type CapabilityPackageRow = typeof capabilityPackages.$inferSelect;
export type CapabilityCandidateRow = typeof capabilityCandidates.$inferSelect;
export type CompiledMissionRow = typeof compiledMissions.$inferSelect;

export type { ToolCall, ProviderName };
