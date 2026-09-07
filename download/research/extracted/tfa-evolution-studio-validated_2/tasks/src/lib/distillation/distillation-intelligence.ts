/**
 * TFA Evolution Studio v29 — Distillation Intelligence
 *
 * WS1: Converts raw cycle outcomes into reusable, typed knowledge assets.
 *
 * Knowledge types produced:
 *   SuccessRecipe      — step-by-step playbook distilled from successful cycles
 *   FailureTaxonomy    — categorised failure modes with cause + recovery path
 *   EngineeringPlaybook — actionable multi-step runbooks for recurring scenarios
 *   ArchitecturePattern — structural decisions proven across multiple projects
 *   DecisionPrior       — Bayesian prior for a decision class (success rate + count)
 *   RecoveryStrategy    — ordered recovery procedure for a known failure mode
 *   ReusablePolicy      — governance rule auto-applied in future cycles
 *
 * Learning sources:
 *   - successful cycles   (promote to recipe / architecture pattern)
 *   - failed cycles       (promote to failure taxonomy + recovery strategy)
 *   - regressions         (update decision prior negatively)
 *   - agent conflicts     (record as policy)
 *   - stress / chaos runs (update recovery strategy success rates)
 *   - release audits      (update architecture pattern confidence)
 *
 * All knowledge assets are file-backed so they survive process restarts and
 * accumulate across releases. Every asset carries a confidence score derived
 * from evidence weight so orchestration can prefer high-confidence assets.
 */

import fs from "fs";
import path from "path";
import { getRecipesDir, ensureDir } from "@/lib/paths";

// ── File paths ─────────────────────────────────────────────────────────────

function knowledgeDir(): string {
  const d = path.join(getRecipesDir(), "knowledge");
  ensureDir(d);
  return d;
}

const FILES = {
  successRecipes:       () => path.join(knowledgeDir(), "success-recipes.json"),
  failureTaxonomy:      () => path.join(knowledgeDir(), "failure-taxonomy.json"),
  engineeringPlaybooks: () => path.join(knowledgeDir(), "engineering-playbooks.json"),
  architecturePatterns: () => path.join(knowledgeDir(), "architecture-patterns.json"),
  decisionPriors:       () => path.join(knowledgeDir(), "decision-priors.json"),
  recoveryStrategies:   () => path.join(knowledgeDir(), "recovery-strategies.json"),
  reusablePolicies:     () => path.join(knowledgeDir(), "reusable-policies.json"),
};

function load<T>(fileFn: () => string): T[] {
  const f = fileFn();
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, "utf-8")) as T[]; } catch { return []; }
}

function save<T>(fileFn: () => string, data: T[]): void {
  fs.writeFileSync(fileFn(), JSON.stringify(data, null, 2));
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface SuccessRecipe {
  id: string;
  topic: string;
  steps: string[];
  /** Number of cycles that produced this outcome successfully. */
  successCount: number;
  /** 0–1 derived from evidenceWeight / totalCycles. */
  confidence: number;
  conditions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface FailureTaxonomyEntry {
  id: string;
  category: "build" | "adapter" | "evidence" | "provider" | "integrity" | "synthesis" | "unknown";
  symptom: string;
  inferredCause: string;
  count: number;
  recoveryHint: string;
  affectedProjects: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface EngineeringPlaybook {
  id: string;
  name: string;
  scenario: string;
  steps: string[];
  triggers: string[];
  successRate: number;
  usageCount: number;
  lastUsedAt?: string;
  createdAt: string;
}

export interface ArchitecturePattern {
  id: string;
  name: string;
  description: string;
  /** Structural modules involved. */
  modules: string[];
  /** Confidence this pattern improves quality. */
  confidence: number;
  /** How many projects have validated this pattern. */
  validationCount: number;
  antiPatterns: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DecisionPrior {
  id: string;
  decisionClass: string;
  /** Empirical success rate [0–1] updated on every cycle outcome. */
  successRate: number;
  totalObservations: number;
  successObservations: number;
  lastObservedAt: string;
  /** Context conditions where this prior applies. */
  conditions: Record<string, unknown>;
  createdAt: string;
}

export interface RecoveryStrategy {
  id: string;
  failureMode: string;
  steps: string[];
  /** Times this strategy was applied. */
  applicationCount: number;
  /** Times it led to successful recovery. */
  successCount: number;
  successRate: number;
  lastAppliedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReusablePolicy {
  id: string;
  name: string;
  rule: string;
  /** When to automatically apply this policy. */
  trigger: string;
  /** Evidence this policy prevents failures. */
  evidenceCount: number;
  enabled: boolean;
  sourceConflict?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Distillation input ─────────────────────────────────────────────────────

export interface DistillationInput {
  projectId: string;
  topic: string;
  outcome: "success" | "failure" | "regression";
  steps: string[];
  evidenceWeight: number;
  durationMs: number;
  conditions: Record<string, unknown>;
  failureSymptom?: string;
  failureCategory?: FailureTaxonomyEntry["category"];
  agentConflicts?: string[];
  /** Architecture modules involved — seeds ArchitecturePattern. */
  architectureModules?: string[];
}

export interface DistillationResult {
  successRecipeId?: string;
  failureTaxonomyId?: string;
  playbookId?: string;
  architecturePatternId?: string;
  decisionPriorId: string;
  recoveryStrategyId?: string;
  policyIds: string[];
  confidenceScore: number;
  summary: string;
}

// ── Core distillation logic ────────────────────────────────────────────────

function nano(): string { return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }

/**
 * Ingest a cycle outcome and produce typed knowledge assets.
 * This is the primary entry point called by the evolution engine
 * after every cycle (success, failure, or regression).
 */
export function distillOutcome(input: DistillationInput): DistillationResult {
  const now = new Date().toISOString();
  const result: DistillationResult = {
    decisionPriorId: "",
    policyIds: [],
    confidenceScore: 0,
    summary: "",
  };

  // 1. Update decision prior (always — success and failure both inform it)
  result.decisionPriorId = upsertDecisionPrior(input, now);

  // 2. Success path: produce recipe + architecture pattern + playbook
  if (input.outcome === "success") {
    result.successRecipeId = upsertSuccessRecipe(input, now);
    if (input.architectureModules && input.architectureModules.length > 0) {
      result.architecturePatternId = upsertArchitecturePattern(input, now);
    }
    result.playbookId = upsertEngineeringPlaybook(input, now);
  }

  // 3. Failure path: produce taxonomy entry + recovery strategy
  if (input.outcome === "failure" || input.outcome === "regression") {
    if (input.failureSymptom) {
      result.failureTaxonomyId = upsertFailureTaxonomy(input, now);
      result.recoveryStrategyId = upsertRecoveryStrategy(input, now);
    }
  }

  // 4. Agent conflicts: produce reusable policies
  if (input.agentConflicts && input.agentConflicts.length > 0) {
    result.policyIds = upsertReusablePolicies(input.agentConflicts, input.topic, now);
  }

  result.confidenceScore = computeConfidence(input);
  result.summary = buildSummary(input, result);

  return result;
}

// ── Upsert helpers ─────────────────────────────────────────────────────────

function upsertSuccessRecipe(input: DistillationInput, now: string): string {
  const all = load<SuccessRecipe>(FILES.successRecipes);
  const existing = all.find(r => r.topic === input.topic);
  if (existing) {
    existing.successCount++;
    existing.confidence = Math.min(1, existing.confidence + 0.05);
    existing.updatedAt = now;
    // Merge new steps not already present
    for (const s of input.steps) {
      if (!existing.steps.includes(s)) existing.steps.push(s);
    }
    save<SuccessRecipe>(FILES.successRecipes, all);
    return existing.id;
  }
  const recipe: SuccessRecipe = {
    id: `sr_${nano()}`,
    topic: input.topic,
    steps: [...input.steps],
    successCount: 1,
    confidence: Math.min(1, input.evidenceWeight / 5),
    conditions: input.conditions,
    createdAt: now,
    updatedAt: now,
  };
  all.push(recipe);
  save<SuccessRecipe>(FILES.successRecipes, all);
  return recipe.id;
}

function upsertFailureTaxonomy(input: DistillationInput, now: string): string {
  const all = load<FailureTaxonomyEntry>(FILES.failureTaxonomy);
  const sym = input.failureSymptom!;
  const existing = all.find(e => e.symptom === sym);
  if (existing) {
    existing.count++;
    existing.lastSeenAt = now;
    if (!existing.affectedProjects.includes(input.projectId)) {
      existing.affectedProjects.push(input.projectId);
    }
    save<FailureTaxonomyEntry>(FILES.failureTaxonomy, all);
    return existing.id;
  }
  const entry: FailureTaxonomyEntry = {
    id: `ft_${nano()}`,
    category: input.failureCategory ?? "unknown",
    symptom: sym,
    inferredCause: `Recurring failure: "${sym}" in topic "${input.topic}"`,
    count: 1,
    recoveryHint: `Investigate evidence gaps for "${input.topic}". Ensure all required evidence nodes are passing before proceeding.`,
    affectedProjects: [input.projectId],
    firstSeenAt: now,
    lastSeenAt: now,
  };
  all.push(entry);
  save<FailureTaxonomyEntry>(FILES.failureTaxonomy, all);
  return entry.id;
}

function upsertEngineeringPlaybook(input: DistillationInput, now: string): string {
  const all = load<EngineeringPlaybook>(FILES.engineeringPlaybooks);
  const existing = all.find(p => p.scenario === input.topic);
  if (existing) {
    existing.usageCount++;
    existing.successRate = Math.min(1, (existing.successRate * (existing.usageCount - 1) + 1) / existing.usageCount);
    existing.lastUsedAt = now;
    for (const s of input.steps) {
      if (!existing.steps.includes(s)) existing.steps.push(s);
    }
    save<EngineeringPlaybook>(FILES.engineeringPlaybooks, all);
    return existing.id;
  }
  const pb: EngineeringPlaybook = {
    id: `epb_${nano()}`,
    name: `${input.topic} Playbook`,
    scenario: input.topic,
    steps: [...input.steps],
    triggers: ["cycle_completed", `topic:${input.topic}`],
    successRate: 1.0,
    usageCount: 1,
    lastUsedAt: now,
    createdAt: now,
  };
  all.push(pb);
  save<EngineeringPlaybook>(FILES.engineeringPlaybooks, all);
  return pb.id;
}

function upsertArchitecturePattern(input: DistillationInput, now: string): string {
  const modules = input.architectureModules ?? [];
  const name = `${input.topic} Pattern`;
  const all = load<ArchitecturePattern>(FILES.architecturePatterns);
  const existing = all.find(p => p.name === name);
  if (existing) {
    existing.validationCount++;
    existing.confidence = Math.min(1, existing.confidence + 0.03);
    existing.updatedAt = now;
    for (const m of modules) {
      if (!existing.modules.includes(m)) existing.modules.push(m);
    }
    save<ArchitecturePattern>(FILES.architecturePatterns, all);
    return existing.id;
  }
  const ap: ArchitecturePattern = {
    id: `ap_${nano()}`,
    name,
    description: `Architecture pattern validated during "${input.topic}" cycle on project ${input.projectId}`,
    modules,
    confidence: Math.min(1, input.evidenceWeight / 5),
    validationCount: 1,
    antiPatterns: [],
    createdAt: now,
    updatedAt: now,
  };
  all.push(ap);
  save<ArchitecturePattern>(FILES.architecturePatterns, all);
  return ap.id;
}

function upsertDecisionPrior(input: DistillationInput, now: string): string {
  const all = load<DecisionPrior>(FILES.decisionPriors);
  const cls = input.topic;
  const existing = all.find(p => p.decisionClass === cls);
  const success = input.outcome === "success" ? 1 : 0;
  if (existing) {
    existing.totalObservations++;
    existing.successObservations += success;
    existing.successRate = existing.successObservations / existing.totalObservations;
    existing.lastObservedAt = now;
    existing.conditions = { ...existing.conditions, ...input.conditions };
    save<DecisionPrior>(FILES.decisionPriors, all);
    return existing.id;
  }
  const dp: DecisionPrior = {
    id: `dp_${nano()}`,
    decisionClass: cls,
    successRate: success,
    totalObservations: 1,
    successObservations: success,
    lastObservedAt: now,
    conditions: input.conditions,
    createdAt: now,
  };
  all.push(dp);
  save<DecisionPrior>(FILES.decisionPriors, all);
  return dp.id;
}

function upsertRecoveryStrategy(input: DistillationInput, now: string): string {
  const mode = input.failureSymptom!;
  const all = load<RecoveryStrategy>(FILES.recoveryStrategies);
  const existing = all.find(r => r.failureMode === mode);
  const recoverySteps = input.steps.length > 0 ? input.steps : [
    `Identify root cause for: "${mode}"`,
    "Collect missing evidence nodes",
    "Re-run affected phase with corrected inputs",
    "Verify evidence chain completeness before proceeding",
  ];
  if (existing) {
    existing.applicationCount++;
    // Only count as success if the outcome was eventually resolved
    if (input.outcome === "success") {
      existing.successCount++;
    }
    existing.successRate = existing.applicationCount > 0
      ? existing.successCount / existing.applicationCount
      : 0;
    existing.lastAppliedAt = now;
    existing.updatedAt = now;
    for (const s of recoverySteps) {
      if (!existing.steps.includes(s)) existing.steps.push(s);
    }
    save<RecoveryStrategy>(FILES.recoveryStrategies, all);
    return existing.id;
  }
  const rs: RecoveryStrategy = {
    id: `rs_${nano()}`,
    failureMode: mode,
    steps: recoverySteps,
    applicationCount: 1,
    successCount: 0,
    successRate: 0,
    lastAppliedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  all.push(rs);
  save<RecoveryStrategy>(FILES.recoveryStrategies, all);
  return rs.id;
}

function upsertReusablePolicies(conflicts: string[], topic: string, now: string): string[] {
  const all = load<ReusablePolicy>(FILES.reusablePolicies);
  const ids: string[] = [];
  for (const conflict of conflicts) {
    const existing = all.find(p => p.sourceConflict === conflict);
    if (existing) {
      existing.evidenceCount++;
      existing.updatedAt = now;
      ids.push(existing.id);
      continue;
    }
    const policy: ReusablePolicy = {
      id: `rp_${nano()}`,
      name: `Auto-policy from conflict: ${conflict.slice(0, 60)}`,
      rule: `When topic "${topic}" triggers conflict "${conflict}", require additional evidence before synthesis.`,
      trigger: `conflict:${topic}`,
      evidenceCount: 1,
      enabled: true,
      sourceConflict: conflict,
      createdAt: now,
      updatedAt: now,
    };
    all.push(policy);
    ids.push(policy.id);
  }
  save<ReusablePolicy>(FILES.reusablePolicies, all);
  return ids;
}

// ── Confidence scoring ─────────────────────────────────────────────────────

function computeConfidence(input: DistillationInput): number {
  const evidenceScore = Math.min(1, input.evidenceWeight / 5);
  const outcomeScore = input.outcome === "success" ? 1 : input.outcome === "regression" ? 0.3 : 0;
  const durationPenalty = input.durationMs > 120_000 ? 0.1 : 0;
  return Math.max(0, Math.min(1, evidenceScore * 0.6 + outcomeScore * 0.4 - durationPenalty));
}

// ── Summary ─────────────────────────────────────────────────────────────────

function buildSummary(input: DistillationInput, result: DistillationResult): string {
  const assets: string[] = [];
  if (result.successRecipeId) assets.push(`recipe:${result.successRecipeId}`);
  if (result.failureTaxonomyId) assets.push(`taxonomy:${result.failureTaxonomyId}`);
  if (result.playbookId) assets.push(`playbook:${result.playbookId}`);
  if (result.architecturePatternId) assets.push(`pattern:${result.architecturePatternId}`);
  if (result.recoveryStrategyId) assets.push(`recovery:${result.recoveryStrategyId}`);
  if (result.policyIds.length) assets.push(`policies:${result.policyIds.length}`);
  return `Distilled [${input.outcome}] "${input.topic}" → confidence=${result.confidenceScore.toFixed(2)} assets=[${assets.join(", ")}]`;
}

// ── Query API ──────────────────────────────────────────────────────────────

export function getSuccessRecipes(): SuccessRecipe[] { return load<SuccessRecipe>(FILES.successRecipes); }
export function getFailureTaxonomy(): FailureTaxonomyEntry[] { return load<FailureTaxonomyEntry>(FILES.failureTaxonomy); }
export function getEngineeringPlaybooks(): EngineeringPlaybook[] { return load<EngineeringPlaybook>(FILES.engineeringPlaybooks); }
export function getArchitecturePatterns(): ArchitecturePattern[] { return load<ArchitecturePattern>(FILES.architecturePatterns); }
export function getDecisionPriors(): DecisionPrior[] { return load<DecisionPrior>(FILES.decisionPriors); }
export function getRecoveryStrategies(): RecoveryStrategy[] { return load<RecoveryStrategy>(FILES.recoveryStrategies); }
export function getReusablePolicies(): ReusablePolicy[] { return load<ReusablePolicy>(FILES.reusablePolicies).filter(p => p.enabled); }

/**
 * Return decision prior for a given class, or a neutral prior if none exists.
 * Used by decision scoring to weight historical evidence.
 */
export function getDecisionPrior(decisionClass: string): DecisionPrior | null {
  return load<DecisionPrior>(FILES.decisionPriors).find(p => p.decisionClass === decisionClass) ?? null;
}

/**
 * Get top N failure modes by frequency — used by backlog engine to surface
 * recurring failures as tracked work items.
 */
export function getTopFailureModes(n = 10): FailureTaxonomyEntry[] {
  return load<FailureTaxonomyEntry>(FILES.failureTaxonomy)
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

/**
 * Return all knowledge assets as a unified summary — used by intelligence
 * dashboard and self-evaluation loop.
 */
export function getKnowledgeSummary(): {
  successRecipes: number;
  failureModes: number;
  playbooks: number;
  architecturePatterns: number;
  decisionPriors: number;
  recoveryStrategies: number;
  reusablePolicies: number;
  avgConfidence: number;
} {
  const recipes = load<SuccessRecipe>(FILES.successRecipes);
  const priors = load<DecisionPrior>(FILES.decisionPriors);
  const avgConfidence = priors.length
    ? priors.reduce((s, p) => s + p.successRate, 0) / priors.length
    : 0;
  return {
    successRecipes: recipes.length,
    failureModes: load<FailureTaxonomyEntry>(FILES.failureTaxonomy).length,
    playbooks: load<EngineeringPlaybook>(FILES.engineeringPlaybooks).length,
    architecturePatterns: load<ArchitecturePattern>(FILES.architecturePatterns).length,
    decisionPriors: priors.length,
    recoveryStrategies: load<RecoveryStrategy>(FILES.recoveryStrategies).length,
    reusablePolicies: load<ReusablePolicy>(FILES.reusablePolicies).filter(p => p.enabled).length,
    avgConfidence: parseFloat(avgConfidence.toFixed(3)),
  };
}

/** @internal test reset */
export function clearKnowledgeBaseForTest(): void {
  for (const fileFn of Object.values(FILES)) {
    const f = fileFn();
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
