import { canonicalJson, sha256 } from "@/lib/durable/canonical-json";
import type { Memory } from "@/lib/db/schema";

export interface PortableMemoryRecord {
  id: string;
  ownerId: string;
  tenantId: string | null;
  workspaceId: string | null;
  visibility: string;
  kind: string;
  content: string;
  contentHash: string;
  tags: string[];
  provenance: Memory["provenance"];
  confidence: number;
  authority: number;
  contradictionRisk: number;
  sensitivity: string;
  status: string;
  correctsId: string | null;
  contradictionGroup: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortableMemoryBundle {
  format: "titai-memory-portability";
  version: 1;
  tenantId: string;
  workspaceId: string | null;
  exportedAt: string;
  records: PortableMemoryRecord[];
  recordsSha256: string;
  bundleSha256: string;
}

export interface MemoryImportConflict {
  id: string;
  reason: "content_mismatch" | "scope_mismatch" | "correction_target_missing";
}

export interface MemoryImportResult {
  accepted: PortableMemoryRecord[];
  duplicates: string[];
  conflicts: MemoryImportConflict[];
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toPortableMemory(memory: Memory): PortableMemoryRecord {
  return {
    id: memory.id,
    ownerId: memory.ownerId,
    tenantId: memory.tenantId,
    workspaceId: memory.workspaceId,
    visibility: memory.visibility,
    kind: memory.kind,
    content: memory.content,
    contentHash: memory.contentHash,
    tags: [...memory.tags].sort(),
    provenance: structuredClone(memory.provenance),
    confidence: memory.confidence,
    authority: memory.authority,
    contradictionRisk: memory.contradictionRisk,
    sensitivity: memory.sensitivity,
    status: memory.status,
    correctsId: memory.correctsId,
    contradictionGroup: memory.contradictionGroup,
    expiresAt: toIso(memory.expiresAt),
    createdAt: (memory.createdAt ?? memory.updatedAt).toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

export function exportMemoryBundle(options: {
  tenantId: string;
  workspaceId?: string | null;
  records: readonly Memory[] | readonly PortableMemoryRecord[];
  now?: Date;
}): PortableMemoryBundle {
  const records = options.records
    .map((record) =>
      record.createdAt instanceof Date
        ? toPortableMemory(record as Memory)
        : structuredClone(record as PortableMemoryRecord),
    )
    .filter(
      (record) =>
        record.tenantId === options.tenantId &&
        (options.workspaceId === undefined || record.workspaceId === options.workspaceId),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const exportedAt = (options.now ?? new Date()).toISOString();
  const recordsSha256 = sha256(records);
  const core = {
    format: "titai-memory-portability" as const,
    version: 1 as const,
    tenantId: options.tenantId,
    workspaceId: options.workspaceId ?? null,
    exportedAt,
    records,
    recordsSha256,
  };
  return { ...core, bundleSha256: sha256(core) };
}

export function verifyMemoryBundle(bundle: PortableMemoryBundle): boolean {
  if (bundle.format !== "titai-memory-portability" || bundle.version !== 1) return false;
  if (bundle.recordsSha256 !== sha256(bundle.records)) return false;
  const { bundleSha256, ...core } = bundle;
  return bundleSha256 === sha256(core);
}

export function importMemoryBundle(options: {
  bundle: PortableMemoryBundle;
  targetTenantId: string;
  targetWorkspaceId?: string | null;
  existing?: readonly PortableMemoryRecord[];
}): MemoryImportResult {
  if (!verifyMemoryBundle(options.bundle)) throw new Error("memory_bundle_integrity_invalid");
  if (options.bundle.tenantId !== options.targetTenantId) {
    throw new Error("memory_bundle_tenant_mismatch");
  }
  if (
    options.targetWorkspaceId !== undefined &&
    options.bundle.workspaceId !== options.targetWorkspaceId
  ) {
    throw new Error("memory_bundle_workspace_mismatch");
  }
  const existingById = new Map((options.existing ?? []).map((record) => [record.id, record]));
  const bundleIds = new Set(options.bundle.records.map((record) => record.id));
  const accepted: PortableMemoryRecord[] = [];
  const duplicates: string[] = [];
  const conflicts: MemoryImportConflict[] = [];

  for (const record of options.bundle.records) {
    if (
      record.tenantId !== options.targetTenantId ||
      (options.targetWorkspaceId !== undefined && record.workspaceId !== options.targetWorkspaceId)
    ) {
      conflicts.push({ id: record.id, reason: "scope_mismatch" });
      continue;
    }
    if (record.correctsId && !bundleIds.has(record.correctsId) && !existingById.has(record.correctsId)) {
      conflicts.push({ id: record.id, reason: "correction_target_missing" });
      continue;
    }
    const existing = existingById.get(record.id);
    if (existing) {
      if (canonicalJson(existing) === canonicalJson(record)) duplicates.push(record.id);
      else conflicts.push({ id: record.id, reason: "content_mismatch" });
      continue;
    }
    accepted.push(structuredClone(record));
  }
  return { accepted, duplicates, conflicts };
}

export interface MemoryConfidenceDecayInput {
  baseConfidence: number;
  authority: number;
  ageDays: number;
  daysSinceReverified?: number;
  contradictionRisk: number;
  corrections: number;
  successfulUses: number;
  failedUses: number;
  kind: string;
}

export function calculateMemoryConfidence(
  input: MemoryConfidenceDecayInput,
): number {
  const base = Math.max(0, Math.min(1, input.baseConfidence));
  const halfLife = input.kind === "procedural" ? 45 : input.kind === "decision" ? 90 : 180;
  const ageFactor = Math.exp(-Math.max(0, input.ageDays) / halfLife);
  const reverificationFactor =
    input.daysSinceReverified === undefined
      ? 0.85
      : 0.85 + 0.15 * Math.exp(-Math.max(0, input.daysSinceReverified) / 30);
  const contradictionPenalty = Math.max(0, Math.min(0.8, input.contradictionRisk * 0.8));
  const correctionPenalty = Math.min(0.35, Math.max(0, input.corrections) * 0.06);
  const usageSignal =
    (Math.max(0, input.successfulUses) - Math.max(0, input.failedUses) * 2) /
    Math.max(5, input.successfulUses + input.failedUses + 5);
  const authorityFloor = 0.25 + Math.max(0, Math.min(1, input.authority)) * 0.5;
  const raw =
    base * ageFactor * reverificationFactor * (1 - contradictionPenalty - correctionPenalty) +
    usageSignal * 0.12;
  return Number(Math.max(0, Math.min(authorityFloor, raw)).toFixed(6));
}
