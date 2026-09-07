import "../_flush.mjs";
/**
 * tests/introduction/cross-tenant-introduction.test.ts — Cross-tenant introduction step 1 (K8).
 *
 * Coverage:
 *   Happy path:
 *     • POST /api/introduction/request returns 201 with signed request
 *     • signature is non-empty and verifiable by the kernel signer
 *   Edge cases / validation:
 *     • missing targetTenantId → 400
 *     • missing proofTarget → 400
 *     • invalid proofTarget.kind → 400
 *     • missing proofTarget.identityId → 400
 *   Fail-closed:
 *     • missing x-tenant-id → 400
 *     • tampered payload breaks signature verification
 *   Tenant isolation:
 *     • list/get only returns requests for the source tenant
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { canonicalize } from "../../src/routes/introduction-routes.ts";

function makeStack() {
  return buildSovereignStack(undefined, { provider: new InMemoryLedger() });
}

async function httpPost(port: number, path: string, tenantId: string | undefined, body: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tenantId !== undefined) headers["x-tenant-id"] = tenantId;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── Server setup (all tests registered after await so harness collects them) ──

const stack = makeStack();
const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
const port = (server.address() as any).port as number;
server.unref();
await new Promise((r) => setTimeout(r, 50));

// ── Unit tests ────────────────────────────────────────────────────────────────

test("canonicalize: stable key order for signing", () => {
  const result = canonicalize({ b: 2, a: 1 });
  eq(result, '{"a":1,"b":2}');
});

// ── HTTP integration tests ──────────────────────────────────────────────────

test("POST /api/introduction/request → 201 with signed request", async () => {
  const r = await httpPost(port, "/api/introduction/request", "tenant-a", {
    targetTenantId: "tenant-b",
    proofTarget: { kind: "track-record", identityId: "actor-123" },
  });
  eq(r.status, 201);
  const body = r.body as any;
  assert(body.id && typeof body.id === "string", "should have id");
  eq(body.sourceTenantId, "tenant-a");
  eq(body.targetTenantId, "tenant-b");
  eq(body.proofTarget.kind, "track-record");
  eq(body.proofTarget.identityId, "actor-123");
  assert(typeof body.signature === "string" && body.signature.length > 0, "should have signature");
  assert(typeof body.createdAt === "string", "should have createdAt");
});

test("signature is verifiable by the kernel signer", async () => {
  const r = await httpPost(port, "/api/introduction/request", "tenant-a", {
    targetTenantId: "tenant-b",
    proofTarget: { kind: "passport", identityId: "actor-456" },
  });
  eq(r.status, 201);
  const body = r.body as any;
  const { signature, ...payload } = body;
  const canonical = canonicalize(payload);
  assert(stack.signer.verify(canonical, signature), "signature should verify");
});

test("tampered payload breaks signature verification", async () => {
  const r = await httpPost(port, "/api/introduction/request", "tenant-a", {
    targetTenantId: "tenant-b",
    proofTarget: { kind: "track-record", identityId: "actor-789" },
  });
  eq(r.status, 201);
  const body = r.body as any;
  const { signature, ...payload } = body;
  payload.targetTenantId = "evil-tenant";
  const canonical = canonicalize(payload);
  assert(!stack.signer.verify(canonical, signature), "tampered payload should fail verification");
});

test("POST /api/introduction/request: missing targetTenantId → 400", async () => {
  const r = await httpPost(port, "/api/introduction/request", "tenant-a", {
    proofTarget: { kind: "track-record", identityId: "actor-123" },
  });
  eq(r.status, 400);
  eq((r.body as any).error, "targetTenantId (string) is required");
});

test("POST /api/introduction/request: missing proofTarget → 400", async () => {
  const r = await httpPost(port, "/api/introduction/request", "tenant-a", {
    targetTenantId: "tenant-b",
  });
  eq(r.status, 400);
  eq((r.body as any).error, "proofTarget must be an object");
});

test("POST /api/introduction/request: invalid proofTarget.kind → 400", async () => {
  const r = await httpPost(port, "/api/introduction/request", "tenant-a", {
    targetTenantId: "tenant-b",
    proofTarget: { kind: "unknown", identityId: "actor-123" },
  });
  eq(r.status, 400);
  eq((r.body as any).error, 'proofTarget.kind must be "track-record" or "passport"');
});

test("POST /api/introduction/request: missing proofTarget.identityId → 400", async () => {
  const r = await httpPost(port, "/api/introduction/request", "tenant-a", {
    targetTenantId: "tenant-b",
    proofTarget: { kind: "track-record", identityId: "" },
  });
  eq(r.status, 400);
  eq((r.body as any).error, "proofTarget.identityId must be a non-empty string");
});

test("POST /api/introduction/request: missing x-tenant-id → 400", async () => {
  const r = await httpPost(port, "/api/introduction/request", undefined, {
    targetTenantId: "tenant-b",
    proofTarget: { kind: "track-record", identityId: "actor-123" },
  });
  eq(r.status, 400);
});

test("tenant isolation: list only returns requests for the source tenant", async () => {
  // Create two requests for different source tenants
  const r1 = await httpPost(port, "/api/introduction/request", "tenant-iso-a", {
    targetTenantId: "tenant-b",
    proofTarget: { kind: "track-record", identityId: "actor-a" },
  });
  eq(r1.status, 201);
  const r2 = await httpPost(port, "/api/introduction/request", "tenant-iso-c", {
    targetTenantId: "tenant-d",
    proofTarget: { kind: "passport", identityId: "actor-c" },
  });
  eq(r2.status, 201);

  // list for tenant-iso-a should only contain tenant-iso-a's request
  const listA = stack.introductionStore.list("tenant-iso-a");
  eq(listA.length, 1);
  eq(listA[0].sourceTenantId, "tenant-iso-a");

  // list for tenant-iso-c should only contain tenant-iso-c's request
  const listC = stack.introductionStore.list("tenant-iso-c");
  eq(listC.length, 1);
  eq(listC[0].sourceTenantId, "tenant-iso-c");

  // get with wrong tenant returns null
  const reqA = listA[0];
  const wrongGet = stack.introductionStore.get(reqA.id, "tenant-iso-c");
  eq(wrongGet, null);

  // get with correct tenant returns the request
  const rightGet = stack.introductionStore.get(reqA.id, "tenant-iso-a");
  assert(rightGet !== null, "should find request for correct tenant");
  eq(rightGet!.id, reqA.id);
});

// ── Target-side inbox (K8 step 2) ─────────────────────────────────────────

async function httpGet(port: number, path: string, tenantId: string | undefined) {
  const headers: Record<string, string> = {};
  if (tenantId !== undefined) headers["x-tenant-id"] = tenantId;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

test("GET /api/introduction/inbox → list only requests sent to target tenant", async () => {
  // Use unique tenant names to avoid collision with earlier tests in shared in-memory store
  const src1 = "inbox-src-1";
  const src2 = "inbox-src-2";
  const src3 = "inbox-src-3";
  const tgtB = "inbox-tgt-b";
  const tgtE = "inbox-tgt-e";

  const r1 = await httpPost(port, "/api/introduction/request", src1, {
    targetTenantId: tgtB,
    proofTarget: { kind: "track-record", identityId: "actor-a" },
  });
  eq(r1.status, 201);
  const r2 = await httpPost(port, "/api/introduction/request", src2, {
    targetTenantId: tgtB,
    proofTarget: { kind: "passport", identityId: "actor-c" },
  });
  eq(r2.status, 201);
  const r3 = await httpPost(port, "/api/introduction/request", src3, {
    targetTenantId: tgtE,
    proofTarget: { kind: "track-record", identityId: "actor-d" },
  });
  eq(r3.status, 201);

  // tgtB inbox should have exactly 2 requests
  const inboxB = await httpGet(port, "/api/introduction/inbox", tgtB);
  eq(inboxB.status, 200);
  const listB = inboxB.body as any[];
  eq(listB.length, 2);
  assert(listB.every((r) => r.targetTenantId === tgtB), "all inbox items should target tgtB");

  // tgtE inbox should have exactly 1 request
  const inboxE = await httpGet(port, "/api/introduction/inbox", tgtE);
  eq(inboxE.status, 200);
  const listE = inboxE.body as any[];
  eq(listE.length, 1);
  eq(listE[0].targetTenantId, tgtE);

  // src1 inbox (as target) should be empty
  const inboxA = await httpGet(port, "/api/introduction/inbox", src1);
  eq(inboxA.status, 200);
  eq((inboxA.body as any[]).length, 0);
});

test("GET /api/introduction/inbox without x-tenant-id → 400", async () => {
  const r = await httpGet(port, "/api/introduction/inbox", undefined);
  eq(r.status, 400);
  const msg = (r.body as any).error;
  assert(
    msg === "x-tenant-id header required" || msg === "x-tenant-id or x-api-key header required",
    `unexpected error message: ${msg}`,
  );
});

test("GET /api/introduction/:id accessible by target tenant", async () => {
  const create = await httpPost(port, "/api/introduction/request", "tenant-src", {
    targetTenantId: "tenant-tgt",
    proofTarget: { kind: "track-record", identityId: "actor-1" },
  });
  eq(create.status, 201);
  const id = (create.body as any).id;

  // target tenant can retrieve
  const getTgt = await httpGet(port, `/api/introduction/${id}`, "tenant-tgt");
  eq(getTgt.status, 200);
  eq((getTgt.body as any).id, id);
  eq((getTgt.body as any).sourceTenantId, "tenant-src");
  eq((getTgt.body as any).targetTenantId, "tenant-tgt");

  // source tenant can also retrieve
  const getSrc = await httpGet(port, `/api/introduction/${id}`, "tenant-src");
  eq(getSrc.status, 200);
  eq((getSrc.body as any).id, id);
});

test("GET /api/introduction/:id by unrelated tenant → 404", async () => {
  const create = await httpPost(port, "/api/introduction/request", "tenant-src", {
    targetTenantId: "tenant-tgt",
    proofTarget: { kind: "passport", identityId: "actor-2" },
  });
  eq(create.status, 201);
  const id = (create.body as any).id;

  // unrelated tenant gets 404 (fail-closed, no leakage)
  const getBad = await httpGet(port, `/api/introduction/${id}`, "tenant-evil");
  eq(getBad.status, 404);
  eq((getBad.body as any).error, "introduction not found or access denied");
});

test("GET /api/introduction/:id with missing x-tenant-id → 400", async () => {
  const r = await httpGet(port, "/api/introduction/intro-123", undefined);
  eq(r.status, 400);
});

test("GET /api/introduction/:id signature verifiable by target tenant", async () => {
  const create = await httpPost(port, "/api/introduction/request", "tenant-src", {
    targetTenantId: "tenant-tgt",
    proofTarget: { kind: "track-record", identityId: "actor-sig" },
  });
  eq(create.status, 201);
  const body = create.body as any;
  const id = body.id;

  // target retrieves and verifies signature
  const getTgt = await httpGet(port, `/api/introduction/${id}`, "tenant-tgt");
  eq(getTgt.status, 200);
  const retrieved = getTgt.body as any;
  const { signature, ...payload } = retrieved;
  const canonical = canonicalize(payload);
  assert(stack.signer.verify(canonical, signature), "target tenant should be able to verify signature");
});

// ── Accept proof bundle (K8 step 3) ─────────────────────────────────────────

async function httpPostAccept(port: number, path: string, tenantId: string | undefined) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tenantId !== undefined) headers["x-tenant-id"] = tenantId;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  return { status: res.status, body: await res.json() };
}

test("POST /api/introduction/:id/accept by target tenant → track-record proof bundle", async () => {
  const create = await httpPost(port, "/api/introduction/request", "tenant-src-accept", {
    targetTenantId: "tenant-tgt-accept",
    proofTarget: { kind: "track-record", identityId: "actor-accept-1" },
  });
  eq(create.status, 201);
  const id = (create.body as any).id;

  const accept = await httpPostAccept(port, `/api/introduction/${id}/accept`, "tenant-tgt-accept");
  eq(accept.status, 200);
  const body = accept.body as any;
  eq(body.accepted, true);
  assert(body.proofBundle, "should return proofBundle");
  eq(body.proofBundle.tenantId, "tenant-src-accept");
  eq(body.proofBundle.identityId, "actor-accept-1");
  eq(body.proofBundle.version, "1");
  assert(typeof body.proofBundle.bundleHash === "string" && body.proofBundle.bundleHash.length > 0, "should have bundleHash");
  // Verify bundle hash integrity
  const { bundleHash, ...rest } = body.proofBundle;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  // We can't easily recompute the exact bundle hash here because the canonicalization
  // in buildTrustProofBundle uses a custom sort function. Instead, verify via the module:
  const { verifyBundleHash } = await import("../../lib/track-record/proof-bundle.ts");
  assert(verifyBundleHash(body.proofBundle), "bundle hash should verify");
});

test("POST /api/introduction/:id/accept: source tenant → 403", async () => {
  const create = await httpPost(port, "/api/introduction/request", "tenant-src-forbid", {
    targetTenantId: "tenant-tgt-forbid",
    proofTarget: { kind: "track-record", identityId: "actor-forbid" },
  });
  eq(create.status, 201);
  const id = (create.body as any).id;

  const accept = await httpPostAccept(port, `/api/introduction/${id}/accept`, "tenant-src-forbid");
  eq(accept.status, 403);
  eq((accept.body as any).error, "only the target tenant can accept");
});

test("POST /api/introduction/:id/accept: unrelated tenant → 404", async () => {
  const create = await httpPost(port, "/api/introduction/request", "tenant-src-unrel", {
    targetTenantId: "tenant-tgt-unrel",
    proofTarget: { kind: "track-record", identityId: "actor-unrel" },
  });
  eq(create.status, 201);
  const id = (create.body as any).id;

  const accept = await httpPostAccept(port, `/api/introduction/${id}/accept`, "tenant-evil-unrel");
  eq(accept.status, 404);
  eq((accept.body as any).error, "introduction not found or access denied");
});

test("POST /api/introduction/:id/accept without x-tenant-id → 400", async () => {
  const r = await httpPostAccept(port, "/api/introduction/intro-123/accept", undefined);
  eq(r.status, 400);
});

test("POST /api/introduction/:id/accept: tampered signature → 403", async () => {
  const create = await httpPost(port, "/api/introduction/request", "tenant-src-tamper", {
    targetTenantId: "tenant-tgt-tamper",
    proofTarget: { kind: "track-record", identityId: "actor-tamper" },
  });
  eq(create.status, 201);
  const id = (create.body as any).id;

  // Tamper the stored request signature in the store
  const stored = stack.introductionStore.getWithAccess(id, "tenant-tgt-tamper");
  assert(stored !== null, "should find stored request");
  (stored as any).signature = "tampered-signature";

  const accept = await httpPostAccept(port, `/api/introduction/${id}/accept`, "tenant-tgt-tamper");
  eq(accept.status, 403);
  eq((accept.body as any).error, "signature verification failed");
});

test("POST /api/introduction/:id/accept: unknown id → 404", async () => {
  const r = await httpPostAccept(port, "/api/introduction/intro-unknown/accept", "tenant-tgt-unknown");
  eq(r.status, 404);
  eq((r.body as any).error, "introduction not found or access denied");
});

test("POST /api/introduction/:id/accept by target tenant → passport (no audit records → 404)", async () => {
  const create = await httpPost(port, "/api/introduction/request", "tenant-src-pass", {
    targetTenantId: "tenant-tgt-pass",
    proofTarget: { kind: "passport", identityId: "actor-pass-no-audit" },
  });
  eq(create.status, 201);
  const id = (create.body as any).id;

  // No audit records exist for this identity, so passport issuance should 404
  const accept = await httpPostAccept(port, `/api/introduction/${id}/accept`, "tenant-tgt-pass");
  eq(accept.status, 404);
  eq((accept.body as any).error, "no passport record found for identity");
});

test("cleanup: close server", () => { server.close(); });
