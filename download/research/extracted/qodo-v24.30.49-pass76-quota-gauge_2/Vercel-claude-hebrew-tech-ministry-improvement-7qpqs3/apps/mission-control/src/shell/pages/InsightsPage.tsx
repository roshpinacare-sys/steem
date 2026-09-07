/**
 * InsightsPage — real delivery analytics over the last 100 workflow runs:
 * success rate with half-over-half delta, runs per day, wall-clock durations
 * per workflow (queue time included — and labeled as such), failure hotspots,
 * and who/what triggers the pipeline. Everything derives from live run data.
 */
import React, { useEffect, useMemo, useState } from "react";
import { UI, FONT, Panel, ScrollArea, CardGrid, StatTile, SectionTitle, EmptyState, Button } from "../ui.js";
import { plural } from "../../utils/plural.js";
import { Icon } from "../icons.js";
import { ConnectHero } from "../ConnectSurface.js";
import { useGitHubLive } from "../github/GitHubLiveContext.js";
import { ghListRuns, type GhRun } from "../github/client.js";
import { getGitHubConfig } from "../github/config.js";
import { deriveInsights, fmtDuration } from "../github/insights.js";
import { RunColumns, Sparkline } from "../charts.js";
import { MiniBar } from "./_shared.js";
import { GhSyncBar } from "../github/RealOps.js";
import type { PageProps } from "../PlatformShell.js";

// Module-level cache, keyed by repo so switching repositories can never
// serve another repo's history. Deep history refetches at most every 5 min.
let cache: { key: string; at: number; runs: GhRun[] } | null = null;
const TTL = 5 * 60_000;
const cacheKey = () => { const c = getGitHubConfig(); return c ? `${c.owner}/${c.repo}` : ""; };

export function InsightsPage(props: PageProps): React.ReactElement {
  const { mc, navigate } = props;
  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }
  if (mc.source !== "github") {
    return (
      <ScrollArea>
        <Panel>
          <EmptyState icon="▥" title="Insights reads your real run history"
            hint="Connect GitHub in Connections to see success rates, durations, and failure hotspots across your last 100 workflow runs." />
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}>
            <Button variant="primary" onClick={() => navigate("connections")}><Icon name="connections" size={15} /> Open Connections</Button>
          </div>
        </Panel>
      </ScrollArea>
    );
  }
  return <InsightsBody isMobile={props.isMobile} />;
}

function InsightsBody({ isMobile }: { isMobile: boolean }): React.ReactElement {
  const gh = useGitHubLive();
  const [deep, setDeep] = useState<GhRun[] | null>(
    cache && cache.key === cacheKey() && Date.now() - cache.at < TTL ? cache.runs : null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = async (force = false) => {
    const c = getGitHubConfig();
    if (!c) return;
    const key = `${c.owner}/${c.repo}`;
    if (!force && cache && cache.key === key && Date.now() - cache.at < TTL) { setDeep(cache.runs); return; }
    try {
      const runs = await ghListRuns(c, 100);
      cache = { key, at: Date.now(), runs };
      setDeep(runs);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed to load run history");
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge the poller's fresh 30 over the deep history so the page stays live.
  const runs = useMemo(() => {
    const base = deep ?? [];
    const seen = new Set(gh.runs.map((r) => r.id));
    return [...gh.runs, ...base.filter((r) => !seen.has(r.id))];
  }, [deep, gh.runs]);

  const m = useMemo(() => deriveInsights(runs), [runs]);
  const cols = isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1fr)";
  const maxAvg = Math.max(1, ...m.workflows.map((w) => w.avgMs));
  const maxFail = Math.max(1, ...m.hotspots.map((w) => w.failures));

  return (
    <ScrollArea>
      <GhSyncBar />
      {error && <Panel pad={14} style={{ marginBottom: 12 }}><span style={{ color: UI.red, fontSize: 12.5 }}>{error}</span></Panel>}

      <CardGrid min={196} gap={14} style={{ marginBottom: 18 }}>
        <StatTile label="Success rate" value={m.successRate != null ? `${m.successRate}%` : "—"}
          accent={m.successRate == null ? UI.textMuted : m.successRate >= 80 ? UI.green : m.successRate >= 50 ? UI.amber : UI.red}
          sub={m.successRateDelta == null ? `${plural(m.completed, "completed run")}` : `${m.successRateDelta >= 0 ? "▲" : "▼"} ${Math.abs(m.successRateDelta)} pts vs earlier half`} />
        <StatTile label="Median duration" value={fmtDuration(m.medianDurationMs)} accent={UI.indigoLight} sub="wall-clock, incl. queue" />
        <StatTile label="Runs in view" value={m.total} accent={UI.cyan} sub={`last ${m.total} fetched`} />
        <StatTile label="Failures" value={runs.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").length} accent={UI.red} sub="failed or timed out" />
      </CardGrid>

      <SectionTitle>Runs per day · last 14 days</SectionTitle>
      <Panel pad={16} style={{ marginBottom: 18 }}>
        <RunColumns buckets={m.days} />
      </Panel>

      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, marginBottom: 18 }}>
        <div>
          <SectionTitle>Success-rate trend</SectionTitle>
          <Panel pad={16}>
            <div style={{ fontSize: 11.5, color: UI.textMuted, marginBottom: 8 }}>Rolling 10-run window, oldest → newest</div>
            <Sparkline points={m.trend} height={56} color={UI.indigo} />
            {m.trend.length >= 2 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: UI.textSecondary, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                <span>{m.trend[0]}%</span>
                <span style={{ fontWeight: 700, color: UI.textPrimary }}>{m.trend[m.trend.length - 1]}% now</span>
              </div>
            )}
          </Panel>
        </div>

        <div>
          <SectionTitle>Failure hotspots</SectionTitle>
          <Panel pad={16} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {m.hotspots.length === 0
              ? <div style={{ color: UI.textMuted, fontSize: 12.5, padding: "8px 0" }}>No failing workflows in view — clean.</div>
              : m.hotspots.map((w) => (
                <MiniBar key={w.name} label={w.name} value={w.failures} max={maxFail} color={UI.red}
                  sub={`${w.failures} of ${w.runs} failed`} />
              ))}
          </Panel>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16 }}>
        <div>
          <SectionTitle>Duration by workflow</SectionTitle>
          <Panel pad={16} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {m.workflows.length === 0
              ? <div style={{ color: UI.textMuted, fontSize: 12.5, padding: "8px 0" }}>No completed runs yet.</div>
              : m.workflows.map((w) => (
                <MiniBar key={w.name} label={w.name} value={w.avgMs} max={maxAvg} color={UI.indigo}
                  sub={`avg ${fmtDuration(w.avgMs)} · p50 ${fmtDuration(w.p50Ms)}`} />
              ))}
          </Panel>
        </div>

        <div>
          <SectionTitle>Triggers</SectionTitle>
          <Panel pad={16} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {m.topEvents.map(([ev, n]) => (
              <div key={ev} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                <span style={{ flex: 1, color: UI.textSecondary, fontFamily: FONT }}>{ev.replace(/_/g, " ")}</span>
                <span style={{ fontWeight: 700, color: UI.indigoLight, fontVariantNumeric: "tabular-nums" }}>{n}</span>
              </div>
            ))}
            {m.topActors.length > 0 && <div style={{ height: 1, background: UI.border, margin: "4px 0" }} />}
            {m.topActors.map(([actor, n]) => (
              <div key={actor} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5 }}>
                <span style={{ flex: 1, color: UI.textSecondary, fontFamily: "monospace", fontSize: 12 }}>{actor}</span>
                <span style={{ fontWeight: 700, color: UI.cyan, fontVariantNumeric: "tabular-nums" }}>{n}</span>
              </div>
            ))}
          </Panel>
        </div>
      </div>
    </ScrollArea>
  );
}
