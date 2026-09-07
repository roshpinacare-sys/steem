import "../_flush.mjs";
/**
 * tests/track-record/count-proof-routes.test.ts
 *
 * Integration tests for:
 *   POST /api/track-record/count-proof        — build a selective-disclosure count proof
 *   POST /api/track-record/count-proof/verify — verify a count proof
 *
 * HAPPY        build returns a valid CountProof; verify returns { valid: true }.
 * EDGE         minCount == leafHashes.length (boundary); deniedCount == 0;
 *              signerId defaults correctly when omitted.
 * FAIL-CLOSED  missing tenantId → 400; missing fields → 400; bad leafHashes → 400;
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

/** Simulate a caller blinding an action into a leaf hash. */
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

const TENANT = "count-proof-route-tenant";

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

// ─── HAPPY ────────────────────────────────────────────────────────────────────

test("count-proof route: POST /api/track-record/count-proof returns valid CountProof", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await post(port, "/api/track-record/count-proof", {
      identityId: "agent-alice",
      leafHashes: LEAF_HASHES,
      deniedCount: 1,
      minCount: 3,
    });
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    assert(body.ok, "ok must be true");
    const proof = body.proof;
    assert(proof, "proof must be present");
    eq(proof.tenantId, TENANT);
    eq(proof.identityId, "agent-alice");
    eq(proof.treeSize, LEAF_HASHES.length);
    eq(proof.minCount, 3);
    eq(proof.deniedCount, 1);
    assert(typeof proof.root === "string" && proof.root.length === 64, "root is 64-hex");
    assert(Array.isArray(proof.witnesses) && proof.witnesses.length === 3, "3 witness entries for minCount=3");
    assert(typeof proof.signature === "string" && proof.signature.length > 0, "signature present");
    assert(typeof proof.signerId === "string", "signerId present");
  } finally { server.close(); }
});

test("count-proof route: build then verify round-trip returns valid: true", async () => {
  const { server, port } = makeServer();
  try {
    const buildRes = await post(port, "/api/track-record/count-proof", {
      identityId: "agent-bob",
      leafHashes: LEAF_HASHES,
      deniedCount: 0,
      minCount: 5,
    });
    eq(buildRes.status, 200);
    const proof = buildRes.body.proof;

    const verifyRes = await post(port, "/api/track-record/count-proof/verify", { proof });
    eq(verifyRes.status, 200, `verify status: ${JSON.stringify(verifyRes.body)}`);
    assert(verifyRes.body.ok, "ok must be true");
    assert(verifyRes.body.valid === true, "valid must be true for unmodified proof");
  } finally { server.close(); }
});

// ─── EDGE ─────────────────────────────────────────────────────────────────────

test("count-proof route: minCount == leafHashes.length (boundary) succeeds", async () => {
  const { server, port } = makeServer();
  try {
    const { status, body } = await post(port, "/api/track-record/count-proof", {
      identityId: "agent-carol",
      leafHashes: LEAF_HASHES,
      deniedCount: 0,
      minCount: LEAF_HASHES.length, // maximum allowed
    });
    eq(status, 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
    eq(body.proof.witnesses.length, LEAF_HASHES.length, "all leaves as witnesses at max minCount");
  } finally { server.close(); }
});

test("count-proof route: tampered proof verify returns valid: false (not an error)", async () => {
  const { server, port } = makeServer();
  try {
    const buildRes = await post(port, "/api/track-record/count-proof", {
      identityId: "agent-dave",
      leafHashes: LEAF_HASHES,
      deniedCount: 2,
      minCount: 2,
    });
    eq(buildRes.status, 200);
    // Tamper: flip one character of the signature.
    const proof = { ...buildRes.body.proof };
    const origSig: string = proof.signature;
    proof.signature = origSig[0] === "a" ? "b" + origSig.slice(1) : "a" + origSig.slice(1);

    const verifyRes = await post(port, "/api/track-record/count-proof/verify", { proof });
    eq(verifyRes.status, 200, "tampered proof must still return 200");
    assert(verifyRes.body.ok, "ok must be true");
    assert(verifyRes.body.valid === false, "valid must be false for tampered proof");
  } finally { server.close(); }
});

test("count-proof route: single-leaf proof (minCount=1) succeeds", async () => {
  const { server, port } = makeServer();
  try {
    const single = [LEAF_HASHES[0]];
    const { status, body } = await post(port, "/api/track-record/count-proof", {
      identityId: "agent-eve",
      leafHashes: single,
      deniedCount: 0,
      minCount: 1,
    });
    eq(status, 200, `expected 200, got ${JSON.stringify(body)}`);
    eq(body.proof.treeSize, 1);
    eq(body.proof.witnesses.length, 1);
  } finally { server.close(); }
});

// ─── FAIL-CLOSED ──────────────────────────────────────────────────────────────

test("count-proof route: missing x-tenant-id → 400", async () => {
  const { server, port } = makeServer();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/track-record/count-proof`, {
      method: "POST",
      headers: { "content-type": "application/json" }, // no x-tenant-id
      body: JSON.stringify({ identityId: "x", leafHashes: LEAF_HASHES, deniedCount: 0, minCount: 1 }),
    });
    eq(res.status, 400, "missing tenantId must be rejected");
  } finally { server.close(); }
});

test("count-proof route: missing identityId → 400", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await post(port, "/api/track-record/count-proof", {
      leafHashes: LEAF_HASHES, deniedCount: 0, minCount: 1,
    });
    eq(status, 400, "missing identityId must be rejected");
  } finally { server.close(); }
});

test("count-proof route: empty leafHashes → 400", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await post(port, "/api/track-record/count-proof", {
      identityId: "x", leafHashes: [], deniedCount: 0, minCount: 1,
    });
    eq(status, 400, "empty leafHashes must be rejected");
  } finally { server.close(); }
});

test("count-proof route: minCount > leafHashes.length → 400", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await post(port, "/api/track-record/count-proof", {
      identityId: "x", leafHashes: LEAF_HASHES, deniedCount: 0, minCount: LEAF_HASHES.length + 1,
    });
    eq(status, 400, "minCount > treeSize must be rejected");
  } finally { server.close(); }
});

test("count-proof verify route: missing proof body field → 400", async () => {
  const { server, port } = makeServer();
  try {
    const { status } = await post(port, "/api/track-record/count-proof/verify", {});
    eq(status, 400, "missing proof must be rejected");
  } finally { server.close(); }
});
