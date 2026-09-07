/**
 * ActivityPage — the live decision stream from every agent, filterable by
 * category. Replaces the old floating LiveStream/DecisionTimeline HUD with a
 * dense, page-native feed that never hides an agent.
 */
import React, { useMemo, useState } from "react";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import { phaseCategory, CATEGORY_LABELS, CATEGORY_ORDER, type PhaseCategory } from "../../utils/phase-meta.js";
import { UI, Panel, ScrollArea, EmptyState, CATEGORY_COLOR, timeAgo, MONO } from "../ui.js";
import { EventRow } from "./_shared.js";
import { ConnectHero } from "../ConnectSurface.js";
import { useGitHubLive } from "../github/GitHubLiveContext.js";
import { GhCommitRow, GhSyncBar, GhRunPill } from "../github/RealOps.js";
import type { PageProps } from "../PlatformShell.js";

export function ActivityPage(props: PageProps): React.ReactElement {
  const { mc, navigate } = props;
  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }
  if (mc.source === "github") return <GitHubActivity />;
  return <TelemetryActivity {...props} />;
}

type GhFilter = "all" | "commits" | "runs";

/** Live (GitHub): the real repository event stream — commits and CI runs. */
function GitHubActivity(): React.ReactElement {
  const gh = useGitHubLive();
  const [filter, setFilter] = useState<GhFilter>("all");

  const feed = useMemo(() => {
    const items: Array<{ ts: number; node: React.ReactElement }> = [];
    if (filter !== "runs") {
      for (const c of gh.commits) items.push({ ts: +new Date(c.date), node: <GhCommitRow key={`c-${c.sha}`} c={c} /> });
    }
    if (filter !== "commits") {
      for (const r of gh.runs) {
        items.push({
          ts: +new Date(r.createdAt),
          node: (
            <div key={`r-${r.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderBottom: `1px solid ${UI.border}` }}>
              <GhRunPill r={r} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: UI.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title || r.workflowName}</div>
                <div style={{ fontSize: 11, color: UI.textMuted, fontFamily: MONO }}>{r.workflowName} #{r.runNumber} · {r.branch}</div>
              </div>
              <span style={{ fontSize: 11, color: UI.textMuted, flexShrink: 0 }}>{timeAgo(r.createdAt)}</span>
            </div>
          ),
        });
      }
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 120);
  }, [gh.commits, gh.runs, filter]);

  return (
    <ScrollArea>
      <GhSyncBar />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <FilterChip label="All" count={gh.commits.length + gh.runs.length} active={filter === "all"} color={UI.indigo} onClick={() => setFilter("all")} />
        <FilterChip label="Commits" count={gh.commits.length} active={filter === "commits"} color={UI.cyan} onClick={() => setFilter("commits")} />
        <FilterChip label="Runs" count={gh.runs.length} active={filter === "runs"} color={UI.green} onClick={() => setFilter("runs")} />
      </div>
      <Panel pad={6}>
        {feed.length === 0
          ? <EmptyState icon="◌" title={gh.loading ? "Syncing your repository…" : "No activity yet"} hint="Commits and workflow runs from your repository stream here, newest first." />
          : feed.map((f) => f.node)}
      </Panel>
    </ScrollArea>
  );
}

function TelemetryActivity(_props: PageProps): React.ReactElement {
  const { events } = useTelemetryCtx();
  const [filter, setFilter] = useState<PhaseCategory | "all">("all");

  const sorted = useMemo(
    () => [...events].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)),
    [events],
  );
  const counts = useMemo(() => {
    const m = new Map<PhaseCategory, number>();
    for (const e of events) {
      const c = phaseCategory(e.phase);
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [events]);

  const shown = filter === "all" ? sorted : sorted.filter((e) => phaseCategory(e.phase) === filter);

  return (
    <ScrollArea>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <FilterChip label="All" count={events.length} active={filter === "all"} color={UI.indigo} onClick={() => setFilter("all")} />
        {CATEGORY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => (
          <FilterChip
            key={c}
            label={CATEGORY_LABELS[c]}
            count={counts.get(c) ?? 0}
            active={filter === c}
            color={CATEGORY_COLOR[c]}
            onClick={() => setFilter(c)}
          />
        ))}
      </div>

      <Panel pad={6}>
        {shown.length === 0 ? (
          <EmptyState
            icon="◌"
            title="No activity yet"
            hint="When you dispatch a mission, every agent decision streams here in real time — architect, coder, the five gates, guards, and more."
          />
        ) : (
          <div>{shown.slice(0, 200).map((e, i) => <EventRow key={`${e.runId}-${e.timestamp}-${i}`} e={e} />)}</div>
        )}
      </Panel>
    </ScrollArea>
  );
}

function FilterChip({ label, count, active, color, onClick }: { label: string; count: number; active: boolean; color: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999,
        cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
        color: active ? color : UI.textMuted,
        background: active ? `${color}1e` : "transparent",
        border: `1px solid ${active ? `${color}55` : UI.border}`,
      }}
    >
      {label}
      <span style={{ fontSize: 11, opacity: 0.85 }}>{count}</span>
    </button>
  );
}
