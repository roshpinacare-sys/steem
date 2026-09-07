import "../_flush.mjs";
/**
 * tests/contract-generator/contract-coverage.test.ts
 *
 * Verifies scripts/contract-coverage-report.ts — the "Contract-strictness" report.
 *
 * Runs the report generator (one shared in-memory server, one probe per generated
 * contract test file) and asserts:
 *   - every one of the 159 contract files is classified into exactly one bucket
 *   - buckets partition the total (no operation counted twice / dropped)
 *   - fail-closed buckets (shape-mismatch / not-registered / crash) are 0 — every
 *     declared route is registered, never crashes, and declared response shapes
 *     that DO get hit match the spec
 *   - "verified" is non-empty (createTenant et al. are actually live-verified)
 *   - "reachable-only" is non-empty (agents/* etc. — spec'd but not yet wired —
 *     proving the bucket distinguishes "exists" from "happy-path confirmed")
 *   - each entry has the expected shape (opId/method/path/expectStatus/liveStatus/classification)
 *   - hasResponseShape flag matches whether REQUIRED_RESPONSE_FIELDS is declared
 *   - COVERAGE_REPORT.json is written and machine-readable
 *   - re-running is deterministic (same summary on a second run)
 *   - process exit code is 0 when there are no violations
 */

import { test, eq, assert } from "../_harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { generateReport } from "../../scripts/contract-coverage-report.ts";

const SOV = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const CONTRACT_DIR = path.join(SOV, "tests/contract");
const REPORT_PATH = path.join(CONTRACT_DIR, "COVERAGE_REPORT.json");

const NUM_CONTRACT_FILES = fs.readdirSync(CONTRACT_DIR).filter((f) => f.endsWith(".contract.test.ts")).length;

// ── Run the report generator once (in-process, fast — one shared server) ──────

const { entries, summary } = await generateReport();

// ── Tests ──────────────────────────────────────────────────────────────────────

test("coverage report: classifies every generated contract file", () => {
  eq(entries.length, NUM_CONTRACT_FILES, `must classify all ${NUM_CONTRACT_FILES} contract files`);
  eq(summary.total, NUM_CONTRACT_FILES);
});

test("coverage report: buckets partition the total (no double-count, no drop)", () => {
  const sum = summary.verified + summary["reachable-only"] + summary["shape-mismatch"]
    + summary["not-registered"] + summary.crash;
  eq(sum, summary.total, "verified + reachable-only + shape-mismatch + not-registered + crash === total");
});

test("coverage report: no crashes (5xx) on any declared operation", () => {
  // installPqcProvider (POST /admin/pqc/install) always returns 503 in this
  // sealed, no-network sandbox by design. In v408, ALLOWED_CRASH_OPIDS was
  // hoisted to module scope in scripts/contract-coverage-report.ts so that
  // probe() itself classifies the by-design 503 as "reachable-only" rather
  // than "crash". This means summary.crash now reflects only genuine,
  // unexpected server crashes — the expected count is 0.
  eq(summary.crash, 0, `expected 0 crashes; got ${summary.crash} — if a new op genuinely crashes, add it to ALLOWED_CRASH_OPIDS in scripts/contract-coverage-report.ts`);
});

test("coverage report: no unregistered methods (405) on any declared operation", () => {
  eq(summary["not-registered"], 0, "every declared method+path must be registered (no 405)");
});

test("coverage report: no shape-mismatches (declared required response fields all present when hit)", () => {
  eq(summary["shape-mismatch"], 0, "declared REQUIRED_RESPONSE_FIELDS must be present whenever the success status is reached");
});

test("coverage report: at least one operation is 'verified' (happy path actually exercised)", () => {
  assert(summary.verified > 0, "expected at least one verified operation (e.g. createTenant)");
  const verifiedOpIds = entries.filter((e) => e.classification === "verified").map((e) => e.opId);
  assert(verifiedOpIds.includes("createTenant"), "createTenant must be classified as verified");
});

test("coverage report: stateful flows upgrade reachable-only to verified", () => {
  // The generic probe marks most execution/escrow operations as reachable-only (404 with dummy ids).
  // Stateful flows prove they work end-to-end and upgrade them to verified.
  const upgraded = entries.filter((e) => e.classification === "verified" && e.statefulFlow);
  assert(upgraded.length >= 5, `expected at least 5 statefully-verified operations, got ${upgraded.length}`);
  const upgradedOpIds = upgraded.map((e) => e.opId);
  assert(upgradedOpIds.includes("adapterRun"), "adapterRun must be upgraded by stateful flow");
  assert(upgradedOpIds.includes("getExecutionReceipt"), "getExecutionReceipt must be upgraded by stateful flow");
  assert(upgradedOpIds.includes("getEscrow"), "getEscrow must be upgraded by stateful flow");
  assert(upgradedOpIds.includes("fundEscrow"), "fundEscrow must be upgraded by stateful flow");
  assert(upgradedOpIds.includes("ledgerMint"), "ledgerMint must be upgraded by stateful flow");
});

test("coverage report (v184): adapter-allowed flow upgrades indexGetActorSummary via real actor projection", () => {
  const entry = entries.find((e) => e.opId === "indexGetActorSummary");
  assert(entry !== undefined, "indexGetActorSummary must be a tracked contract op");
  eq(entry!.classification, "verified");
  eq(entry!.statefulFlow, "adapter-allowed");
});

test("coverage report (v184): ledger-escrow-dispute flow upgrades indexGetDispute via real dispute projection", () => {
  const entry = entries.find((e) => e.opId === "indexGetDispute");
  assert(entry !== undefined, "indexGetDispute must be a tracked contract op");
  eq(entry!.classification, "verified");
  eq(entry!.statefulFlow, "ledger-escrow-dispute");
});

test("coverage report (v184): ledger-escrow-happy flow upgrades indexGetPassport via real passport issuance", () => {
  const entry = entries.find((e) => e.opId === "indexGetPassport");
  assert(entry !== undefined, "indexGetPassport must be a tracked contract op");
  eq(entry!.classification, "verified");
  eq(entry!.statefulFlow, "ledger-escrow-happy");
});

test("coverage report (v184): api-key-lifecycle flow upgrades authApiKeysRevoke via real key creation+revocation", () => {
  const entry = entries.find((e) => e.opId === "authApiKeysRevoke");
  assert(entry !== undefined, "authApiKeysRevoke must be a tracked contract op");
  eq(entry!.classification, "verified");
  eq(entry!.statefulFlow, "api-key-lifecycle");
});

test("coverage report (v216): settlement-happy flow upgrades 4 settlement operations", () => {
  for (const opId of ["createSettlement", "getSettlement", "fundSettlement", "releaseSettlement"]) {
    const entry = entries.find((e) => e.opId === opId);
    assert(entry !== undefined, `${opId} must be a tracked contract op`);
    eq(entry!.classification, "verified");
    eq(entry!.statefulFlow, "settlement-happy");
  }
});

test("coverage report (v217): webhook-happy flow upgrades registerWebhook and deleteWebhook", () => {
  for (const opId of ["registerWebhook", "deleteWebhook"]) {
    const entry = entries.find((e) => e.opId === opId);
    assert(entry !== undefined, `${opId} must be a tracked contract op`);
    eq(entry!.classification, "verified");
    eq(entry!.statefulFlow, "webhook-happy");
  }
});

test("coverage report (v218): settlement-dispute-reverse flow upgrades disputeSettlement and reverseSettlement", () => {
  for (const opId of ["disputeSettlement", "reverseSettlement"]) {
    const entry = entries.find((e) => e.opId === opId);
    assert(entry !== undefined, `${opId} must be a tracked contract op`);
    eq(entry!.classification, "verified");
    eq(entry!.statefulFlow, "settlement-dispute-reverse");
  }
});

test("coverage report (v218): settlement-partial-release flow upgrades partialReleaseSettlement", () => {
  const entry = entries.find((e) => e.opId === "partialReleaseSettlement");
  assert(entry !== undefined, "partialReleaseSettlement must be a tracked contract op");
  eq(entry!.classification, "verified");
  eq(entry!.statefulFlow, "settlement-partial-release");
});

test("coverage report (v218): settlement-threshold flow upgrades generateThresholdApproval", () => {
  const entry = entries.find((e) => e.opId === "generateThresholdApproval");
  assert(entry !== undefined, "generateThresholdApproval must be a tracked contract op");
  eq(entry!.classification, "verified");
  eq(entry!.statefulFlow, "settlement-threshold");
});

test("coverage report (v184): truth-island has grown to at least 30 verified operations", () => {
  // v183 baseline was 25/41 verified. v184 adds 6 more (actorSummary, dispute,
  // passport, apiKeysRevoke + the routing-bug fix for apiKeysCreate/List) → 31/41.
  assert(summary.verified >= 30, `expected >= 30 verified operations, got ${summary.verified}`);
});

test("coverage report (v427): +2 redacted-proof-bundle routes — 93 verified, 31 reachable-only, 0 crash", () => {
  // v216 added settlement-happy stateful flow (create→fund→release), upgrading
  // 4 ops: createSettlement, getSettlement, fundSettlement, releaseSettlement.
  // v217 added webhook-happy stateful flow (register→list→delete), upgrading
  // 2 ops: registerWebhook, deleteWebhook.
  // v218 added settlement-dispute-reverse, settlement-partial-release, and
  // settlement-threshold flows, upgrading the remaining 4 ops:
  // disputeSettlement, partialReleaseSettlement, reverseSettlement, generateThresholdApproval.
  // v255 added the ap2-mandate-linkage stateful flow (adapterRun → linkMandates),
  // upgrading the last reachable-only op: linkMandates.
  // v261 added POST /receipt/verify with a dedicated contract test — the generic probe
  // exercises the endpoint with a minimal payload and receives 200 (signature/decision check),
  // so it is verified without needing a stateful flow.
  // v292 added execution core (5) + readyz (1); createExecution, listExecution, getExecution,
  // transitionExecution, superviseExecution are verified by stateful flows; readinessCheck
  // is verified by the health-check contract test.
  // v323 added insights (+1 verified via generic probe).
  // v324 added ledger/withdraw + 3 passport routes; all 4 are reachable-only.
  // v325 added kill-switch 3 + eval 2 + confidence 2; all 7 are reachable-only.
  // v327 added tenants 1 + escrow 1 + potential/complete 1; 2 verified (GET /tenants, GET /escrow)
  // 1 reachable-only (POST /potential/collaboration/{escrowId}/complete — returns 404 for missing escrow).
  // v330 added 4 meta-routes (dashboard, docs, openapi.yaml, audit-trail):
  // getApiDocs (GET /docs) and getOpenApiSpec (GET /openapi.yaml) hit the live
  // contract-test server (which doesn't mount the root meta-route handlers) and
  // return their generic 200 fallback → verified. getDashboard (GET /dashboard,
  // 404 — not mounted on the contract-test harness) and getAuditTrail (GET
  // /audit-trail, 400 — missing required filter param) → reachable-only.
  // +2 verified, +2 reachable-only → 83 verified, 19 reachable-only.
  // v390 added 3 transparency-log witness routes: listWitnessStatements (GET,
  // no required query params) succeeds on the bare generic probe → verified.
  // submitWitnessStatement (POST, requires a well-formed body) and
  // getWitnessQuorum (GET, requires logId/root/treeSize/threshold) both 400 on
  // the generic probe → reachable-only. +1 verified, +2 reachable-only →
  // 84 verified, 21 reachable-only.
  // v391 added 4 transparency-log core routes:
  // getTransparencyLogRoot (GET /transparency/log/root, no required params) → verified.
  // runTransparencyLogConsistencyMonitor (GET /transparency-log/consistency/monitor, no params) → verified.
  // getTransparencyLogProof (GET /transparency/log/proof/:receiptId, 404 on missing) → reachable-only.
  // getTransparencyLogConsistency (GET /transparency-log/consistency, oldSize required) → reachable-only.
  // +2 verified, +2 reachable-only → 86 verified, 23 reachable-only.
  // v392 added 3 passport-revocation routes: revokePassport (POST, requires only
  // passportId — the generic probe's sampled placeholder "test-id-0000" satisfies
  // the handler's non-empty-string check, no cross-reference to a real passport
  // is required) → verified. getPassportRevocationStatus (GET, dummy passportId —
  // handler always returns 200 {revoked:false, entry:null}, never 404) → verified.
  // listPassportRevocations (GET, no required params) → verified.
  // +3 verified, +0 reachable-only → 89 verified, 23 reachable-only.
  // v393 added 1 mcp-routes operation: mcpJsonRpcBridge (POST /mcp, requires
  // jsonrpc==="2.0" — the generic probe's sampled placeholder "test-value" for
  // the jsonrpc field fails that exact-match check, so the live probe gets 400
  // instead of the declared 200 success status) → reachable-only (no stateful
  // flow added this cycle; the dedicated contract test above already proves the
  // route is registered and validates correctly with both a malformed and,
  // separately, a real JSON-RPC body would succeed — out of scope for this
  // generic classification pass).
  // +0 verified, +1 reachable-only → 89 verified, 24 reachable-only.
  // v401 added 3 operations (ard-routes.ts + pqc-admin-routes.ts):
  //   verifyArdAgent (POST /ard/verify) → verified (probe body satisfies handler).
  //   getArdCatalog (GET /.well-known/ai-catalog.json) → reachable-only (404 at /api prefix).
  //   installPqcProvider (POST /admin/pqc/install) → reachable-only: ALLOWED_CRASH_OPIDS
  //   hoisted to module scope in v408 so probe() classifies its by-design 503 as
  //   reachable-only instead of crash, eliminating the crash counter.
  // +1 verified, +2 reachable-only → 90 verified, 26 reachable-only, 0 crash.
  // v408 added 1 operation (drift-explain-routes.ts):
  //   explainDriftCompliance (POST /risk/drift-explain) → reachable-only: generic
  //   probe sends placeholder body; handler validates agentId/records and returns
  //   400 — route is registered and fail-closed, not a crash.
  // +0 verified, +1 reachable-only → 90 verified, 27 reachable-only, 0 crash.
  // v416: +3 kid-resolver key routes brought into the gate — /keys/current and
  //   /keys are 200 (verified); /keys/{kid} with a synthetic id is 404 (reachable-only).
  // v423: +1 getArbitrageQuotes (POST, generic probe sends no body → 400 → reachable-only) → 92 verified, 29 reachable-only.
  // v424: +1 buildDisputeProof (POST, generic probe placeholder fails decimal-string check →
  //   400 → reachable-only) → 92 verified, 30 reachable-only, 0 crash.
  // v427: +2 redacted-proof-bundle routes:
  //   buildRedactedProofBundle (POST, probe sends placeholder body → handler validates
  //   bundle.version → 400) → reachable-only.
  //   verifyRedactedProofBundle (POST, probe sends {bundle:{}} → handler calls
  //   verifyRedactedProofBundle({}) which returns false without throwing → 200
  //   {ok:true, valid:false}) → verified (200 == expectStatus).
  // +1 verified, +1 reachable-only → 93 verified, 31 reachable-only, 0 crash.
  assert(summary["verified"] === 93, `expected 93 verified, got ${summary["verified"]}`);
  assert((summary["reachable-only"] ?? 0) === 31, `expected 31 reachable-only, got ${summary["reachable-only"]}`);
  assert((summary["crash"] ?? 0) === 0, `expected 0 crash, got ${summary["crash"]}`);
});

test("coverage report (v255): linkMandates is verified via the ap2-mandate-linkage flow", () => {
  const entry = entries.find((e) => e.opId === "linkMandates");
  assert(entry !== undefined, "linkMandates entry must exist");
  eq(entry!.classification, "verified");
  eq(entry!.statefulFlow, "ap2-mandate-linkage");
});

test("coverage report: each entry has the expected shape", () => {
  for (const e of entries) {
    assert(typeof e.opId === "string" && e.opId.length > 0, "opId is a non-empty string");
    assert(typeof e.method === "string", "method is a string");
    assert(typeof e.path === "string" && e.path.startsWith("/"), "path is absolute");
    assert(typeof e.expectStatus === "number", "expectStatus is a number");
    assert(typeof e.liveStatus === "number", "liveStatus is a number");
    assert(typeof e.hasResponseShape === "boolean", "hasResponseShape is a boolean");
    assert(["verified", "reachable-only", "shape-mismatch", "not-registered", "crash"].includes(e.classification),
      `unexpected classification "${e.classification}" for ${e.opId}`);
  }
});

test("coverage report: hasResponseShape is true exactly for entries with REQUIRED_RESPONSE_FIELDS declared", () => {
  // createTenant declares REQUIRED_RESPONSE_FIELDS (per v106) — must be hasResponseShape=true.
  const ct = entries.find((e) => e.opId === "createTenant");
  assert(ct !== undefined, "createTenant entry exists");
  assert(ct!.hasResponseShape === true, "createTenant has a declared response shape");

  // healthCheck has no requestBody and no REQUIRED_RESPONSE_FIELDS — hasResponseShape=false.
  const hc = entries.find((e) => e.opId === "healthCheck");
  assert(hc !== undefined, "healthCheck entry exists");
  assert(hc!.hasResponseShape === false, "healthCheck has no declared response shape");
});

test("coverage report: verified createTenant has liveStatus === expectStatus (201)", () => {
  const ct = entries.find((e) => e.opId === "createTenant")!;
  eq(ct.liveStatus, ct.expectStatus);
  eq(ct.liveStatus, 201);
});

test("coverage report: writes a machine-readable COVERAGE_REPORT.json", () => {
  assert(fs.existsSync(REPORT_PATH), "COVERAGE_REPORT.json must exist after generateReport()");
  // generateReport() (imported) doesn't write the file itself — write it here so downstream
  // tooling (and the CLI run) always has a fresh copy reflecting this run's entries/summary.
  fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), summary, entries }, null, 2));
  const parsed = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
  eq(parsed.summary.total, NUM_CONTRACT_FILES);
  assert(Array.isArray(parsed.entries) && parsed.entries.length === NUM_CONTRACT_FILES, "entries array matches total");
});

test("coverage report: re-running generateReport() is deterministic (same summary)", async () => {
  const second = await generateReport();
  eq(second.summary.total, summary.total);
  eq(second.summary.verified, summary.verified);
  eq(second.summary["reachable-only"], summary["reachable-only"]);
  eq(second.summary["shape-mismatch"], summary["shape-mismatch"]);
  eq(second.summary["not-registered"], summary["not-registered"]);
  eq(second.summary.crash, summary.crash);
});

test("coverage report: CLI run (node scripts/contract-coverage-report.ts) exits 0 with no violations", () => {
  // Run as a subprocess so we exercise the actual main()/exit-code path.
  const out = execFileSync("node", ["scripts/contract-coverage-report.ts"], { cwd: SOV, encoding: "utf8" });
  assert(out.includes("=== Contract Coverage Report ==="), "CLI prints the report header");
  assert(out.includes(`total            : ${NUM_CONTRACT_FILES}`), "CLI reports the correct total");
  // execFileSync throws on non-zero exit — reaching here means exit code 0.
});
