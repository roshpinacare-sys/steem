import type { RiskLevel } from "./types";
import { compileSafeRegex } from "@/lib/security/safe-regex";

/**
 * Policy-as-data (adapted from V3's sovereign kernel). Rules are declarative
 * JSON. The engine evaluates enabled policies in priority order; within a
 * policy the first matching rule wins. If nothing matches anywhere we
 * FAIL CLOSED: low risk auto-runs, anything higher asks a human.
 */

export type ApprovalClass = "auto" | "human" | "deny";

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export interface PolicyCondition {
  toolName?: string[];
  riskAtLeast?: RiskLevel;
  agentTier?: string[];
  /** All must match: arg at dot-path matches the given regex (on String(value)). */
  argMatches?: { path: string; regex: string }[];
}

export interface PolicyRule {
  if: PolicyCondition;
  then: ApprovalClass;
  reason?: string;
}

export interface PolicyRow {
  id: string;
  enabled: boolean;
  priority: number;
  rules: PolicyRule[];
  name?: string;
}

export interface PolicyAction {
  toolName: string;
  risk: RiskLevel;
  agentTier: string;
  arguments: Record<string, unknown>;
}

export interface PolicyDecision {
  effect: ApprovalClass;
  reason: string;
  policyId?: string;
  policyName?: string;
  ruleIndex?: number;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function conditionMatches(
  cond: PolicyCondition,
  action: PolicyAction,
): boolean {
  if (cond.toolName && !cond.toolName.includes(action.toolName)) return false;
  if (
    cond.riskAtLeast &&
    RISK_ORDER[action.risk] < RISK_ORDER[cond.riskAtLeast]
  ) {
    return false;
  }
  if (cond.agentTier && !cond.agentTier.includes(action.agentTier)) return false;
  if (cond.argMatches) {
    for (const { path, regex } of cond.argMatches) {
      const value = getPath(action.arguments, path);
      const re = compileSafeRegex(regex);
      if (!re) return false;
      if (!re.test(String(value ?? "").slice(0, 4_096))) return false;
    }
  }
  return true;
}

export function evaluatePolicies(
  policies: PolicyRow[],
  action: PolicyAction,
): PolicyDecision {
  const ordered = [...policies]
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const policy of ordered) {
    for (let i = 0; i < policy.rules.length; i++) {
      const rule = policy.rules[i];
      if (conditionMatches(rule.if, action)) {
        return {
          effect: rule.then,
          reason:
            rule.reason ??
            `Matched rule ${i + 1} of policy "${policy.name ?? policy.id}"`,
          policyId: policy.id,
          policyName: policy.name,
          ruleIndex: i,
        };
      }
    }
  }

  // Fail-closed default.
  if (action.risk === "low") {
    return { effect: "auto", reason: "Default: low-risk tools run automatically" };
  }
  return {
    effect: "human",
    reason: `Default (fail-closed): ${action.risk}-risk tools require approval`,
  };
}

/** The policy seeded on first boot. */
export const DEFAULT_POLICY: {
  name: string;
  description: string;
  priority: number;
  rules: PolicyRule[];
} = {
  name: "Default guardrails",
  description:
    "Medium and high-risk tools require human approval unless a narrower rule explicitly allows them; low-risk tools run automatically.",
  priority: 100,
  rules: [
    {
      if: { toolName: ["simulate_deploy"] },
      then: "human",
      reason: "Deployments always require sign-off",
    },
    {
      if: { riskAtLeast: "high" },
      then: "human",
      reason: "High-risk tool calls require approval",
    },
  ],
};
