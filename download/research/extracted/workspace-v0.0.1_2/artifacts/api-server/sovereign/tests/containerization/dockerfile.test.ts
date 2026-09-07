import "../_flush.mjs";
/**
 * tests/containerization/dockerfile.test.ts
 *
 * Verifies that the production Dockerfile exists, follows best practices,
 * and contains all required directives for a fail-closed TFA deployment.
 */

import { test, assert, eq } from "../_harness.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dockerfilePath = join(import.meta.dirname, "../../Dockerfile");
const dockerfile = readFileSync(dockerfilePath, "utf8");

const lines = dockerfile.split("\n").map((l) => l.trim().toLowerCase());

function hasDirective(prefix: string): boolean {
  return lines.some((l) => l.startsWith(prefix.toLowerCase()));
}

function extractLine(prefix: string): string {
  const line = lines.find((l) => l.startsWith(prefix.toLowerCase()));
  return line ?? "";
}

/** Checks if the lowered Dockerfile content contains the given substring. */
function dockerfileIncludes(sub: string): boolean {
  return dockerfile.toLowerCase().includes(sub.toLowerCase());
}

test("Dockerfile exists and is non-empty", () => {
  assert(dockerfile.length > 0, "Dockerfile must not be empty");
});

test("Dockerfile uses Node 24+ slim base image", () => {
  const fromLine = extractLine("FROM");
  assert(fromLine.includes("node"), "must use official node image");
  assert(fromLine.includes("slim") || fromLine.includes("alpine"), "should use slim or alpine variant for smaller image");
});

test("Dockerfile sets WORKDIR /app", () => {
  assert(hasDirective("WORKDIR"), "must set WORKDIR");
  assert(extractLine("WORKDIR").includes("/app"), "WORKDIR should be /app");
});

test("Dockerfile copies source into image", () => {
  assert(hasDirective("COPY"), "must COPY source code");
});

test("Dockerfile exposes port 7700", () => {
  assert(hasDirective("EXPOSE"), "must EXPOSE the service port");
  assert(extractLine("EXPOSE").includes("7700"), "must expose port 7700");
});

test("Dockerfile sets NODE_ENV=production", () => {
  assert(dockerfile.toLowerCase().includes("node_env=production"), "must set NODE_ENV=production for fail-closed behavior");
});

test("Dockerfile includes HEALTHCHECK directive", () => {
  assert(hasDirective("HEALTHCHECK"), "must include HEALTHCHECK for orchestrator integration");
  assert(dockerfileIncludes("curl"), "healthcheck should use curl");
  assert(dockerfileIncludes("healthz"), "healthcheck must probe /healthz");
  assert(dockerfileIncludes("|| exit 1"), "healthcheck must fail with exit 1 on probe failure");
});

test("Dockerfile HEALTHCHECK uses sane timeouts", () => {
  const healthLine = extractLine("HEALTHCHECK");
  assert(healthLine.includes("--timeout"), "should specify --timeout");
  assert(healthLine.includes("--interval"), "should specify --interval");
  assert(healthLine.includes("--start-period"), "should specify --start-period");
  assert(healthLine.includes("--retries"), "should specify --retries");
});

test("Dockerfile CMD starts sovereign server", () => {
  assert(hasDirective("CMD"), "must have a CMD");
  assert(dockerfileIncludes("node"), "CMD must run node");
  assert(dockerfileIncludes("sovereign-server.ts"), "CMD must start sovereign-server.ts");
});

test("Dockerfile does not bake secrets", () => {
  const lowered = dockerfile.toLowerCase();
  assert(!lowered.includes("tfa_secret="), "must not hardcode TFA_SECRET");
  assert(!lowered.includes("db_url="), "must not hardcode DB_URL");
});
