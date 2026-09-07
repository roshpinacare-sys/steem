import "../_flush.mjs";
/**
 * tests/sdk-cli/ci-workflow.test.ts — CI workflow governance tests.
 *
 * These tests verify that the CI workflow file (.github/workflows/ci.yml)
 * exists and encodes the required quality gates. They run in the test suite
 * (no network, no shell) and serve as a machine-readable contract for what
 * CI must do.
 *
 * Coverage:
 *   File existence and parseability
 *     • .github/workflows/ci.yml exists at repo root
 *     • file is non-empty and contains YAML structure
 *
 *   Required triggers
 *     • triggers on push to main/master
 *     • triggers on pull_request to main/master
 *     • supports workflow_dispatch (manual run)
 *
 *   Required jobs
 *     • "audit" job exists (full test suite gate)
 *     • "sync-check" job exists (github-action binary sync)
 *     • "typecheck" job exists (TypeScript)
 *
 *   Quality gates
 *     • audit job runs ecos-audit.mjs --full
 *     • sync-check job runs sync-github-action-bin.mjs --check
 *     • audit job uses Node.js 22
 *     • minimal permissions (contents: read)
 *
 *   Security
 *     • no secrets in plaintext in the workflow file
 *     • permissions block is present
 */

import { test, assert, eq } from "../_harness.mjs";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Path helpers ─────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// Path from tests/sdk-cli/ to repo root (2 levels up):
// sdk-cli → tests → sovereign (repo root)
const repoRoot = resolve(__dirname, "../../");
const WORKFLOW_PATH = join(repoRoot, ".github", "workflows", "ci.yml");

function readWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf-8");
}

// ─── File existence ───────────────────────────────────────────────────────────

test("CI: .github/workflows/ci.yml exists at repo root", () => {
  assert(
    existsSync(WORKFLOW_PATH),
    `Expected CI workflow at ${WORKFLOW_PATH}`,
  );
});

test("CI: ci.yml is non-empty (> 100 bytes)", () => {
  const content = readWorkflow();
  assert(content.length > 100, `ci.yml is too short (${content.length} bytes)`);
});

// ─── Required triggers ────────────────────────────────────────────────────────

test("CI: triggers on push to main or master", () => {
  const content = readWorkflow();
  assert(
    content.includes("push") && (content.includes("main") || content.includes("master")),
    "ci.yml must trigger on push to main/master",
  );
});

test("CI: triggers on pull_request", () => {
  const content = readWorkflow();
  assert(content.includes("pull_request"), "ci.yml must trigger on pull_request");
});

test("CI: supports workflow_dispatch (manual trigger)", () => {
  const content = readWorkflow();
  assert(content.includes("workflow_dispatch"), "ci.yml must support workflow_dispatch");
});

// ─── Required jobs ────────────────────────────────────────────────────────────

test("CI: 'audit' job exists", () => {
  const content = readWorkflow();
  assert(content.includes("audit:"), "ci.yml must define an 'audit:' job");
});

test("CI: 'sync-check' job exists", () => {
  const content = readWorkflow();
  assert(
    content.includes("sync-check:") || content.includes("sync_check:"),
    "ci.yml must define a sync-check job",
  );
});

test("CI: 'typecheck' job exists", () => {
  const content = readWorkflow();
  assert(content.includes("typecheck:"), "ci.yml must define a 'typecheck:' job");
});

// ─── Quality gates ────────────────────────────────────────────────────────────

test("CI: audit job runs ecos-audit.mjs --full", () => {
  const content = readWorkflow();
  assert(
    content.includes("ecos-audit.mjs") && content.includes("--full"),
    "audit job must run 'node scripts/ecos-audit.mjs --full'",
  );
});

test("CI: sync-check job runs sync-github-action-bin.mjs --check", () => {
  const content = readWorkflow();
  assert(
    content.includes("sync-github-action-bin.mjs") && content.includes("--check"),
    "sync-check job must run sync-github-action-bin.mjs --check",
  );
});

test("CI: audit job uses Node.js 22", () => {
  const content = readWorkflow();
  // node-version: "22" or node-version: 22
  assert(
    content.includes("node-version") && (content.includes('"22"') || content.includes("'22'") || content.includes(": 22")),
    "CI must specify Node.js 22",
  );
});

// ─── Security ─────────────────────────────────────────────────────────────────

test("CI: permissions block is present (least-privilege)", () => {
  const content = readWorkflow();
  assert(content.includes("permissions:"), "ci.yml must declare a permissions block");
});

test("CI: permissions includes contents: read", () => {
  const content = readWorkflow();
  assert(
    content.includes("contents: read"),
    "ci.yml permissions must include 'contents: read' (least privilege)",
  );
});

test("CI: no hardcoded secrets in plaintext (no bare secret values)", () => {
  const content = readWorkflow();
  // Secrets should only appear as ${{ secrets.* }} references, not bare values.
  // We check there are no lines like: key: someActualSecretValue123
  // Simple heuristic: no lines that look like "secret: <non-empty non-expression value>"
  const lines = content.split("\n");
  const suspicious = lines.filter(l => {
    const trimmed = l.trim();
    // Skip comment lines and expression lines
    if (trimmed.startsWith("#") || trimmed.includes("${{")) return false;
    // Look for lines that assign a non-empty, non-expression value to something named *secret* or *key*
    return /^\s*(api.key|secret|password|token)\s*:\s*[a-zA-Z0-9]{8,}/i.test(l);
  });
  eq(
    suspicious.length,
    0,
    `Suspicious hardcoded secret lines found:\n${suspicious.join("\n")}`,
  );
});

// ─── Structure completeness ───────────────────────────────────────────────────

test("CI: uses actions/checkout", () => {
  const content = readWorkflow();
  assert(content.includes("actions/checkout"), "ci.yml must use actions/checkout");
});

test("CI: uses actions/setup-node", () => {
  const content = readWorkflow();
  assert(content.includes("actions/setup-node"), "ci.yml must use actions/setup-node");
});

test("CI: name field is set", () => {
  const content = readWorkflow();
  assert(content.startsWith("name:") || content.includes("\nname:"), "ci.yml must have a name field");
});
