/**
 * PipelinePage — the nine-phase delivery pipeline for the current run as a
 * live stepper with per-phase timing. Shows exactly where the agent is and how
 * long each phase held the baton.
 */
import React, { useMemo } from "react";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import { corePhaseSteps, phaseTimings, summarizeRun } from "../../mobile/derive.js";
import { phaseLabel } from "../../utils/phase-meta.js";
import { UI, Panel, ScrollArea, EmptyState, Pill } from "../ui.js";
import { ProgressBar, RunStatusPill } from "./_shared.js";
import { ConnectHero } from "../ConnectSurface.js";
import { TelemetryDepthNotice } from "../github/RealOps.js";
import type { PageProps } from "../PlatformShell.js";

const STATE_COLOR: Record<string, string> = { done: UI.green, current: UI.amber, failed: UI.red, pending: UI.textMuted };

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function PipelinePage({ mc, navigate }: PageProps): React.ReactElement {
  const { events, currentRunId } = useTelemetryCtx();
  const runId = currentRunId;
  const summary = useMemo(() => summarizeRun(events, runId), [events, runId]);
  const steps = useMemo(() => corePhaseSteps(events, runId), [events, runId]);
  const timings = useMemo(() => (runId ? phaseTimings(events, runId) : []), [events, runId]);
  const tookByPhase = new Map(timings.map((t) => [t.phase, t.tookMs]));

  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }

  if (!runId) {
    return (
      <ScrollArea>
        {mc.source === "github" && <TelemetryDepthNotice onSettings={() => navigate("settings")} />}
        <Panel><EmptyState icon="◫" title="No active run" hint="The nine-phase pipeline — Architect → Coder → Gate → Commit → AST-Doc → Canary → Merge → Post-Merge → Reviewer — lights up here as soon as a mission is dispatched." /></Panel>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea>
      <Panel pad={18} style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: UI.textMuted, fontFamily: "monospace" }}>{runId}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <RunStatusPill status={summary.status} />
            <Pill color={UI.indigo}>{summary.touchedCorePhases.size}/9 phases</Pill>
          </div>
        </div>
        <ProgressBar value={summary.progress} color={summary.status === "failed" ? UI.red : summary.status === "done" ? UI.green : UI.indigo} height={8} />
      </Panel>

      <Panel pad={18}>
        {steps.map((s, i) => {
          const took = tookByPhase.get(s.phase) ?? null;
          const color = STATE_COLOR[s.state];
          return (
            <div key={s.phase} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch" }}>
                <span style={{
                  width: 26, height: 26, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
                  border: `2px solid ${color}`, color, fontSize: 12, fontWeight: 700,
                  background: s.state === "done" ? `${UI.green}22` : s.state === "current" ? `${UI.amber}18` : "transparent",
                  boxShadow: s.state === "current" ? `0 0 10px ${UI.amber}` : "none",
                }}>
                  {s.state === "done" ? "✓" : s.state === "failed" ? "✕" : i + 1}
                </span>
                {i < steps.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 18, background: s.state === "done" ? UI.green : UI.border }} />}
              </div>
              <div style={{ paddingBottom: 18, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: s.state === "pending" ? UI.textMuted : UI.textPrimary }}>{phaseLabel(s.phase)}</span>
                  {s.state !== "pending" && <span style={{ fontSize: 11.5, color: UI.textMuted, fontVariantNumeric: "tabular-nums" }}>{fmtMs(took)}</span>}
                </div>
                {s.lastEvent?.decision && (
                  <div style={{ fontSize: 12.5, color: UI.textMuted, marginTop: 2 }}>{s.lastEvent.decision.replace(/[-_]/g, " ")}</div>
                )}
              </div>
            </div>
          );
        })}
      </Panel>
    </ScrollArea>
  );
}
