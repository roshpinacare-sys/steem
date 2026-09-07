"use client";

import * as React from "react";
import {
  Activity,
  AlarmClock,
  CheckCircle2,
  CircleOff,
  Clock3,
  DatabaseZap,
  Gauge,
  HeartPulse,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  ListChecks,
  LockKeyhole,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import type { OperationalMetrics } from "@/lib/observability/metrics";
import { evaluatePilotReadiness } from "@/lib/release/pilot-readiness";
import { cn } from "@/lib/utils";

export function ControlRoom({ initialMetrics }: { initialMetrics: OperationalMetrics }) {
  const [metrics, setMetrics] = React.useState(initialMetrics);
  const [refreshing, setRefreshing] = React.useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/metrics", { cache: "no-store" });
      if (response.ok) setMetrics(await response.json() as OperationalMetrics);
    } finally {
      setRefreshing(false);
    }
  }

  const violated = metrics.slo.filter((item) => !item.passed);
  const pressure = metrics.outbox.pending + metrics.outbox.processing + metrics.outbox.failed;
  const unsafe = metrics.durableJobs.needsReconciliation + metrics.durableJobs.failed;
  const readiness = React.useMemo(() => evaluatePilotReadiness(metrics), [metrics]);

  return (
    <>
      <PageHeader
        title="Operations signal plane"
        subtitle="A live control surface for pressure, recovery debt, human waits, and service-level evidence."
        action={<Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}><RefreshCw className={cn("size-4", refreshing && "animate-spin")} />Refresh</Button>}
      />

      <section className="signal-plane" aria-label="Operational signal plane">
        <div className="signal-plane__axis" aria-hidden="true"><span>NOW</span><i /><span>RECOVERY</span><i /><span>PROOF</span></div>
        <div className="signal-plane__primary">
          <SignalNode icon={<HeartPulse />} label="Service posture" value={violated.length ? `${violated.length} SLO breach${violated.length === 1 ? "" : "es"}` : "Within declared SLOs"} state={violated.length ? "danger" : "good"} detail={`Generated ${new Date(metrics.generatedAt).toLocaleTimeString()}`} />
          <SignalNode icon={<Activity />} label="Run throughput" value={`${metrics.runs.total} observed`} state="neutral" detail={`${Math.round(metrics.runs.successRate * 100)}% terminal success · p95 ${formatDuration(metrics.runs.latencyMs.p95)}`} />
          <SignalNode icon={<AlarmClock />} label="Human wait" value={`${metrics.approvals.pending} pending`} state={metrics.approvals.pending ? "warning" : "good"} detail={`${metrics.approvals.expired} expired decisions`} />
          <SignalNode icon={<DatabaseZap />} label="Durable state" value={`${metrics.durableJobs.leased} leased`} state={unsafe ? "danger" : "neutral"} detail={`${metrics.durableJobs.queued} queued · ${metrics.durableJobs.needsReconciliation} reconcile · ${metrics.durableJobs.failed} failed`} />
          <SignalNode icon={<Gauge />} label="Outbox pressure" value={`${pressure} unsettled`} state={metrics.outbox.failed ? "danger" : pressure > 100 ? "warning" : "good"} detail={`${metrics.outbox.pending} pending · ${metrics.outbox.processing} processing · ${metrics.outbox.failed} failed`} />
        </div>

        <div className="signal-plane__slo" aria-label="Service level objectives">
          <header><ShieldAlert className="size-4" /><strong>Declared service boundaries</strong><span>{metrics.slo.length - violated.length}/{metrics.slo.length} passing</span></header>
          <ol>
            {metrics.slo.map((item) => (
              <li key={item.id} className={item.passed ? "is-passing" : "is-failing"}>
                {item.passed ? <CheckCircle2 /> : <TriangleAlert />}
                <code>{item.id}</code>
                <span>{item.target}</span>
                <strong>{formatValue(item.id, item.value)}</strong>
              </li>
            ))}
          </ol>
        </div>

        <section className="pilot-readiness" aria-labelledby="pilot-readiness-title">
          <header>
            <div><ListChecks className="size-4" /><span>Pilot evidence gate</span></div>
            <strong id="pilot-readiness-title">{readiness.classification}</strong>
            <p>{readiness.score}/100 evidence score · {readiness.blockers} blockers · {readiness.warnings} warnings or unknowns</p>
          </header>
          <ol>
            {readiness.gates.map((gate) => (
              <li key={gate.id} data-state={gate.state}>
                <span aria-hidden="true">{gate.state === "pass" ? "PASS" : gate.state === "block" ? "BLOCK" : gate.state === "warn" ? "WARN" : "UNKNOWN"}</span>
                <div><strong>{gate.label}</strong><p>{gate.evidence}</p>{gate.nextAction && gate.state !== "pass" ? <small>{gate.nextAction}</small> : null}</div>
              </li>
            ))}
          </ol>
          <footer><LockKeyhole className="size-4" /><span>Unknown release evidence is treated as a blocker. Runtime calm is never promoted into release confidence.</span></footer>
        </section>

        <aside className="signal-plane__truth">
          <CircleOff className="size-5" />
          <div><strong>Zero data is not proof of healthy production.</strong><p>These metrics describe locally persisted observations. They do not substitute for load testing, external uptime monitoring, or a proven multi-process deployment.</p></div>
        </aside>
      </section>
    </>
  );
}

function SignalNode({ icon, label, value, detail, state }: { icon: React.ReactNode; label: string; value: string; detail: string; state: "good" | "warning" | "danger" | "neutral" }) {
  return <article className={cn("signal-node", `signal-node--${state}`)}><div className="signal-node__icon">{icon}</div><span>{label}</span><strong>{value}</strong><p>{detail}</p></article>;
}
function formatDuration(ms: number) {
  if (!ms) return "no sample";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}
function formatValue(id: string, value: number) {
  if (id.includes("rate")) return `${(value * 100).toFixed(1)}%`;
  if (id.includes("latency")) return formatDuration(value);
  return String(value);
}
