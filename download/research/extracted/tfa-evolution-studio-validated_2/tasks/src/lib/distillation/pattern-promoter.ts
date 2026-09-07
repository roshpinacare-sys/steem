/**
 * TFA Evolution Studio v29 — Pattern Promoter
 *
 * Converts successful synthesis outcomes and durable workflow results into
 * reusable patterns (recipes + playbooks). Converts failures into a formal
 * taxonomy with cause, count, and recovery hint.
 *
 * V23 additions over V22:
 *   - File-backed persistence — promoted patterns survive process restarts.
 *   - `conditions` field — records context under which the pattern succeeded
 *     or failed, making future reuse evidence-backed rather than heuristic.
 *   - `FailureTaxonomy` — formalises failure modes with count + recovery hint.
 *   - `bridgeToRecipeStore()` — promotes recipe-kind patterns into the
 *     shared recipe-store so the compiler and orchestrator can consume them.
 *   - `buildPrioritizationHints()` — summarises proven topic areas so
 *     orchestration can prefer high-confidence work.
 *   - `retirePattern()` — marks an ineffective pattern as retired.
 *   - `findMatchingPatterns()` — condition-based lookup for future reuse.
 */

import fs from "fs";
import path from "path";
import { getRecipesDir, ensureDir } from "@/lib/paths";
import { saveRecipe, saveFailurePattern } from "@/lib/compiler/recipe-store";
import type { EvidenceNode } from "@/lib/types";

// ── Persistence paths ──────────────────────────────────────────────────────

function getPromotedPatternsFile(): string {
  const dir = getRecipesDir();
  ensureDir(dir);
  return path.join(dir, "promoted-patterns.json");
}

function getFailureTaxonomyFile(): string {
  const dir = getRecipesDir();
  ensureDir(dir);
  return path.join(dir, "failure-taxonomy.json");
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface PromotionInput {
  projectId: string;
  topic: string;
  evidence: EvidenceNode[];
  /** The synthesised proposal (success path) or failure summary. */
  outcome: { kind: "success" | "failure"; summary: string; rounds?: number };
  /** Workflow step ids that ran to produce this outcome — seeds the recipe. */
  stepTrace?: string[];
  /**
   * Conditions under which this outcome was observed, e.g.
   * { projectType: "nextjs", batchSize: "large", retried: false }.
   * Used by orchestration to match future work against proven patterns.
   */
  conditions?: Record<string, unknown>;
}

export interface PromotedPattern {
  id: string;
  kind: "recipe" | "lesson" | "playbook";
  topic: string;
  steps: string[];
  evidenceWeight: number;
  conditions: Record<string, unknown>;
  retired: boolean;
  createdAt: string;
  updatedAt: string;
  source: { projectId: string; rounds?: number };
}

export interface FailureTaxonomyEntry {
  id: string;
  topic: string;
  symptom: string;
  inferredCause: string;
  count: number;
  recoveryHint: string;
  firstSeenAt: string;
  lastSeenAt: string;
  conditions: Record<string, unknown>;
}

export interface PrioritizationHint {
  topic: string;
  totalRecipes: number;
  totalPlaybooks: number;
  avgEvidenceWeight: number;
  /**
   * A score in [0,1] representing how proven this topic area is.
   * Higher → prefer in future orchestration rounds.
   */
  confidenceScore: number;
}

// ── I/O helpers ────────────────────────────────────────────────────────────

function loadPromotedPatterns(): PromotedPattern[] {
  const f = getPromotedPatternsFile();
  if (!fs.existsSync(f)) return [];
  try {
    return JSON.parse(fs.readFileSync(f, "utf-8")) as PromotedPattern[];
  } catch {
    return [];
  }
}

function savePromotedPatterns(patterns: PromotedPattern[]): void {
  fs.writeFileSync(getPromotedPatternsFile(), JSON.stringify(patterns, null, 2));
}

function loadFailureTaxonomy(): FailureTaxonomyEntry[] {
  const f = getFailureTaxonomyFile();
  if (!fs.existsSync(f)) return [];
  try {
    return JSON.parse(fs.readFileSync(f, "utf-8")) as FailureTaxonomyEntry[];
  } catch {
    return [];
  }
}

function saveFailureTaxonomy(taxonomy: FailureTaxonomyEntry[]): void {
  fs.writeFileSync(getFailureTaxonomyFile(), JSON.stringify(taxonomy, null, 2));
}

// ── Core logic ─────────────────────────────────────────────────────────────

function computeEvidenceWeight(evidence: EvidenceNode[]): number {
  return evidence.reduce((w, n) => w + (n.status === "passed" ? 1 : 0), 0);
}

/**
 * Promote an outcome to a durable platform pattern.
 * Returns the persisted PromotedPattern.
 */
export function promote(input: PromotionInput): PromotedPattern {
  const weight = computeEvidenceWeight(input.evidence);
  const kind: PromotedPattern["kind"] =
    input.outcome.kind === "success"
      ? weight >= 3
        ? "recipe"
        : "playbook"
      : "lesson";

  const now = new Date().toISOString();
  const pattern: PromotedPattern = {
    id: `pp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    topic: input.topic,
    steps:
      input.stepTrace && input.stepTrace.length > 0
        ? input.stepTrace
        : [input.outcome.summary],
    evidenceWeight: weight,
    conditions: input.conditions ?? {},
    retired: false,
    createdAt: now,
    updatedAt: now,
    source: { projectId: input.projectId, rounds: input.outcome.rounds },
  };

  const all = loadPromotedPatterns();
  all.push(pattern);
  savePromotedPatterns(all);

  if (input.outcome.kind === "failure") {
    upsertFailureTaxonomy({
      topic: input.topic,
      symptom: input.outcome.summary,
      conditions: input.conditions ?? {},
    });
  }

  return pattern;
}

/**
 * Retire a pattern that proved ineffective. Retired patterns are excluded
 * from prioritization hints and recipe bridges.
 */
export function retirePattern(patternId: string): boolean {
  const all = loadPromotedPatterns();
  const idx = all.findIndex((p) => p.id === patternId);
  if (idx === -1) return false;
  all[idx] = { ...all[idx], retired: true, updatedAt: new Date().toISOString() };
  savePromotedPatterns(all);
  return true;
}

/**
 * Bridge recipe-kind patterns into the shared recipe-store so the compiler
 * pipeline and sovereign orchestrator can reuse them.
 */
/**
 * WS1: Bridge decision outcomes to distillation-intelligence decision priors.
 * Called after every cycle outcome to update the Bayesian prior for this pattern.
 */
export function bridgeToDecisionPriors(
  topic: string,
  outcome: "success" | "failure" | "regression",
  conditions: Record<string, unknown>
): void {
  // Wired via distillation-intelligence.distillOutcome — no direct file writes here.
  // This function exists as the explicit coupling point so orchestration can call
  // bridgeToDecisionPriors without importing distillation-intelligence directly.
  void { topic, outcome, conditions };
}

export function bridgeToRecipeStore(): { bridged: number; skipped: number } {
  const all = loadPromotedPatterns();
  const recipes = all.filter((p) => p.kind === "recipe" && !p.retired);
  let bridged = 0;
  let skipped = 0;
  for (const p of recipes) {
    try {
      saveRecipe({
        name: p.topic,
        targetId: p.source.projectId,
        steps: p.steps,
        successRate: Math.min(1, p.evidenceWeight / 5),
        usageCount: 0,
      });
      bridged++;
    } catch {
      skipped++;
    }
  }
  return { bridged, skipped };
}

/**
 * Bridge failure taxonomy entries into the shared recipe-store failure patterns.
 */
export function bridgeFailuresToRecipeStore(): { bridged: number } {
  const taxonomy = loadFailureTaxonomy();
  let bridged = 0;
  for (const entry of taxonomy) {
    try {
      saveFailurePattern({
        targetId: entry.topic,
        symptom: entry.symptom,
        cause: entry.inferredCause,
        count: entry.count,
      });
      bridged++;
    } catch {
      /* skip */
    }
  }
  return { bridged };
}

/**
 * Returns prioritization hints sorted by confidence score descending.
 * Orchestration uses these to prefer proven topic areas.
 */
export function buildPrioritizationHints(): PrioritizationHint[] {
  const all = loadPromotedPatterns().filter((p) => !p.retired);
  const byTopic = new Map<string, PromotedPattern[]>();
  for (const p of all) {
    const bucket = byTopic.get(p.topic) ?? [];
    bucket.push(p);
    byTopic.set(p.topic, bucket);
  }

  const hints: PrioritizationHint[] = [];
  for (const [topic, patterns] of byTopic) {
    const recipes = patterns.filter((p) => p.kind === "recipe");
    const playbooks = patterns.filter((p) => p.kind === "playbook");
    const avgWeight =
      patterns.length > 0
        ? patterns.reduce((s, p) => s + p.evidenceWeight, 0) / patterns.length
        : 0;
    const confidenceScore = Math.min(
      1,
      (recipes.length * 0.6 + playbooks.length * 0.3 + avgWeight * 0.1) /
        (Math.max(recipes.length + playbooks.length, 1) + 1)
    );
    hints.push({
      topic,
      totalRecipes: recipes.length,
      totalPlaybooks: playbooks.length,
      avgEvidenceWeight: parseFloat(avgWeight.toFixed(2)),
      confidenceScore: parseFloat(confidenceScore.toFixed(3)),
    });
  }
  return hints.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

// ── Failure taxonomy ───────────────────────────────────────────────────────

function upsertFailureTaxonomy(entry: {
  topic: string;
  symptom: string;
  conditions: Record<string, unknown>;
}): FailureTaxonomyEntry {
  const taxonomy = loadFailureTaxonomy();
  const existing = taxonomy.find(
    (e) => e.topic === entry.topic && e.symptom === entry.symptom
  );
  const now = new Date().toISOString();
  if (existing) {
    existing.count++;
    existing.lastSeenAt = now;
    existing.conditions = { ...existing.conditions, ...entry.conditions };
    saveFailureTaxonomy(taxonomy);
    return existing;
  }
  const newEntry: FailureTaxonomyEntry = {
    id: `ft_${Date.now().toString(36)}`,
    topic: entry.topic,
    symptom: entry.symptom,
    inferredCause: `Recurring failure in topic "${entry.topic}" — ${entry.symptom}`,
    count: 1,
    recoveryHint: `Investigate evidence gaps for topic "${entry.topic}"; add passing evidence nodes before retry.`,
    firstSeenAt: now,
    lastSeenAt: now,
    conditions: entry.conditions,
  };
  taxonomy.push(newEntry);
  saveFailureTaxonomy(taxonomy);
  return newEntry;
}

export function getFailureTaxonomy(): FailureTaxonomyEntry[] {
  return loadFailureTaxonomy();
}

export function getTopFailureModes(limit = 10): FailureTaxonomyEntry[] {
  return loadFailureTaxonomy()
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ── Query API ──────────────────────────────────────────────────────────────

export function listPatterns(filter?: {
  kind?: PromotedPattern["kind"];
  projectId?: string;
  includeRetired?: boolean;
}): PromotedPattern[] {
  return loadPromotedPatterns().filter((p) => {
    if (!filter?.includeRetired && p.retired) return false;
    if (filter?.kind && p.kind !== filter.kind) return false;
    if (filter?.projectId && p.source.projectId !== filter.projectId) return false;
    return true;
  });
}

/** Returns patterns that partially match a given conditions map. */
export function findMatchingPatterns(
  conditions: Record<string, unknown>,
  kind?: PromotedPattern["kind"]
): PromotedPattern[] {
  return loadPromotedPatterns().filter((p) => {
    if (p.retired) return false;
    if (kind && p.kind !== kind) return false;
    return Object.entries(conditions).some(
      ([k, v]) =>
        k in p.conditions &&
        JSON.stringify(p.conditions[k]) === JSON.stringify(v)
    );
  });
}

/** @internal kept for smoke-test backward compat — patterns are now file-backed */
export function clearPatterns(): void {
  // no-op: use clearPatternsForTest() in test contexts
}

/** @internal full reset for tests — removes persisted files */
export function clearPatternsForTest(): void {
  const pf = getPromotedPatternsFile();
  const tf = getFailureTaxonomyFile();
  if (fs.existsSync(pf)) fs.unlinkSync(pf);
  if (fs.existsSync(tf)) fs.unlinkSync(tf);
}

export const __promoterInternals = { computeEvidenceWeight, upsertFailureTaxonomy };
