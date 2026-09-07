/**
 * GitHubLiveContext — the Live (GitHub) data plane. When a token + repo are
 * configured, this polls REAL repository state (workflow runs, open PRs,
 * commits) every 30s and exposes on-demand job/step detail plus real
 * workflow_dispatch. Nothing here is simulated.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getGitHubConfig, onGitHubConfigChange, type GitHubConfig } from "./config.js";
import {
  ghListRuns, ghListJobs, ghListPrs, ghListCommits, ghDispatchPipeline, onGhMutation,
  type GhRun, type GhJob, type GhPr, type GhCommit,
} from "./client.js";

const POLL_MS = 30_000;

export interface GitHubLive {
  cfg: GitHubConfig | null;
  configured: boolean;
  runs: GhRun[];
  prs: GhPr[];
  commits: GhCommit[];
  loading: boolean;
  error: string | null;
  lastSyncAt: number | null;
  refresh: () => Promise<void>;
  /** Jobs for one run, cached; in-progress runs are always refetched. */
  fetchJobs: (runId: number) => Promise<GhJob[]>;
  dispatch: (objective: string, opts?: { dryRun?: boolean }) => Promise<void>;
}

const Ctx = createContext<GitHubLive | null>(null);

export function GitHubLiveProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [cfg, setCfg] = useState<GitHubConfig | null>(() => getGitHubConfig());
  const [runs, setRuns] = useState<GhRun[]>([]);
  const [prs, setPrs] = useState<GhPr[]>([]);
  const [commits, setCommits] = useState<GhCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const jobsCache = useRef(new Map<number, GhJob[]>());
  const inflight = useRef(false);

  useEffect(() => onGitHubConfigChange(() => {
    setCfg(getGitHubConfig());
    jobsCache.current.clear();
    setRuns([]); setPrs([]); setCommits([]); setError(null); setLastSyncAt(null);
  }), []);

  const refresh = useCallback(async () => {
    const c = getGitHubConfig();
    if (!c || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const [r, p, cm] = await Promise.all([ghListRuns(c), ghListPrs(c), ghListCommits(c)]);
      setRuns(r); setPrs(p); setCommits(cm);
      setError(null);
      setLastSyncAt(Date.now());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "GitHub sync failed");
    } finally {
      inflight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!cfg) return;
    void refresh();
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [cfg, refresh]);

  // A dispatch fired anywhere in the app (composer, ⌘K) → sync soon after,
  // when the new run has appeared in the Actions list.
  useEffect(() => onGhMutation(() => {
    setTimeout(() => void refresh(), 2500);
    setTimeout(() => void refresh(), 9000);
  }), [refresh]);

  // Stable identity (reads fresh runs via ref) so consumers' effects that
  // depend on fetchJobs don't re-fire — and re-show loading — on every poll.
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const fetchJobs = useCallback(async (runId: number): Promise<GhJob[]> => {
    const c = getGitHubConfig();
    if (!c) return [];
    const run = runsRef.current.find((r) => r.id === runId);
    const cached = jobsCache.current.get(runId);
    if (cached && run?.status === "completed") return cached;
    const jobs = await ghListJobs(c, runId);
    jobsCache.current.set(runId, jobs);
    return jobs;
  }, []);

  const dispatch = useCallback(async (objective: string, opts?: { dryRun?: boolean }) => {
    const c = getGitHubConfig();
    if (!c) throw new Error("GitHub is not connected");
    await ghDispatchPipeline(c, objective, opts); // onGhMutation schedules the resync
  }, []);

  const value = useMemo<GitHubLive>(() => ({
    cfg, configured: cfg != null, runs, prs, commits, loading, error, lastSyncAt,
    refresh, fetchJobs, dispatch,
  }), [cfg, runs, prs, commits, loading, error, lastSyncAt, refresh, fetchJobs, dispatch]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGitHubLive(): GitHubLive {
  const v = useContext(Ctx);
  if (!v) throw new Error("useGitHubLive must be used within GitHubLiveProvider");
  return v;
}

/** Presentation helpers shared by the real-data pages. */
export function runStateColorKey(r: GhRun): "green" | "red" | "amber" | "muted" {
  if (r.status !== "completed") return "amber";
  if (r.conclusion === "success") return "green";
  if (r.conclusion === "failure" || r.conclusion === "timed_out") return "red";
  return "muted";
}

export function runStateLabel(r: GhRun): string {
  if (r.status === "queued") return "Queued";
  if (r.status === "in_progress") return "Running";
  if (r.conclusion === "success") return "Passed";
  if (r.conclusion === "failure") return "Failed";
  if (r.conclusion === "cancelled") return "Cancelled";
  if (r.conclusion === "timed_out") return "Timed out";
  return r.conclusion ?? r.status;
}

export function durationLabel(startIso: string | null, endIso: string | null): string {
  if (!startIso) return "—";
  const end = endIso ? +new Date(endIso) : Date.now();
  const s = Math.max(0, Math.round((end - +new Date(startIso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
