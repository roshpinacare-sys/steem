/**
 * TFA Evolution Studio v28 — Metrics Store
 *
 * Trend analysis, bottleneck detection, and cycle summary statistics.
 */

export interface MetricPoint {
  timestamp: string;
  value: number;
  label: string;
}

const metrics: MetricPoint[] = [];

export function recordMetric(point: MetricPoint): void {
  metrics.push(point);
}

export function computeTrendAnalysis(label: string, window = 10): {
  slope: number;
  average: number;
} {
  const subset = metrics.filter((m) => m.label === label).slice(-window);
  if (subset.length < 2) return { slope: 0, average: subset[0]?.value ?? 0 };
  const avg = subset.reduce((s, m) => s + m.value, 0) / subset.length;
  // Simple linear slope using first and last
  const slope = (subset[subset.length - 1].value - subset[0].value) / subset.length;
  return { slope, average: avg };
}

export function detectBottleneckPhase(runMetrics: { phase: string; durationMs: number }[]): string | undefined {
  if (runMetrics.length === 0) return undefined;
  const max = runMetrics.reduce((a, b) => (a.durationMs > b.durationMs ? a : b));
  return max.durationMs > 60_000 ? max.phase : undefined;
}

export function getCycleSummaryStats(): {
  totalRuns: number;
  avgDurationMs: number;
  successRate: number;
} {
  const successMetrics = metrics.filter((m) => m.label === "success");
  const durationMetrics = metrics.filter((m) => m.label === "duration");
  const totalRuns = successMetrics.length;
  const successes = successMetrics.filter((m) => m.value > 0).length;
  const avgDurationMs =
    durationMetrics.length > 0
      ? durationMetrics.reduce((s, m) => s + m.value, 0) / durationMetrics.length
      : 0;
  return {
    totalRuns,
    avgDurationMs,
    successRate: totalRuns > 0 ? successes / totalRuns : 0,
  };
}
