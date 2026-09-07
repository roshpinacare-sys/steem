import type { ToolDef } from "./types";
import { decideRiskAdjustedAutonomy } from "@/lib/intelligence/risk-adjusted-autonomy";

export interface ToolCapabilityRequest {
  tool: ToolDef;
  allowedTools: readonly string[];
  dryRun: boolean;
  hasHumanApproval: boolean;
  maximumRisk?: "low" | "medium" | "high";
  allowNetwork?: boolean;
  allowFilesystem?: boolean;
}

export interface ToolCapabilityDecision {
  allowed: boolean;
  reasons: string[];
  requirements: string[];
}

const RISK_ORDER = { low: 0, medium: 1, high: 2 } as const;

export function decideToolCapability(
  request: ToolCapabilityRequest,
): ToolCapabilityDecision {
  const reasons: string[] = [];
  const requirements: string[] = [];
  if (!request.allowedTools.includes(request.tool.name)) {
    reasons.push("tool_not_in_agent_allowlist");
  }
  if (
    request.maximumRisk &&
    RISK_ORDER[request.tool.risk] > RISK_ORDER[request.maximumRisk]
  ) {
    reasons.push("tool_risk_exceeds_task_scope");
  }
  if (request.tool.network && request.allowNetwork === false) {
    reasons.push("network_capability_not_granted");
  }
  if (request.tool.filesystem && request.allowFilesystem === false) {
    reasons.push("filesystem_capability_not_granted");
  }
  const autonomy = decideRiskAdjustedAutonomy({
    risk: request.tool.risk,
    effect: request.tool.effect,
    idempotency: request.tool.idempotency,
    dryRun: request.dryRun,
    hasHumanApproval: request.hasHumanApproval,
    reversible: request.tool.effect === "read" || request.tool.idempotency === "intrinsic",
  });
  if (autonomy.level === "deny") reasons.push(...autonomy.reasons);
  if (autonomy.level === "human_required") requirements.push("human_approval");
  if (autonomy.level === "supervised" && !request.hasHumanApproval) requirements.push("supervised_execution");
  return { allowed: reasons.length === 0, reasons, requirements };
}

export function toolCapabilityDescriptor(tool: ToolDef) {
  return {
    name: tool.name,
    schemaVersion: tool.schemaVersion,
    risk: tool.risk,
    effect: tool.effect,
    idempotency: tool.idempotency,
    network: tool.network,
    filesystem: tool.filesystem,
    timeoutMs: tool.timeoutMs,
    maxOutputBytes: tool.maxOutputBytes,
  };
}
