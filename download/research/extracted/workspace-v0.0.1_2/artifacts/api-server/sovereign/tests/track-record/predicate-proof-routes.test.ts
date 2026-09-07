import "../_flush.mjs";
/**
 * tests/track-record/predicate-proof-routes.test.ts
 *
 * Integration tests for:
 *   POST /api/track-record/predicate-proof        — build a selective-disclosure predicate proof
 *   POST /api/track-record/predicate-proof/verify — verify a predicate proof
 *
 * HAPPY        build returns a valid PredicateProof; verify returns { valid: true }.
 * EDGE         threshold as numeric string; allBelowThreshold=false (not-all-below);
 *              minCount == leafHashes.length (boundary); signerId defaults correctly.
 * FAIL-CLOSED  missing tenantId → 400; missing required fields → 400;
 *              threshold=0 → 400; non-boolean allBelowThreshold → 400;
 *              tampered proof → verify returns { valid: false } (not an error).
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { createHash } from "node:crypto";
import type { Server } from "node:http";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const UNLIMITED = { windowMs: 60_000, maxRequests: 10_000 };

function makeServer(): { server: Server; port: number } {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false, rateLimit: UNLIMITED });
  server.unref();
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("Server did not bind");
  return { server, port: addr.port };
}

function makeLeaf(id: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${id}`).digest("hex");
}

const LEAF_HASHES = [
  makeLeaf("action-1", "salt-a"),
  makeLeaf("action-2", "salt-b"),
  makeLeaf("action-3", "salt-c"),
  makeLeaf("action-4", "salt-d"),
  makeLeaf("action-5", "salt-e"),
];

const TENANT = "predicate-proof-route-tenant";

async function post(port: number, path: string, body: unknown, tenant = TENANT) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-tenant-id": tenant },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("happy: build returns a well-formed PredicateProof", async () => {
  const { port } = makeServer();
  const res = await post(port, "/api/track-record/predicate-proof", {
    identityId: "agent-001",
    leafHashes: LEAF_HASHES,
    threshold: "500000",        // 500_000 micro-cents
    allBelowThreshold: true,
    minCount: 3,
  });
  eq(res.status, 200);
  eq(res.body.ok, true);
  const proof = res.body.proof;
  assert(proof && typeof proof === "object", "proof must be an object");
  eq(proof.version, "tfa-predicate-proof-v1");
  eq(proof.identityId, "agent-001");
  eq(proof.tenantId, TENANT);
  assert(typeof proof.signature === "string" && proof.signature.length > 0, "signature present");
  assert(Array.isArray(proof.witnesses) && proof.witnesses.length > 0, "witnesses present");
});

test("happy: build then verify round-trip returns { valid: true }", async () => {
  const { port } = makeServer();
  const build = await post(port, "/api/track-record/predicate-proof", {
    identityId: "agent-002",
    leafHashes: LEAF_HASHES,
    threshold: "1000000",
    allBelowThreshold: true,
    minCount: 2,
  });
  eq(build.status, 200);
  const verify = await post(port, "/api/track-record/predicate-proof/verify", {
    proof: build.body.proof,
  });
  eq(verify.status, 200);
  eq(verify.body.ok, true);
  eq(verify.body.valid, true);
});

test("edge: threshold supplied as numeric string (BigInt parsing path)", async () => {
  const { port } = makeServer();
  const res = await post(port, "/api/track-record/predicate-proof", {
    identityId: "agent-003",
    leafHashes: LEAF_HASHES.slice(0, 2),
    threshold: "9999999999",    // large value, still a valid numeric string
    allBelowThreshold: false,   // not-all-below is also a valid claim
    minCount: 1,
  });
  eq(res.status, 200);
  eq(res.body.ok, true);
  eq(res.body.proof.allBelowThreshold, false);
});

test("edge: minCount == leafHashes.length (boundary — every leaf must contribute)", async () => {
  const { port } = makeServer();
  const res = await post(port, "/api/track-record/predicate-proof", {
    identityId: "agent-004",
    leafHashes: LEAF_HASHES,
    threshold: "250000",
    allBelowThreshold: true,
    minCount: LEAF_HASHES.length,   // exactly all leaves
  });
  eq(res.status, 200);
  eq(res.body.ok, true);
});

test("edge: signerId defaults when omitted (kernel kid used)", async () => {
  const { port } = makeServer();
  const res = await post(port, "/api/track-record/predicate-proof", {
    identityId: "agent-005",
    leafHashes: LEAF_HASHES.slice(0, 1),
    threshold: "100",
    allBelowThreshold: true,
    minCount: 1,
    // signerId intentionally omitted
  });
  eq(res.status, 200);
  eq(res.body.ok, true);
  assert(typeof res.body.proof.signerId === "string" && res.body.proof.signerId.length > 0,
    "signerId is set from stack default");
});

test("edge: tampered proof → verify returns { valid: false } (not an error)", async () => {
  const { port } = makeServer();
  const build = await post(port, "/api/track-record/predicate-proof", {
    identityId: "agent-006",
    leafHashes: LEAF_HASHES,
    threshold: "500000",
    allBelowThreshold: true,
    minCount: 2,
  });
  eq(build.status, 200);
  const tampered = { ...build.body.proof, signature: "deadbeef".repeat(8) };
  const verify = await post(port, "/api/track-record/predicate-proof/verify", { proof: tampered });
  eq(verify.status, 200);
  eq(verify.body.ok, true);
  eq(verify.body.valid, false);
});

test("fail-closed: missing x-tenant-id → 400", async () => {
  const { port } = makeServer();
  const res = await fetch(`http://127.0.0.1:${port}/api/track-record/predicate-proof`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identityId: "x", leafHashes: LEAF_HASHES, threshold: "1", allBelowThreshold: true, minCount: 1 }),
  });
  eq(res.status, 400);
});

test("fail-closed: missing identityId → 400", async () => {
  const { port } = makeServer();
  const res = await post(port, "/api/track-record/predicate-proof", {
    leafHashes: LEAF_HASHES, threshold: "1000", allBelowThreshold: true, minCount: 1,
  });
  eq(res.status, 400);
});

test("fail-closed: empty leafHashes → 400", async () => {
  const { port } = makeServer();
  const res = await post(port, "/api/track-record/predicate-proof", {
    identityId: "agent-007", leafHashes: [], threshold: "1000", allBelowThreshold: true, minCount: 1,
  });
  eq(res.status, 400);
});

test("fail-closed: threshold=0 → 400 (must be > 0)", async () => {
  const { port } = makeServer();
  const res = await post(port, "/api/track-record/predicate-proof", {
    identityId: "agent-008", leafHashes: LEAF_HASHES, threshold: "0", allBelowThreshold: true, minCount: 1,
  });
  eq(res.status, 400);
});

test("fail-closed: non-boolean allBelowThreshold → 400", async () => {
  const { port } = makeServer();
  const res = await post(port, "/api/track-record/predicate-proof", {
    identityId: "agent-009", leafHashes: LEAF_HASHES, threshold: "1000",
    allBelowThreshold: "yes",   // string instead of boolean
    minCount: 1,
  });
  eq(res.status, 400);
});

test("fail-closed: missing proof body in verify → 400", async () => {
  const { port } = makeServer();
  const res = await post(port, "/api/track-record/predicate-proof/verify", { notAProof: true });
  eq(res.status, 400);
});
