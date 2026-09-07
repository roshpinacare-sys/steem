/**
 * TFA Evolution Studio v29 — Playbook Engine
 *
 * Reusable runbooks for common evolution scenarios.
 *
 * V23 additions:
 *   - `fromPromotedPattern()` — converts a playbook-kind PromotedPattern into
 *     an executable Playbook so promoted knowledge is immediately usable.
 *   - `mergePlaybooks()` — combines two playbooks for the same topic
 *     (deduplicates steps, merges triggers).
 *   - Default set expanded: distillation cycle + evidence gap recovery runbooks.
 */

import type { PromotedPattern } from "@/lib/distillation/pattern-promoter";

export interface Playbook {
  id: string;
  name: string;
  steps: string[];
  triggers: string[];
  /** Source pattern id when promoted from a PromotedPattern, undefined otherwise. */
  sourcePatternId?: string;
}

export function getDefaultPlaybooks(): Playbook[] {
  return [
    {
      id: "pb_upgrade",
      name: "Version Upgrade",
      steps: [
        "Bump version in package.json",
        "Update package-lock.json to match",
        "Update RELEASE_NOTES.md heading and Version field",
        "Update README heading",
        "Update Sidebar version label",
        "Run coherence:check",
        "Run self-audit",
        "Package ZIP",
      ],
      triggers: ["release_requested"],
    },
    {
      id: "pb_fix",
      name: "Hotfix Pipeline",
      steps: [
        "Isolate failing evidence node",
        "Apply minimal targeted fix",
        "Record fix evidence node",
        "Run tests",
        "Run self-audit",
        "Build release",
      ],
      triggers: ["critical_bug_detected"],
    },
    {
      id: "pb_distillation",
      name: "Distillation Cycle",
      steps: [
        "Collect outcomes from last N cycles",
        "Promote high-evidence successes to recipes",
        "Promote lower-evidence successes to playbooks",
        "Record failures in failure taxonomy",
        "Bridge recipes to recipe-store",
        "Rebuild prioritization hints",
        "Update backlog scoring with promoted patterns",
      ],
      triggers: ["cycle_completed", "batch_reconciled"],
    },
    {
      id: "pb_evidence_recovery",
      name: "Evidence Gap Recovery",
      steps: [
        "Identify missing evidence nodes from evaluation report",
        "For each missing node: locate the responsible module",
        "Re-run the module with corrected inputs",
        "Record the new evidence node",
        "Re-evaluate the evidence chain",
        "Proceed only when chain is complete",
      ],
      triggers: ["evidence_blocked", "requires_more_evidence"],
    },
  ];
}

export function getPlaybook(id: string): Playbook | undefined {
  return getDefaultPlaybooks().find((p) => p.id === id);
}

/**
 * Convert a playbook-kind PromotedPattern into a runtime Playbook.
 * Bridges the distillation layer into the execution layer.
 */
export function fromPromotedPattern(pattern: PromotedPattern): Playbook {
  return {
    id: `pb_promoted_${pattern.id}`,
    name: pattern.topic,
    steps: pattern.steps,
    triggers: ["distillation_promoted"],
    sourcePatternId: pattern.id,
  };
}

/**
 * Merge two playbooks that cover the same topic.
 * Deduplicates steps (preserving order of a), merges triggers.
 */
export function mergePlaybooks(a: Playbook, b: Playbook): Playbook {
  const seen = new Set(a.steps);
  const merged = [...a.steps];
  for (const s of b.steps) {
    if (!seen.has(s)) { merged.push(s); seen.add(s); }
  }
  return {
    id: a.id,
    name: a.name,
    steps: merged,
    triggers: Array.from(new Set([...a.triggers, ...b.triggers])),
    sourcePatternId: a.sourcePatternId ?? b.sourcePatternId,
  };
}

/**
 * WS1: Return playbooks that encode a known architecture pattern.
 * Used by intelligence dashboard to surface structural recommendations.
 */
export function getArchitecturePlaybooks(
  playbooks: Playbook[]
): Playbook[] {
  return playbooks.filter(p =>
    p.triggers?.some((t: string) => t.startsWith("architecture:")) ?? false
  );
}

/**
 * WS1: Construct a playbook trigger tag for an architecture pattern.
 */
export function architecturePatternTrigger(patternName: string): string {
  return `architecture:${patternName}`;
}
