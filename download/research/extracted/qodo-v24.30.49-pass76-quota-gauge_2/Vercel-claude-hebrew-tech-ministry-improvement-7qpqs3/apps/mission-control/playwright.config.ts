import { defineConfig } from "@playwright/test";

/**
 * E2E config for the Live-mode verification suite (e2e/*.spec.ts).
 *
 * The webServer builds the app and serves the production bundle, so the test
 * exercises exactly what ships. Chromium resolves from PLAYWRIGHT_CHROMIUM_PATH
 * when set (e.g. a pre-installed browser in a sandbox); otherwise Playwright's
 * managed browser is used (the CI job installs it).
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 390, height: 844 },
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: {
    // Bind explicitly to 127.0.0.1 — vite preview otherwise listens on
    // "localhost", which on CI runners can resolve to IPv6 ::1 only, so the
    // IPv4 readiness probe is refused and the server "never" comes up.
    command: "npm run build && npm run preview -- --port 4173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
