/**
 * github/client.ts — a minimal typed GitHub REST client for Live mode.
 *
 * Everything here is REAL repository state: workflow runs, jobs and steps,
 * commits, pull requests, and workflow_dispatch to launch actual agent runs.
 * api.github.com serves CORS for any origin, so this works identically in the
 * browser and inside the Android WebView.
 */
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import type { GitHubConfig } from "./config.js";

const API = "https://api.github.com";
/** The agent's own CI workflow — dispatching it starts a real delivery run. */
export const PIPELINE_WORKFLOW = "agent-pipeline.yml";

export interface GhRun {
  id: number;
  runNumber: number;
  workflowName: string;
  title: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: string | null;
  branch: string;
  event: string;
  actor: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface GhStep {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GhJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  steps: GhStep[];
}

export interface GhPr {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  author: string;
  branch: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface GhCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  htmlUrl: string;
}

export interface GhVerifyResult {
  login: string;
  repoFullName: string;
  defaultBranch: string;
  canDispatch: boolean;
}

/** Human-readable GitHub error, with rate-limit and auth guidance. */
async function ghError(r: Response): Promise<Error> {
  let apiMsg = "";
  try {
    const body = (await r.json()) as { message?: string };
    apiMsg = body.message ?? "";
  } catch { /* non-JSON error body */ }

  if (r.status === 401) {
    return new Error("GitHub sign-in failed (401) — your token is invalid or expired. Reconnect on the Connections page.");
  }
  // Primary/secondary rate limiting surfaces as 403/429 with a reset header.
  const remaining = r.headers.get("x-ratelimit-remaining");
  const reset = r.headers.get("x-ratelimit-reset");
  if ((r.status === 403 || r.status === 429) && (remaining === "0" || /rate limit/i.test(apiMsg))) {
    let when = "";
    if (reset) {
      const secs = Math.max(0, Math.round(Number(reset) * 1000 - Date.now()) / 1000);
      const mins = Math.ceil(secs / 60);
      when = ` — resets in ~${mins} min (${new Date(Number(reset) * 1000).toLocaleTimeString()})`;
    }
    return new Error(`GitHub rate limit reached${when}. Try again then.`);
  }
  if (r.status === 403) {
    return new Error(`GitHub 403 — ${apiMsg || "forbidden"}. Your token may lack the required scope (Contents / Actions).`);
  }
  return new Error(`GitHub ${r.status}${apiMsg ? ` — ${apiMsg}` : ""}`);
}

const RETRYABLE = new Set([502, 503, 504]);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function gh<T>(cfg: GitHubConfig, path: string, init?: RequestInit): Promise<T> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${cfg.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(init?.headers ?? {}),
  };
  // Retry transient failures (network hiccup / 502-504) with backoff; never
  // retry a mutating request that may have already been applied.
  const mutating = init?.method != null && init.method !== "GET";
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchWithTimeout(`${API}${path}`, { ...init, headers }, 20_000);
      if (!r.ok) {
        if (!mutating && RETRYABLE.has(r.status) && attempt < 2) { await sleep(400 * (attempt + 1)); continue; }
        throw await ghError(r);
      }
      if (r.status === 204) return undefined as T; // No Content (dispatch)
      return (await r.json()) as T;
    } catch (e: unknown) {
      // A thrown ghError is a definitive API error — don't retry it.
      if (e instanceof Error && /^GitHub /.test(e.message)) throw e;
      lastErr = e;
      if (mutating || attempt === 2) break;
      await sleep(400 * (attempt + 1)); // network/timeout → retry
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("GitHub request failed");
}

export interface GhIdentity {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/** A repository the authenticated user can see, for the connect picker. */
export interface GhRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  canPush: boolean;
  pushedAt: string;
}

/**
 * Authenticate a token against /user only — the first step of the stepped
 * connect flow. Proves the token is valid and returns the identity to show,
 * before any repository is chosen.
 */
export async function ghAuthenticate(token: string): Promise<GhIdentity> {
  const cfg = { token, owner: "", repo: "", branch: "" };
  const u = await gh<{ login: string; name: string | null; avatar_url: string | null }>(cfg, "/user");
  return { login: u.login, name: u.name ?? null, avatarUrl: u.avatar_url ?? null };
}

/**
 * List repositories the token can act on, most-recently-pushed first. The
 * picker replaces hand-typing "owner/repo" — the #1 connect friction.
 */
export async function ghListRepos(token: string, perPage = 100): Promise<GhRepo[]> {
  const cfg = { token, owner: "", repo: "", branch: "" };
  const d = await gh<Array<Record<string, unknown>>>(
    cfg,
    `/user/repos?per_page=${perPage}&sort=pushed&affiliation=owner,collaborator,organization_member`,
  );
  return d.map((r) => ({
    fullName: r.full_name as string,
    owner: ((r.owner as { login?: string } | null)?.login) ?? "",
    name: r.name as string,
    private: Boolean(r.private),
    defaultBranch: (r.default_branch as string) ?? "main",
    canPush: Boolean((r.permissions as { push?: boolean } | null)?.push),
    pushedAt: (r.pushed_at as string) ?? "",
  }));
}

/**
 * Does the connected repo actually contain the agent's dispatch workflow?
 * When false, "New task" would silently no-op (nothing to dispatch) — the
 * real reason the app "doesn't run" against a fresh repo. The connect flow
 * surfaces this honestly instead of pretending the button works.
 */
export async function ghWorkflowExists(cfg: GitHubConfig): Promise<boolean> {
  try {
    await gh<unknown>(cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${PIPELINE_WORKFLOW}`);
    return true;
  } catch (e: unknown) {
    if (e instanceof Error && /\b404\b/.test(e.message)) return false;
    throw e;
  }
}

/** Validate token + repo access and learn the default branch. */
export async function ghVerify(cfg: GitHubConfig): Promise<GhVerifyResult> {
  const user = await gh<{ login: string }>(cfg, "/user");
  const repo = await gh<{ full_name: string; default_branch: string; permissions?: { push?: boolean } }>(
    cfg, `/repos/${cfg.owner}/${cfg.repo}`,
  );
  return {
    login: user.login,
    repoFullName: repo.full_name,
    defaultBranch: repo.default_branch,
    canDispatch: repo.permissions?.push ?? false,
  };
}

export async function ghListRuns(cfg: GitHubConfig, perPage = 30): Promise<GhRun[]> {
  const d = await gh<{ workflow_runs: Array<Record<string, unknown>> }>(
    cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/runs?per_page=${perPage}`,
  );
  return d.workflow_runs.map((r) => ({
    id: r.id as number,
    runNumber: r.run_number as number,
    workflowName: (r.name as string) ?? "workflow",
    title: (r.display_title as string) ?? "",
    status: r.status as GhRun["status"],
    conclusion: (r.conclusion as string | null) ?? null,
    branch: (r.head_branch as string) ?? "",
    event: (r.event as string) ?? "",
    actor: ((r.actor as { login?: string } | null)?.login) ?? "",
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    htmlUrl: r.html_url as string,
  }));
}

export async function ghListJobs(cfg: GitHubConfig, runId: number): Promise<GhJob[]> {
  const d = await gh<{ jobs: Array<Record<string, unknown>> }>(
    cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/runs/${runId}/jobs?per_page=50`,
  );
  return d.jobs.map((j) => ({
    id: j.id as number,
    name: j.name as string,
    status: j.status as string,
    conclusion: (j.conclusion as string | null) ?? null,
    startedAt: (j.started_at as string | null) ?? null,
    completedAt: (j.completed_at as string | null) ?? null,
    steps: ((j.steps as Array<Record<string, unknown>> | undefined) ?? []).map((s) => ({
      name: s.name as string,
      status: s.status as string,
      conclusion: (s.conclusion as string | null) ?? null,
      startedAt: (s.started_at as string | null) ?? null,
      completedAt: (s.completed_at as string | null) ?? null,
    })),
  }));
}

export async function ghListPrs(cfg: GitHubConfig): Promise<GhPr[]> {
  const d = await gh<Array<Record<string, unknown>>>(
    cfg, `/repos/${cfg.owner}/${cfg.repo}/pulls?state=open&per_page=20&sort=updated&direction=desc`,
  );
  return d.map((p) => ({
    number: p.number as number,
    title: p.title as string,
    state: p.state as string,
    draft: Boolean(p.draft),
    author: ((p.user as { login?: string } | null)?.login) ?? "",
    branch: ((p.head as { ref?: string } | null)?.ref) ?? "",
    updatedAt: p.updated_at as string,
    htmlUrl: p.html_url as string,
  }));
}

export async function ghListCommits(cfg: GitHubConfig, perPage = 30): Promise<GhCommit[]> {
  const d = await gh<Array<Record<string, unknown>>>(
    cfg, `/repos/${cfg.owner}/${cfg.repo}/commits?per_page=${perPage}`,
  );
  return d.map((c) => {
    const commit = c.commit as { message?: string; author?: { name?: string; date?: string } };
    return {
      sha: c.sha as string,
      message: (commit.message ?? "").split("\n")[0],
      author: commit.author?.name ?? ((c.author as { login?: string } | null)?.login) ?? "",
      date: commit.author?.date ?? "",
      htmlUrl: c.html_url as string,
    };
  });
}

/** Fired after a successful mutation so live views can refresh promptly. */
const mutationListeners = new Set<() => void>();
export function onGhMutation(l: () => void): () => void {
  mutationListeners.add(l);
  return () => mutationListeners.delete(l);
}
function notifyMutation(): void {
  for (const l of mutationListeners) l();
}

/** Launch a REAL agent delivery run via workflow_dispatch. */
export async function ghDispatchPipeline(
  cfg: GitHubConfig,
  objective: string,
  opts?: { dryRun?: boolean },
): Promise<void> {
  await gh<void>(cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${PIPELINE_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: cfg.branch,
      inputs: { objective, dry_run: opts?.dryRun ? "true" : "false" },
    }),
  });
  notifyMutation();
}

export interface GhCodeHit { path: string; htmlUrl: string; repo: string }

/** Search code within the connected repo (GitHub code search). */
export async function ghSearchCode(cfg: GitHubConfig, query: string, perPage = 15): Promise<GhCodeHit[]> {
  const q = `${query} repo:${cfg.owner}/${cfg.repo}`;
  const d = await gh<{ items?: Array<Record<string, unknown>> }>(
    cfg, `/search/code?q=${encodeURIComponent(q)}&per_page=${perPage}`,
  );
  return (d.items ?? []).map((it) => ({
    path: it.path as string,
    htmlUrl: (it.html_url as string) ?? "",
    repo: ((it.repository as { full_name?: string } | null)?.full_name) ?? "",
  }));
}

export type AgentMode = "janitor" | "evolve" | "compliance" | "support" | "drain";

/**
 * Dispatch an autonomous MODE run (janitor / evolve / compliance / …) via the
 * same workflow. The workflow maps the `mode` input to the real CLI flag, so
 * this genuinely triggers that agent power in CI — provided the repo carries
 * agent-pipeline.yml and its secrets.
 */
export async function ghDispatchMode(cfg: GitHubConfig, mode: AgentMode, objective: string): Promise<void> {
  await gh<void>(cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/workflows/${PIPELINE_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: cfg.branch, inputs: { objective, mode } }),
  });
  notifyMutation();
}

// ── Pull requests: detail, files, create, comment (agent skills) ────────────

export interface GhPrFile { filename: string; status: string; additions: number; deletions: number }

/** A single PR's detail (title, body, base/head, mergeable state). */
export async function ghGetPr(cfg: GitHubConfig, number: number): Promise<GhPr & { body: string; base: string }> {
  const p = await gh<Record<string, unknown>>(cfg, `/repos/${cfg.owner}/${cfg.repo}/pulls/${number}`);
  return {
    number: p.number as number,
    title: p.title as string,
    state: p.state as string,
    draft: Boolean(p.draft),
    author: ((p.user as { login?: string } | null)?.login) ?? "",
    branch: ((p.head as { ref?: string } | null)?.ref) ?? "",
    base: ((p.base as { ref?: string } | null)?.ref) ?? "",
    updatedAt: p.updated_at as string,
    htmlUrl: p.html_url as string,
    body: (p.body as string) ?? "",
  };
}

/** The files a PR changes, with add/delete counts. */
export async function ghListPrFiles(cfg: GitHubConfig, number: number): Promise<GhPrFile[]> {
  const d = await gh<Array<Record<string, unknown>>>(cfg, `/repos/${cfg.owner}/${cfg.repo}/pulls/${number}/files?per_page=100`);
  return d.map((f) => ({
    filename: f.filename as string,
    status: (f.status as string) ?? "modified",
    additions: (f.additions as number) ?? 0,
    deletions: (f.deletions as number) ?? 0,
  }));
}

/** Create a branch from a ref (default: the connected branch's head). */
export async function ghCreateBranch(cfg: GitHubConfig, name: string, fromRef?: string): Promise<void> {
  const base = fromRef ?? cfg.branch;
  const ref = await gh<{ object: { sha: string } }>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(base)}`);
  await gh<unknown>(cfg, `/repos/${cfg.owner}/${cfg.repo}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${name}`, sha: ref.object.sha }),
  });
  notifyMutation();
}

/** Open a pull request. */
export async function ghCreatePr(cfg: GitHubConfig, opts: { title: string; head: string; base?: string; body?: string }): Promise<{ number: number; htmlUrl: string }> {
  const d = await gh<{ number: number; html_url: string }>(cfg, `/repos/${cfg.owner}/${cfg.repo}/pulls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: opts.title, head: opts.head, base: opts.base ?? cfg.branch, body: opts.body ?? "" }),
  });
  notifyMutation();
  return { number: d.number, htmlUrl: d.html_url };
}

/** Comment on a PR (via the issues endpoint). */
export async function ghCommentPr(cfg: GitHubConfig, number: number, body: string): Promise<void> {
  await gh<unknown>(cfg, `/repos/${cfg.owner}/${cfg.repo}/issues/${number}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  notifyMutation();
}

// ── Repository contents (Files page: browse / view / upload / edit) ─────────

export interface GhContentEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  sha: string;
  htmlUrl: string;
}

export interface GhFile {
  name: string;
  path: string;
  size: number;
  sha: string;
  /** Base64 payload; empty for files over ~1 MB (use ghGetFileRaw). */
  content: string;
  encoding: string;
  htmlUrl: string;
  downloadUrl: string | null;
}

export async function ghListContents(cfg: GitHubConfig, path: string, ref?: string): Promise<GhContentEntry[]> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const d = await gh<Array<Record<string, unknown>>>(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}${q}`);
  return d.map((e) => ({
    name: e.name as string,
    path: e.path as string,
    type: e.type as GhContentEntry["type"],
    size: (e.size as number) ?? 0,
    sha: e.sha as string,
    htmlUrl: (e.html_url as string) ?? "",
  }));
}

export async function ghGetFile(cfg: GitHubConfig, path: string, ref?: string): Promise<GhFile> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const d = await gh<Record<string, unknown>>(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}${q}`);
  return {
    name: d.name as string,
    path: d.path as string,
    size: (d.size as number) ?? 0,
    sha: d.sha as string,
    content: ((d.content as string) ?? "").replace(/\n/g, ""),
    encoding: (d.encoding as string) ?? "base64",
    htmlUrl: (d.html_url as string) ?? "",
    downloadUrl: (d.download_url as string | null) ?? null,
  };
}

/** Raw bytes for large/binary files (Contents API caps inline base64 at ~1MB). */
export async function ghGetFileRaw(cfg: GitHubConfig, path: string, ref?: string): Promise<ArrayBuffer> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const r = await fetchWithTimeout(`${API}/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}${q}`, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  }, 60_000);
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.arrayBuffer();
}

/** Create or update a file — a REAL commit on the ref. */
export async function ghPutFile(
  cfg: GitHubConfig,
  path: string,
  contentBase64: string,
  message: string,
  opts?: { sha?: string; branch?: string },
): Promise<void> {
  const body: Record<string, unknown> = { message, content: contentBase64, branch: opts?.branch ?? cfg.branch };
  if (opts?.sha) body.sha = opts.sha;
  await gh<unknown>(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  notifyMutation();
}

export async function ghDeleteFile(cfg: GitHubConfig, path: string, message: string, sha: string, branch?: string): Promise<void> {
  await gh<unknown>(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${encodePath(path)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch: branch ?? cfg.branch }),
  });
  notifyMutation();
}

export interface GhBranch { name: string; protected: boolean }

export async function ghListBranches(cfg: GitHubConfig): Promise<GhBranch[]> {
  const d = await gh<Array<Record<string, unknown>>>(cfg, `/repos/${cfg.owner}/${cfg.repo}/branches?per_page=50`);
  return d.map((b) => ({ name: b.name as string, protected: Boolean(b.protected) }));
}

function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

// ── Releases & CI artifacts (Releases page) ─────────────────────────────────

export interface GhReleaseAsset {
  id: number;
  name: string;
  size: number;
  downloadCount: number;
  browserDownloadUrl: string;
}

export interface GhRelease {
  id: number;
  tagName: string;
  name: string;
  draft: boolean;
  prerelease: boolean;
  publishedAt: string | null;
  body: string;
  htmlUrl: string;
  assets: GhReleaseAsset[];
}

export async function ghListReleases(cfg: GitHubConfig): Promise<GhRelease[]> {
  const d = await gh<Array<Record<string, unknown>>>(cfg, `/repos/${cfg.owner}/${cfg.repo}/releases?per_page=15`);
  return d.map((r) => ({
    id: r.id as number,
    tagName: (r.tag_name as string) ?? "",
    name: (r.name as string) ?? (r.tag_name as string) ?? "",
    draft: Boolean(r.draft),
    prerelease: Boolean(r.prerelease),
    publishedAt: (r.published_at as string | null) ?? null,
    body: (r.body as string) ?? "",
    htmlUrl: (r.html_url as string) ?? "",
    assets: ((r.assets as Array<Record<string, unknown>> | undefined) ?? []).map((a) => ({
      id: a.id as number,
      name: a.name as string,
      size: (a.size as number) ?? 0,
      downloadCount: (a.download_count as number) ?? 0,
      browserDownloadUrl: (a.browser_download_url as string) ?? "",
    })),
  }));
}

export interface GhArtifact {
  id: number;
  name: string;
  sizeInBytes: number;
  expired: boolean;
  createdAt: string;
  expiresAt: string | null;
  workflowRunId: number | null;
}

export async function ghListArtifacts(cfg: GitHubConfig): Promise<GhArtifact[]> {
  const d = await gh<{ artifacts: Array<Record<string, unknown>> }>(cfg, `/repos/${cfg.owner}/${cfg.repo}/actions/artifacts?per_page=30`);
  return d.artifacts.map((a) => ({
    id: a.id as number,
    name: a.name as string,
    sizeInBytes: (a.size_in_bytes as number) ?? 0,
    expired: Boolean(a.expired),
    createdAt: (a.created_at as string) ?? "",
    expiresAt: (a.expires_at as string | null) ?? null,
    workflowRunId: ((a.workflow_run as { id?: number } | null)?.id) ?? null,
  }));
}

/**
 * Download an artifact zip. The API 302-redirects to a signed URL; fetch
 * follows it, but the signed host may not serve CORS — callers must catch and
 * fall back to an "Open on GitHub" link.
 */
export async function ghDownloadArtifactZip(cfg: GitHubConfig, artifactId: number): Promise<Blob> {
  const r = await fetchWithTimeout(`${API}/repos/${cfg.owner}/${cfg.repo}/actions/artifacts/${artifactId}/zip`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  }, 120_000);
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.blob();
}
