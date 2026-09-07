/**
 * OverviewPage — the flagship: system state, the current mission, live vitals,
 * a contained neural-core visualization, and jump-offs into the deeper pages.
 * Everything here is real telemetry; the 3D core is a bounded accent, not the
 * whole screen.
 */
import React, { useMemo } from "react";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import { summarizeRun, listRuns, aggregateCosts } from "../../mobile/derive.js";
import { phaseLabel, phaseCategory, CATEGORY_LABELS, CATEGORY_ORDER, type PhaseCategory } from "../../utils/phase-meta.js";
import { UI, Panel, ScrollArea, CardGrid, StatTile, SectionTitle, Button, Dot, CATEGORY_COLOR, timeAgo } from "../ui.js";
import { plural } from "../../utils/plural.js";
import { Icon } from "../icons.js";
import { ProgressBar, RunStatusPill, EventRow } from "./_shared.js";
import { ConnectHero } from "../ConnectSurface.js";
import { useGitHubLive } from "../github/GitHubLiveContext.js";
import { GhRunCard, GhCommitRow, GhSyncBar, GhRunPill, useGhKpis } from "../github/RealOps.js";
import type { PageProps } from "../PlatformShell.js";

const NeuralCoreLazy = React.lazy(() =>
  import("../../components/NeuralCore.js").then((m) => ({ default: m.NeuralCore })),
);

/**
 * The 3D neural-core accent. It's decoration, not data — labeled as such —
 * and its three.js chunk (~275 KB gz) is heavy, so phones get a lightweight
 * still that activates the live scene only on tap.
 */
function CorePanel({ isMobile }: { isMobile: boolean }): React.ReactElement {
  const [on, setOn] = React.useState(!isMobile);
  return (
    <Panel pad={0} style={{ overflow: "hidden", minHeight: 240, position: "relative" }}>
      <div style={{ position: "absolute", inset: 0 }}>
        {on ? (
          <React.Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", color: UI.textMuted, fontSize: 12 }}>Loading core…</div>}>
            <NeuralCoreLazy />
          </React.Suspense>
        ) : (
          <button onClick={() => setOn(true)}
            style={{
              width: "100%", height: "100%", border: "none", cursor: "pointer",
              background: `radial-gradient(320px 200px at 65% 30%, ${UI.indigo}2e, transparent 70%), radial-gradient(260px 180px at 30% 75%, ${UI.purple}26, transparent 70%)`,
              display: "grid", placeItems: "center", color: UI.textSecondary, fontFamily: "inherit",
            }}>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ width: 42, height: 42, borderRadius: "50%", border: `1.5px solid ${UI.indigo}66`, display: "grid", placeItems: "center", background: `${UI.indigo}1a` }}>▶</span>
              Activate neural core
              <span style={{ fontSize: 10.5, fontWeight: 500, color: UI.textMuted }}>3D visual · loads ~275 KB</span>
            </span>
          </button>
        )}
      </div>
      <div style={{ position: "absolute", top: 12, left: 14, fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, pointerEvents: "none" }}>
        Neural core
      </div>
    </Panel>
  );
}

export function OverviewPage(props: PageProps): React.ReactElement {
  const { mc, navigate } = props;
  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }
  if (mc.source === "github") return <GitHubOverview {...props} />;
  return <TelemetryOverview {...props} />;
}

/** Live (GitHub): the real state of your repository at a glance. */
function GitHubOverview({ mc, navigate, isMobile }: PageProps): React.ReactElement {
  const cols = isMobile ? "1fr" : "minmax(0, 1.15fr) minmax(0, 1fr)";
  const gh = useGitHubLive();
  const k = useGhKpis();
  const featured = k.activeRun ?? k.latest;

  const workflows = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of gh.runs) m.set(r.workflowName, (m.get(r.workflowName) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [gh.runs]);

  return (
    <ScrollArea>
      <GhSyncBar />
      <CardGrid min={196} gap={14} style={{ marginBottom: 18 }}>
        <StatTile label="System" value={k.activeRun ? "Running" : "Ready"} accent={k.activeRun ? UI.amber : UI.green}
          sub={k.latest ? `last run ${timeAgo(k.latest.createdAt)}` : "no runs yet"}
          icon={<Dot color={k.activeRun ? UI.amber : UI.green} glow={Boolean(k.activeRun)} />} />
        <StatTile label="Runs · 7d" value={k.runsThisWeek} accent={UI.indigoLight} sub={`${k.total} in view`} />
        <StatTile label="Success rate" value={k.successRate != null ? `${k.successRate}%` : "—"} accent={k.successRate != null && k.successRate >= 80 ? UI.green : UI.amber} sub="completed runs" />
        <StatTile label="Open PRs" value={k.openPrs} accent={UI.cyan} sub={mc.githubRepo ?? ""} />
      </CardGrid>

      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, marginBottom: 18 }}>
        <Panel pad={18}>
          <SectionTitle right={featured ? <GhRunPill r={featured} /> : undefined}>Current mission</SectionTitle>
          {featured ? (
            <>
              <div style={{ fontSize: 15, lineHeight: 1.5, color: UI.textPrimary, marginBottom: 14, minHeight: 44 }}>
                {featured.title || featured.workflowName}
                <div style={{ fontSize: 12, color: UI.textMuted, fontFamily: "monospace", marginTop: 4 }}>
                  {featured.workflowName} #{featured.runNumber} · {featured.branch} · by {featured.actor}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                <Button onClick={() => navigate("runs")}><Icon name="runs" size={15} /> Job detail</Button>
                <Button onClick={() => navigate("activity")}><Icon name="activity" size={15} /> Live activity</Button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 14, color: UI.textMuted, lineHeight: 1.6 }}>
              No runs yet — press <strong style={{ color: UI.textSecondary }}>New task</strong> to dispatch the agent pipeline in {mc.githubRepo}.
            </div>
          )}
        </Panel>

        <CorePanel isMobile={isMobile} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16 }}>
        <div>
          <SectionTitle right={<button onClick={() => navigate("activity")} style={linkBtn}>View all ›</button>}>Latest commits</SectionTitle>
          <Panel pad={6}>
            {gh.commits.length === 0
              ? <div style={{ padding: 24, textAlign: "center", color: UI.textMuted, fontSize: 13 }}>{gh.loading ? "Syncing…" : "No commits in view."}</div>
              : gh.commits.slice(0, 7).map((c) => <GhCommitRow key={c.sha} c={c} />)}
          </Panel>
        </div>

        <div>
          <SectionTitle right={<button onClick={() => navigate("runs")} style={linkBtn}>Open ›</button>}>Recent runs</SectionTitle>
          {gh.runs.slice(0, 3).map((r) => <GhRunCard key={r.id} r={r} onOpen={() => navigate("runs")} />)}
          {workflows.length > 0 && (
            <Panel pad={14} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {workflows.map(([name, count]) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Dot color={UI.indigo} size={8} />
                  <span style={{ flex: 1, fontSize: 13, color: UI.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: UI.indigoLight, fontVariantNumeric: "tabular-nums" }}>{count}</span>
                </div>
              ))}
            </Panel>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

function TelemetryOverview({ mc, navigate, isMobile }: PageProps): React.ReactElement {
  const cols = isMobile ? "1fr" : "minmax(0, 1.15fr) minmax(0, 1fr)";
  const { events, currentRunId } = useTelemetryCtx();
  const summary = useMemo(() => summarizeRun(events, currentRunId), [events, currentRunId]);
  const runs = useMemo(() => listRuns(events), [events]);
  const agg = useMemo(() => aggregateCosts(events), [events]);

  const activeAgents = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (currentRunId && e.runId === currentRunId && Date.now() - +new Date(e.timestamp) < 90_000) set.add(e.phase);
    return set.size;
  }, [events, currentRunId]);

  const recent = useMemo(
    () => [...events].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)).slice(0, 7),
    [events],
  );

  const catCounts = useMemo(() => {
    const m = new Map<PhaseCategory, number>();
    for (const e of events) { const c = phaseCategory(e.phase); m.set(c, (m.get(c) ?? 0) + 1); }
    return m;
  }, [events]);

  const statusColor = summary.status === "running" ? UI.amber : summary.status === "done" ? UI.green : summary.status === "failed" ? UI.red : UI.textMuted;

  return (
    <ScrollArea>
      {/* KPI row */}
      <CardGrid min={196} gap={14} style={{ marginBottom: 18 }}>
        <StatTile label="System" value={summary.status === "idle" ? "Ready" : summary.status[0].toUpperCase() + summary.status.slice(1)} accent={statusColor}
          sub={summary.latest ? phaseLabel(summary.latest.phase) : "awaiting dispatch"}
          icon={<Dot color={statusColor} glow={summary.status === "running"} />} />
        <StatTile label="Runs" value={runs.length} accent={UI.indigoLight} sub={`${runs.filter((r) => r.status === "done").length} merged`} />
        <StatTile label="Active agents" value={activeAgents} accent={UI.cyan} sub="in the current run" />
        <StatTile label="Spend" value={agg ? `$${(agg.totalCents / 100).toFixed(3)}` : "$0"} accent={UI.green} sub={agg ? `${agg.totalTokens.toLocaleString()} tokens` : "no cost yet"} />
      </CardGrid>

      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, marginBottom: 18 }}>
        {/* Current mission */}
        <Panel pad={18}>
          <SectionTitle right={<RunStatusPill status={summary.status} />}>Current mission</SectionTitle>
          <div style={{ fontSize: 15, lineHeight: 1.5, color: mc.mission || summary.runId ? UI.textPrimary : UI.textMuted, marginBottom: 14, minHeight: 44 }}>
            {mc.mission
              ? mc.mission
              : summary.runId
                ? <>Tracking <span style={{ fontFamily: "monospace", fontSize: 13 }}>{summary.runId}</span>{summary.latest ? <> — latest: <strong>{phaseLabel(summary.latest.phase)}</strong></> : null}</>
                : "No mission dispatched yet. Press Dispatch (⌘K) to give the agent an objective and a repository."}
          </div>
          <ProgressBar value={summary.progress} color={statusColor} height={8} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12, color: UI.textMuted }}>
            <span>{summary.touchedCorePhases.size}/9 phases</span>
            <span>{plural(summary.eventCount, "event")} · {summary.totalTokens.toLocaleString()} tok</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Button onClick={() => navigate("pipeline")}><Icon name="pipeline" size={15} /> View pipeline</Button>
            <Button onClick={() => navigate("activity")}><Icon name="activity" size={15} /> Live activity</Button>
          </div>
        </Panel>

        {/* Neural core accent */}
        <CorePanel isMobile={isMobile} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16 }}>
        {/* Recent activity */}
        <div>
          <SectionTitle right={<button onClick={() => navigate("activity")} style={linkBtn}>View all ›</button>}>Recent activity</SectionTitle>
          <Panel pad={6}>
            {recent.length === 0
              ? <div style={{ padding: 24, textAlign: "center", color: UI.textMuted, fontSize: 13 }}>Idle — no telemetry yet.</div>
              : recent.map((e, i) => <EventRow key={i} e={e} expandable={false} />)}
          </Panel>
        </div>

        {/* Ministry snapshot */}
        <div>
          <SectionTitle right={<button onClick={() => navigate("ministry")} style={linkBtn}>Open ›</button>}>Ministry</SectionTitle>
          <Panel pad={14} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {CATEGORY_ORDER.filter((c) => c !== "other" || (catCounts.get(c) ?? 0) > 0).map((c) => {
              const color = CATEGORY_COLOR[c];
              const count = catCounts.get(c) ?? 0;
              return (
                <div key={c} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Dot color={color} size={8} />
                  <span style={{ flex: 1, fontSize: 13, color: UI.textSecondary }}>{CATEGORY_LABELS[c]}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: count > 0 ? color : UI.textMuted, fontVariantNumeric: "tabular-nums" }}>{count}</span>
                </div>
              );
            })}
          </Panel>
        </div>
      </div>
    </ScrollArea>
  );
}

const linkBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", color: UI.indigoLight, fontSize: 12, fontWeight: 600, fontFamily: "inherit", padding: 0,
};
