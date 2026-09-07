/**
 * persistence.spec.ts — durable proof that in-progress state survives an app
 * restart. Playwright gives each test a fresh context (empty storage), and a
 * page.reload() stands in for closing and reopening the app.
 */
import { test, expect } from "@playwright/test";

test("an unsent chat draft survives an app restart", async ({ page }) => {
  await page.goto("/");
  await page.locator("textarea").fill("a half-typed message I have not sent");
  await page.waitForTimeout(200); // let the persist effect flush
  await page.reload();
  await expect(page.locator("textarea")).toHaveValue("a half-typed message I have not sent");
});

test("the app reopens on the page you last used", async ({ page }) => {
  await page.goto("/");
  // Navigate to Settings via a keyless chat command, then "restart".
  await page.locator("textarea").fill("open settings");
  await page.keyboard.press("Enter");
  await expect(page.getByText("AI providers")).toBeVisible();
  await page.reload();
  await expect(page.getByText("AI providers")).toBeVisible(); // restored to Settings
});

test("a drafted task objective survives reopening the composer", async ({ page }) => {
  await page.goto("/");
  // Open the composer from the header, type an objective, close without launching.
  await page.getByRole("button", { name: "New task" }).click();
  const objective = page.locator("textarea").last();
  await objective.fill("Add caching to the search endpoint");
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape");
  // Reopen — the objective is restored.
  await page.getByRole("button", { name: "New task" }).click();
  await expect(page.locator("textarea").last()).toHaveValue("Add caching to the search endpoint");
});
