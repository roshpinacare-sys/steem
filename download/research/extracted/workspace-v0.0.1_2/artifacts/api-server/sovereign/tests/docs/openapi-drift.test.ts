import "../_flush.mjs";
/**
 * tests/docs/openapi-drift.test.ts
 *
 * Verifies that lib/api-spec/openapi.yaml is NOT stale relative to the
 * implemented routes that changed in v91-v102. Covers the four drift points
 * fixed in v103:
 *
 *  1. POST /auth/api-keys — requestBody required:true + 201 response schema with
 *     `secret` and `key` fields documented.
 *  2. GET /auth/api-keys — 200 response has `keys` array schema.
 *  3. DELETE /auth/api-keys/:keyId — 400 response code documented + 404 tenant-isolation note.
 *  4. POST /tenants — requestBody with `plan` enum [free,pro] + 200/201 response
 *     includes `plan` field.
 *  5. components.securitySchemes has `apiKeyHeader` (x-api-key in header).
 *  6. Sanity: total operation count = 53 (settlement + webhook routes added in v215).
 *  7. All operationIds referenced by routes that changed are present in the spec.
 *
 * Rules:
 *  • Zero dependencies — node:fs only.
 *  • Does NOT parse YAML (avoids external parsers) — grep on raw text (UTF-8).
 *    The spec is hand-authored YAML; string presence is sufficient for drift detection.
 *  • Does NOT hit a live server (no DB, no network).
 */

import { test, assert, eq } from "../_harness.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(__dirname, "../../lib/api-spec/openapi.yaml");
const spec = readFileSync(SPEC_PATH, "utf-8");

// ─── Helper ──────────────────────────────────────────────────────────────────

function has(pattern: string | RegExp): boolean {
  if (typeof pattern === "string") return spec.includes(pattern);
  return pattern.test(spec);
}

function countOccurrences(needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = spec.indexOf(needle, pos)) !== -1) { count++; pos++; }
  return count;
}

// ─── 1. POST /auth/api-keys — requestBody + response schema ──────────────────

test("OPENAPI DRIFT: POST /auth/api-keys has requestBody with required name field", () => {
  // The fix adds required: [name] inside /auth/api-keys post requestBody
  assert(has("authApiKeysCreate"), "operationId authApiKeysCreate present");
  assert(has(/authApiKeysCreate[\s\S]{0,800}required: \[name\]/), "name is required in requestBody");
});

test("OPENAPI DRIFT: POST /auth/api-keys 201 response documents secret field", () => {
  assert(has(/authApiKeysCreate[\s\S]{0,1200}secret/), "secret field in 201 response schema");
});

test("OPENAPI DRIFT: POST /auth/api-keys 201 response documents key object with keyId", () => {
  assert(has(/authApiKeysCreate[\s\S]{0,1500}keyId/), "keyId in key object of 201 response");
});

test("OPENAPI DRIFT: POST /auth/api-keys has 400 response code", () => {
  // Fix added "400: { description: Missing name or invalid input }"
  assert(has(/authApiKeysCreate[\s\S]{0,1800}"400"/), "400 response on create endpoint");
});

// ─── 2. GET /auth/api-keys — response schema ─────────────────────────────────

test("OPENAPI DRIFT: GET /auth/api-keys 200 response has keys array schema", () => {
  assert(has("authApiKeysList"), "operationId authApiKeysList present");
  assert(has(/authApiKeysList[\s\S]{0,600}keys:/), "keys array in GET response schema");
});

test("OPENAPI DRIFT: GET /auth/api-keys documents tenantId in key item shape", () => {
  // The fixed spec enumerates tenantId as a key item field
  assert(has(/authApiKeysList[\s\S]{0,800}tenantId/), "tenantId in key item schema");
});

// ─── 3. DELETE /auth/api-keys/:keyId — 400 + tenant isolation ────────────────

test("OPENAPI DRIFT: DELETE /auth/api-keys/:keyId has 400 response", () => {
  assert(has("authApiKeysRevoke"), "operationId authApiKeysRevoke present");
  assert(has(/authApiKeysRevoke[\s\S]{0,400}"400"/), "400 response on revoke endpoint");
});

test("OPENAPI DRIFT: DELETE /auth/api-keys/:keyId 404 mentions another tenant", () => {
  assert(has(/authApiKeysRevoke[\s\S]{0,500}another tenant/), "404 note mentions tenant isolation");
});

// ─── 4. POST /tenants — requestBody with plan + response with plan ─────────────

test("OPENAPI DRIFT: POST /tenants has requestBody", () => {
  assert(has("createTenant"), "operationId createTenant present");
  // requestBody appears within 600 chars of operationId (summary is multiline)
  assert(has(/createTenant[\s\S]{0,600}requestBody/), "requestBody present under createTenant");
});

test("OPENAPI DRIFT: POST /tenants requestBody includes plan enum [free, pro]", () => {
  assert(has(/createTenant[\s\S]{0,800}enum: \[free, pro\]/), "plan enum [free, pro] in requestBody");
});

test("OPENAPI DRIFT: POST /tenants 201 response documents plan field", () => {
  assert(has(/createTenant[\s\S]{0,1500}plan:[\s\S]{0,100}enum: \[free, pro\]/), "plan field in 201 response schema");
});

test("OPENAPI DRIFT: POST /tenants 201 response documents created boolean", () => {
  assert(has(/createTenant[\s\S]{0,1800}created:[\s\S]{0,100}boolean/), "created: boolean in 201 response");
});

test("OPENAPI DRIFT: POST /tenants 200 response also documents plan (idempotent update)", () => {
  // The fix adds a 200 response with plan field for repeat calls.
  // 201 schema is ~600 chars, then 200 response follows — needs ~2600 char lookahead.
  assert(has(/createTenant[\s\S]{0,2600}"200"[\s\S]{0,400}plan/), "plan in 200 response too");
});

// ─── 5. apiKeyHeader security scheme ─────────────────────────────────────────

test("OPENAPI DRIFT: components.securitySchemes has apiKeyHeader", () => {
  assert(has("apiKeyHeader:"), "apiKeyHeader security scheme declared");
});

test("OPENAPI DRIFT: apiKeyHeader is type apiKey in header named x-api-key", () => {
  assert(has(/apiKeyHeader:[\s\S]{0,200}type: apiKey/), "apiKeyHeader type is apiKey");
  assert(has(/apiKeyHeader:[\s\S]{0,200}in: header/), "apiKeyHeader in: header");
  assert(has(/apiKeyHeader:[\s\S]{0,300}name: x-api-key/), "apiKeyHeader name is x-api-key");
});

test("OPENAPI DRIFT: auth endpoints reference apiKeyHeader security", () => {
  // At least one of the auth/api-keys operations lists apiKeyHeader as an option
  assert(has(/- apiKeyHeader: \[\]/), "apiKeyHeader: [] referenced in at least one operation");
});

// ─── 6. Sanity — total operationId count ─────────────────────────────────────

test("OPENAPI DRIFT: spec has 124 operationIds (v427: +2 buildRedactedProofBundle + verifyRedactedProofBundle)", () => {
  const count = countOccurrences("operationId:");
  assert(count === 124, `expected 124 operationIds, got ${count}`);
});

// ─── 7. Key operationIds for changed routes ───────────────────────────────────

test("OPENAPI DRIFT: all six operationIds for changed routes are present", () => {
  const required = [
    "authApiKeysCreate",
    "authApiKeysList",
    "authApiKeysRevoke",
    "createTenant",
  ];
  for (const id of required) {
    assert(has(id), `operationId ${id} present in spec`);
  }
});

// ─── 8. Spec file is valid UTF-8 YAML structure (basic sanity) ───────────────

test("OPENAPI DRIFT: spec starts with openapi: 3", () => {
  assert(spec.trimStart().startsWith("openapi: \"3"), "spec starts with openapi: \"3…\"");
});

test("OPENAPI DRIFT: spec has paths: and components: sections", () => {
  assert(has("paths:"), "paths: section present");
  assert(has("components:"), "components: section present");
});
