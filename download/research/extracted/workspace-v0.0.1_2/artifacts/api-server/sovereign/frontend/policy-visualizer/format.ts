/**
 * frontend/policy-visualizer/format.ts — Format a PolicyDryRunReport for frontend display.
 *
 * Takes the raw report produced by lib/risk/policy-dryrun.ts (passed in as a
 * plain object — no engine import) and emits a DryRunDisplayReport with bar
 * chart data, severity-tagged changed records, and pre-computed flags.
 *
 * Pure, deterministic, zero external dependencies.
 */

import type {
  PolicyDryRunReportShape,
  DryRunDisplayReport,
  DryRunRecordDisplay,
  DeltaBar,
  DeltaKind,
} from "./types.ts";

const DELTA_LABELS: Record<DeltaKind, string> = {
  unchanged: "Unchanged",
  escalated: "Escalated",
  relaxed: "Relaxed",
  newly_denied: "Newly denied",
  newly_allowed: "Newly allowed",
};

/** Map delta kind to UI severity. */
export function deltaSeverity(kind: DeltaKind): "info" | "warn" | "critical" {
  if (kind === "newly_denied") return "critical";
  if (kind === "escalated") return "warn";
  return "info";
}

/**
 * Format a PolicyDryRunReport for frontend display.
 *
 * Returns:
 * - bars      — one entry per DeltaKind with count + percentage (sum-100 over non-zero total)
 * - changedRecords — severity-tagged display entries for changed records only
 * - allUnchanged   — true when every record's delta is "unchanged"
 * - hasNewDenials  — quick flag for CI-style warnings in the UI
 * - hasRelaxations — quick flag for relaxed/newly_allowed outcomes
 *
 * fail-closed: null/non-object report throws; non-finite total throws;
 * missing counts throws; non-array changed throws; non-string headline throws.
 */
export function formatDryRunReport(report: unknown): DryRunDisplayReport {
  if (!report || typeof report !== "object") {
    throw new Error("formatDryRunReport: report must be an object");
  }
  const r = report as PolicyDryRunReportShape;

  if (typeof r.total !== "number" || !Number.isFinite(r.total)) {
    throw new Error("formatDryRunReport: report.total must be a finite number");
  }
  if (!r.counts || typeof r.counts !== "object") {
    throw new Error("formatDryRunReport: report.counts must be an object");
  }
  if (!Array.isArray(r.changed)) {
    throw new Error("formatDryRunReport: report.changed must be an array");
  }
  if (typeof r.headline !== "string") {
    throw new Error("formatDryRunReport: report.headline must be a string");
  }

  const total = r.total;

  // Build bars in a display-meaningful order: severity desc, then relaxations.
  // Efficiency: single pass over kindOrder — no extra scan.
  const kindOrder: DeltaKind[] = [
    "unchanged",
    "escalated",
    "newly_denied",
    "relaxed",
    "newly_allowed",
  ];
  const bars: DeltaBar[] = kindOrder.map((kind) => {
    const count = Number((r.counts as Record<string, unknown>)[kind] ?? 0);
    return {
      kind,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      label: DELTA_LABELS[kind],
    };
  });

  // Format changed records — single pass.
  const changedRecords: DryRunRecordDisplay[] = (r.changed ?? []).map((rec) => {
    const delta = rec.delta as DeltaKind;
    const deltaLabel = DELTA_LABELS[delta] ?? delta;
    return {
      recordId: rec.recordId,
      before: String(rec.recordedDecision ?? ""),
      after: String(rec.replayedDecision ?? ""),
      delta,
      label: `${rec.recordedDecision} \u2192 ${rec.replayedDecision} (${deltaLabel})`,
      severity: deltaSeverity(delta),
    };
  });

  const counts = r.counts as Record<string, number>;
  const hasNewDenials = (counts.newly_denied ?? 0) > 0;
  const hasRelaxations = ((counts.relaxed ?? 0) + (counts.newly_allowed ?? 0)) > 0;
  const allUnchanged = total > 0 && (counts.unchanged ?? 0) === total;

  return {
    headline: r.headline,
    total,
    bars,
    changedRecords,
    allUnchanged,
    hasNewDenials,
    hasRelaxations,
  };
}

/** Human-readable label for a policy branch. */
export function formatBranchLabel(branch: string): string {
  const labels: Record<string, string> = {
    auto: "Auto-approved",
    human: "Human review",
    "threshold-escrow": "Threshold / Escrow",
    deny: "Denied",
  };
  return labels[branch] ?? branch;
}
