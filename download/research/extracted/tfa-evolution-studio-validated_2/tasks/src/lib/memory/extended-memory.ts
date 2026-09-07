/**
 * TFA Evolution Studio v28 — Extended Memory
 *
 * Key-value store scoped per project or globally.
 * Supports structured queries and automatic cleanup.
 */

import fs from "fs";
import path from "path";
import { getMemoryDir, ensureDir } from "@/lib/paths";
import type { MemoryEntry, ArchitecturalDecision, TechnicalDebtItem } from "@/lib/types";

// ── Typed record shapes ───────────────────────────────────────────────────

export interface AgentMemoryRecord {
  projectId: string;
  agentId: string;
  task: string;
  outcome: "success" | "failure" | "partial";
  durationMs: number;
  notes?: string;
  recordedAt: string;
}

const MEMORY_FILE = path.join(getMemoryDir(), "memory.json");

function loadMemory(): MemoryEntry[] {
  if (!fs.existsSync(MEMORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8")) as MemoryEntry[];
  } catch {
    return [];
  }
}

function saveMemory(entries: MemoryEntry[]): void {
  ensureDir(path.dirname(MEMORY_FILE));
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(entries, null, 2));
}

export function getMemory(projectId: string, scope?: MemoryEntry["scope"]): MemoryEntry[] {
  const entries = loadMemory();
  return entries.filter(
    (e) => e.projectId === projectId && (!scope || e.scope === scope)
  );
}

export function setMemory(
  projectId: string,
  key: string,
  value: unknown,
  scope: MemoryEntry["scope"] = "project"
): MemoryEntry {
  const entries = loadMemory();
  const existing = entries.findIndex((e) => e.projectId === projectId && e.key === key && e.scope === scope);
  const entry: MemoryEntry = {
    id: existing !== -1 ? entries[existing].id : `mem_${Date.now()}`,
    projectId,
    scope,
    key,
    value,
    createdAt: existing !== -1 ? entries[existing].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (existing !== -1) {
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }
  saveMemory(entries);
  return entry;
}

export function deleteMemory(projectId: string, key: string, scope?: MemoryEntry["scope"]): boolean {
  const entries = loadMemory();
  const idx = entries.findIndex(
    (e) => e.projectId === projectId && e.key === key && (!scope || e.scope === scope)
  );
  if (idx === -1) return false;
  entries.splice(idx, 1);
  saveMemory(entries);
  return true;
}

export function getGlobalMemory(key?: string): MemoryEntry[] {
  const entries = loadMemory().filter((e) => e.scope === "global");
  return key ? entries.filter((e) => e.key === key) : entries;
}

// ── Scoped project-memory helpers ─────────────────────────────────────────

export function getProjectMemory(projectId: string): MemoryEntry[] {
  return getMemory(projectId, "project").filter(
    (e) => !e.key.startsWith("agent:") &&
            !e.key.startsWith("decision:") &&
            !e.key.startsWith("arch:") &&
            !e.key.startsWith("release:")
  );
}

export function getAgentMemory(projectId: string): AgentMemoryRecord[] {
  return getMemory(projectId, "project")
    .filter((e) => e.key.startsWith("agent:"))
    .map((e) => e.value as AgentMemoryRecord);
}

export function getDecisionMemory(projectId: string): MemoryEntry[] {
  return getMemory(projectId, "project").filter((e) => e.key.startsWith("decision:"));
}

export function getArchMemory(projectId: string): MemoryEntry[] {
  return getMemory(projectId, "project").filter((e) => e.key.startsWith("arch:"));
}

export function getReleaseMemory(projectId: string): MemoryEntry[] {
  return getMemory(projectId, "project").filter((e) => e.key.startsWith("release:"));
}

export function buildMemoryDigest(projectId: string): Record<string, number> {
  const all = getMemory(projectId, "project");
  return {
    project: all.filter(
      (e) => !e.key.startsWith("agent:") &&
              !e.key.startsWith("decision:") &&
              !e.key.startsWith("arch:") &&
              !e.key.startsWith("release:")
    ).length,
    agents: all.filter((e) => e.key.startsWith("agent:")).length,
    decisions: all.filter((e) => e.key.startsWith("decision:")).length,
    architecture: all.filter((e) => e.key.startsWith("arch:")).length,
    releases: all.filter((e) => e.key.startsWith("release:")).length,
  };
}

// ── Record helpers ─────────────────────────────────────────────────────────

export function recordAgentTask(
  projectId: string,
  record: Omit<AgentMemoryRecord, "projectId" | "recordedAt">
): MemoryEntry {
  const full: AgentMemoryRecord = {
    ...record,
    projectId,
    recordedAt: new Date().toISOString(),
  };
  return setMemory(projectId, `agent:${record.agentId}:${Date.now()}`, full, "project");
}

export function recordDecisionMemory(
  projectId: string,
  data: Record<string, unknown>
): MemoryEntry {
  return setMemory(projectId, `decision:${Date.now()}`, data, "project");
}

export function recordArchSnapshot(
  projectId: string,
  data: Record<string, unknown>
): MemoryEntry {
  return setMemory(projectId, `arch:snapshot:${Date.now()}`, data, "project");
}

export function recordRelease(
  projectId: string,
  data: Record<string, unknown>
): MemoryEntry {
  return setMemory(projectId, `release:${Date.now()}`, data, "project");
}

export function recordDecision(
  projectId: string,
  data: Omit<ArchitecturalDecision, "id" | "recordedAt">
): MemoryEntry {
  const full: ArchitecturalDecision = {
    ...data,
    id: `adec_${Date.now()}`,
    recordedAt: new Date().toISOString(),
  };
  return setMemory(projectId, `decision:arch:${full.id}`, full, "project");
}

export function recordDebt(
  projectId: string,
  data: Omit<TechnicalDebtItem, "id" | "recordedAt">
): MemoryEntry {
  const full: TechnicalDebtItem = {
    ...data,
    id: `debt_${Date.now()}`,
    recordedAt: new Date().toISOString(),
  };
  return setMemory(projectId, `decision:debt:${full.id}`, full, "project");
}
