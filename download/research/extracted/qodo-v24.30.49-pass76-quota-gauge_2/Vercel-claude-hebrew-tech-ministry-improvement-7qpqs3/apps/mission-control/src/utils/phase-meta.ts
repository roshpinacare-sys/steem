/**
 * phase-meta.ts — single source of truth mapping a telemetry `phase` string
 * to a human-readable label and a display category.
 *
 * WHY THIS FILE EXISTS:
 * The backend pipeline (packages/agent/src/cli.ts + every agent/service under
 * it) currently emits 27 distinct `telemetry.decision(phase, ...)` tags —
 * architect, coder, gate, warden, meta-agent, secret-guard, necromancer,
 * mentor, semantic-dag, compliance-oracle, context-enricher, darwin-engine,
 * infra-oracle, janitor, style-aligner, ui-synthesizer, cartographer,
 * incident, sre-feedback, semantic-cache, skill-exchange,
 * vector-skill-exchange, edge-fragment, edge-test, edge-test-channel,
 * r2-storage, ai-router, run — plus whatever a future agent adds.
 *
 * Before this file existed, DecisionTimeline.tsx hardcoded a 6-item allowlist
 * and silently dropped every event whose phase wasn't in it — meaning ~20 of
 * the system's real, live agents were structurally invisible in the UI no
 * matter how much telemetry they emitted. That's the fix this file enables:
 * PHASE_META is a *label/grouping* lookup, not a filter — any phase not
 * listed here still renders, just under the "Other" category with its raw
 * name as the label. Nothing is ever silently dropped again.
 *
 * Add a new agent? Add one line here. Forget to add it? It still shows up
 * (in "Other", unstyled) instead of disappearing.
 */

export type PhaseCategory =
  | "core"        // the main commit pipeline, start to finish
  | "safety"      // gates, guards, and self-correction mechanisms
  | "autonomous"  // proactive agents that act without being in the critical path
  | "infra"       // caching, sharding, storage, cross-agent memory
  | "meta"        // run-level lifecycle (start/done/fatal)
  | "other";      // anything not yet registered above — always shown, never hidden

export interface PhaseMeta {
  label: string;
  category: PhaseCategory;
}

export const PHASE_META: Record<string, PhaseMeta> = {
  // ── Core pipeline (cli.ts state machine, in execution order) ────────────
  architect:   { label: "Architect",               category: "core" },
  coder:       { label: "Coder",                    category: "core" },
  gate:        { label: "Gate",                     category: "core" },
  commit:      { label: "Commit",                   category: "core" },
  astdoc:      { label: "AST Auto-Documentation",   category: "core" },
  canary:      { label: "Canary Rollout",           category: "core" },
  merge:       { label: "Merge",                    category: "core" },
  postmerge:   { label: "Post-Merge Validation",    category: "core" },
  review:      { label: "Reviewer",                 category: "core" },

  // ── Safety & governance ──────────────────────────────────────────────────
  warden:          { label: "Warden (Code Guard)",        category: "safety" },
  "secret-guard":  { label: "Secret Guard",               category: "safety" },
  necromancer:     { label: "Drift Guard",                category: "safety" },
  "meta-agent":    { label: "Meta-Agent (Self-Mutation)", category: "safety" },
  mentor:          { label: "Mentor Approval",            category: "safety" },
  "semantic-dag":  { label: "Concept Lock",               category: "safety" },

  // ── Autonomous / proactive agents ────────────────────────────────────────
  "compliance-oracle": { label: "Compliance Oracle",       category: "autonomous" },
  "context-enricher":  { label: "Context Enricher",        category: "autonomous" },
  "darwin-engine":     { label: "Darwin Engine (Evolve)",  category: "autonomous" },
  "infra-oracle":      { label: "Infra Oracle",            category: "autonomous" },
  janitor:             { label: "Janitor",                 category: "autonomous" },
  "style-aligner":     { label: "Style Aligner",           category: "autonomous" },
  "ui-synthesizer":    { label: "UI Synthesizer",          category: "autonomous" },
  cartographer:        { label: "Cartographer",            category: "autonomous" },
  incident:            { label: "Incident Resolver",       category: "autonomous" },
  "sre-feedback":      { label: "SRE Feedback Loop",       category: "autonomous" },

  // ── Infra / cross-run memory ─────────────────────────────────────────────
  "semantic-cache":        { label: "Semantic Cache",        category: "infra" },
  "skill-exchange":        { label: "Skill Exchange",        category: "infra" },
  "vector-skill-exchange": { label: "Vector Skill Exchange",  category: "infra" },
  "edge-fragment":         { label: "Edge Fragment Sharding", category: "infra" },
  "edge-test":             { label: "Edge Test Offload",      category: "infra" },
  "edge-test-channel":     { label: "P2P Test Grid",          category: "infra" },
  "r2-storage":            { label: "R2 Storage",             category: "infra" },
  "ai-router":             { label: "AI Router",              category: "infra" },

  // ── Run lifecycle ────────────────────────────────────────────────────────
  run:           { label: "Run Lifecycle", category: "meta" },
  "cost-summary": { label: "Cost Summary", category: "meta" },
};

export const CATEGORY_ORDER: PhaseCategory[] = [
  "core",
  "safety",
  "autonomous",
  "infra",
  "meta",
  "other",
];

export const CATEGORY_LABELS: Record<PhaseCategory, string> = {
  core: "Core Pipeline",
  safety: "Safety & Governance",
  autonomous: "Autonomous Agents",
  infra: "Infra & Memory",
  meta: "Run Lifecycle",
  other: "Other",
};

/** Human-readable label for a phase, falling back to the raw string. */
export function phaseLabel(phase: string | null | undefined): string {
  if (!phase) return "Unknown";
  return PHASE_META[phase]?.label ?? phase;
}

/** Category for a phase, falling back to "other" — never throws, never hides. */
export function phaseCategory(phase: string | null | undefined): PhaseCategory {
  if (!phase) return "other";
  return PHASE_META[phase]?.category ?? "other";
}
