/**
 * team-setup.spec.ts — durable proof of the team onboarding path.
 *
 * A "setup code" carries the non-secret pointers (repo, branch, proxy) but no
 * token. This drives the real UI: share a code from a connected device, wipe
 * the device, import the code, and confirm (a) the proxy + repo are applied
 * with NO token leaking, and (b) signing in auto-selects the imported repo.
 */
import { test, expect } from "@playwright/test";
import { installGitHubMock, FULL, OWNER } from "./github-mock.js";

test.beforeEach(async ({ page }) => {
  await installGitHubMock(page);
});

test("a setup code shares repo + proxy, imports without any token, and auto-connects", async ({ page }) => {
  // ── Device A: connected, with a proxy configured ──────────────────────────
  // Seed via evaluate (not addInitScript) so a later clear+reload for "device
  // B" is genuinely clean — an init script would re-seed the token on reload.
  await page.goto("/");
  await page.evaluate(([full, owner]) => {
    localStorage.setItem("qodo:github-token", "ghp_e2e_token");
    localStorage.setItem("qodo:github-repo", full);
    localStorage.setItem("qodo:github-branch", "main");
    localStorage.setItem("qodo:github-user", JSON.stringify({ login: owner, name: "Haran Dev", avatarUrl: null }));
    localStorage.setItem("qodo:proxy-url", "https://proxy.example.dev");
  }, [FULL, OWNER]);
  await page.reload();
  await page.locator("textarea").fill("open settings");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Team setup")).toBeVisible();
  const code = (await page.locator("code", { hasText: "qodo1:" }).first().innerText()).trim();
  expect(code).toMatch(/^qodo1:/);

  // ── Device B: wipe everything, import the code ────────────────────────────
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("textarea").fill("open settings");
  await page.keyboard.press("Enter");

  await page.getByPlaceholder("qodo1:…").fill(code);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/Applied:/)).toBeVisible();

  const applied = await page.evaluate(() => ({
    repo: localStorage.getItem("qodo:github-repo"),
    proxy: localStorage.getItem("qodo:proxy-url"),
    token: localStorage.getItem("qodo:github-token"),
  }));
  expect(applied.repo).toBe(FULL);
  expect(applied.proxy).toBe("https://proxy.example.dev");
  expect(applied.token).toBeNull(); // the code never carries a secret

  // ── Sign in — the connect wizard auto-selects the imported repo ───────────
  await page.locator('input[type="password"]').first().fill("ghp_e2e_token");
  await page.getByRole("button", { name: "Continue" }).click();

  // Auto-select jumps straight past the repo picker to the branch step for the
  // imported repository — no hand-picking required.
  await expect(page.getByRole("button", { name: /Connect vercel/ })).toBeVisible();
});
