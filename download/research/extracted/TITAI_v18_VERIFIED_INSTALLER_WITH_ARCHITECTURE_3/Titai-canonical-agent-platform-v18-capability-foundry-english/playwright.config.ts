import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = 3210;
const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  "/opt/pw-browsers/chromium",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((value): value is string => Boolean(value));
const sandboxChromium = candidates.find((candidate) => existsSync(candidate));
const chromiumArgs = process.env.PLAYWRIGHT_NO_SANDBOX === "1"
  ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  : ["--disable-dev-shm-usage"];
const chromiumLaunchOptions = sandboxChromium
  ? { executablePath: sandboxChromium, args: chromiumArgs }
  : { args: chromiumArgs };

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/playwright",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["html", { open: "never", outputFolder: "playwright-report" }], ["json", { outputFile: "test-results/playwright-results.json" }]]
    : [["list"], ["json", { outputFile: "test-results/playwright-results.json" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: process.env.CI ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: chromiumLaunchOptions } },
    ...(process.env.CI
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
          { name: "mobile-chromium", use: { ...devices["Pixel 7"], launchOptions: chromiumLaunchOptions } },
        ]
      : []),
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    env: {
      AUTH_SECRET: "e2e-secret-32-bytes-long-for-tests-only-x",
      ENCRYPTION_KEY: "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcy1sb25nISE=",
      DATABASE_PATH: "./data/titai.db",
      TITAI_SQLITE_DRIVER: process.env.TITAI_SQLITE_DRIVER ?? "auto",
      TITAI_RUNNER_MODE: "durable_opt_in",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_NO_WARNINGS: "1",
    },
  },
});
