/**
 * tests/sdk-cli/github-action-pr-demo.test.ts — v263
 *
 * Validates the PR demo workflow file (examples/github-action-pr-demo.yml)
 * that demonstrates using the TFA Trust Gate action in a pull-request
 * with automatic comment posting.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test, assert } from "../_harness.mjs";

const ROOT = new URL("../../", import.meta.url).pathname;
const DEMO_PATH = join(ROOT, "examples/github-action-pr-demo.yml");

function readDemo(): string {
  return readFileSync(DEMO_PATH, "utf8");
}

// ─── File existence ───────────────────────────────────────────────────────────

test("pr-demo: examples/github-action-pr-demo.yml exists", () => {
  assert(existsSync(DEMO_PATH), "demo workflow must exist in examples/");
});

// ─── YAML structure ───────────────────────────────────────────────────────────

test("pr-demo: workflow has a name", () => {
  const yaml = readDemo();
  assert(yaml.match(/^name:\s*.+/m), "demo workflow must have a name");
});

test("pr-demo: triggers on pull_request", () => {
  const yaml = readDemo();
  assert(yaml.includes("pull_request:"), "must trigger on pull_request");
});

test("pr-demo: permissions block includes contents: read", () => {
  const yaml = readDemo();
  assert(yaml.includes("permissions:"), "permissions block required");
  assert(yaml.includes("contents: read"), "contents: read permission required");
});

test("pr-demo: permissions block includes pull-requests: write", () => {
  const yaml = readDemo();
  assert(yaml.includes("pull-requests: write"), "pull-requests: write permission required for comment posting");
});

test("pr-demo: uses the TFA trust gate action (uses: tfa/...)", () => {
  const yaml = readDemo();
  assert(yaml.includes("uses:") && yaml.includes("tfa"), "must reference the TFA action");
});

test("pr-demo: sets post-comment to true", () => {
  const yaml = readDemo();
  assert(yaml.includes("post-comment: 'true'") || yaml.includes('post-comment: "true"') || yaml.includes("post-comment: true"),
    "must enable post-comment to demonstrate PR comment feature");
});

test("pr-demo: passes github-token to the action", () => {
  const yaml = readDemo();
  assert(yaml.includes("github-token:"), "must pass github-token for PR comment auth");
});

test("pr-demo: references required TFA variables (base-url, tenant, api-key)", () => {
  const yaml = readDemo();
  for (const key of ["base-url", "tenant", "api-key"]) {
    assert(yaml.includes(key), `must reference input ${key}`);
  }
});

test("pr-demo: runs on ubuntu-latest", () => {
  const yaml = readDemo();
  assert(yaml.includes("runs-on: ubuntu-latest"), "demo should use ubuntu-latest runner");
});

test("pr-demo: includes actions/checkout and actions/setup-node steps", () => {
  const yaml = readDemo();
  assert(yaml.includes("actions/checkout"), "must checkout the repo");
  assert(yaml.includes("actions/setup-node"), "must set up Node.js");
});
