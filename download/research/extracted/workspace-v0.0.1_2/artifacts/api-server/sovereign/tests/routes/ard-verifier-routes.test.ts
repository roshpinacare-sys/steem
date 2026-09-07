import "../_flush.mjs";
/**
 * tests/routes/ard-verifier-routes.test.ts — ARD verifier route integration tests.
 *
 * Coverage:
 *   Happy path:
 *     • POST /api/ard/verify with matching URN + trustManifest → 200 valid=true
 *   Edge cases:
 *     • https identity with matching hostname → 200 valid=true
 *     • no signature → 200 valid=true but jwsValid=null
 *   Fail-closed:
 *     • missing x-tenant-id → 400
 *     • domain mismatch → 200 valid=false
 *     • tampered JWS → 200 valid=false
 *     • malformed URN → 200 valid=false
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { canonicalizeJson } from "../../lib/adapter/ard-publisher.ts";

function makeStack() {
  return buildSovereignStack(undefined, { provider: new InMemoryLedger() });
}

async function httpPost(port: number, path: string, body: unknown, tenantId: string | undefined) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (tenantId !== undefined) headers["x-tenant-id"] = tenantId;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function makeSignedTrustManifest(identity: string, signer: any, extra: any = {}) {
  const { createDetachedJws } = await import("../../lib/adapter/ard-publisher.ts");
  const payload = { identity, identityType: "did" as const, ...extra };
  const canonical = canonicalizeJson(payload);
  const signature = createDetachedJws(canonical, signer);
  return { ...payload, signature };
}

// ── Server setup ────────────────────────────────────────────────────────────

const stack = makeStack();
const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
const port = (server.address() as any).port as number;
server.unref();
await new Promise((r) => setTimeout(r, 50));

// ── Happy path ─────────────────────────────────────────────────────────────

test("POST /api/ard/verify → 200 with valid=true for matching did:web", async () => {
  const tm = await makeSignedTrustManifest("did:web:example.com", stack.signer, {
    attestations: [{ type: "TFA", uri: "https://tfa.dev/verify/1", digest: "abc123" }],
  });
  const r = await httpPost(port, "/api/ard/verify", { urn: "urn:ai:example.com:ns:agent", trustManifest: tm }, "tenant-ard-v1");
  eq(r.status, 200);
  const body = r.body as any;
  assert(body.valid === true, `expected valid=true, got: ${JSON.stringify(body)}`);
  assert(body.checks.urnWellFormed === true);
  assert(body.checks.domainAlignment === true);
  assert(body.checks.jwsValid === true);
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test("POST /api/ard/verify → 200 valid=true for https identity", async () => {
  const tm = await makeSignedTrustManifest("https://example.com/agent", stack.signer);
  const r = await httpPost(port, "/api/ard/verify", { urn: "urn:ai:example.com:ns:agent", trustManifest: tm }, "tenant-ard-v2");
  eq(r.status, 200);
  assert(r.body.valid === true);
});

test("POST /api/ard/verify → 200 valid=true but jwsValid=null when no signature", async () => {
  const tm = { identity: "did:web:example.com", identityType: "did" };
  const r = await httpPost(port, "/api/ard/verify", { urn: "urn:ai:example.com:ns:agent", trustManifest: tm }, "tenant-ard-v3");
  eq(r.status, 200);
  assert(r.body.valid === true);
  assert(r.body.checks.jwsValid === null);
});

// ── Fail-closed ────────────────────────────────────────────────────────────

test("POST /api/ard/verify without x-tenant-id → 400", async () => {
  const tm = { identity: "did:web:example.com", identityType: "did" };
  const r = await httpPost(port, "/api/ard/verify", { urn: "urn:ai:example.com:ns:agent", trustManifest: tm }, undefined);
  eq(r.status, 400);
  assert(r.body.error);
});

test("POST /api/ard/verify with domain mismatch → 200 valid=false", async () => {
  const tm = await makeSignedTrustManifest("did:web:evil.com", stack.signer);
  const r = await httpPost(port, "/api/ard/verify", { urn: "urn:ai:example.com:ns:agent", trustManifest: tm }, "tenant-ard-v4");
  eq(r.status, 200);
  assert(r.body.valid === false);
  assert(r.body.checks.domainAlignment === false);
});

test("POST /api/ard/verify with tampered JWS → 200 valid=false", async () => {
  const tm = await makeSignedTrustManifest("did:web:example.com", stack.signer);
  tm.signature = tm.signature.slice(0, -4) + "XXXX";
  const r = await httpPost(port, "/api/ard/verify", { urn: "urn:ai:example.com:ns:agent", trustManifest: tm }, "tenant-ard-v5");
  eq(r.status, 200);
  assert(r.body.valid === false);
  assert(r.body.checks.jwsValid === false);
});

test("POST /api/ard/verify with malformed URN → 200 valid=false", async () => {
  const tm = await makeSignedTrustManifest("did:web:example.com", stack.signer);
  const r = await httpPost(port, "/api/ard/verify", { urn: "not-a-urn", trustManifest: tm }, "tenant-ard-v6");
  eq(r.status, 200);
  assert(r.body.valid === false);
  assert(r.body.checks.urnWellFormed === false);
});

test("cleanup: close server", () => { server.close(); });
