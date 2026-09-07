/**
 * live-mode.spec.ts — durable proof that Live (GitHub-connected) mode works.
 *
 * Drives the REAL app against a faithful in-memory GitHub (github-mock.ts):
 *   1. the stepped connect wizard (token → repo picker → branch → connected),
 *   2. live pages rendering real repository state,
 *   3. keyless chat commands returning live data with correct grammar,
 *   4. the agentic LLM tool loop, including the confirmation gate on a
 *      mutating action.
 *
 * If any live path regresses, this test fails in CI.
 */
import { test, expect } from "@playwright/test";
import { installGitHubMock, installLlmMock, seedConnected, FULL, RUNS_WITH_FAILURE, FAILED_JOBS } from "./github-mock.js";

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

test.beforeEach(async ({ page }) => {
  await installGitHubMock(page);
});

test("connect wizard authenticates, lists repos, picks a branch, and persists the connection", async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/");
  // Chat is the landing page; jump to Connections with a command.
  await page.locator("textarea").fill("open connections");
  await page.keyboard.press("Enter");

  // Step 1: authenticate a token.
  await page.locator('input[type="password"]').first().fill("ghp_e2e_token");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2: pick a repository from the real list.
  await expect(page.getByText("Choose a repository")).toBeVisible();
  await expect(page.getByText("read-only")).toBeVisible(); // acme/shared-lib has no push
  await page.getByText(FULL, { exact: true }).click();

  // Step 3: branch step shows the workflow-backed branches. Wait for the
  // branch list to finish loading (the "protected" pill only renders once
  // ghListBranches resolves) before asserting — avoids racing the loader.
  await expect(page.getByText("Branch", { exact: true })).toBeVisible();
  await expect(page.getByText("protected")).toBeVisible();
  await page.getByRole("button", { name: /Connect vercel/ }).click();

  // Connected: config persisted → source becomes github.
  const cfg = await page.evaluate(() => ({
    repo: localStorage.getItem("qodo:github-repo"),
    branch: localStorage.getItem("qodo:github-branch"),
    token: Boolean(localStorage.getItem("qodo:github-token")),
  }));
  expect(cfg).toEqual({ repo: FULL, branch: "main", token: true });
});

test("live pages render real repository data", async ({ page }) => {
  await seedConnected(page);
  await page.goto("/");

  // Runs page shows the live run titles + status.
  await page.locator("textarea").fill("open runs");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Live · GitHub")).toBeVisible();
  await expect(page.getByText("Turn the chat into a real agent")).toBeVisible();
  await expect(page.getByText("Passed")).toBeVisible();

  // Files page browses the real repository tree.
  await page.locator("nav").getByText("Chat", { exact: true }).click();
  await page.locator("textarea").fill("open files");
  await page.keyboard.press("Enter");
  await expect(page.getByText("apps", { exact: true })).toBeVisible();
  await expect(page.getByText("README.md")).toBeVisible();
});

test("keyless chat commands return live data with correct pluralization", async ({ page }) => {
  await seedConnected(page);
  await page.goto("/");
  const ta = page.locator("textarea");

  await ta.fill("status"); await page.keyboard.press("Enter");
  await expect(page.getByText(new RegExp(`Signed in as`))).toBeVisible();
  await expect(page.getByText(/present ✓/)).toBeVisible(); // workflow preflight

  await ta.fill("prs"); await page.keyboard.press("Enter");
  await expect(page.getByText("1 open PR:")).toBeVisible(); // NOT "1 open PRs"

  await ta.fill("search router"); await page.keyboard.press("Enter");
  await expect(page.getByText("packages/agent/src/services/ai-router.ts")).toBeVisible();

  await ta.fill("read README.md"); await page.keyboard.press("Enter");
  await expect(page.getByText("Autonomous delivery agent.")).toBeVisible();
});

test("agent tool loop reads live data and a mutating action requires confirmation", async ({ page }) => {
  await seedConnected(page);
  // Pre-configure an LLM provider so freeform goes to the agent.
  await page.addInitScript(() => {
    localStorage.setItem("qodo:llm:key:openrouter", "sk-or-e2e");
    localStorage.setItem("qodo:llm:selected", "openrouter");
  });
  // Scripted agent: read runs (auto), then dispatch (needs confirm), then answer.
  const llm = await installLlmMock(page, [
    '```json\n{"tool":"list_runs","args":{"limit":5}}\n```',
    '```json\n{"tool":"dispatch_task","args":{"objective":"Add a slug helper"}}\n```',
    "Done — I inspected your runs and dispatched the task.",
  ]);
  const gh = await installGitHubMock(page); // re-install to capture dispatch count on this page
  await page.goto("/");

  await page.locator("textarea").fill("check my runs then dispatch a slug helper task");
  await page.keyboard.press("Enter");

  // The mutating tool pauses for confirmation.
  await expect(page.getByText("Confirm action")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Approve" }).click();

  // Final answer + evidence the tools ran.
  await expect(page.getByText("dispatched the task")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/tool step/)).toBeVisible();
  expect(llm.calls).toBeGreaterThanOrEqual(3);
  expect(gh.dispatched).toBeGreaterThanOrEqual(1);
});

test("triage skill (keyless) finds failing runs and the jobs that broke", async ({ page }) => {
  await seedConnected(page);
  // Override the runs/jobs routes with a failing scenario (registered last → wins).
  await page.route(/https:\/\/api\.github\.com\/.*/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/actions/runs/") && path.includes("/jobs")) return route.fulfill(json(FAILED_JOBS));
    if (path.includes("/actions/runs")) return route.fulfill(json(RUNS_WITH_FAILURE));
    return route.fallback();
  });
  await page.goto("/");
  await page.locator("textarea").fill("triage");
  await page.keyboard.press("Enter");
  await expect(page.getByText("1 failing run")).toBeVisible();
  await expect(page.getByText(/Unit \/ Property \/ Snapshot tests/)).toBeVisible();
});

test("GitHub rate limiting surfaces a clear, human message (not a raw 403)", async ({ page }) => {
  await seedConnected(page);
  const reset = Math.floor(Date.now() / 1000) + 15 * 60; // resets in ~15 min
  await page.route(/https:\/\/api\.github\.com\/.*\/actions\/runs.*/, async (route) =>
    route.fulfill({
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": String(reset),
        "content-type": "application/json",
        // Real GitHub exposes the ratelimit headers cross-origin; mirror that
        // so the browser can read them (in the APK, native HTTP has no CORS).
        "access-control-expose-headers": "x-ratelimit-remaining, x-ratelimit-reset",
      },
      body: JSON.stringify({ message: "API rate limit exceeded" }),
    }),
  );
  await page.goto("/");
  await page.locator("textarea").fill("runs");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/rate limit reached/i)).toBeVisible();
  await expect(page.getByText(/resets in ~1[0-9] min/)).toBeVisible();
});

test("review skill drives the agent through get_pr on real PR data", async ({ page }) => {
  await seedConnected(page);
  await page.addInitScript(() => {
    localStorage.setItem("qodo:llm:key:openrouter", "sk-or-e2e");
    localStorage.setItem("qodo:llm:selected", "openrouter");
  });
  // Agent: call get_pr for #42, then deliver a review grounded in the result.
  const llm = await installLlmMock(page, [
    '```json\n{"tool":"get_pr","args":{"number":42}}\n```',
    "Review of #42: the rate limiter is covered by tests/rate-limit.test.ts — solid. Consider a config for the window size.",
  ]);
  await installGitHubMock(page);
  await page.goto("/");
  await page.locator("textarea").fill("review 42");
  await page.keyboard.press("Enter");
  await expect(page.getByText("rate limiter is covered by tests")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/tool step/)).toBeVisible();
  expect(llm.calls).toBeGreaterThanOrEqual(2);
});
