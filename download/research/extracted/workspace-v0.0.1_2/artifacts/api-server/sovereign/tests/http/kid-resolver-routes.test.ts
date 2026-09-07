/**
 * tests/http/kid-resolver-routes.test.ts
 *
 * Tests for GET /api/keys/* (KID resolver endpoints) and KeyRing.list().
 */

import { test, assert, eq } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { KeyRing } from "../../lib/passport/key-ring.ts";
import type { Server } from "node:http";

// ── KeyRing.list() unit tests ─────────────────────────────────────────────────

test("KeyRing.list() returns all registered entries", () => {
  const ring = new KeyRing();
  ring.register({ kid: "kid1", algorithm: "hmac-sha256", secret: "s1", status: "active", createdAt: "2026-01-01T00:00:00Z" });
  ring.register({ kid: "kid2", algorithm: "hmac-sha256", secret: "s2", status: "retiring", createdAt: "2025-01-01T00:00:00Z" });
  const entries = ring.list();
  eq(entries.length, 2);
  assert(entries.some((e: any) => e.kid === "kid1"), "kid1 in list");
  assert(entries.some((e: any) => e.kid === "kid2"), "kid2 in list");
});

test("KeyRing.list() returns empty array when no keys registered", () => {
  const ring = new KeyRing();
  eq(ring.list().length, 0);
});

test("KeyRing.list() includes revoked entries", () => {
  const ring = new KeyRing();
  ring.register({ kid: "k1", algorithm: "hmac-sha256", secret: "sec", status: "active", createdAt: "2026-01-01T00:00:00Z" });
  ring.revoke("k1");
  const entries = ring.list();
  eq(entries.length, 1);
  eq(entries[0].status, "revoked");
});

test("KeyRing.list() includes active + retiring after rotate", () => {
  const ring = new KeyRing();
  ring.register({ kid: "k1", algorithm: "hmac-sha256", secret: "s1", status: "active", createdAt: "2026-01-01T00:00:00Z" });
  ring.rotate({ kid: "k2", algorithm: "hmac-sha256", secret: "s2", status: "active", createdAt: "2026-06-01T00:00:00Z" });
  const entries = ring.list();
  eq(entries.length, 2);
  const k1 = entries.find((e: any) => e.kid === "k1");
  const k2 = entries.find((e: any) => e.kid === "k2");
  assert(k1 !== undefined, "k1 should be in list");
  assert(k2 !== undefined, "k2 should be in list");
  eq(k1!.status, "retiring");
  eq(k2!.status, "active");
});

// ── HTTP integration ──────────────────────────────────────────────────────────

// Set up shared server synchronously at module load (before harness setTimeout fires)
const _stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
const _server = startSovereignServer(0, _stack) as Server & { shutdown: () => Promise<void> };
const _port = (_server.address() as any).port as number;
_server.unref();

async function get(path: string, tenantId = "t1") {
  const res = await fetch(`http://127.0.0.1:${_port}${path}`, {
    headers: { "x-tenant-id": tenantId },
  });
  return { status: res.status, body: await res.json() as any, headers: res.headers };
}

test("GET /api/keys/current → 200 with active key", async () => {
  const r = await get("/api/keys/current");
  eq(r.status, 200);
  assert(typeof r.body.key === "object" && r.body.key !== null, "should have key object");
  assert(typeof r.body.key.kid === "string" && r.body.key.kid.length > 0, "key.kid required");
  assert(typeof r.body.key.algorithm === "string", "key.algorithm required");
  eq(r.body.key.status, "active");
});

test("GET /api/keys/current → no secret in response", async () => {
  const r = await get("/api/keys/current");
  eq(r.status, 200);
  eq(r.body.key.secret, undefined);
  eq(r.body.key.privateKey, undefined);
});

test("GET /api/keys/current → cache-control header present", async () => {
  const r = await get("/api/keys/current");
  eq(r.status, 200);
  const cc = r.headers.get("cache-control");
  assert(typeof cc === "string" && cc.length > 0, "cache-control header should be set");
});

test("GET /api/keys → 200 { kids: [...] } with at least 1 entry", async () => {
  const r = await get("/api/keys");
  eq(r.status, 200);
  assert(Array.isArray(r.body.kids), "should have kids array");
  assert(r.body.kids.length >= 1, "should have at least one key");
});

test("GET /api/keys → no secrets in kids list", async () => {
  const r = await get("/api/keys");
  eq(r.status, 200);
  for (const k of r.body.kids) {
    eq(k.secret, undefined);
    eq(k.privateKey, undefined);
    assert(typeof k.kid === "string" && k.kid.length > 0, "each entry has kid");
    assert(typeof k.status === "string", "each entry has status");
  }
});

test("GET /api/keys/:kid → 200 for current kid", async () => {
  const currentR = await get("/api/keys/current");
  const kid = currentR.body.key.kid;
  const r = await get(`/api/keys/${kid}`);
  eq(r.status, 200);
  eq(r.body.key.kid, kid);
  eq(r.body.key.status, "active");
  eq(r.body.key.secret, undefined);
});

test("GET /api/keys/:kid → 404 for unknown kid", async () => {
  const r = await get("/api/keys/0000000000000000");
  eq(r.status, 404);
  assert(typeof r.body.error === "string", "should have error message");
});

test("GET /api/keys/:kid → 404 for completely unknown string", async () => {
  const r = await get("/api/keys/does-not-exist-at-all");
  eq(r.status, 404);
});

test("GET /api/keys/current → JSON responses never contain 'secret' string", async () => {
  const r = await get("/api/keys/current");
  const text = JSON.stringify(r.body);
  assert(!text.includes('"secret"'), "secret must never appear in JSON response");
});

test("GET /api/keys → JSON responses never contain 'secret' string", async () => {
  const r = await get("/api/keys");
  const text = JSON.stringify(r.body);
  assert(!text.includes('"secret"'), "secret must never appear in JSON response");
});

test("GET /api/keys/current → kid matches signer.kid when defined", async () => {
  const r = await get("/api/keys/current");
  eq(r.status, 200);
  const returnedKid = r.body.key.kid;
  const signerKid = (_stack.signer as any).kid;
  if (typeof signerKid === "string") {
    eq(returnedKid, signerKid, "returned kid should match signer.kid");
  }
  assert(returnedKid.length > 0, "kid should be non-empty");
});

test("cleanup: close server", () => { _server.close(); });
