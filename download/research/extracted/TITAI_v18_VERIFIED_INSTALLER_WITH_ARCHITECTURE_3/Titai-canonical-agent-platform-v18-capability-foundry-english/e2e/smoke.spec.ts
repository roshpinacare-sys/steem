import { test, expect, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL ?? "demo@titai.dev";
const password = process.env.E2E_PASSWORD;

async function login(page: Page) {
  if (!password) throw new Error("E2E_PASSWORD is required for browser tests.");
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const emailInput = page.locator('input[name="email"]');
  const passwordInput = page.locator('input[name="password"]');
  await expect(emailInput).toBeEditable();
  await expect(passwordInput).toBeEditable();
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.includes("login"), { timeout: 20_000 });
  await expect(page.getByText("Mission Control")).toBeVisible();
}

test("launch a simulated run, resolve the human gate, and inspect evidence", async ({ page }) => {
  await login(page);
  await page.locator("main").getByRole("button", { name: /Launch run/i }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator("textarea").fill("Build and deploy a new billing page");
  for (let step = 0; step < 3; step += 1) {
    await dialog.getByRole("button", { name: "Next" }).click();
  }
  await dialog.getByRole("button", { name: /Launch run/i }).click();
  await page.waitForURL(/\/runs\//, { timeout: 15_000 });

  const approve = page.getByRole("button", { name: "Approve" }).first();
  await expect(approve).toBeVisible({ timeout: 20_000 });
  await approve.click();
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 25_000 });
  await expect.poll(() => page.locator(".react-flow__node").count(), { timeout: 10_000 }).toBeGreaterThan(0);
  await page.getByRole("tab", { name: /Dossier/i }).click();
  await expect(page.getByText("Execution control record")).toBeVisible();
  await expect(page.getByText(/Model decision|Governed context|Tool boundary/).first()).toBeVisible();
  await page.getByRole("tab", { name: /Evidence/i }).click();
  await expect(page.getByText(/reconstruct|coverage|evidence/i).first()).toBeVisible();
  await page.getByRole("tab", { name: /Pilot/i }).click();
  await expect(page.getByText(/Pilot readiness/i).first()).toBeVisible();
  await expect(page.getByText(/DEVELOPMENT ONLY|CONTROLLED INTERNAL PILOT/i).first()).toBeVisible();
  await expect(page.getByText(/block|unknown|evidence/i).first()).toBeVisible();
  await page.goto("/operations", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Operations signal plane")).toBeVisible();
  await expect(page.getByText("Declared service boundaries")).toBeVisible();
});

test("create an agent and run the deterministic test bench", async ({ page }) => {
  await login(page);
  await page.goto("/agents?new=1", { waitUntil: "domcontentloaded" });
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog.getByLabel(/Name/i).first()).toBeEditable();
  await dialog.getByLabel(/Name/i).first().fill(`E2E Agent ${Date.now()}`);
  await dialog.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/agents\//, { timeout: 15_000 });
  await expect(page.getByText("Studio")).toBeVisible();

  const skillChip = page.locator("button", { hasText: /Writer|Researcher|Checklist/ }).first();
  if (await skillChip.count()) await skillChip.click();
  const bench = page.getByPlaceholder(/Try an objective/i);
  await bench.fill("Research the best caching approach");
  await page.getByRole("button", { name: /Run test/i }).click();
  await expect(page.getByText(/started|Steps/i).first()).toBeVisible({ timeout: 20_000 });
});

test("create, correct, search, and delete a governed memory record", async ({ page }) => {
  await login(page);
  await page.goto("/memory", { waitUntil: "domcontentloaded" });
  const marker = `E2E memory ${Date.now()}`;
  await page.getByLabel("Content").fill(marker);
  await page.getByLabel("Tags").fill("e2e, recovery");
  await page.getByRole("button", { name: "Create record" }).click();
  await expect(page.getByText(marker)).toBeVisible();

  await page.getByPlaceholder("Search memory content and tags").fill(marker);
  await expect(page.getByText(marker)).toBeVisible();
  await page.getByRole("button", { name: "Correct" }).click();
  const corrected = `${marker} corrected`;
  await page.getByLabel("Replacement content").fill(corrected);
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByText(corrected)).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(corrected)).toHaveCount(0);
});

test("pilot control surfaces expose semantic labels and keyboard focus", async ({ page }) => {
  await login(page);
  await page.goto("/operations", { waitUntil: "domcontentloaded" });
  await expect(page.locator("main")).toBeVisible();
  const unnamedInteractive = await page.locator("button, a, input, select, textarea").evaluateAll((elements) =>
    elements.filter((element) => {
      const html = element as HTMLElement;
      const text = (html.innerText || html.getAttribute("aria-label") || html.getAttribute("title") || "").trim();
      const input = element as HTMLInputElement;
      return !text && !input.placeholder && input.type !== "hidden";
    }).length,
  );
  expect(unnamedInteractive).toBe(0);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  const focusedOutline = await page.locator(":focus").evaluate((element) => {
    const style = getComputedStyle(element);
    return `${style.outlineStyle}:${style.outlineWidth}:${style.boxShadow}`;
  });
  expect(focusedOutline).not.toMatch(/^none:0px:(none)?$/);
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  await expect(page.getByText("Operations signal plane")).toBeVisible();
});
