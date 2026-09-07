/**
 * derive.ts — pure derivations from the telemetry event stream shared by
 * the mobile screens. No fetching here; input is always the events array
 * from TelemetryContext.
 */
import type { TelemetryEvent } from "../types/telemetry.js";
import { phaseCategory } from "../utils/phase-meta.js";

/** The core delivery pipeline, in execution order (mirrors PHASE_META core). */
export const CORE_PHASES = [
  "architect",
  "coder",
  "gate",
  "commit",
  "astdoc",
  "canary",
  "merge",
  "postmerge",
  "review",
] as const;

export type RunStatus = "idle" | "running" | "done" | "failed";

export interface RunSummary {
  runId: string | null;
  status: RunStatus;
  /** Core phases that have emitted at least one event this run. */
  touchedCorePhases: Set<string>;
  /** 0..1 progress across the core pipeline. */
  progress: number;
  latest: TelemetryEvent | null;
  startedAt: string | null;
  totalTokens: number;
  eventCount: number;
}

export function summarizeRun(events: TelemetryEvent[], runId: string | null): RunSummary {
  if (!runId) {
    return {
      runId: null,
      status: "idle",
      touchedCorePhases: new Set(),
      progress: 0,
      latest: null,
      startedAt: null,
      totalTokens: 0,
      eventCount: 0,
    };
  }

  const run = events
    .filter((e) => e.runId === runId)
    .sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));

  const touched = new Set<string>();
  let tokens = 0;
  for (const e of run) {
    if ((CORE_PHASES as readonly string[]).includes(e.phase)) touched.add(e.phase);
    if (typeof e.totalTokens === "number") tokens += e.totalTokens;
  }

  const failed = run.some((e) => e.decision === "fatal-error");
  const done = run.some((e) => e.decision === "done");
  const latest = run[run.length - 1] ?? null;
  // A run with no fresh events for 45 minutes isn't "running" — the agent's
  // own hard ceiling (mentor wait) is 30 minutes.
  const stale = latest ? Date.now() - +new Date(latest.timestamp) > 45 * 60 * 1000 : true;

  return {
    runId,
    status: failed ? "failed" : done ? "done" : stale ? "idle" : "running",
    touchedCorePhases: touched,
    progress: done ? 1 : touched.size / CORE_PHASES.length,
    latest,
    startedAt: run[0]?.timestamp ?? null,
    totalTokens: tokens,
    eventCount: run.length,
  };
}

export interface PhaseStep {
  phase: string;
  state: "done" | "current" | "failed" | "pending";
  lastEvent: TelemetryEvent | null;
}

/** Vertical-stepper model for the core pipeline of one run. */
export function corePhaseSteps(events: TelemetryEvent[], runId: string | null): PhaseStep[] {
  const run = runId
    ? events
        .filter((e) => e.runId === runId)
        .sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp))
    : [];

  const lastByPhase = new Map<string, TelemetryEvent>();
  for (const e of run) lastByPhase.set(e.phase, e);

  const fatal = run.some((e) => e.decision === "fatal-error");
  const doneRun = run.some((e) => e.decision === "done");

  // The furthest core phase with events is "current" while the run lives.
  let furthest = -1;
  CORE_PHASES.forEach((p, i) => {
    if (lastByPhase.has(p)) furthest = i;
  });

  return CORE_PHASES.map((phase, i) => {
    const lastEvent = lastByPhase.get(phase) ?? null;
    let state: PhaseStep["state"];
    if (i < furthest) state = "done";
    else if (i === furthest) state = fatal ? "failed" : doneRun ? "done" : "current";
    else state = "pending";
    return { phase, state, lastEvent };
  });
}

/** Safety/governance events of a run (warden, guards, mentor…), newest first. */
export function safetyEvents(events: TelemetryEvent[], runId: string | null): TelemetryEvent[] {
  return events
    .filter((e) => (!runId || e.runId === runId) && phaseCategory(e.phase) === "safety")
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
}

/** Every run in the stream, summarized, newest activity first. */
export function listRuns(events: TelemetryEvent[]): RunSummary[] {
  const ids = new Map<string, number>(); // runId → last activity
  for (const e of events) {
    const t = +new Date(e.timestamp);
    ids.set(e.runId, Math.max(ids.get(e.runId) ?? 0, t));
  }
  return [...ids.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => summarizeRun(events, id));
}

export interface PhaseTiming {
  phase: string;
  startedAt: string;
  /** ms until the next core phase began (null for the last touched phase). */
  tookMs: number | null;
}

/**
 * Per-phase timing: how long each touched core phase held the baton,
 * measured first-event → next touched phase's first event.
 */
export function phaseTimings(events: TelemetryEvent[], runId: string): PhaseTiming[] {
  const firstByPhase = new Map<string, number>();
  for (const e of events) {
    if (e.runId !== runId) continue;
    if (!(CORE_PHASES as readonly string[]).includes(e.phase)) continue;
    const t = +new Date(e.timestamp);
    const cur = firstByPhase.get(e.phase);
    if (cur === undefined || t < cur) firstByPhase.set(e.phase, t);
  }
  const touched = CORE_PHASES.filter((p) => firstByPhase.has(p));
  return touched.map((phase, i) => {
    const start = firstByPhase.get(phase)!;
    const next = i + 1 < touched.length ? firstByPhase.get(touched[i + 1])! : null;
    return {
      phase,
      startedAt: new Date(start).toISOString(),
      tookMs: next !== null ? next - start : null,
    };
  });
}

export interface RunCost {
  cents: number;
  totalTokens: number;
  callCount: number;
  breakdown: { provider?: string; model?: string; tier?: string; tokens: number; cents: number }[];
}

/** The run's cost-summary payload, if the pipeline emitted one. */
export function runCost(events: TelemetryEvent[], runId: string): RunCost | null {
  const e = events
    .filter((x) => x.runId === runId && x.phase === "cost-summary")
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))[0] as
    | (TelemetryEvent & {
        estimatedUsdCents?: number;
        callCount?: number;
        breakdown?: { provider?: string; model?: string; tier?: string; tokens?: number; cents?: number }[];
      })
    | undefined;
  if (!e || typeof e.estimatedUsdCents !== "number") return null;
  return {
    cents: e.estimatedUsdCents,
    totalTokens: typeof e.totalTokens === "number" ? e.totalTokens : 0,
    callCount: e.callCount ?? 0,
    breakdown: (e.breakdown ?? []).map((b) => ({
      provider: b.provider,
      model: b.model,
      tier: b.tier,
      tokens: b.tokens ?? 0,
      cents: b.cents ?? 0,
    })),
  };
}

/** Aggregate cost/usage across every run that reported a cost-summary. */
export function aggregateCosts(events: TelemetryEvent[]): {
  totalCents: number;
  totalTokens: number;
  runsWithCost: number;
  byModel: { model: string; tokens: number; cents: number }[];
} | null {
  const runs = new Set(events.filter((e) => e.phase === "cost-summary").map((e) => e.runId));
  if (runs.size === 0) return null;
  let totalCents = 0;
  let totalTokens = 0;
  const byModel = new Map<string, { tokens: number; cents: number }>();
  for (const id of runs) {
    const c = runCost(events, id);
    if (!c) continue;
    totalCents += c.cents;
    totalTokens += c.totalTokens;
    for (const b of c.breakdown) {
      const key = b.model ?? b.provider ?? "unknown";
      const cur = byModel.get(key) ?? { tokens: 0, cents: 0 };
      cur.tokens += b.tokens;
      cur.cents += b.cents;
      byModel.set(key, cur);
    }
  }
  return {
    totalCents,
    totalTokens,
    runsWithCost: runs.size,
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}
