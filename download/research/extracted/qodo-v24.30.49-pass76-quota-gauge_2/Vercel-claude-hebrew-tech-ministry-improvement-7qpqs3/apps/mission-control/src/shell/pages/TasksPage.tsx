/**
 * TasksPage — the parallel task board.
 *
 * Live (GitHub): every card is a REAL workflow run from your repository, plus
 * open pull requests; New task launches a real agent run via
 * workflow_dispatch. Simulator/proxy modes keep the telemetry board. With
 * nothing connected, this page leads with the connect surface.
 */
import React, { useMemo } from "react";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import { listRuns, type RunSummary } from "../../mobile/derive.js";
import { phaseLabel } from "../../utils/phase-meta.js";
import { UI, Panel, ScrollArea, CardGrid, StatTile, Button, EmptyState, SectionTitle } from "../ui.js";
import { plural } from "../../utils/plural.js";
import { Icon } from "../icons.js";
import { ProgressBar, RunStatusPill } from "./_shared.js";
import { ConnectHero } from "../ConnectSurface.js";
import { useGitHubLive } from "../github/GitHubLiveContext.js";
import { GhRunCard, GhPrCard, GhSyncBar } from "../github/RealOps.js";
import type { PageProps } from "../PlatformShell.js";

export function TasksPage(props: PageProps): React.ReactElement {
  const { mc, navigate } = props;
  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }
  if (mc.source === "github") return <GitHubBoard {...props} />;
  return <TelemetryBoard {...props} />;
}

/** Real workflow runs + PRs from the connected repository. */
function GitHubBoard({ mc, navigate }: PageProps): React.ReactElement {
  const gh = useGitHubLive();
  const active = gh.runs.filter((r) => r.status !== "completed");
  const passed = gh.runs.filter((r) => r.conclusion === "success");

  return (
    <ScrollArea>
      <GhSyncBar />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <CardGrid min={150} gap={12} style={{ flex: 1, minWidth: 280 }}>
          <StatTile label="Running" value={active.length} accent={active.length ? UI.amber : UI.textMuted} />
          <StatTile label="Passed" value={passed.length} accent={UI.green} sub={`of last ${plural(gh.runs.length, "run")}`} />
          <StatTile label="Open PRs" value={gh.prs.length} accent={UI.indigoLight} />
        </CardGrid>
        <Button variant="primary" onClick={mc.openComposer} disabled={mc.busy}>
          <Icon name="dispatch" size={15} /> {mc.busy ? "Launching…" : "New task"}
        </Button>
      </div>

      <SectionTitle>Workflow runs · live</SectionTitle>
      {gh.runs.length === 0 ? (
        <Panel>
          <EmptyState icon="◇" title={gh.loading ? "Syncing your repository…" : "No workflow runs yet"}
            hint="Launch a task — it dispatches the agent pipeline in your repository and appears here as a real run." />
        </Panel>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {gh.runs.slice(0, 12).map((r) => <GhRunCard key={r.id} r={r} onOpen={() => navigate("runs")} />)}
        </div>
      )}

      {gh.prs.length > 0 && (
        <>
          <SectionTitle>Open pull requests</SectionTitle>
          {gh.prs.map((p) => <GhPrCard key={p.number} p={p} />)}
        </>
      )}
    </ScrollArea>
  );
}

/** Simulator / telemetry-proxy board (unchanged behavior, clearly labeled). */
function TelemetryBoard({ mc, navigate }: PageProps): React.ReactElement {
  const { events } = useTelemetryCtx();
  const runs = useMemo(() => listRuns(events), [events]);
  const running = runs.filter((r) => r.status === "running");
  const done = runs.filter((r) => r.status === "done");

  return (
    <ScrollArea>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <CardGrid min={150} gap={12} style={{ flex: 1, minWidth: 280 }}>
          <StatTile label="Active" value={running.length} accent={running.length ? UI.amber : UI.textMuted} />
          <StatTile label="Merged" value={done.length} accent={UI.green} />
          <StatTile label="Total" value={runs.length} accent={UI.indigoLight} />
        </CardGrid>
        <Button variant="primary" onClick={mc.openComposer}><Icon name="dispatch" size={15} /> New task</Button>
      </div>

      {runs.length === 0 ? (
        <Panel>
          <EmptyState icon="◇" title="No tasks yet"
            hint="Launch a task — give the agent an objective and a repo, and it plans, writes, validates, commits, and merges. Launch several at once to run them in parallel." />
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}>
            <Button variant="primary" onClick={mc.openComposer}><Icon name="dispatch" size={15} /> New task</Button>
          </div>
        </Panel>
      ) : (
        <CardGrid min={300} gap={14}>
          {runs.map((r) => <TaskCard key={r.runId ?? "none"} run={r} onOpen={() => navigate("runs")} />)}
        </CardGrid>
      )}
    </ScrollArea>
  );
}

function TaskCard({ run, onOpen }: { run: RunSummary; onOpen: () => void }): React.ReactElement {
  const color = run.status === "failed" ? UI.red : run.status === "done" ? UI.green : run.status === "running" ? UI.amber : UI.textMuted;
  return (
    <Panel interactive onClick={onOpen} pad={16} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "monospace", fontSize: 12.5, color: UI.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {run.runId}
        </span>
        <RunStatusPill status={run.status} />
      </div>
      <div style={{ fontSize: 13, color: UI.textPrimary }}>
        {run.latest ? phaseLabel(run.latest.phase) : "—"}
        {run.latest?.decision ? <span style={{ color: UI.textMuted }}> · {run.latest.decision.replace(/[-_]/g, " ")}</span> : null}
      </div>
      <ProgressBar value={run.progress} color={color} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: UI.textMuted }}>
        <span>{run.touchedCorePhases.size}/9 phases</span>
        <span>{run.totalTokens.toLocaleString()} tok · {plural(run.eventCount, "event")}</span>
      </div>
    </Panel>
  );
}
