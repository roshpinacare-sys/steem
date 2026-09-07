/**
 * TFA Evolution Studio v28 — Large-Batch Coordinator
 *
 * Deterministic decomposition, bounded-concurrency execution, and
 * conflict reconciliation for large work batches.
 *
 * V23 additions over V22:
 *   - `semanticReconcile()` — improves on V22's shallow field diff by
 *     treating same-value updates as non-conflicts and assigning
 *     resolution hints when genuine conflicts are found.
 *   - `ConflictResolutionHint` — structured hint attached to each conflict
 *     so downstream orchestration can act on it rather than just log it.
 *   - `stopOnFirstGroupFailure` option — aborts the batch early if any group
 *     emits a failed evidence node, preventing wasted work on a broken base.
 *   - `BatchSynthesisSummary` — a structured summary emitted after the full
 *     batch completes, suitable for feeding into the pattern promoter.
 *   - Cross-group dependency support: a group may declare `dependsOn` group
 *     ids; those groups are guaranteed to have completed before it starts.
 */

import { v4 as uuidv4 } from "uuid";
import type { EvidenceNode } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────

export interface BatchUnit<T = unknown> {
  id: string;
  groupId: string;
  payload: T;
  safeForParallel: boolean;
}

export interface BatchGroup {
  id: string;
  units: string[];  // unit ids belonging to this group
  /** Groups that must complete before this group may start. */
  dependsOn?: string[];
}

/** V28: Named conflict type for structured batch conflict reporting. */
export interface BatchConflict {
  unitId: string;
  groupId: string;
  field: string;
  values: unknown[];
  recommendation: string;
}

export interface ConflictResolutionHint {
  field: string;
  values: unknown[];
  recommendation: string;
}

export interface ReconcileResult {
  merged: Record<string, unknown>;
  conflicts: { field: string; values: unknown[] }[];
  resolutionHints: ConflictResolutionHint[];
}

export interface BatchGroupResult {
  groupId: string;
  outcomes: { unitId: string; result: unknown; error?: string }[];
  evidence: EvidenceNode;
  reconciled: ReconcileResult;
}

export interface BatchSynthesisSummary {
  totalGroups: number;
  totalUnits: number;
  passedGroups: number;
  failedGroups: number;
  conflictCount: number;
  earlyAbort: boolean;
  // V24: cycle warnings surfaced when dependency ordering could not be honored
  cycleWarnings: string[];
  completedAt: string;
  groupResults: BatchGroupResult[];
}

export interface BatchCoordinatorOptions<T> {
  /** How many groups may run in parallel (serial-safe units still run serially within a group). */
  concurrencyLimit?: number;
  /** Abort remaining groups if any group emits a failed evidence node. Default: false. */
  stopOnFirstGroupFailure?: boolean;
  /** Custom reconciler — defaults to semanticReconcile(). */
  reconcile?: (results: unknown[]) => ReconcileResult;
}

// ── Default reconcilers ────────────────────────────────────────────────────

/**
 * V22 shallow reconciler (kept for backward compatibility).
 */
export function shallowReconcile(results: unknown[]): ReconcileResult {
  const records = results.filter(
    (r): r is Record<string, unknown> => typeof r === "object" && r !== null
  );
  if (records.length === 0) return { merged: {}, conflicts: [], resolutionHints: [] };
  const merged: Record<string, unknown> = { ...records[0] };
  const conflicts: ReconcileResult["conflicts"] = [];
  for (let i = 1; i < records.length; i++) {
    for (const [k, v] of Object.entries(records[i])) {
      if (!(k in merged)) { merged[k] = v; continue; }
      if (JSON.stringify(merged[k]) !== JSON.stringify(v)) {
        conflicts.push({ field: k, values: [merged[k], v] });
        merged[k] = v;
      }
    }
  }
  return { merged, conflicts, resolutionHints: [] };
}

/**
 * V23 semantic reconciler.
 *
 * Improvements over shallowReconcile:
 *   - Same-value updates are not reported as conflicts.
 *   - Conflicts carry a ConflictResolutionHint describing what kind of
 *     disagreement occurred and a recommended action.
 *   - Last-write wins for the merged output (deterministic).
 */
export function semanticReconcile(results: unknown[]): ReconcileResult {
  const records = results.filter(
    (r): r is Record<string, unknown> => typeof r === "object" && r !== null
  );
  if (records.length === 0) return { merged: {}, conflicts: [], resolutionHints: [] };

  // Build a map of field → all distinct values seen across records
  const fieldValues = new Map<string, Set<string>>();
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec)) {
      const serialised = JSON.stringify(v);
      const set = fieldValues.get(k) ?? new Set<string>();
      set.add(serialised);
      fieldValues.set(k, set);
    }
  }

  const merged: Record<string, unknown> = {};
  const conflicts: ReconcileResult["conflicts"] = [];
  const resolutionHints: ConflictResolutionHint[] = [];

  // Last write wins for merge; conflict only when distinct values > 1
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec)) {
      merged[k] = v;
    }
  }

  for (const [field, valueSet] of fieldValues) {
    if (valueSet.size > 1) {
      const values = Array.from(valueSet).map((s) => JSON.parse(s) as unknown);
      conflicts.push({ field, values });
      resolutionHints.push({
        field,
        values,
        recommendation: inferResolutionHint(field, values),
      });
    }
  }

  return { merged, conflicts, resolutionHints };
}

function inferResolutionHint(field: string, values: unknown[]): string {
  const fieldLower = field.toLowerCase();
  if (fieldLower.includes("status")) {
    const statuses = values.map(String);
    if (statuses.includes("failed")) return `Field "${field}" has a "failed" value — treat as failed.`;
    if (statuses.includes("completed")) return `Field "${field}" diverges between completed and non-completed — prefer "completed" only if all units agree.`;
    return `Field "${field}" has conflicting status values; escalate to sovereign loop for resolution.`;
  }
  if (fieldLower.includes("version")) {
    return `Field "${field}" has conflicting versions — use highest semver or escalate.`;
  }
  if (typeof values[0] === "number") {
    return `Field "${field}" has conflicting numeric values — consider using the maximum or requiring consensus.`;
  }
  return `Field "${field}" has ${values.length} distinct values — manual review or sovereign loop resolution recommended.`;
}

// ── Decomposition ─────────────────────────────────────────────────────────

export function decomposeIntoBatch<T>(
  items: T[],
  groupSize: number,
  toUnit: (item: T, index: number) => Omit<BatchUnit<T>, "id">
): { units: BatchUnit<T>[]; groups: BatchGroup[] } {
  const units: BatchUnit<T>[] = items.map((item, i) => ({
    id: `u_${i}_${uuidv4().slice(0, 8)}`,
    ...toUnit(item, i),
  }));

  const groupMap = new Map<string, string[]>();
  for (const u of units) {
    const list = groupMap.get(u.groupId) ?? [];
    list.push(u.id);
    groupMap.set(u.groupId, list);
  }

  const groups: BatchGroup[] = Array.from(groupMap.entries()).map(([id, unitIds]) => ({
    id,
    units: unitIds,
  }));

  return { units, groups };
}

// ── Concurrency ────────────────────────────────────────────────────────────

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workerCount = Math.min(limit, items.length);
  if (workerCount === 0) return results;
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

// ── Execution ─────────────────────────────────────────────────────────────

export async function runBatch<T>(
  units: BatchUnit<T>[],
  groups: BatchGroup[],
  execute: (unit: BatchUnit<T>) => Promise<unknown>,
  opts: BatchCoordinatorOptions<T> = {}
): Promise<BatchSynthesisSummary> {
  const concurrencyLimit = opts.concurrencyLimit ?? 4;
  const stopOnFirstGroupFailure = opts.stopOnFirstGroupFailure ?? false;
  const reconcile = opts.reconcile ?? semanticReconcile;

  const unitMap = new Map(units.map((u) => [u.id, u]));
  const groupResults: BatchGroupResult[] = [];
  let earlyAbort = false;
  const completedGroupIds = new Set<string>();
  const cycleWarnings: string[] = [];

  // Topological execution: resolve dependsOn ordering by iterating until all groups run.
  const pendingGroups = [...groups];
  const maxPasses = groups.length + 1;
  let pass = 0;

  while (pendingGroups.length > 0 && pass < maxPasses) {
    pass++;
    const runnable = pendingGroups.filter((g) =>
      (g.dependsOn ?? []).every((dep) => completedGroupIds.has(dep))
    );

    if (runnable.length === 0 && pendingGroups.length > 0) {
            // Previously, remaining groups were silently spliced-in and run without
      // any warning — callers had no way to know ordering guarantees had
      // been violated. Now we record which groups are involved and surface
      // a cycle_detected warning in the batch summary evidence before
      // running them (best-effort execution is preserved so callers that
      // tolerate cycles still get results).
      const cycleGroupIds = pendingGroups.map((g) => g.id);
      cycleWarnings.push(
        `Dependency cycle or unsatisfiable deps detected among groups: [${cycleGroupIds.join(", ")}]. ` +
        `Running them without guaranteed order.`
      );
      runnable.push(...pendingGroups.splice(0));
    }

    for (const g of runnable) {
      pendingGroups.splice(pendingGroups.indexOf(g), 1);
    }

    const groupBatch = await runWithConcurrency(runnable, concurrencyLimit, async (group) => {
      const groupUnits = group.units.map((id) => unitMap.get(id)).filter(Boolean) as BatchUnit<T>[];

      // Serial units within the group run one by one
      const serialUnits = groupUnits.filter((u) => !u.safeForParallel);
      const parallelUnits = groupUnits.filter((u) => u.safeForParallel);

      const outcomes: BatchGroupResult["outcomes"] = [];

      for (const u of serialUnits) {
        try {
          const result = await execute(u);
          outcomes.push({ unitId: u.id, result });
        } catch (e) {
          outcomes.push({ unitId: u.id, result: null, error: String(e) });
        }
      }

      const parallelResults = await runWithConcurrency(
        parallelUnits,
        Math.min(concurrencyLimit, parallelUnits.length || 1),
        async (u) => {
          try {
            return { unitId: u.id, result: await execute(u), error: undefined };
          } catch (e) {
            return { unitId: u.id, result: null, error: String(e) };
          }
        }
      );
      outcomes.push(...parallelResults);

      const hasFailure = outcomes.some((o) => o.error !== undefined);
      const reconciled = reconcile(outcomes.map((o) => o.result));

      const evidence: EvidenceNode = {
        kind: "batch_reconciled",
        status: hasFailure ? "failed" : "passed",
        message: hasFailure
          ? `Group ${group.id}: ${outcomes.filter((o) => o.error).length} unit(s) failed`
          : `Group ${group.id}: ${outcomes.length} unit(s) reconciled (${reconciled.conflicts.length} conflict(s))`,
        timestamp: new Date().toISOString(),
        metadata: {
          groupId: group.id,
          unitCount: outcomes.length,
          conflictCount: reconciled.conflicts.length,
          resolutionHints: reconciled.resolutionHints,
        },
      };

      return { groupId: group.id, outcomes, evidence, reconciled } as BatchGroupResult;
    });

    for (const gr of groupBatch) {
      groupResults.push(gr);
      completedGroupIds.add(gr.groupId);
      if (stopOnFirstGroupFailure && gr.evidence.status === "failed") {
        earlyAbort = true;
        break;
      }
    }
    if (earlyAbort) break;
  }

  const totalConflicts = groupResults.reduce(
    (s, gr) => s + gr.reconciled.conflicts.length,
    0
  );
  const passedGroups = groupResults.filter((gr) => gr.evidence.status === "passed").length;

  return {
    totalGroups: groups.length,
    totalUnits: units.length,
    passedGroups,
    failedGroups: groupResults.length - passedGroups,
    conflictCount: totalConflicts,
    earlyAbort,
    // V24: expose cycle warnings so callers know ordering guarantees were violated
    cycleWarnings,
    completedAt: new Date().toISOString(),
    groupResults,
  };
}

/**
 * V28: reconcileGroup — deterministic conflict resolution for a single batch group.
 * Extracts BatchConflict records from a group result for structured reporting.
 * Separates pure conflict analysis from the full runBatch coordination loop.
 */
export function reconcileGroup(groupResult: BatchGroupResult): BatchConflict[] {
  return groupResult.reconciled.conflicts.map((c) => {
    const hint = groupResult.reconciled.resolutionHints.find((h) => h.field === c.field);
    return {
      unitId: groupResult.groupId,
      groupId: groupResult.groupId,
      field: c.field,
      values: c.values,
      recommendation: hint?.recommendation ?? "No resolution hint available — manual review required.",
    };
  });
}
