/**
 * frontend/policy-visualizer/tree.ts — Build a visual policy tree and diff two policy versions.
 *
 * Converts a DeclarativePolicy into a flat array of PolicyTreeNode (one per rule
 * + one default node), each classified into one of four visual branches:
 *   auto             — allow, no financial/amount signals
 *   human            — allow, but isAutonomous=true or isFinancial=true (needs review)
 *   threshold-escrow — allow or deny conditioned on amount thresholds
 *   deny             — unconditional or conditional deny
 *
 * diffPolicies compares two policy versions and returns a structured change set.
 *
 * Pure, deterministic, zero external dependencies.
 */

import type {
  DeclarativePolicyShape,
  PolicyTreeNode,
  PolicyBranch,
  PolicyRuleShape,
  PolicyConditionShape,
  PolicyDiff,
  PolicyRuleDiff,
} from "./types.ts";

/**
 * Classify a rule into the correct visual branch.
 *
 * Priority order (highest wins):
 * 1. amount condition (amountAbove/amountAtMost) → "threshold-escrow" (allow or deny)
 * 2. then=deny (no amount) → "deny"
 * 3. then=allow + isAutonomous=true or isFinancial=true → "human"
 * 4. then=allow (no special signals) → "auto"
 *
 * Amount conditions take priority over deny, because a deny conditioned on
 * an amount threshold is a threshold-escrow branch, not an unconditional deny.
 */
export function classifyBranch(rule: PolicyRuleShape): PolicyBranch {
  const c: PolicyConditionShape = rule.if ?? {};
  if (c.amountAbove !== undefined || c.amountAtMost !== undefined) return "threshold-escrow";
  if (rule.then === "deny") return "deny";
  if (c.isAutonomous === true || c.isFinancial === true) return "human";
  return "auto";
}

function conditionLabel(c: PolicyConditionShape): string {
  const parts: string[] = [];
  if (c.actionType?.length) parts.push(`type in [${c.actionType.join(", ")}]`);
  if (c.actionTypeNotIn?.length) parts.push(`type not in [${c.actionTypeNotIn.join(", ")}]`);
  if (c.isAutonomous !== undefined) parts.push(`autonomous=${c.isAutonomous}`);
  if (c.isFinancial !== undefined) parts.push(`financial=${c.isFinancial}`);
  if (c.amountAbove !== undefined) parts.push(`amount > ${c.amountAbove}\u03bc\u00a2`);
  if (c.amountAtMost !== undefined) parts.push(`amount \u2264 ${c.amountAtMost}\u03bc\u00a2`);
  if (c.source?.length) parts.push(`source in [${c.source.join(", ")}]`);
  if (c.minTrustScore !== undefined) parts.push(`trust \u2265 ${c.minTrustScore}`);
  if (c.maxMonthlyActions !== undefined) parts.push(`monthly \u2265 ${c.maxMonthlyActions}`);
  return parts.length > 0 ? parts.join(" AND ") : "(always)";
}

function outcomeLabel(branch: PolicyBranch, effect: "allow" | "deny"): string {
  if (branch === "auto") return "Auto-approved";
  if (branch === "human") return "Human approval required";
  if (branch === "threshold-escrow") {
    return effect === "allow" ? "Threshold: escrow hold" : "Threshold: deny";
  }
  return "Denied";
}

/**
 * Build a flat visual policy tree from a declarative policy.
 * Returns one node per rule, followed by one default-catch-all node.
 *
 * fail-closed: null/non-object input throws; missing name throws;
 * non-array rules throw; malformed individual rules throw.
 */
export function buildPolicyTree(policy: unknown): PolicyTreeNode[] {
  if (!policy || typeof policy !== "object") {
    throw new Error("buildPolicyTree: policy must be an object");
  }
  const p = policy as DeclarativePolicyShape;
  if (typeof p.name !== "string" || !p.name) {
    throw new Error("buildPolicyTree: policy.name is required");
  }
  if (!Array.isArray(p.rules)) {
    throw new Error("buildPolicyTree: policy.rules must be an array");
  }

  const nodes: PolicyTreeNode[] = [];

  for (let i = 0; i < p.rules.length; i++) {
    const rule = p.rules[i];
    if (!rule || typeof rule !== "object") {
      throw new Error(`buildPolicyTree: rule[${i}] must be an object`);
    }
    if (rule.then !== "allow" && rule.then !== "deny") {
      throw new Error(`buildPolicyTree: rule[${i}].then must be "allow" or "deny"`);
    }
    const effect: "allow" | "deny" = rule.then;
    const branch = classifyBranch(rule);
    nodes.push({
      ruleIndex: i,
      branch,
      effect,
      conditionLabel: conditionLabel(rule.if ?? {}),
      outcomeLabel: outcomeLabel(branch, effect),
      reason: rule.reason,
      isDefault: false,
    });
  }

  const defaultEffect: "allow" | "deny" = p.default === "allow" ? "allow" : "deny";
  const defaultBranch: PolicyBranch = defaultEffect === "allow" ? "auto" : "deny";
  nodes.push({
    ruleIndex: "default",
    branch: defaultBranch,
    effect: defaultEffect,
    conditionLabel: "(no rule matched \u2014 default)",
    outcomeLabel:
      defaultEffect === "allow"
        ? "Auto-approved (default)"
        : "Denied (default, fail-closed)",
    isDefault: true,
  });

  return nodes;
}

function rulesEqual(a: PolicyRuleShape, b: PolicyRuleShape): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Diff two policy versions, returning a structured change set.
 *
 * Compares rules positionally (by index). Detects added, removed, and changed
 * rules; also flags name changes and default-effect changes.
 *
 * fail-closed: null/non-object inputs throw; non-array rules throw.
 */
export function diffPolicies(before: unknown, after: unknown): PolicyDiff {
  if (!before || typeof before !== "object") {
    throw new Error("diffPolicies: before must be an object");
  }
  if (!after || typeof after !== "object") {
    throw new Error("diffPolicies: after must be an object");
  }
  const a = before as DeclarativePolicyShape;
  const b = after as DeclarativePolicyShape;
  if (!Array.isArray(a.rules)) {
    throw new Error("diffPolicies: before.rules must be an array");
  }
  if (!Array.isArray(b.rules)) {
    throw new Error("diffPolicies: after.rules must be an array");
  }

  const beforeDefault: "allow" | "deny" = a.default === "allow" ? "allow" : "deny";
  const afterDefault: "allow" | "deny" = b.default === "allow" ? "allow" : "deny";

  const ruleDiffs: PolicyRuleDiff[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  const maxLen = Math.max(a.rules.length, b.rules.length);

  for (let i = 0; i < maxLen; i++) {
    const ar = a.rules[i] as PolicyRuleShape | undefined;
    const br = b.rules[i] as PolicyRuleShape | undefined;

    if (ar && br) {
      if (rulesEqual(ar, br)) {
        ruleDiffs.push({
          ruleIndex: i,
          kind: "unchanged",
          description: `rule[${i}] unchanged`,
          before: ar,
          after: br,
        });
      } else {
        changed++;
        const beforeBranch = classifyBranch(ar);
        const afterBranch = classifyBranch(br);
        const desc =
          beforeBranch !== afterBranch
            ? `rule[${i}] branch changed: ${beforeBranch} \u2192 ${afterBranch}`
            : `rule[${i}] conditions changed (${ar.then} \u2192 ${br.then})`;
        ruleDiffs.push({ ruleIndex: i, kind: "changed", description: desc, before: ar, after: br });
      }
    } else if (ar && !br) {
      removed++;
      ruleDiffs.push({
        ruleIndex: i,
        kind: "removed",
        description: `rule[${i}] removed (was: ${ar.then})`,
        before: ar,
      });
    } else if (!ar && br) {
      added++;
      ruleDiffs.push({
        ruleIndex: i,
        kind: "added",
        description: `rule[${i}] added (${br.then})`,
        after: br,
      });
    }
  }

  const summaryParts: string[] = [];
  if (added) summaryParts.push(`${added} added`);
  if (removed) summaryParts.push(`${removed} removed`);
  if (changed) summaryParts.push(`${changed} changed`);
  const nameChanged = a.name !== b.name;
  const defaultChanged = beforeDefault !== afterDefault;
  if (nameChanged) summaryParts.push("name changed");
  if (defaultChanged) summaryParts.push(`default ${beforeDefault} \u2192 ${afterDefault}`);

  const summary =
    summaryParts.length > 0
      ? `Policy diff: ${summaryParts.join("; ")}.`
      : "No changes detected.";

  return {
    nameChanged,
    defaultChanged,
    beforeDefault,
    afterDefault,
    ruleDiffs,
    added,
    removed,
    changed,
    summary,
  };
}
