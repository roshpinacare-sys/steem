/**
 * RunsPage — every delivery run in the stream, with a detail drawer showing
 * the nine-phase stepper, per-phase timing, cost, and safety events. Driven
 * entirely by derive.ts.
 */
import React, { useMemo, useState } from "react";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import { listRuns, corePhaseSteps, runCost, safetyEvents } from "../../mobile/derive.js";
import { phaseLabel } from "../../utils/phase-meta.js";
import { UI, Panel, ScrollArea, EmptyState } from "../ui.js";
import { plural } from "../../utils/plural.js";
import { ProgressBar, RunStatusPill, EventRow } from "./_shared.js";
import { ConnectHero } from "../ConnectSurface.js";
import { useGitHubLive } from "../github/GitHubLiveContext.js";
import { GhRunCard, GhRunDetail, GhSyncBar } from "../github/RealOps.js";
import type { PageProps } from "../PlatformShell.js";

export function RunsPage(props: PageProps): React.ReactElement {
  const { mc, navigate } = props;
  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }
  if (mc.source === "github") return <GitHubRuns isMobile={props.isMobile} />;
  return <TelemetryRuns {...props} />;
}

/** Live (GitHub): real workflow runs with real job/step detail. */
function GitHubRuns({ isMobile }: { isMobile: boolean }): React.ReactElement {
  const gh = useGitHubLive();
  const [selected, setSelected] = useState<number | null>(null);
  const active = selected ?? gh.runs[0]?.id ?? null;
  const activeRun = gh.runs.find((r) => r.id === active) ?? null;

  if (gh.runs.length === 0) {
    return (
      <ScrollArea>
        <GhSyncBar />
        <Panel><EmptyState icon="◷" title={gh.loading ? "Syncing your repository…" : "No workflow runs yet"} hint="Every run in your repository appears here with live job-by-job progress." /></Panel>
      </ScrollArea>
    );
  }

  if (isMobile) {
    if (selected != null && activeRun) {
      return (
        <ScrollArea>
          <button onClick={() => setSelected(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: UI.indigoLight, fontSize: 13, fontWeight: 600, padding: "0 0 14px", fontFamily: "inherit" }}>‹ All runs</button>
          <GhRunDetail run={activeRun} />
        </ScrollArea>
      );
    }
    return (
      <ScrollArea>
        <GhSyncBar />
        {gh.runs.map((r) => <GhRunCard key={r.id} r={r} onOpen={() => setSelected(r.id)} />)}
      </ScrollArea>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(360px, 1.2fr)", height: "100%", minHeight: 0 }}>
      <div style={{ overflowY: "auto", padding: "20px 16px 32px", borderRight: `1px solid ${UI.border}` }}>
        <GhSyncBar />
        {gh.runs.map((r) => <GhRunCard key={r.id} r={r} active={r.id === active} onOpen={() => setSelected(r.id)} />)}
      </div>
      <div style={{ overflowY: "auto", padding: "20px 24px 32px" }}>
        {activeRun && <GhRunDetail run={activeRun} />}
      </div>
    </div>
  );
}

function TelemetryRuns({ isMobile }: PageProps): React.ReactElement {
  const { events } = useTelemetryCtx();
  const runs = useMemo(() => listRuns(events), [events]);
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ?? runs[0]?.runId ?? null;

  if (runs.length === 0) {
    return (
      <ScrollArea>
        <Panel><EmptyState icon="◷" title="No runs yet" hint="Launch a task and it will appear here with live progress, timing, and cost." /></Panel>
      </ScrollArea>
    );
  }

  const RunCard = ({ r }: { r: ReturnType<typeof listRuns>[number] }) => {
    const on = r.runId === active;
    return (
      <Panel interactive onClick={() => setSelected(r.runId)} pad={14}
        style={{ marginBottom: 10, background: on && !isMobile ? UI.bgActive : UI.bgPanel, borderColor: on && !isMobile ? "rgba(99,102,241,0.35)" : undefined }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: UI.textPrimary, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortRun(r.runId)}</span>
          <RunStatusPill status={r.status} />
        </div>
        <ProgressBar value={r.progress} color={r.status === "failed" ? UI.red : r.status === "done" ? UI.green : UI.indigo} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, fontSize: 11.5, color: UI.textMuted }}>
          <span>{r.touchedCorePhases.size}/9 phases</span>
          <span>{r.totalTokens.toLocaleString()} tok · {plural(r.eventCount, "event")}</span>
        </div>
      </Panel>
    );
  };

  // Phone: list, then drill into a single run's detail with a back control.
  if (isMobile) {
    if (selected) {
      return (
        <ScrollArea>
          <button onClick={() => setSelected(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: UI.indigoLight, fontSize: 13, fontWeight: 600, padding: "0 0 14px", fontFamily: "inherit" }}>‹ All runs</button>
          <RunDetail runId={selected} />
        </ScrollArea>
      );
    }
    return <ScrollArea>{runs.map((r) => <RunCard key={r.runId ?? "none"} r={r} />)}</ScrollArea>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(360px, 1.2fr)", height: "100%", minHeight: 0 }}>
      {/* Run list */}
      <div style={{ overflowY: "auto", padding: "20px 16px 32px", borderRight: `1px solid ${UI.border}` }}>
        {runs.map((r) => <RunCard key={r.runId ?? "none"} r={r} />)}
      </div>

      {/* Detail */}
      <div style={{ overflowY: "auto", padding: "20px 24px 32px" }}>
        {active && <RunDetail runId={active} />}
      </div>
    </div>
  );
}

function RunDetail({ runId }: { runId: string }): React.ReactElement {
  const { events } = useTelemetryCtx();
  const steps = useMemo(() => corePhaseSteps(events, runId), [events, runId]);
  const cost = useMemo(() => runCost(events, runId), [events, runId]);
  const safety = useMemo(() => safetyEvents(events, runId).slice(0, 8), [events, runId]);

  const stateColor: Record<string, string> = { done: UI.green, current: UI.amber, failed: UI.red, pending: UI.textMuted };

  return (
    <div>
      <div style={{ fontSize: 12.5, color: UI.textMuted, fontFamily: "monospace", marginBottom: 16 }}>{runId}</div>

      <div style={{ marginBottom: 22 }}>
        {steps.map((s, i) => (
          <div key={s.phase} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch" }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
                border: `2px solid ${stateColor[s.state]}`, color: stateColor[s.state], fontSize: 11, fontWeight: 700,
                background: s.state === "done" ? `${UI.green}22` : "transparent",
                boxShadow: s.state === "current" ? `0 0 8px ${UI.amber}` : "none",
              }}>
                {s.state === "done" ? "✓" : s.state === "failed" ? "✕" : i + 1}
              </span>
              {i < steps.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 14, background: s.state === "done" ? UI.green : UI.border }} />}
            </div>
            <div style={{ paddingBottom: 14, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: s.state === "pending" ? UI.textMuted : UI.textPrimary }}>{phaseLabel(s.phase)}</div>
              {s.lastEvent?.decision && (
                <div style={{ fontSize: 12, color: UI.textMuted }}>{s.lastEvent.decision.replace(/[-_]/g, " ")}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {cost && (
        <Panel pad={14} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12.5, color: UI.textMuted }}>Run cost</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: UI.green }}>${(cost.cents / 100).toFixed(4)}</span>
          </div>
          <div style={{ fontSize: 11.5, color: UI.textMuted, marginTop: 4 }}>
            {cost.totalTokens.toLocaleString()} tokens · {cost.callCount} calls
          </div>
        </Panel>
      )}

      {safety.length > 0 && (
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, marginBottom: 8 }}>
            Safety events
          </div>
          <Panel pad={6}>{safety.map((e, i) => <EventRow key={i} e={e} />)}</Panel>
        </div>
      )}
    </div>
  );
}

function shortRun(runId: string | null): string {
  if (!runId) return "—";
  return runId.length > 26 ? runId.slice(0, 24) + "…" : runId;
}
