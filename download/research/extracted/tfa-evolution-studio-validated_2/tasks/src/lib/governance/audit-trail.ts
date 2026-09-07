/**
 * TFA Evolution Studio v28 — Audit Trail
 *
 * Append-only, immutable NDJSON log of every platform mutation.
 * V21 additions:
 *   - actorRole field (RBAC integration)
 *   - riskLevel field (tied to operation classification)
 *   - outcome field ("success" | "failure" | "blocked")
 *   - getAuditTrailByActor() for per-actor forensics
 *   - getAuditTrailByRisk() for risk-focused review
 */

import fs from "fs";
import path from "path";
import { AUDIT_FILE, ensureDir } from "@/lib/paths";
import type { AuditEntry, Role, RiskLevel } from "@/lib/types";

function loadAuditEntries(): AuditEntry[] {
  if (!fs.existsSync(AUDIT_FILE)) return [];
  const lines = fs.readFileSync(AUDIT_FILE, "utf-8").split("\n").filter(Boolean);
  return lines.map((line) => {
    try { return JSON.parse(line) as AuditEntry; } catch { return null; }
  }).filter((e): e is AuditEntry => e !== null);
}

function appendAuditEntry(entry: AuditEntry): void {
  ensureDir(path.dirname(AUDIT_FILE));
  fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n");
}

export function recordAudit(
  actor: string,
  action: string,
  resource: string,
  projectId?: string,
  metadata?: Record<string, unknown>,
  opts: {
    actorRole?: Role;
    riskLevel?: RiskLevel;
    outcome?: AuditEntry["outcome"];
  } = {}
): AuditEntry {
  const entry: AuditEntry = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    actor,
    actorRole: opts.actorRole,
    action,
    resource,
    projectId,
    riskLevel: opts.riskLevel,
    outcome: opts.outcome ?? "success",
    metadata,
  };
  appendAuditEntry(entry);
  return entry;
}

export function getAuditTrail(projectId?: string, limit = 500): AuditEntry[] {
  const all = loadAuditEntries();
  const filtered = projectId ? all.filter((a) => a.projectId === projectId) : all;
  return filtered.slice(-limit).reverse();
}

export function getAuditTrailByActor(actor: string, limit = 200): AuditEntry[] {
  return loadAuditEntries()
    .filter((e) => e.actor === actor)
    .slice(-limit)
    .reverse();
}

export function getAuditTrailByRisk(
  minRisk: RiskLevel,
  projectId?: string,
  limit = 200
): AuditEntry[] {
  const riskRank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const threshold = riskRank[minRisk];
  const all = loadAuditEntries();
  return all
    .filter((e) => {
      const passesProject = projectId ? e.projectId === projectId : true;
      const passesRisk = e.riskLevel !== undefined && riskRank[e.riskLevel] >= threshold;
      return passesProject && passesRisk;
    })
    .slice(-limit)
    .reverse();
}

export function getAuditSummary(projectId?: string): {
  total: number;
  actions: Record<string, number>;
  actors: Record<string, number>;
  outcomes: Record<string, number>;
  riskBreakdown: Record<string, number>;
} {
  const entries = getAuditTrail(projectId, 10000);
  const actions: Record<string, number> = {};
  const actors: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const riskBreakdown: Record<string, number> = {};

  for (const e of entries) {
    actions[e.action] = (actions[e.action] || 0) + 1;
    actors[e.actor] = (actors[e.actor] || 0) + 1;
    if (e.outcome) outcomes[e.outcome] = (outcomes[e.outcome] || 0) + 1;
    if (e.riskLevel) riskBreakdown[e.riskLevel] = (riskBreakdown[e.riskLevel] || 0) + 1;
  }
  return { total: entries.length, actions, actors, outcomes, riskBreakdown };
}
