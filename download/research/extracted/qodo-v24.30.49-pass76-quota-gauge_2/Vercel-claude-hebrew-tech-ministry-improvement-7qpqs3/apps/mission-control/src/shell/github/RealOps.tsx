/**
 * RealOps.tsx — shared building blocks for Live (GitHub) mode. Every element
 * here renders REAL repository state: workflow runs, job/step detail, open
 * pull requests, and commits. No simulation.
 */
import React, { useEffect, useMemo, useState } from "react";
import { UI, MONO, Panel, Pill, Dot, timeAgo, EmptyState } from "../ui.js";
import { Icon } from "../icons.js";
import { useGitHubLive, runStateColorKey, runStateLabel, durationLabel } from "./GitHubLiveContext.js";
import type { GhRun, GhJob, GhPr, GhCommit } from "./client.js";

const STATE_COLOR = { green: UI.green, red: UI.red, amber: UI.amber, muted: UI.textMuted } as const;

export function runColor(r: GhRun): string {
  return STATE_COLOR[runStateColorKey(r)];
}

export function GhRunPill({ r }: { r: GhRun }): React.ReactElement {
  const c = runColor(r);
  return (
    <Pill color={c}>
      <Dot color={c} size={6} glow={r.status !== "completed"} />
      {runStateLabel(r)}
    </Pill>
  );
}

/** One real workflow run as a card. */
export function GhRunCard({ r, active, onOpen }: { r: GhRun; active?: boolean; onOpen?: () => void }): React.ReactElement {
  return (
    <Panel interactive={Boolean(onOpen)} onClick={onOpen} pad={14}
      style={{ marginBottom: 10, background: active ? UI.bgActive : UI.bgPanel, borderColor: active ? "rgba(99,102,241,0.35)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 650, color: UI.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {r.title || r.workflowName}
        </span>
        <GhRunPill r={r} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5, color: UI.textMuted, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {r.workflowName} #{r.runNumber} · {r.branch}
        </span>
        <span style={{ flexShrink: 0 }}>{timeAgo(r.createdAt)} · {durationLabel(r.createdAt, r.status === "completed" ? r.updatedAt : null)}</span>
      </div>
    </Panel>
  );
}

/** Real job/step detail for one run — the CI stepper, from live data. */
export function GhRunDetail({ run }: { run: GhRun }): React.ReactElement {
  const gh = useGitHubLive();
  const [jobs, setJobs] = useState<GhJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<number | null>(null);

  // Reset only when switching runs; refreshes for the SAME run keep the
  // current stepper on screen instead of flashing "Loading jobs…".
  useEffect(() => {
    setJobs(null);
    setError(null);
    setOpenJob(null);
  }, [run.id]);

  useEffect(() => {
    let live = true;
    gh.fetchJobs(run.id)
      .then((j) => { if (live) { setJobs(j); if (j.length === 1) setOpenJob((o) => o ?? j[0].id); } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : "failed to load jobs"); });
    return () => { live = false; };
  }, [run.id, run.status, run.updatedAt, gh.fetchJobs]);

  const jc = (j: GhJob): string =>
    j.status !== "completed" ? UI.amber
      : j.conclusion === "success" ? UI.green
      : j.conclusion === "skipped" ? UI.textMuted
      : UI.red;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: UI.textPrimary }}>{run.title || run.workflowName}</span>
        <GhRunPill r={run} />
      </div>
      <div style={{ fontSize: 12, color: UI.textMuted, fontFamily: MONO, marginBottom: 16 }}>
        {run.workflowName} #{run.runNumber} · {run.branch} · by {run.actor} ·{" "}
        <a href={run.htmlUrl} target="_blank" rel="noreferrer" style={{ color: UI.indigoLight, textDecoration: "none" }}>open on GitHub ↗</a>
      </div>

      {error && <Panel pad={14} style={{ marginBottom: 12 }}><span style={{ color: UI.red, fontSize: 12.5 }}>{error}</span></Panel>}
      {!jobs && !error && <div style={{ color: UI.textMuted, fontSize: 12.5, padding: "10px 0" }}>Loading jobs…</div>}

      {jobs?.map((j, i) => {
        const c = jc(j);
        const open = openJob === j.id;
        return (
          <div key={j.id} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "stretch" }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
                border: `2px solid ${c}`, color: c, fontSize: 11, fontWeight: 700,
                background: j.conclusion === "success" ? `${UI.green}22` : "transparent",
                boxShadow: j.status !== "completed" ? `0 0 8px ${UI.amber}` : "none",
              }}>
                {j.conclusion === "success" ? "✓" : j.conclusion === "failure" ? "✕" : j.conclusion === "skipped" ? "–" : i + 1}
              </span>
              {i < jobs.length - 1 && <span style={{ width: 2, flex: 1, minHeight: 14, background: j.conclusion === "success" ? UI.green : UI.border }} />}
            </div>
            <div style={{ paddingBottom: 14, flex: 1, minWidth: 0 }}>
              <button onClick={() => setOpenJob(open ? null : j.id)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: j.conclusion === "skipped" ? UI.textMuted : UI.textPrimary }}>{j.name}</span>
                <span style={{ fontSize: 11.5, color: UI.textMuted, flexShrink: 0 }}>{durationLabel(j.startedAt, j.completedAt)} {open ? "▾" : "▸"}</span>
              </button>
              {open && j.steps.length > 0 && (
                <div style={{ marginTop: 8, borderLeft: `2px solid ${UI.border}`, paddingLeft: 10 }}>
                  {j.steps.map((s, k) => {
                    const sc = s.status !== "completed" ? UI.amber : s.conclusion === "success" ? UI.green : s.conclusion === "skipped" ? UI.textMuted : UI.red;
                    return (
                      <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3.5px 0", fontSize: 12 }}>
                        <span style={{ color: sc, width: 12, flexShrink: 0, textAlign: "center" }}>
                          {s.conclusion === "success" ? "✓" : s.conclusion === "failure" ? "✕" : s.status !== "completed" ? "●" : "–"}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, color: s.conclusion === "skipped" ? UI.textMuted : UI.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                        <span style={{ color: UI.textMuted, fontSize: 11, flexShrink: 0 }}>{durationLabel(s.startedAt, s.completedAt)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
      {jobs?.length === 0 && <EmptyState icon="◷" title="No jobs reported yet" hint="Queued runs list their jobs once a runner picks them up." />}
    </div>
  );
}

export function GhPrCard({ p }: { p: GhPr }): React.ReactElement {
  return (
    <Panel pad={14} style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <a href={p.htmlUrl} target="_blank" rel="noreferrer"
          style={{ fontSize: 13, fontWeight: 650, color: UI.textPrimary, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {p.title}
        </a>
        <Pill color={p.draft ? UI.textMuted : UI.green}>{p.draft ? "draft" : "open"}</Pill>
      </div>
      <div style={{ fontSize: 11.5, color: UI.textMuted, fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        #{p.number} · {p.branch} · {p.author} · {timeAgo(p.updatedAt)}
      </div>
    </Panel>
  );
}

export function GhCommitRow({ c }: { c: GhCommit }): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderBottom: `1px solid ${UI.border}` }}>
      <span style={{ color: UI.cyan, flexShrink: 0, display: "grid", placeItems: "center" }}><Icon name="pipeline" size={14} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: UI.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</div>
        <div style={{ fontSize: 11, color: UI.textMuted, fontFamily: MONO }}>{c.sha.slice(0, 7)} · {c.author}</div>
      </div>
      <span style={{ fontSize: 11, color: UI.textMuted, flexShrink: 0 }}>{timeAgo(c.date)}</span>
    </div>
  );
}

/** Sync freshness + manual refresh, shown on every real-data page. */
export function GhSyncBar(): React.ReactElement {
  const gh = useGitHubLive();
  const repo = gh.cfg ? `${gh.cfg.owner}/${gh.cfg.repo}` : "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
      <Dot color={gh.error ? UI.red : UI.green} glow={!gh.error} size={7} />
      <span style={{ fontSize: 12, color: UI.textSecondary, fontFamily: MONO, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{repo}</span>
      <span style={{ fontSize: 11.5, color: gh.error ? UI.red : UI.textMuted, flex: 1, minWidth: 120 }}>
        {gh.error ? gh.error : gh.lastSyncAt ? `real data · synced ${timeAgo(new Date(gh.lastSyncAt).toISOString())}` : "syncing…"}
      </span>
      <button onClick={() => void gh.refresh()} disabled={gh.loading}
        style={{ background: "none", border: "none", color: UI.indigoLight, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", padding: 0 }}>
        {gh.loading ? "syncing…" : "refresh"}
      </button>
    </div>
  );
}

/** Honest pointer shown on telemetry-deep pages while in GitHub mode. */
export function TelemetryDepthNotice({ onSettings }: { onSettings: () => void }): React.ReactElement {
  return (
    <Panel pad={14} style={{ marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span style={{ color: UI.amber, flexShrink: 0, display: "grid", placeItems: "center", paddingTop: 1 }}><Icon name="alert" size={15} /></span>
      <div style={{ fontSize: 12.5, color: UI.textSecondary, lineHeight: 1.55 }}>
        This page reads the agent's deep telemetry stream (per-phase decisions, guard verdicts, token spend).
        GitHub Live shows real CI/PR state; for full telemetry,{" "}
        <button onClick={onSettings} style={{ background: "none", border: "none", padding: 0, color: UI.indigoLight, cursor: "pointer", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit" }}>
          connect the telemetry proxy
        </button>{" "}
        — no simulated stand-in is shown here.
      </div>
    </Panel>
  );
}

/** Aggregates for Overview KPIs, computed from the real run list. */
export function useGhKpis() {
  const gh = useGitHubLive();
  return useMemo(() => {
    const runs = gh.runs;
    const completed = runs.filter((r) => r.status === "completed");
    const succeeded = completed.filter((r) => r.conclusion === "success");
    const activeRun = runs.find((r) => r.status === "in_progress" || r.status === "queued") ?? null;
    const week = runs.filter((r) => Date.now() - +new Date(r.createdAt) < 7 * 86_400_000);
    return {
      total: runs.length,
      successRate: completed.length ? Math.round((succeeded.length / completed.length) * 100) : null,
      activeRun,
      latest: runs[0] ?? null,
      runsThisWeek: week.length,
      openPrs: gh.prs.length,
    };
  }, [gh.runs, gh.prs]);
}
