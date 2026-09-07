/**
 * insights.ts — pure derivations over real workflow runs for the Insights
 * page. Wall-clock durations include queue time (updatedAt − createdAt) and
 * the UI says so; nothing here is estimated or invented.
 */
import type { GhRun } from "./client.js";
import type { DayBucket } from "../charts.js";

export interface WorkflowStat {
  name: string;
  runs: number;
  failures: number;
  avgMs: number;
  p50Ms: number;
}

export interface InsightsModel {
  total: number;
  completed: number;
  successRate: number | null;          // 0..100 over completed runs
  successRateDelta: number | null;     // last-half minus first-half, pct points
  medianDurationMs: number | null;
  days: DayBucket[];                   // last 14 UTC days
  workflows: WorkflowStat[];           // by run count desc
  hotspots: WorkflowStat[];            // failures desc
  trend: number[];                     // rolling success rate, oldest→newest
  topActors: [string, number][];
  topEvents: [string, number][];
}

const DAY = 86_400_000;

export function deriveInsights(runs: GhRun[]): InsightsModel {
  const completed = runs.filter((r) => r.status === "completed");
  const decided = completed.filter((r) => r.conclusion === "success" || r.conclusion === "failure" || r.conclusion === "timed_out");
  const ok = (r: GhRun) => r.conclusion === "success";

  // Success rate + half-over-half delta (oldest half vs newest half).
  const successRate = decided.length ? Math.round((decided.filter(ok).length / decided.length) * 100) : null;
  let successRateDelta: number | null = null;
  if (decided.length >= 10) {
    const sorted = [...decided].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    const half = Math.floor(sorted.length / 2);
    const first = sorted.slice(0, half);
    const second = sorted.slice(half);
    const rate = (xs: GhRun[]) => (xs.filter(ok).length / xs.length) * 100;
    successRateDelta = Math.round(rate(second) - rate(first));
  }

  // Durations (completed only).
  const durations = completed
    .map((r) => +new Date(r.updatedAt) - +new Date(r.createdAt))
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const medianDurationMs = durations.length ? durations[Math.floor(durations.length / 2)] : null;

  // Runs per UTC day, last 14 days.
  const today = Math.floor(Date.now() / DAY);
  const days: DayBucket[] = [];
  for (let i = 13; i >= 0; i--) {
    const dayIdx = today - i;
    const inDay = runs.filter((r) => Math.floor(+new Date(r.createdAt) / DAY) === dayIdx);
    const d = new Date(dayIdx * DAY);
    days.push({
      label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
      success: inDay.filter(ok).length,
      failure: inDay.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").length,
    });
  }

  // Per-workflow stats.
  const byWf = new Map<string, GhRun[]>();
  for (const r of runs) {
    const list = byWf.get(r.workflowName) ?? [];
    list.push(r);
    byWf.set(r.workflowName, list);
  }
  const workflows: WorkflowStat[] = [...byWf.entries()].map(([name, list]) => {
    const done = list.filter((r) => r.status === "completed");
    const ds = done.map((r) => +new Date(r.updatedAt) - +new Date(r.createdAt)).filter((d) => d > 0).sort((a, b) => a - b);
    return {
      name,
      runs: list.length,
      failures: list.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").length,
      avgMs: ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : 0,
      p50Ms: ds.length ? ds[Math.floor(ds.length / 2)] : 0,
    };
  }).sort((a, b) => b.runs - a.runs);

  const hotspots = workflows.filter((w) => w.failures > 0).sort((a, b) => b.failures - a.failures);

  // Rolling success-rate trend (window of 10, oldest→newest).
  const chrono = [...decided].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const trend: number[] = [];
  const W = 10;
  for (let i = W; i <= chrono.length; i++) {
    const win = chrono.slice(i - W, i);
    trend.push(Math.round((win.filter(ok).length / W) * 100));
  }

  const count = (key: (r: GhRun) => string): [string, number][] => {
    const m = new Map<string, number>();
    for (const r of runs) { const k = key(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  };

  return {
    total: runs.length,
    completed: completed.length,
    successRate,
    successRateDelta,
    medianDurationMs,
    days,
    workflows: workflows.slice(0, 8),
    hotspots: hotspots.slice(0, 5),
    trend,
    topActors: count((r) => r.actor),
    topEvents: count((r) => r.event),
  };
}

export function fmtDuration(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
