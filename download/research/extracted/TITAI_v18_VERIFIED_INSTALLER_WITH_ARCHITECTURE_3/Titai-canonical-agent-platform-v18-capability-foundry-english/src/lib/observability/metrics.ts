export interface MetricRun {
  status: string;
  createdAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  tokenUsage?: { input: number; output: number } | null;
}

export interface OperationalMetrics {
  generatedAt: string;
  runs: {
    total: number;
    byStatus: Record<string, number>;
    finished: number;
    successRate: number;
    interruptedRate: number;
    latencyMs: { p50: number; p95: number; p99: number; max: number };
    totalTokens: number;
  };
  approvals: { pending: number; expired: number };
  outbox: { pending: number; processing: number; failed: number };
  durableJobs: { queued: number; leased: number; needsReconciliation: number; failed: number };
  slo: Array<{ id: string; target: string; value: number; passed: boolean }>;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

export function computeOperationalMetrics(input: {
  runs: MetricRun[];
  approvalStatuses: string[];
  outboxStatuses: string[];
  durableJobStatuses: string[];
  now?: Date;
}): OperationalMetrics {
  const byStatus: Record<string, number> = {};
  for (const run of input.runs) byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
  const finishedRuns = input.runs.filter((run) => run.finishedAt && run.startedAt);
  const latencies = finishedRuns.map((run) =>
    Math.max(0, run.finishedAt!.getTime() - run.startedAt!.getTime()),
  );
  const completed = byStatus.completed ?? 0;
  const failed = byStatus.failed ?? 0;
  const interrupted = byStatus.interrupted ?? 0;
  const terminal = completed + failed + interrupted + (byStatus.cancelled ?? 0);
  const successRate = terminal ? completed / terminal : 1;
  const interruptedRate = terminal ? interrupted / terminal : 0;
  const totalTokens = input.runs.reduce(
    (sum, run) => sum + (run.tokenUsage?.input ?? 0) + (run.tokenUsage?.output ?? 0),
    0,
  );
  const count = (items: string[], status: string) => items.filter((item) => item === status).length;
  const p95 = percentile(latencies, 0.95);
  const pendingOutbox = count(input.outboxStatuses, "pending");
  const failedOutbox = count(input.outboxStatuses, "failed");
  const reconciliation = count(input.durableJobStatuses, "needs_reconciliation");

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    runs: {
      total: input.runs.length,
      byStatus,
      finished: finishedRuns.length,
      successRate,
      interruptedRate,
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95,
        p99: percentile(latencies, 0.99),
        max: latencies.length ? Math.max(...latencies) : 0,
      },
      totalTokens,
    },
    approvals: {
      pending: count(input.approvalStatuses, "pending"),
      expired: count(input.approvalStatuses, "expired"),
    },
    outbox: {
      pending: pendingOutbox,
      processing: count(input.outboxStatuses, "processing"),
      failed: failedOutbox,
    },
    durableJobs: {
      queued: count(input.durableJobStatuses, "queued"),
      leased: count(input.durableJobStatuses, "leased"),
      needsReconciliation: reconciliation,
      failed: count(input.durableJobStatuses, "failed"),
    },
    slo: [
      { id: "run_success_rate", target: ">= 0.95", value: successRate, passed: successRate >= 0.95 },
      { id: "run_p95_latency_ms", target: "<= 300000", value: p95, passed: p95 <= 300_000 },
      { id: "interrupted_rate", target: "<= 0.01", value: interruptedRate, passed: interruptedRate <= 0.01 },
      { id: "outbox_backlog", target: "<= 100", value: pendingOutbox + failedOutbox, passed: pendingOutbox + failedOutbox <= 100 },
      { id: "needs_reconciliation", target: "= 0", value: reconciliation, passed: reconciliation === 0 },
    ],
  };
}
