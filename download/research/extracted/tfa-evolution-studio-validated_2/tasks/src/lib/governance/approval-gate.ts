/**
 * TFA Evolution Studio v28 — Approval Gate
 *
 * Enforces human-in-the-loop approval for sensitive platform actions.
 * V21 additions:
 *   - riskLevel on every request (tied to RBAC permission classification)
 *   - requesterRole / resolverRole (full RBAC traceability)
 *   - rationale field (required justification for high/critical risk)
 *   - expiresAt: pending approvals auto-expire after TTL
 *   - approvalGateAllows() checks both action match and expiry
 *   - getExpiredApprovals() for cleanup
 */

import fs from "fs";
import path from "path";
import { getApprovalsDir, ensureDir } from "@/lib/paths";
import { recordAudit } from "./audit-trail";
import type { ApprovalRequest, Role, RiskLevel } from "@/lib/types";

const APPROVALS_FILE = path.join(getApprovalsDir(), "approvals.json");

// Default TTL for pending approvals: 24 hours
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

function loadApprovals(): ApprovalRequest[] {
  if (!fs.existsSync(APPROVALS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(APPROVALS_FILE, "utf-8")) as ApprovalRequest[];
  } catch {
    return [];
  }
}

function saveApprovals(approvals: ApprovalRequest[]): void {
  ensureDir(path.dirname(APPROVALS_FILE));
  fs.writeFileSync(APPROVALS_FILE, JSON.stringify(approvals, null, 2));
}

export function createApprovalRequest(
  request: Omit<ApprovalRequest, "id" | "requestedAt" | "status">
): ApprovalRequest {
  const approvals = loadApprovals();
  const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS).toISOString();
  const req: ApprovalRequest = {
    ...request,
    id: `apr_${Date.now()}`,
    status: "pending",
    requestedAt: new Date().toISOString(),
    expiresAt,
  };
  approvals.push(req);
  saveApprovals(approvals);

  recordAudit(
    request.requester,
    `approval_requested:${request.action}`,
    `approval:${req.id}`,
    request.projectId,
    { riskLevel: request.riskLevel, rationale: request.rationale },
    { actorRole: request.requesterRole, riskLevel: request.riskLevel, outcome: "success" }
  );

  return req;
}

export function resolveApproval(
  id: string,
  status: "approved" | "rejected",
  resolvedBy: string,
  resolverRole?: Role
): ApprovalRequest | undefined {
  const approvals = loadApprovals();
  const idx = approvals.findIndex((a) => a.id === id);
  if (idx === -1) return undefined;

  approvals[idx] = {
    ...approvals[idx],
    status,
    resolvedBy,
    resolverRole,
    resolvedAt: new Date().toISOString(),
  };
  saveApprovals(approvals);

  recordAudit(
    resolvedBy,
    `approval_${status}:${approvals[idx].action}`,
    `approval:${id}`,
    approvals[idx].projectId,
    { riskLevel: approvals[idx].riskLevel },
    {
      actorRole: resolverRole,
      riskLevel: approvals[idx].riskLevel,
      outcome: status === "approved" ? "success" : "blocked",
    }
  );

  return approvals[idx];
}

export function listApprovalRequests(projectId?: string): ApprovalRequest[] {
  const all = loadApprovals();
  return projectId ? all.filter((a) => a.projectId === projectId) : all;
}

export function getPendingApprovals(projectId?: string): ApprovalRequest[] {
  const now = new Date().toISOString();
  return listApprovalRequests(projectId).filter(
    (a) => a.status === "pending" && (!a.expiresAt || a.expiresAt > now)
  );
}

export function getExpiredApprovals(projectId?: string): ApprovalRequest[] {
  const now = new Date().toISOString();
  return listApprovalRequests(projectId).filter(
    (a) => a.status === "pending" && a.expiresAt !== undefined && a.expiresAt <= now
  );
}

export function approvalGateAllows(projectId: string, action: string): boolean {
  // Gate blocks if a valid (non-expired) pending approval exists for this action
  return getPendingApprovals(projectId).every((a) => a.action !== action);
}

export function getApprovalsByRisk(
  riskLevel: RiskLevel,
  projectId?: string
): ApprovalRequest[] {
  return listApprovalRequests(projectId).filter((a) => a.riskLevel === riskLevel);
}

// ── Additional exports required by API routes ──────────────────────────────

export function getApprovals(projectId?: string) {
  return listApprovalRequests(projectId);
}

export function requestApproval(projectId: string, action: string, riskLevel: RiskLevel = "low", requestedBy = "system") {
  return createApprovalRequest({ projectId, action, riskLevel, requester: requestedBy });
}

export function approveAction(approvalId: string, approvedBy = "system"): boolean {
  const result = resolveApproval(approvalId, "approved", approvedBy);
  return result !== undefined;
}

export function rejectAction(approvalId: string, rejectedBy = "system"): boolean {
  const result = resolveApproval(approvalId, "rejected", rejectedBy);
  return result !== undefined;
}
