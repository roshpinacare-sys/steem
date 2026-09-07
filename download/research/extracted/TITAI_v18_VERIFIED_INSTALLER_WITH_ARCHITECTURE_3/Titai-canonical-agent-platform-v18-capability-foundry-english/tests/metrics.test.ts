import { describe, expect, it } from "vitest";
import { computeOperationalMetrics, percentile } from "@/lib/observability/metrics";

describe("operational metrics", () => {
  it("computes deterministic nearest-rank percentiles", () => {
    expect(percentile([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
    expect(percentile([], 0.95)).toBe(0);
  });

  it("surfaces SLO failures and reconciliation backlog", () => {
    const metrics = computeOperationalMetrics({
      now: new Date("2026-07-10T00:00:00Z"),
      runs: [
        {
          status: "completed",
          startedAt: new Date("2026-07-10T00:00:00Z"),
          finishedAt: new Date("2026-07-10T00:00:02Z"),
          tokenUsage: { input: 10, output: 5 },
        },
        {
          status: "interrupted",
          startedAt: new Date("2026-07-10T00:00:00Z"),
          finishedAt: new Date("2026-07-10T00:10:00Z"),
          tokenUsage: { input: 2, output: 1 },
        },
      ],
      approvalStatuses: ["pending", "expired"],
      outboxStatuses: ["pending", "failed"],
      durableJobStatuses: ["queued", "needs_reconciliation"],
    });
    expect(metrics.runs.totalTokens).toBe(18);
    expect(metrics.runs.latencyMs.p95).toBe(600_000);
    expect(metrics.durableJobs.needsReconciliation).toBe(1);
    expect(metrics.slo.find((slo) => slo.id === "needs_reconciliation")?.passed).toBe(false);
  });
});
