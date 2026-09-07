/**
 * TFA Evolution Studio v28 — Canonical Type System
 *
 * Single source of truth for all domain types.
 * Every module imports from here; no ad-hoc type duplication.
 */

// ── Evidence Chain ─────────────────────────────────────────────────────────

export type EvidenceNodeKind =
  | "smoke_test_exists"
  | "coherence_check_passed"
  | "zip_integrity_verified"
  | "artifact_hash_verified"
  | "manifest_version_consistent"
  | "sla_within_budget"
  | "token_budget_respected"
  | "circuit_breaker_clean"
  | "delta_manifest_generated"
  | "build_passed"
  | "tests_passed"
  | "lint_clean"
  | "adapter_selected"
  | "recipe_applied"
  | "approval_granted"
  | "audit_trail_complete"
  | "release_gate_passed"
  | "large_project_scanned"
  | "workspace_isolated"
  | "concurrent_limit_respected"
  | "version_coherence_verified"
  | "strategy_assessed"
  | "arch_graph_built"
  | "reality_checked"
  | "playbook_updated"
  | "zip_filename_verified"
  | "build_verified"
  | "dependency_graph_verified"
  | "workflow_replayable"
  | "synthesis_loop_converged"
  | "batch_reconciled"
  | "self_audit_clean"
  // V23 — distillation, refinement, lockfile coherence
  | "pattern_promoted"
  | "failure_taxonomy_updated"
  | "prioritization_updated"
  | "distillation_cycle_complete"
  | "batch_synthesis_complete"
  | "sovereign_batch_converged"
  | "release_gate_passed"
  | "lockfile_version_verified"
  // V28 — chaos engineering, evidence emitter, orchestration decomposition
  | "chaos_fault_injected"
  | "chaos_recovery_verified"
  | "orchestration_phase_completed"
  | "evidence_emitter_validated"
  | "tech_debt_eliminated"
  | "distillation_policy_applied"
  // v29 additions
  | "distillation_cycle_completed"
  | "decision_prior_updated"
  | "architecture_pattern_validated"
  | "recovery_strategy_applied"
  | "synthesis_objection_resolved"
  | "large_project_stress_verified"
  | "self_evaluation_completed"
  // v30 additions — Production Readiness & Autonomous Intelligence Maturity
  | "soak_test_completed"
  | "soak_scenario_stable"
  | "fitness_gate_passed"
  | "arch_health_scored"
  | "debate_v2_converged"
  | "memory_graph_updated"
  | "runtime_profile_detected"
  | "compiler_pipeline_passed"
  | "self_critique_passed"
  | "technical_debt_resolved";

export interface EvidenceNode {
  kind: EvidenceNodeKind;
  status: "pending" | "passed" | "failed" | "blocked";
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface CycleEvidenceChain {
  runId: string;
  projectId: string;
  startedAt: string;
  completedAt?: string;
  nodes: EvidenceNode[];
  passRate: number;
  complete: boolean;
}

// ── Projects ───────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeVersionId?: string;
  status: "idle" | "running" | "completed" | "failed";
}

export interface ProjectState {
  projectId: string;
  activeVersionId?: string;
  lastRunId?: string;
  status: Project["status"];
  workspaceRoot: string;
}

export interface VersionedProject {
  versionId: string;
  projectId: string;
  createdAt: string;
  sourcePath: string;
  artifacts?: VersionArtifacts;
  fileChanges: FileChange[];
}

export interface VersionArtifacts {
  zipPath: string;
  manifest: string;
  status: string;
  runbook: string;
  releaseNotes: string;
  nextCyclePrompt: string;
}

export interface FileChange {
  path: string;
  change: "added" | "modified" | "deleted";
  size: number;
}

// ── Jobs ───────────────────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted" | "retrying";
export type JobPriority = "low" | "normal" | "high" | "critical";
export type ScheduledJobKind = "evolution" | "compile" | "analysis" | "release" | "scan";

// ── Durable Execution ──────────────────────────────────────────────────────

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOn?: ("failure" | "timeout" | "crash")[];
}

export interface JobCheckpoint {
  phase: string;
  savedAt: string;
  progress: number;
  metadata?: Record<string, unknown>;
}

export interface CompilerJob {
  id: string;
  projectId: string;
  status: JobStatus;
  progress: number; // 0–100
  createdAt: string;
  updatedAt?: string;   // V24: stamped on every durableUpdateJob call — required by stuck-job detection
  startedAt?: string;
  completedAt?: string;
  interruptedAt?: string;
  resumedAt?: string;
  targetId?: string;
  outputZipPath?: string;
  error?: string;
  logs: string[];
  evidence: EvidenceNode[];
  // Durable execution additions
  idempotencyKey?: string;
  retryCount: number;
  retryPolicy?: RetryPolicy;
  checkpoint?: JobCheckpoint;
  executionId?: string; // unique per attempt, for dedup
}

export interface ScheduledJob {
  id: string;
  kind: ScheduledJobKind;
  projectId: string;
  priority: JobPriority;
  status: JobStatus;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
}

// ── Adapters ───────────────────────────────────────────────────────────────

export type PluginCapability =
  | "build"
  | "install"
  | "preview"
  | "export"
  | "lint"
  | "test"
  | "scan"
  | "deploy";

export interface PluginManifest {
  pluginId: string;
  targetId: string;
  version: string;
  minPlatformVersion: string;
  capabilities: PluginCapability[];
  author?: string;
  description?: string;
  registeredAt: string;
  healthEndpoint?: string;
}

export interface AdapterTarget {
  targetId: string;
  label: string;
  description: string;
  extensions: string[];
  buildCommand?: string;
  installCommand?: string;
  previewCommand?: string;
  exportCommand?: string;
}

export interface AdapterManifest {
  targetId: string;
  version: string;
  lifecycle: AdapterLifecycle;
}

export interface AdapterLifecycle {
  discover: (projectRoot: string) => Promise<boolean>;
  install: (projectRoot: string, log: (msg: string) => void) => Promise<boolean>;
  build: (projectRoot: string, log: (msg: string) => void) => Promise<boolean>;
  preview: (projectRoot: string, log: (msg: string) => void) => Promise<{ url?: string }>;
  export: (projectRoot: string, log: (msg: string) => void) => Promise<{ zipPath: string }>;
  // Optional extended lifecycle hooks
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
  healthCheck?: () => Promise<{ healthy: boolean; detail?: string }>;
}

// ── Sandbox ────────────────────────────────────────────────────────────────

export interface SandboxContext {
  projectId: string;
  sandboxId: string;
  sandboxRoot: string;
  projectRoot: string;
  artifactsDir: string;
  tmpDir: string;
  createdAt: string;
  isolationLevel: "strict" | "normal";
}

export interface SandboxIngestResult {
  sandboxId: string;
  projectRoot: string;
  fileCount: number;
  detectedAdapter?: string;
  ingestedAt: string;
}

// ── Architecture ────────────────────────────────────────────────────────────

export interface ArchGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export interface ArchNode {
  id: string;
  label: string;
  type: "module" | "package" | "service" | "component";
  metrics?: Record<string, number>;
}

export interface ArchEdge {
  from: string;
  to: string;
  type: "import" | "dependency" | "call";
}

export interface ArchStoreEntry {
  projectId: string;
  versionId: string;
  savedAt: string;
  archGraph?: ArchGraph;
  moduleGraph?: ArchGraph;
  depGraph?: ArchGraph;
  risks?: ArchRisk[];
  driftReport?: DriftReport;
  refactoringCandidates?: RefactorCandidate[];
}

export interface ArchRisk {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  category: "coupling" | "complexity" | "duplication" | "dead-code";
  message: string;
  filePath?: string;
}

export interface DriftReport {
  score: number;
  findings: string[];
}

export interface RefactorCandidate {
  id: string;
  filePath: string;
  reason: string;
  estimatedEffort: "small" | "medium" | "large";
}

// ── Assets ─────────────────────────────────────────────────────────────────

export type AssetKind = "template" | "snippet" | "script" | "recipe" | "checklist";

export interface EngineeringAsset {
  id: string;
  kind: AssetKind;
  name: string;
  description: string;
  tags: string[];
  content: string;
  variables?: string[];
  createdAt: string;
  updatedAt: string;
  usageCount: number;
}

// ── Automation ────────────────────────────────────────────────────────────

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  projectId: string;
  requiresApproval: boolean;
  createdAt: string;
}

export interface AutomationTrigger {
  event: "job_completed" | "job_failed" | "evidence_blocked" | "schedule" | "webhook";
  condition?: Record<string, unknown>;
}

export interface AutomationAction {
  type: "notify" | "create_backlog_item" | "run_job" | "approve";
  params: Record<string, unknown>;
}

export interface AutomationLog {
  id: string;
  ruleId: string;
  firedAt: string;
  result: "success" | "failure";
  message: string;
}

// ── Backlog ───────────────────────────────────────────────────────────────

export interface BacklogItem {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: "open" | "in_progress" | "resolved" | "wont_fix";
  priority: JobPriority;
  detectedAt: string;
  resolvedAt?: string;
  resolvedInVersion?: string;
  source: "scan" | "automation" | "manual" | "learning" | "taxonomy";
}

// ── Governance ─────────────────────────────────────────────────────────────

export type Role = "owner" | "admin" | "developer" | "reviewer" | "observer";
export type Permission =
  | "project.create"
  | "project.delete"
  | "job.run"
  | "job.cancel"
  | "release.publish"
  | "release.approve"
  | "governance.approve"
  | "governance.view"
  | "audit.view"
  | "adapter.register"
  | "automation.manage";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRequest {
  id: string;
  projectId: string;
  requester: string;
  requesterRole?: Role;
  action: string;
  riskLevel: RiskLevel;
  rationale?: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolverRole?: Role;
  expiresAt?: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  actorRole?: Role;
  action: string;
  resource: string;
  projectId?: string;
  riskLevel?: RiskLevel;
  outcome?: "success" | "failure" | "blocked";
  metadata?: Record<string, unknown>;
}

// ── Learning ───────────────────────────────────────────────────────────────

export interface Lesson {
  id: string;
  projectId: string;
  category: "pattern" | "anti-pattern" | "recovery" | "optimization";
  title: string;
  description: string;
  occurrences: number;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Outcome {
  runId: string;
  projectId: string;
  success: boolean;
  passRate: number;
  durationMs: number;
  lessonsLearned: string[];
  createdAt: string;
}

// ── Memory ─────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  projectId: string;
  scope: "project" | "global";
  key: string;
  value: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ArchitecturalDecision {
  id: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  recordedAt: string;
}

export interface TechnicalDebtItem {
  id: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  area: string;
  estimatedEffort: string;
  recordedAt: string;
}

// ── Integrations ────────────────────────────────────────────────────────────

export interface Integration {
  id: string;
  name: string;
  kind: "webhook" | "slack" | "github" | "jira" | "generic";
  config: Record<string, unknown>;
  enabled: boolean;
  healthStatus: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastTestedAt?: string;
}

// ── Intelligence ─────────────────────────────────────────────────────────────

export interface CrossProjectPattern {
  id: string;
  pattern: string;
  frequency: number;
  affectedProjects: string[];
  category: "success" | "failure" | "optimization";
  confidence: number;
}

export interface PortfolioSummary {
  totalProjects: number;
  totalRuns: number;
  avgPassRate: number;
  topPatterns: CrossProjectPattern[];
  recurringFailures: CrossProjectPattern[];
}

// ── Compiler / Recipe ──────────────────────────────────────────────────────

export interface Recipe {
  id: string;
  name: string;
  targetId: string;
  steps: string[];
  successRate: number;
  usageCount: number;
  createdAt: string;
}

export interface FailurePattern {
  id: string;
  targetId: string;
  symptom: string;
  cause: string;
  count: number;
}

export interface RecoveryPattern {
  id: string;
  targetId: string;
  failureSymptom: string;
  recoverySteps: string[];
  successCount: number;
}

export interface AdapterLesson {
  id: string;
  targetId: string;
  lesson: string;
  context: string;
  count: number;
}

export interface DistillationReport {
  totalRecipes: number;
  totalFailures: number;
  totalRecoveries: number;
  totalLessons: number;
  topFailurePatterns: FailurePattern[];
  topRecoveryPatterns: RecoveryPattern[];
}

// ── Events ─────────────────────────────────────────────────────────────────

export interface PlatformEvent {
  id: string;
  projectId?: string;
  runId?: string;
  type: string;
  payload: unknown;
  timestamp: string;
}

// ── Agents ─────────────────────────────────────────────────────────────────

export interface Agent {
  role: string;
  layer: "executive" | "engineering" | "quality" | "release";
  title: string;
  responsibility: string;
}

// ── Release Gate ───────────────────────────────────────────────────────────

export interface ReleaseRecord {
  version: string;
  projectId: string;
  releasedAt: string;
  artifacts: string[];
  artifactHashes: Record<string, string>; // filename → sha256
  evidence: EvidenceNode[];
  releaseNotesPath?: string;
  zipFilename?: string;
  zipRootFolder?: string;
  platformVersion?: string;
}

export interface ReleaseGateResult {
  passed: boolean;
  blockers: string[];
  warnings: string[];
  evidence: EvidenceNode[];
}

export interface ReleaseIdentityReport {
  packageVersion: string;
  zipFilenameVersion?: string;
  zipRootFolderVersion?: string;
  headerVersion?: string;
  releaseNotesVersion?: string;
  coherent: boolean;
  discrepancies: string[];
}
