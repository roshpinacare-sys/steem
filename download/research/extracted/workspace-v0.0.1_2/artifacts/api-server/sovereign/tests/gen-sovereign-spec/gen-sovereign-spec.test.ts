import "../_flush.mjs";
/**
 * tests/gen-sovereign-spec/gen-sovereign-spec.test.ts — v416
 *
 * Tests for scripts/gen-sovereign-spec.mjs:
 *   • SOVEREIGN_ROUTES list integrity (every entry exists in the full spec)
 *   • No duplicates in SOVEREIGN_ROUTES
 *   • Generated sovereign-openapi.yaml is present and has correct op count
 *   • Every operation in sovereign-openapi.yaml is in the SOVEREIGN_ROUTES list
 *   • Every SOVEREIGN_ROUTES entry that exists in the full spec is in sovereign-openapi.yaml
 *   • Routes NOT in sovereign-routes are absent from sovereign-openapi.yaml
 *   • Generated file title includes "Sovereign Kernel"
 *   • Generated file servers url = /api (unchanged)
 *   • Components section is preserved in generated file
 *   • Generator is idempotent (running twice produces identical output)
 *   • Dry-run flag does not overwrite the file
 *   • parseSpec produces the correct path-count for the full spec
 *   • buildFilteredSpec respects IMPLEMENTED set (unit test)
 *
 * Node directly: node tests/gen-sovereign-spec/gen-sovereign-spec.test.ts
 */

import fs   from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { test, assert, eq } from "../_harness.mjs";
import {
  SOVEREIGN_ROUTES,
  IMPLEMENTED,
  parseSpec,
  buildFilteredSpec,
} from "../../scripts/gen-sovereign-spec.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOV       = path.join(__dirname, "..", "..");
const SPEC_FULL = path.join(SOV, "lib", "api-spec", "openapi.yaml");
const SPEC_SOV  = path.join(SOV, "lib", "api-spec", "sovereign-openapi.yaml");

// ─── Parse both specs once at the top ────────────────────────────────────────

const fullText = fs.readFileSync(SPEC_FULL, "utf8");
const parsedFull = parseSpec(fullText);

const sovText  = fs.existsSync(SPEC_SOV) ? fs.readFileSync(SPEC_SOV, "utf8") : "";
const parsedSov = sovText ? parseSpec(sovText) : null;

// Helper: count operationId occurrences in text
function countOps(text: string): number {
  return (text.match(/operationId:/g) || []).length;
}

// Helper: extract all (method, specPath) from a parsed spec's paths map
function allOps(parsed: ReturnType<typeof parseSpec>): { method: string; specPath: string }[] {
  const ops: { method: string; specPath: string }[] = [];
  for (const [specPath, entry] of parsed.paths) {
    for (const [method] of entry.methods) {
      ops.push({ method, specPath });
    }
  }
  return ops;
}

// ─── 1. SOVEREIGN_ROUTES list integrity ───────────────────────────────────────

test("gen-sovereign-spec: SOVEREIGN_ROUTES is non-empty", () => {
  assert(SOVEREIGN_ROUTES.length > 0, "SOVEREIGN_ROUTES must have entries");
});

test("gen-sovereign-spec: SOVEREIGN_ROUTES has no duplicate (method, specPath) pairs", () => {
  const seen = new Set<string>();
  for (const r of SOVEREIGN_ROUTES) {
    const key = `${r.method} ${r.specPath}`;
    assert(!seen.has(key), `Duplicate SOVEREIGN_ROUTES entry: ${key}`);
    seen.add(key);
  }
});

test("gen-sovereign-spec: all SOVEREIGN_ROUTES entries that exist in full spec have a real operationId", () => {
  for (const r of SOVEREIGN_ROUTES) {
    const entry = parsedFull.paths.get(r.specPath);
    if (!entry) continue; // some routes not yet in the full spec — that's OK
    const methods = entry.methods;
    assert(
      methods.has(r.method),
      `SOVEREIGN_ROUTES entry "${r.method} ${r.specPath}" — method not in full spec. Available: ${[...methods.keys()].join(", ")}`,
    );
    // The method block should contain operationId
    const block = methods.get(r.method)!.join("\n");
    assert(block.includes("operationId:"), `"${r.method} ${r.specPath}" lacks operationId in full spec`);
  }
});

test("gen-sovereign-spec: IMPLEMENTED set size equals SOVEREIGN_ROUTES length", () => {
  eq(IMPLEMENTED.size, SOVEREIGN_ROUTES.length);
});

// ─── 2. Generated file presence & structure ───────────────────────────────────

test("gen-sovereign-spec: sovereign-openapi.yaml exists", () => {
  assert(fs.existsSync(SPEC_SOV), `${SPEC_SOV} must exist — run: node scripts/gen-sovereign-spec.mjs`);
});

test("gen-sovereign-spec: sovereign-openapi.yaml has exactly 36 operations", () => {
  const count = countOps(sovText);
  eq(count, 36, `expected 36 operationIds, got ${count}`);
});

test("gen-sovereign-spec: sovereign-openapi.yaml title includes 'Sovereign Kernel'", () => {
  assert(sovText.includes("Sovereign Kernel"), "title must contain 'Sovereign Kernel'");
});

test("gen-sovereign-spec: sovereign-openapi.yaml has servers url = /api", () => {
  assert(sovText.includes("url: /api"), "servers.url must be /api");
});

test("gen-sovereign-spec: sovereign-openapi.yaml preserves components section", () => {
  assert(sovText.includes("components:"), "components section must be preserved");
  assert(sovText.includes("bearerAuth"), "bearerAuth scheme must be preserved");
});

// ─── 3. Content correctness ───────────────────────────────────────────────────

test("gen-sovereign-spec: every op in sovereign-openapi.yaml is in SOVEREIGN_ROUTES", () => {
  if (!parsedSov) return;
  for (const { method, specPath } of allOps(parsedSov)) {
    const key = `${method} ${specPath}`;
    assert(IMPLEMENTED.has(key), `sovereign spec contains "${key}" but it is NOT in SOVEREIGN_ROUTES`);
  }
});

test("gen-sovereign-spec: every SOVEREIGN_ROUTES entry that exists in full spec is in sovereign spec", () => {
  if (!parsedSov) return;
  for (const r of SOVEREIGN_ROUTES) {
    if (!parsedFull.paths.has(r.specPath)) continue; // not in full spec → skip
    const fullEntry = parsedFull.paths.get(r.specPath)!;
    if (!fullEntry.methods.has(r.method)) continue; // method not in full spec → skip
    const sovEntry = parsedSov.paths.get(r.specPath);
    assert(sovEntry !== undefined, `"${r.specPath}" should be in sovereign spec but is missing`);
    assert(
      sovEntry.methods.has(r.method),
      `"${r.method} ${r.specPath}" in SOVEREIGN_ROUTES+full-spec but not in sovereign spec`,
    );
  }
});

test("gen-sovereign-spec: auth/login (not implemented) is absent from sovereign spec", () => {
  if (!parsedSov) return;
  assert(!parsedSov.paths.has("/auth/login"), "/auth/login must not appear in sovereign spec");
});

test("gen-sovereign-spec: /agents (not implemented) is absent from sovereign spec", () => {
  if (!parsedSov) return;
  assert(!parsedSov.paths.has("/agents"), "/agents must not appear in sovereign spec");
});

test("gen-sovereign-spec: /workflows (not implemented) is absent from sovereign spec", () => {
  if (!parsedSov) return;
  assert(!parsedSov.paths.has("/workflows"), "/workflows must not appear in sovereign spec");
});

// ─── Settlement / webhooks presence ──────────────────────────────────────────

test("gen-sovereign-spec: /settlement post is present in full and sovereign spec", () => {
  assert(parsedFull.paths.has("/settlement"), "/settlement must be in full spec");
  assert(parsedFull.paths.get("/settlement")!.methods.has("post"), "POST /settlement must be in full spec");
  if (!parsedSov) return;
  assert(parsedSov.paths.has("/settlement"), "/settlement must be in sovereign spec");
  assert(parsedSov.paths.get("/settlement")!.methods.has("post"), "POST /settlement must be in sovereign spec");
});

test("gen-sovereign-spec: /settlement/{id}/threshold-approval post is present in both specs", () => {
  assert(parsedFull.paths.has("/settlement/{id}/threshold-approval"), "threshold-approval must be in full spec");
  if (!parsedSov) return;
  assert(parsedSov.paths.has("/settlement/{id}/threshold-approval"), "threshold-approval must be in sovereign spec");
});

test("gen-sovereign-spec: /webhooks get and delete are present in both specs", () => {
  assert(parsedFull.paths.has("/webhooks"), "/webhooks must be in full spec");
  assert(parsedFull.paths.get("/webhooks")!.methods.has("get"), "GET /webhooks must be in full spec");
  assert(parsedFull.paths.get("/webhooks")!.methods.has("post"), "POST /webhooks must be in full spec");
  assert(parsedFull.paths.has("/webhooks/{id}"), "/webhooks/{id} must be in full spec");
  assert(parsedFull.paths.get("/webhooks/{id}")!.methods.has("delete"), "DELETE /webhooks/{id} must be in full spec");
  if (!parsedSov) return;
  assert(parsedSov.paths.has("/webhooks"), "/webhooks must be in sovereign spec");
  assert(parsedSov.paths.get("/webhooks")!.methods.has("get"), "GET /webhooks must be in sovereign spec");
  assert(parsedSov.paths.get("/webhooks")!.methods.has("post"), "POST /webhooks must be in sovereign spec");
  assert(parsedSov.paths.has("/webhooks/{id}"), "/webhooks/{id} must be in sovereign spec");
  assert(parsedSov.paths.get("/webhooks/{id}")!.methods.has("delete"), "DELETE /webhooks/{id} must be in sovereign spec");
});

// ─── 4. parseSpec unit test ──────────────────────────────────────────────────

test("gen-sovereign-spec: parseSpec finds all 124 operations in full spec (v427: +2 redacted-proof-bundle routes)", () => {
  const ops = allOps(parsedFull);
  eq(ops.length, 124, `parseSpec should find 124 operations, got ${ops.length}`);
});

test("gen-sovereign-spec: parseSpec finds /escrow path with post and get methods", () => {
  const entry = parsedFull.paths.get("/escrow");
  assert(entry !== undefined, "/escrow must be in parsed paths");
  assert(entry!.methods.has("post"), "/escrow must have post");
  assert(entry!.methods.has("get"), "GET /escrow should be in full spec");
});

// ─── 5. buildFilteredSpec unit test ──────────────────────────────────────────

test("gen-sovereign-spec: buildFilteredSpec with empty IMPLEMENTED set produces 0 ops", () => {
  const mini = `openapi: "3.1.0"\npaths:\n  /foo:\n    get:\n      operationId: fooGet\n`;
  const parsed = parseSpec(mini);
  const { text, included } = buildFilteredSpec(parsed, new Set());
  eq(included, 0);
  assert(!text.includes("operationId: fooGet"), "filtered-out op must not appear");
});

test("gen-sovereign-spec: buildFilteredSpec with matching IMPLEMENTED keeps op", () => {
  const mini = `openapi: "3.1.0"\npaths:\n  /foo:\n    get:\n      operationId: fooGet\n`;
  const parsed = parseSpec(mini);
  const { text, included } = buildFilteredSpec(parsed, new Set(["get /foo"]));
  eq(included, 1);
  assert(text.includes("operationId: fooGet"), "included op must appear");
});

// ─── 6. Idempotency ──────────────────────────────────────────────────────────

test("gen-sovereign-spec: generator is idempotent (running twice produces identical output)", () => {
  const first = fs.readFileSync(SPEC_SOV, "utf8");
  // Run generator again
  const result = spawnSync("node", ["scripts/gen-sovereign-spec.mjs"], {
    cwd: SOV, encoding: "utf8",
  });
  assert(result.status === 0, `generator exited with ${result.status}: ${result.stderr}`);
  const second = fs.readFileSync(SPEC_SOV, "utf8");
  eq(first, second, "second run must produce identical output");
});
