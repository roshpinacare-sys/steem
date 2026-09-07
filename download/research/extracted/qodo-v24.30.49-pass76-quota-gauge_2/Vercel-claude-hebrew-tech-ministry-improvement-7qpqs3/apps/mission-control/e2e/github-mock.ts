/**
 * github-mock.ts — the "connections" used to verify Live mode end to end.
 *
 * A faithful, in-memory GitHub (and an optional LLM provider) served through
 * Playwright request interception. It mirrors the exact JSON shapes the app's
 * github/client.ts consumes, so the real client code, real UI, and real chat
 * engine all run — only the network is stubbed. This is what makes the
 * live-mode test a durable proof that the connected experience works.
 */
import type { Page } from "@playwright/test";

const json = (body: unknown, status = 200) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

export const OWNER = "haran4-cpu";
export const REPO = "vercel";
export const FULL = `${OWNER}/${REPO}`;

export const USER = { login: OWNER, name: "Haran Dev", avatar_url: "https://avatars.example/u.png" };

export const REPOS = [
  { full_name: FULL, owner: { login: OWNER }, name: REPO, private: true, default_branch: "main", permissions: { push: true }, pushed_at: "2026-07-11T17:00:00Z" },
  { full_name: `${OWNER}/side-project`, owner: { login: OWNER }, name: "side-project", private: false, default_branch: "master", permissions: { push: true }, pushed_at: "2026-07-01T10:00:00Z" },
  { full_name: "acme/shared-lib", owner: { login: "acme" }, name: "shared-lib", private: false, default_branch: "main", permissions: { push: false }, pushed_at: "2026-06-20T10:00:00Z" },
];

export const RUNS = { workflow_runs: [
  { id: 101, run_number: 35, name: "Qodo V24 Agent Pipeline", display_title: "Turn the chat into a real agent", status: "completed", conclusion: "success", head_branch: "main", event: "push", actor: { login: OWNER }, created_at: "2026-07-11T17:11:06Z", updated_at: "2026-07-11T17:15:06Z", html_url: "https://github.com/x" },
  { id: 102, run_number: 34, name: "Qodo V24 Agent Pipeline", display_title: "Smart GitHub sign-in", status: "in_progress", conclusion: null, head_branch: "main", event: "workflow_dispatch", actor: { login: OWNER }, created_at: "2026-07-11T17:00:00Z", updated_at: "2026-07-11T17:02:00Z", html_url: "https://github.com/y" },
] };

export const JOBS = { jobs: [
  { id: 1, name: "TypeScript strict check", status: "completed", conclusion: "success", started_at: "t", completed_at: "t", steps: [] },
  { id: 2, name: "Unit / Property / Snapshot tests", status: "completed", conclusion: "success", started_at: "t", completed_at: "t", steps: [] },
] };

export const PRS = [
  { number: 42, title: "Add rate limiting to the public API", state: "open", draft: false, user: { login: OWNER }, head: { ref: "feature/rate-limit" }, base: { ref: "main" }, updated_at: "2026-07-11T12:00:00Z", html_url: "https://github.com/pr42" },
];

export const PR_DETAIL = {
  number: 42, title: "Add rate limiting to the public API", state: "open", draft: false,
  user: { login: OWNER }, head: { ref: "feature/rate-limit" }, base: { ref: "main" },
  updated_at: "2026-07-11T12:00:00Z", html_url: "https://github.com/pr42",
  body: "Adds a sliding-window rate limiter to the public API and covers it with tests.",
};

export const PR_FILES = [
  { filename: "src/middleware/rate-limit.ts", status: "added", additions: 84, deletions: 0 },
  { filename: "src/app.ts", status: "modified", additions: 6, deletions: 1 },
  { filename: "tests/rate-limit.test.ts", status: "added", additions: 120, deletions: 0 },
];

/** A runs payload with a failed run (for the triage skill). */
export const RUNS_WITH_FAILURE = { workflow_runs: [
  { id: 201, run_number: 36, name: "Qodo V24 Agent Pipeline", display_title: "Broken change", status: "completed", conclusion: "failure", head_branch: "main", event: "push", actor: { login: OWNER }, created_at: "2026-07-11T18:00:00Z", updated_at: "2026-07-11T18:03:00Z", html_url: "u" },
  ...RUNS.workflow_runs,
] };

export const FAILED_JOBS = { jobs: [
  { id: 10, name: "TypeScript strict check", status: "completed", conclusion: "success", started_at: "t", completed_at: "t", steps: [] },
  { id: 11, name: "Unit / Property / Snapshot tests", status: "completed", conclusion: "failure", started_at: "t", completed_at: "t", steps: [{ name: "Run tests with coverage", status: "completed", conclusion: "failure", started_at: "t", completed_at: "t" }] },
] };

export const COMMITS = [
  { sha: "7df01927abc0000", commit: { message: "QA polish: correct pluralization\n\nbody", author: { name: "Claude", date: "2026-07-11T17:30:00Z" } }, author: { login: OWNER }, html_url: "u" },
];

export const BRANCHES = [
  { name: "main", protected: true },
  { name: "develop", protected: false },
  { name: "claude/hebrew-tech-ministry-improvement-7qpqs3", protected: false },
];

export const ROOT_CONTENTS = [
  { name: "README.md", path: "README.md", type: "file", size: 2048, sha: "s1", html_url: "u" },
  { name: "package.json", path: "package.json", type: "file", size: 512, sha: "s2", html_url: "u" },
  { name: "apps", path: "apps", type: "dir", size: 0, sha: "s3", html_url: "u" },
  { name: "packages", path: "packages", type: "dir", size: 0, sha: "s4", html_url: "u" },
];

const README_TEXT = "# Qodo V24\n\nAutonomous delivery agent.\n";
export const README = {
  name: "README.md", path: "README.md", size: 2048, sha: "s1",
  content: Buffer.from(README_TEXT).toString("base64"), encoding: "base64", html_url: "u", download_url: "u",
};

export const SEARCH = { items: [
  { path: "packages/agent/src/services/ai-router.ts", html_url: "u", repository: { full_name: FULL } },
  { path: "apps/mission-control/src/shell/chat/engine.ts", html_url: "u", repository: { full_name: FULL } },
] };

export interface MockState { dispatched: number }

/** Route api.github.com through the in-memory GitHub. Returns mutable state. */
export async function installGitHubMock(page: Page): Promise<MockState> {
  const state: MockState = { dispatched: 0 };
  await page.route(/https:\/\/api\.github\.com\/.*/, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path === "/user") return route.fulfill(json(USER));
    if (path === "/user/repos") return route.fulfill(json(REPOS));
    if (path.includes("/actions/workflows/agent-pipeline.yml/dispatches") && method === "POST") {
      state.dispatched++;
      return route.fulfill({ status: 204, body: "" });
    }
    if (path.includes("/actions/workflows/agent-pipeline.yml")) return route.fulfill(json({ id: 1, name: "Qodo V24 Agent Pipeline", state: "active" }));
    if (path.includes("/actions/runs/") && path.includes("/jobs")) return route.fulfill(json(JOBS));
    if (path.includes("/actions/runs")) return route.fulfill(json(RUNS));
    if (path.includes("/actions/artifacts")) return route.fulfill(json({ artifacts: [] }));
    if (/\/pulls\/\d+\/files$/.test(path)) return route.fulfill(json(PR_FILES));
    if (/\/pulls\/\d+$/.test(path)) return route.fulfill(json(PR_DETAIL));
    if (path.includes("/pulls")) return route.fulfill(json(PRS));
    if (path.includes("/commits")) return route.fulfill(json(COMMITS));
    if (path.includes("/branches")) return route.fulfill(json(BRANCHES));
    if (path.includes("/contents/README.md")) return route.fulfill(json(README));
    if (path.includes("/contents")) return route.fulfill(json(ROOT_CONTENTS));
    if (path.includes("/search/code")) return route.fulfill(json(SEARCH));
    if (/^\/repos\/[^/]+\/[^/]+$/.test(path)) { const r = REPOS.find((x) => path.endsWith(x.full_name)) ?? REPOS[0]; return route.fulfill(json(r)); }
    return route.fulfill(json({ message: "unmocked " + path }, 404));
  });
  return state;
}

/**
 * Route an OpenAI-compatible LLM provider (OpenRouter) through a scripted
 * sequence of assistant replies — each call returns the next reply, so the
 * agent tool loop advances deterministically.
 */
export async function installLlmMock(page: Page, replies: string[]): Promise<{ calls: number }> {
  const ctr = { calls: 0 };
  await page.route(/https:\/\/openrouter\.ai\/.*/, async (route) => {
    const content = replies[Math.min(ctr.calls, replies.length - 1)];
    ctr.calls++;
    return route.fulfill(json({ choices: [{ message: { content } }] }));
  });
  return ctr;
}

/** Seed a fully-connected GitHub session in localStorage (skips the wizard). */
export async function seedConnected(page: Page): Promise<void> {
  await page.addInitScript(([full, owner, repo]) => {
    localStorage.setItem("qodo:github-token", "ghp_e2e_token");
    localStorage.setItem("qodo:github-repo", full);
    localStorage.setItem("qodo:github-branch", "main");
    localStorage.setItem("qodo:github-user", JSON.stringify({ login: owner, name: "Haran Dev", avatarUrl: null }));
    localStorage.removeItem("qodo:chat:history");
  }, [FULL, OWNER, REPO]);
}
