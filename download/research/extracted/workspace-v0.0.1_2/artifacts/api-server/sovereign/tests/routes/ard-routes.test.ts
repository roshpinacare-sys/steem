import "../_flush.mjs";
/**
 * tests/routes/ard-routes.test.ts — ARD publisher route integration tests.
 *
 * Coverage:
 *   Happy path:
 *     • GET /.well-known/ai-catalog.json returns 200 with valid catalog
 *     • Response includes schemaVersion, publisher, agents with trustManifest
 *   Edge cases:
 *     • Different tenants get different identities
 *   Fail-closed:
 *     • Missing x-tenant-id → 400
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { _clearArdCatalogCache } from "../../lib/adapter/ard-publisher.ts";

function makeStack() {
  return buildSovereignStack(undefined, { provider: new InMemoryLedger() });
}

async function httpGet(port: number, path: string, tenantId: string | undefined) {
  const headers: Record<string, string> = {};
  if (tenantId !== undefined) headers["x-tenant-id"] = tenantId;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

// ── Server setup ────────────────────────────────────────────────────────────

_clearArdCatalogCache();
const stack = makeStack();
const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
const port = (server.address() as any).port as number;
server.unref();
await new Promise((r) => setTimeout(r, 50));

// ── Happy path ───────────────────────────────────────────────────────────────

test("GET /.well-known/ai-catalog.json → 200 with ARD catalog", async () => {
  const r = await httpGet(port, "/.well-known/ai-catalog.json", "tenant-ard-1");
  eq(r.status, 200);
  const body = r.body as any;
  eq(body.schemaVersion, "v0.9-draft");
  assert(typeof body.publisher.name === "string", "publisher.name should be string");
  assert(Array.isArray(body.agents) && body.agents.length === 1, "should have exactly one agent");
  const agent = body.agents[0];
  assert(typeof agent.id === "string" && agent.id.length > 0, "agent.id should be non-empty");
  assert(agent.trustManifest, "trustManifest should be present");
  const tm = agent.trustManifest;
  assert(tm.identity.startsWith("did:web:"), "identity should be did:web");
  assert(typeof tm.signature === "string" && tm.signature.includes(".."), "signature should be detached JWS");
});

test("GET /.well-known/ai-catalog.json — trustManifest signature is verifiable", async () => {
  const r = await httpGet(port, "/.well-known/ai-catalog.json", "tenant-ard-2");
  eq(r.status, 200);
  const body = r.body as any;
  const tm = body.agents[0].trustManifest;
  const { signature, ...payload } = tm;
  const { verifyDetachedJws, canonicalizeJson } = await import("../../lib/adapter/ard-publisher.ts");
  const canonical = canonicalizeJson(payload);
  assert(verifyDetachedJws(signature, canonical, stack.signer), "JWS should verify against kernel signer");
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test("GET /.well-known/ai-catalog.json — different tenants get different identities", async () => {
  const r1 = await httpGet(port, "/.well-known/ai-catalog.json", "tenant-ard-a");
  const r2 = await httpGet(port, "/.well-known/ai-catalog.json", "tenant-ard-b");
  eq(r1.status, 200);
  eq(r2.status, 200);
  const id1 = r1.body.agents[0].trustManifest.identity;
  const id2 = r2.body.agents[0].trustManifest.identity;
  assert(id1 !== id2, "different tenants should have different identities");
});

// ── Fail-closed ─────────────────────────────────────────────────────────────

test("GET /.well-known/ai-catalog.json without x-tenant-id → 400", async () => {
  const r = await httpGet(port, "/.well-known/ai-catalog.json", undefined);
  eq(r.status, 400);
  assert((r.body as any).error, "should have error message");
});

test("cleanup: close server", () => { server.close(); });
