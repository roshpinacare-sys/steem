import "../_flush.mjs";
/**
 * tests/track-record/redacted-proof-bundle-routes.test.ts
 *
 * Integration tests for:
 *   POST /api/track-record/redacted-proof-bundle        — build a redacted proof bundle
 *   POST /api/track-record/redacted-proof-bundle/verify — verify a redacted bundle
 *
 * HAPPY        build round-trips to a version-"2r" redacted bundle with correct fields;
 *              verify returns { valid: true } for an unmodified bundle.
 * EDGE         bundle with empty arrays produces zero-count commitments but valid hash;
 *              cross-tenant bundle is rejected 403.
 * FAIL-CLOSED  missing x-tenant-id → 400; missing bundle field → 400; wrong bundle
 *              version → 400; tampered hash → verify returns { valid: false }.
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { buildTrustProofBundleV2 } from "../../lib/track-record/proof-bundle-v2.ts";
import type { Server } from "node:http";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const UNLIMITED = { windowMs: 60_000, maxRequests: 10_000 };
const TENANT = "redacted-proof-route-tenant";

function makeServer(): { server: Server; port: number } {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false, rateLimit: UNLIMITED });
  server.unref();
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("Server did not bind");
  return { server, port: addr.port };
}

async function post(port: number, path: string, body: unknown, tenant = TENANT) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed as Record<string, unknown> };
}

/** Build a minimal valid TrustProofBundleV2 for testing. */
function makeFullBundle(tenantId = TENANT) {
  return buildTrustProofBundleV2({
    tenantId,
    identityId: "agent-redacted-test",
    record: {
      settledAsWorker: 5, settledAsClient: 2, denied: 1, challenged: 0,
      reputationScore: 88, explanation: "test record", lastUpdatedMs: Date.now(),
    },
    passports: [],
    signerKeys: [],
    evidenceManifest: [],
    approvalRefs: [],
    ledgerRefs: [],
    policyRefs: [],
    validForMs: 86_400_000, // 24 h
  });
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

test("redacted-proof-bundle route: POST /build returns version-2r bundle with correct structure", async () => {
  const { server, port } = makeServer();
  try {
    const fullBundle = makeFullBundle();
    const { status, body } = await post(port, "/api/track-record/redacted-proof-bundle", { bundle: fullBundle });
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok === true, "ok must be true");
    const r = body.redacted as Record<string, unknown>;
    assert(r !== undefined, "redacted must be present");
    eq(r.version, "2r");
    eq(r.tenantId, TENANT);
    eq(r.identityId, "agent-redacted-test");
    assert(typeof r.redactedBundleHash === "string" && (r.redactedBundleHash as string).length === 64, "redactedBundleHash is 64-hex");
    assert(typeof r.originalBundleHash === "string" && (r.originalBundleHash as string).length === 64, "originalBundleHash preserved");
    assert(r.record !== undefined, "record preserved");
    const rd = r.redacted as Record<string, Record<string, unknown>>;
    assert(rd !== undefined, "redacted.redacted commitments present");
    for (const key of ["passports", "signerKeys", "evidenceManifest", "approvalRefs", "ledgerRefs", "policyRefs"]) {
      const entry = rd[key];
      assert(entry !== undefined, `commitment for ${key} must exist`);
      assert(typeof entry.sha256 === "string" && (entry.sha256 as string).length === 64, `${key}.sha256 is 64-hex`);
      eq(entry.count, 0); // all arrays empty in this fixture
    }
  } finally { server.close(); }
});

test("redacted-proof-bundle route: build then verify round-trip returns valid: true", async () => {
  const { server, port } = makeServer();
  try {
    const fullBundle = makeFullBundle();
    const buildRes = await post(port, "/api/track-record/redacted-proof-bundle", { bundle: fullBundle });
    eq(buildRes.status, 200);
    const redacted = buildRes.body.redacted;

    const verifyRes = await post(port, "/api/track-record/redacted-proof-bundle/verify", { bundle: redacted });
    eq(verifyRes.status, 200, `verify status ${verifyRes.status}: ${JSON.stringify(verifyRes.body)}`);
    assert(verifyRes.body.ok === true, "ok must be true");
    assert(verifyRes.body.valid === true, "valid must be true for unmodified bundle");
  } finally { server.close(); }
});

// ─── EDGE ─────────────────────────────────────────────────────────────────────

test("redacted-proof-bundle route: originalBundleHash matches full bundle's bundleHash", async () => {
  const { server, port } = makeServer();
  try {
    const fullBundle = makeFullBundle();
    const buildRes = await post(port, "/api/track-record/redacted-proof-bundle", { bundle: fullBundle });
    eq(buildRes.status, 200);
    const r = buildRes.body.redacted as Record<string, unknown>;
    eq(r.originalBundleHash, fullBundle.bundleHash, "originalBundleHash must equal full bundle's bundleHash");
  } finally { server.close(); }
});

test("redacted-proof-bundle route: cross-tenant bundle is rejected 403", async () => {
  const { server, port } = makeServer();
  try {
    // Bundle created for tenant-other, but caller presents tenant TENANT.
    const foreignBundle = makeFullBundle("tenant-other");
    const { status } = await post(port, "/api/track-record/redacted-proof-bundle", { bundle: foreignBundle });
    eq(status, 403, "cross-tenant bundle must be rejected with 403");
  } finally { server.close(); }
});

// ─── FAIL-CLOSED ──────────────────────────────────────────────────────────────

test("redacted-proof-bundle route: missing x-tenant-id → 400", async () => {
  const { server, port } = makeServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/track-record/redacted-proof-bundle`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // no x-tenant-id
      body: JSON.stringify({ bundle: makeFullBundle() }),
    });
    eq(res.status, 400, "missing x-tenant-id must be rejected");
  } finally { server.close(); }
});

test("redacted-proof-bundle route: missing bundle field → 400", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await post(port, "/api/track-record/redacted-proof-bundle", {});
    eq(status, 400, "missing bundle must be rejected");
  } finally { server.close(); }
});

test("redacted-proof-bundle route: wrong bundle version → 400", async () => {
  const { server, port } = makeServer();
  try {
    const badBundle = { ...makeFullBundle(), version: "1" };
    const { status, body } = await post(port, "/api/track-record/redacted-proof-bundle", { bundle: badBundle });
    eq(status, 400, `wrong version must be rejected, got: ${JSON.stringify(body)}`);
  } finally { server.close(); }
});

test("redacted-proof-bundle verify route: tampered hash returns valid: false (not an error)", async () => {
  const { server, port } = makeServer();
  try {
    const fullBundle = makeFullBundle();
    const buildRes = await post(port, "/api/track-record/redacted-proof-bundle", { bundle: fullBundle });
    eq(buildRes.status, 200);
    // Tamper: flip one character of the redactedBundleHash.
    const redacted = { ...(buildRes.body.redacted as Record<string, unknown>) };
    const origHash = redacted.redactedBundleHash as string;
    redacted.redactedBundleHash = origHash[0] === "a" ? "b" + origHash.slice(1) : "a" + origHash.slice(1);

    const verifyRes = await post(port, "/api/track-record/redacted-proof-bundle/verify", { bundle: redacted });
    eq(verifyRes.status, 200, "tampered bundle must still return 200");
    assert(verifyRes.body.ok === true, "ok must be true");
    assert(verifyRes.body.valid === false, "valid must be false for tampered bundle");
  } finally { server.close(); }
});

test("redacted-proof-bundle verify route: missing x-tenant-id → 400", async () => {
  const { server, port } = makeServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/track-record/redacted-proof-bundle/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bundle: {} }),
    });
    eq(res.status, 400);
  } finally { server.close(); }
});

test("redacted-proof-bundle verify route: cross-tenant bundle is rejected 403", async () => {
  const { server, port } = makeServer();
  try {
    const fullBundle = makeFullBundle();
    const buildRes = await post(port, "/api/track-record/redacted-proof-bundle", { bundle: fullBundle });
    eq(buildRes.status, 200);
    const redacted = { ...(buildRes.body.redacted as Record<string, unknown>), tenantId: "tenant-other" };
    const { status } = await post(port, "/api/track-record/redacted-proof-bundle/verify", { bundle: redacted });
    eq(status, 403, "cross-tenant verify must be rejected 403");
  } finally { server.close(); }
});
