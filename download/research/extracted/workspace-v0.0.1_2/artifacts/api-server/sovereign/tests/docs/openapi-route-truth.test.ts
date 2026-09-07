import "../_flush.mjs";
/**
 * tests/docs/openapi-route-truth.test.ts
 *
 * OpenAPI truthfulness — gap #18 (drift prevention).
 *
 * Compares every registered HTTP route in the source code against the paths
 * documented in lib/api-spec/openapi.yaml. Fails when:
 *   1. A route exists in code but is missing from the spec (drift).
 *   2. A route is documented in spec but does not exist in code (stale spec).
 *
 * Known historical gaps are tracked explicitly in KNOWN_MISSING so the test
 * can be green while the spec is being back-filled. Adding a new route without
 * updating BOTH the code AND the spec (or the allowlist with a dated comment)
 * breaks the build — this is the drift gate.
 *
 * Zero dependencies — pure string scanning (no YAML parser).
 */

import { test, assert, eq } from "../_harness.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(__dirname, "../../lib/api-spec/openapi.yaml");

// ─── 1. Extract registered routes from source code ───────────────────────────

interface CodeRoute { method: string; path: string; file: string; }

function extractCodeRoutes(): CodeRoute[] {
  const routes: CodeRoute[] = [];
  const routeFiles = [
    "src/routes/sovereign-routes.ts",
    "src/routes/execution-routes.ts",
    "src/routes/adapter-routes.ts",
    "src/routes/settlement-routes.ts",
    "src/routes/eval-routes.ts",
    "src/routes/indexer-routes.ts",
    "src/routes/sovereignty-routes.ts",
    "src/routes/confidence-routes.ts",
    "src/routes/introduction-routes.ts",
    "src/routes/kill-switch-routes.ts",
    "src/routes/receipt-verify-routes.ts",
    "src/routes/witness-routes.ts",
    "src/routes/transparency-log-routes.ts",
    "src/routes/passport-revocation-routes.ts",
    "src/routes/mcp-routes.ts",
    "src/routes/ard-routes.ts",
    "src/routes/pqc-admin-routes.ts",
    "src/routes/drift-explain-routes.ts",
    "src/routes/kid-resolver-routes.ts",
    "src/routes/arbitrage-routes.ts",
    "src/routes/dispute-routes.ts",
  ];
  const base = join(__dirname, "../..");
  for (const f of routeFiles) {
    const src = readFileSync(join(base, f), "utf8");
    const matches = src.matchAll(/method:\s*"(\w+)",\s*pattern:\s*"([^"]+)"/g);
    for (const m of matches) {
      routes.push({ method: m[1].toUpperCase(), path: m[2], file: f });
    }
  }
  // Hard-coded routes in sovereign-server.ts (healthz, readyz, dashboard, docs, spec)
  routes.push({ method: "GET", path: "/healthz", file: "src/http/sovereign-server.ts" });
  routes.push({ method: "GET", path: "/readyz", file: "src/http/sovereign-server.ts" });
  routes.push({ method: "GET", path: "/dashboard", file: "src/http/sovereign-server.ts" });
  routes.push({ method: "GET", path: "/api/docs", file: "src/http/sovereign-server.ts" });
  routes.push({ method: "GET", path: "/api/openapi.yaml", file: "src/http/sovereign-server.ts" });
  return routes;
}

// ─── 2. Extract documented paths+methods from OpenAPI YAML ───────────────────

interface SpecRoute { method: string; path: string; }

function extractSpecRoutes(): SpecRoute[] {
  const spec = readFileSync(SPEC_PATH, "utf8");
  const routes: SpecRoute[] = [];
  const lines = spec.split("\n");
  let inPaths = false;
  let currentPath: string | null = null;
  let pathIndent = 0;

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    if (trimmed.startsWith("paths:")) {
      inPaths = true;
      pathIndent = indent;
      continue;
    }
    if (!inPaths) continue;
    // Exit paths section when we hit another top-level section
    if (indent <= 2 && trimmed.endsWith(":") && !trimmed.startsWith("/")) {
      inPaths = false;
      continue;
    }

    // Path line: "  /foo:" or "  /foo/{bar}:"
    const pathMatch = trimmed.match(/^(\/[^:\s]+):\s*$/);
    if (pathMatch && indent > pathIndent) {
      currentPath = pathMatch[1];
      continue;
    }

    // Method line under current path
    if (currentPath) {
      const methodMatch = trimmed.match(/^(get|post|put|delete|patch):\s*$/i);
      if (methodMatch) {
        routes.push({ method: methodMatch[1].toUpperCase(), path: currentPath });
      }
    }
  }
  return routes;
}

// ─── 3. Normalise for comparison ─────────────────────────────────────────────

function normalise(path: string): string {
  // code uses ":param", spec uses "{param}" — normalise to {param}
  return path.replace(/:([^/]+)/g, "{$1}");
}

function key(r: { method: string; path: string }): string {
  return `${r.method} ${normalise(r.path)}`;
}

// The spec declares paths without the /api prefix because servers: [{ url: /api }].
// Code routes include /api, so we prepend /api to spec paths for comparison.
// Root-level health probes (/healthz, /readyz, /dashboard) are NOT under /api.
// /.well-known/ai-catalog.json (v401) is also root-level by spec convention
// (RFC 8615 well-known URIs are never namespaced under an API prefix).
function specKey(r: { method: string; path: string }): string {
  const rootPaths = ["/healthz", "/readyz", "/dashboard", "/.well-known/ai-catalog.json"];
  const prefix = rootPaths.includes(r.path) ? "" : "/api";
  return `${r.method} ${prefix}${normalise(r.path)}`;
}

// ─── 4. Known gaps (historical, not new drift) ───────────────────────────────
// These routes are registered in code but not yet in the spec. Adding a new
// entry here requires a comment with the date and justification.

const KNOWN_MISSING: Set<string> = new Set([
  // v324 — backfilled: POST /api/ledger/withdraw → see openapi.yaml
  // v327 — backfilled: GET /api/tenants, /api/escrow, POST /api/potential/collaboration/{escrowId}/complete → see openapi.yaml
  // v292 — execution core routes now in spec
  // v324 — backfilled: GET /api/passport/public-key, /passport/{auditId}, /passports/{id}/status → see openapi.yaml
  // v325 — backfilled: GET /api/eval/run, /eval/run/{taskId}, /confidence/evaluate, /confidence/verify, /admin/kill-switch/* → see openapi.yaml
  // v328 — backfilled: marketplace, sovereignty, introduction, track-record proof → see openapi.yaml
  // v226 — backfilled: GET /api/monitor/status, POST /api/monitor/run → see openapi.yaml
  // v226 — backfilled: GET /api/transparency/chain, /transparency/balances, /transparency/passports → see openapi.yaml
  // v330 — backfilled: GET /dashboard, /api/docs, /api/openapi.yaml, /api/audit-trail → see openapi.yaml
  // v425 — count-proof routes added; OpenAPI backfill is next open item
  "POST /api/track-record/count-proof",
  "POST /api/track-record/count-proof/verify",
  // v426 — predicate-proof routes added; OpenAPI backfill pending
  "POST /api/track-record/predicate-proof",
  "POST /api/track-record/predicate-proof/verify",
]);

// ─── 5. Stale spec entries (in spec but not in code) ─────────────────────────

const KNOWN_STALE: Set<string> = new Set([
  // None at present — if spec documents a route we removed, list it here.
]);

// ─── 6. Compute drift ────────────────────────────────────────────────────────

const codeRoutes = extractCodeRoutes();
const specRoutes = extractSpecRoutes();

const codeKeys = new Set(codeRoutes.map(key));
const specKeys = new Set(specRoutes.map(specKey));

const missingFromSpec = [...codeKeys].filter((k) => !specKeys.has(k) && !KNOWN_MISSING.has(k));
const staleInSpec = [...specKeys].filter((k) => !codeKeys.has(k) && !KNOWN_STALE.has(k));

// ─── Tests ───────────────────────────────────────────────────────────────────

test("ROUTE TRUTH: every registered code route is either in spec or in KNOWN_MISSING", () => {
  if (missingFromSpec.length) {
    console.log("  [drift] routes in code but missing from spec:");
    for (const k of missingFromSpec) console.log("    " + k);
  }
  eq(missingFromSpec.length, 0, `drift detected: ${missingFromSpec.length} route(s) in code but not in spec`);
});

test("ROUTE TRUTH: every spec entry is either implemented in code or in KNOWN_STALE", () => {
  if (staleInSpec.length) {
    console.log("  [stale] routes in spec but missing from code:");
    for (const k of staleInSpec) console.log("    " + k);
  }
  eq(staleInSpec.length, 0, `stale spec: ${staleInSpec.length} route(s) in spec but not in code`);
});

test("ROUTE TRUTH: total code routes match expected count (drift canary)", () => {
  // This is a canary: if someone adds a route without updating the spec,
  // this count changes and the test above fails. The number itself is not
  // sacred — it is here to make the diff obvious in test output.
  eq(codeRoutes.length, 128, `expected 128 registered routes (v427: +2 — POST /api/track-record/redacted-proof-bundle + verify); if this changed, check the drift list above`);
});

test("ROUTE TRUTH: spec has at least 53 documented operationIds (contract baseline)", () => {
  const spec = readFileSync(SPEC_PATH, "utf8");
  const opIds = [...spec.matchAll(/operationId:\s*(\w+)/g)].map((m) => m[1]);
  assert(opIds.length >= 53, `expected >= 53 operationIds, got ${opIds.length}`);
});

test("ROUTE TRUTH: no duplicate keys in code (same method+path registered twice)", () => {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of codeRoutes) {
    const k = key(r);
    if (seen.has(k)) dups.push(k);
    seen.add(k);
  }
  eq(dups.length, 0, `duplicate route registrations: ${dups.join(", ")}`);
});

test("ROUTE TRUTH: no duplicate keys in spec (same method+path declared twice)", () => {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const r of specRoutes) {
    const k = specKey(r);
    if (seen.has(k)) dups.push(k);
    seen.add(k);
  }
  eq(dups.length, 0, `duplicate spec entries: ${dups.join(", ")}`);
});

// Edge-case / fail-closed: allowlists must not contradict reality.
test("ROUTE TRUTH: KNOWN_MISSING entries are not accidentally in spec", () => {
  const contradictions = [...KNOWN_MISSING].filter((k) => specKeys.has(k));
  eq(contradictions.length, 0, `KNOWN_MISSING contains routes that ARE in spec: ${contradictions.join(", ")}`);
});

test("ROUTE TRUTH: KNOWN_STALE entries are not accidentally in code", () => {
  const contradictions = [...KNOWN_STALE].filter((k) => codeKeys.has(k));
  eq(contradictions.length, 0, `KNOWN_STALE contains routes that ARE in code: ${contradictions.join(", ")}`);
});

// Canary: net unique operations should be within reasonable bounds
test("ROUTE TRUTH: total unique operations is within expected bounds", () => {
  const total = new Set([...codeKeys, ...specKeys]).size;
  assert(total >= 50 && total <= 150, `expected 50–150 unique operations, got ${total}`);
});
