import "../_flush.mjs";
/**
 * tests/contract-generator/gen-contract-tests.generator.test.ts
 *
 * Unit tests for the upgraded gen-contract-tests.mjs (v2: payload extraction).
 *
 * Verifies:
 *   - Generator produces 3-test files for requestBody operations
 *   - Minimal payloads are correctly extracted from OpenAPI schema
 *   - PAYLOAD constant contains correct typed sample values
 *   - No-requestBody operations still produce 2-test files
 *   - Payload test block is semantically correct (acceptable statuses set)
 *   - Re-generation is idempotent (running twice produces identical output)
 *
 * Zero external deps — reads generated files from tests/contract/.
 */

import { test, eq, assert } from "../_harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const SOV  = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const CONT = path.join(SOV, "tests/contract");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readContract(opId) {
  const f = path.join(CONT, opId + ".contract.test.ts");
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, "utf8");
}

function countTests(src) {
  return (src.match(/^test\(/gm) || []).length;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("generator: createTenant (requestBody, no required fields; response has required[]) → 4 tests", () => {
  const src = readContract("createTenant");
  assert(src !== null, "createTenant.contract.test.ts must exist");
  eq(countTests(src), 4, "must have 4 tests: declared + reachable + valid-payload + response-shape");
});

test("generator: createTenant payload is empty object (all fields optional)", () => {
  const src = readContract("createTenant");
  assert(src.includes("const PAYLOAD = {};"), "PAYLOAD must be {} — no required fields in createTenant requestBody");
});

test("generator: createTenant has payload test with 201 in acceptable set", () => {
  const src = readContract("createTenant");
  assert(src.includes("accepts valid payload (201 or known client error)"), "payload test description mentions 201");
  assert(src.includes("201"), "201 must appear in the acceptable status set");
});

test("generator: adapterRun (requestBody, required: actorId+toolId+resourceRef+riskClass) → 4 tests", () => {
  const src = readContract("adapterRun");
  assert(src !== null, "adapterRun.contract.test.ts must exist");
  eq(countTests(src), 4, "must have 4 tests");
});

test("generator: adapterRun PAYLOAD has actorId and toolId with typed samples", () => {
  const src = readContract("adapterRun");
  assert(src.includes("test-id-0000"), "actorId/toolId fields must use id sample value");
  assert(src.includes("test-value"), "resourceRef field must use string sample value");
});

test("generator: adapterRun payload test includes 201 in acceptable statuses", () => {
  const src = readContract("adapterRun");
  assert(src.includes("accepts valid payload (201 or known client error)"), "payload test describes expected status");
});

test("generator: authApiKeysCreate (requestBody, required: name, has security) → 4 tests", () => {
  // authApiKeysCreate has response-schema required [ok, key, secret] → 4th shape test generated.
  const src = readContract("authApiKeysCreate");
  assert(src !== null, "authApiKeysCreate.contract.test.ts must exist");
  eq(countTests(src), 4, "4 tests: declared + reachable + valid-payload + response-shape");
});

test("generator: authApiKeysCreate PAYLOAD has name field", () => {
  const src = readContract("authApiKeysCreate");
  assert(src.includes("\"name\""), "name field in PAYLOAD");
});

test("generator: adapterRun PAYLOAD has required fields", () => {
  const src = readContract("adapterRun");
  assert(src !== null, "adapterRun.contract.test.ts must exist");
  assert(src.includes("\"actorId\""), "actorId field in PAYLOAD");
  assert(src.includes("\"toolId\""), "toolId field in PAYLOAD");
  assert(src.includes("\"resourceRef\""), "resourceRef field in PAYLOAD");
  assert(src.includes("\"riskClass\""), "riskClass field in PAYLOAD");
});

test("generator: operation without requestBody → 2 tests (declared + reachable)", () => {
  // healthCheck has no requestBody
  const src = readContract("healthCheck");
  assert(src !== null, "healthCheck.contract.test.ts must exist");
  eq(countTests(src), 2, "no requestBody → exactly 2 tests");
  assert(src.includes("// No requestBody defined"), "no-requestBody comment present");
  assert(!src.includes("const PAYLOAD"), "no PAYLOAD constant for no-requestBody operation");
});

test("generator: reachable test for requestBody op includes body in fetch", () => {
  const src = readContract("adapterRun");
  // The reachable test should now include body: JSON.stringify(PAYLOAD)
  const reachableBlock = src.split("is reachable")[1]?.split("test(")[0] || "";
  assert(reachableBlock.includes("JSON.stringify(PAYLOAD)"), "reachable test must send payload body");
});

test("generator: payload test uses different tenant-id to avoid state collision", () => {
  const src = readContract("createTenant");
  // payload test uses 'contract-test-tenant-payload' (different from 'contract-test-tenant')
  assert(src.includes("contract-test-tenant-payload"), "payload test uses separate tenant-id");
});

test("generator: all contract test files are AUTO-GENERATED (except sovereign-new-endpoints-live)", () => {
  const files = fs.readdirSync(CONT).filter(f => f.endsWith(".contract.test.ts"));
  const notGenerated = files.filter(f => {
    const src = fs.readFileSync(path.join(CONT, f), "utf8");
    return !src.includes("AUTO-GENERATED");
  });
  // Only the manual file should not have AUTO-GENERATED
  eq(notGenerated.length, 0,
    `unexpected non-auto-generated files: ${notGenerated.join(", ")}`);
});

test("generator: re-generation is idempotent (running twice produces same output)", () => {
  const src1 = readContract("createTenant");
  // Re-run generator
  execSync("node scripts/gen-contract-tests.mjs", {
    cwd: SOV,
    stdio: "pipe",
  });
  const src2 = readContract("createTenant");
  eq(src1, src2, "re-generated createTenant must be identical");
});

test("generator: payload acceptable set includes 404 (missing resource returns 404)", () => {
  // adapterRun may return 400 for invalid intent; 404 is in the acceptable set for any requestBody op
  const src = readContract("adapterRun");
  const payloadTest = src.split("accepts valid payload")[1] || "";
  assert(payloadTest.includes("404"), "404 must be in acceptable statuses (handles missing resources)");
});

test("generator: approveExecution (requestBody) → PAYLOAD present", () => {
  const src = readContract("approveExecution");
  assert(src !== null, "approveExecution.contract.test.ts must exist");
  eq(countTests(src), 4, "requestBody op with response required → 4 tests");
});

// ─── v3: response-shape (responses[successStatus].schema.required) ───────────

test("generator: createTenant REQUIRED_RESPONSE_FIELDS matches spec [ok, tenantId, plan, created]", () => {
  const src = readContract("createTenant");
  assert(src.includes('const REQUIRED_RESPONSE_FIELDS = ["ok","tenantId","plan","created"];'),
    "REQUIRED_RESPONSE_FIELDS must be exactly [ok, tenantId, plan, created]");
});

test("generator: createTenant response-shape test only asserts on the declared success status (201)", () => {
  const src = readContract("createTenant");
  const block = src.split("response shape")[1] || "";
  assert(block.includes("if (res.status !== 201) return;"),
    "response-shape test must early-return when status !== success status");
});

test("generator: authApiKeysCreate (response required: [ok, key, secret]) → 4 tests", () => {
  const src = readContract("authApiKeysCreate");
  assert(src !== null, "authApiKeysCreate.contract.test.ts must exist");
  eq(countTests(src), 4, "must have 4 tests: declared + reachable + valid-payload + response-shape");
});

test("generator: authApiKeysCreate REQUIRED_RESPONSE_FIELDS matches spec [ok, key, secret]", () => {
  const src = readContract("authApiKeysCreate");
  assert(src.includes('const REQUIRED_RESPONSE_FIELDS = ["ok","key","secret"];'),
    "REQUIRED_RESPONSE_FIELDS must be exactly [ok, key, secret]");
});

test("generator: operation without requestBody and without response-schema required → 2 tests", () => {
  // getPotentialPersonality has no requestBody and its response declares no `required:` schema.
  const src = readContract("getPotentialPersonality");
  assert(src !== null, "getPotentialPersonality.contract.test.ts must exist");
  eq(countTests(src), 2, "no requestBody and no response-schema required → exactly 2 tests");
  assert(!src.includes("REQUIRED_RESPONSE_FIELDS"), "no REQUIRED_RESPONSE_FIELDS constant when response has no required[]");
});

test("generator: no-requestBody operation (healthCheck) is unaffected by response-shape feature", () => {
  const src = readContract("healthCheck");
  eq(countTests(src), 2, "healthCheck stays at 2 tests");
  assert(!src.includes("REQUIRED_RESPONSE_FIELDS"), "healthCheck has no response-shape test");
});

test("generator: response-shape test uses a distinct tenant-id (contract-test-tenant-shape)", () => {
  const src = readContract("createTenant");
  assert(src.includes("contract-test-tenant-shape"), "response-shape test uses its own tenant-id to avoid state collisions");
});

test("generator: re-generation is idempotent for response-shape ops too (createTenant)", () => {
  const src1 = readContract("createTenant");
  execSync("node scripts/gen-contract-tests.mjs", { cwd: SOV, stdio: "pipe" });
  const src2 = readContract("createTenant");
  eq(src1, src2, "re-generated createTenant (with response-shape test) must be identical");
});

test("generator: exactly 111 operations across the spec declare response-schema required fields (v427: +2 redacted-proof-bundle routes)", () => {
  // Count occurrences of REQUIRED_RESPONSE_FIELDS across all generated contract files.
  const files = fs.readdirSync(CONT).filter(f => f.endsWith(".contract.test.ts"));
  let count = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(CONT, f), "utf8");
    if (src.includes("REQUIRED_RESPONSE_FIELDS")) count++;
  }
  // v173: removed all fictional domains (124 ops) → 34 ops with response-schema required remain.
  // v215: settlement + webhook routes added (+12 ops, most with response.required[]) → 46.
  // v261: verifyReceipt added REQUIRED_RESPONSE_FIELDS → 48.
  // v292: execution core (5) + readyz (1) added REQUIRED_RESPONSE_FIELDS → 54.
  // v323: insights added REQUIRED_RESPONSE_FIELDS → 55.
  // v325: +7 (kill-switch 3 + eval 2 + confidence 2) → 66.
  // v327: +3 (tenants 1 + escrow 1 + potential/complete 1) → 74.
  // v328: +14 (marketplace 6 + sovereignty 5 + introduction 4 + track-record proof 2; 3 without) → 88.
  // v330: +1 (audit-trail) → 89.
  // v390: +3 (transparency-log witness submit/quorum/statements, all declare response.required[]) → 92.
  // v391: +4 (transparency-log root/proof/consistency/monitor, all declare response.required[]) → 96.
  // v392: +3 (passport-revocation revoke/status/list, all declare response.required[]) → 99.
  // v393: +1 (mcp JSON-RPC bridge, response.required: [jsonrpc]) → 100.
  // v416: +3 — getCurrentSigningKey, listSigningKeys, getSigningKeyByKid. Their
  //   contract test files already existed but the spec did not declare these
  //   operations, so they were not reconciled by the drift gate until v416.
    // v423: +1 (getArbitrageQuotes, declares response.required[]) → 108.
    // v424: +1 (buildDisputeProof, declares response.required[]) → 109.
  eq(count, 111, "111 operations declare response.required[] in the current spec");
});
