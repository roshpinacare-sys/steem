import "../_flush.mjs";
/**
 * tests/http/replay-protection.test.ts — Unified ReplayProtection interface (gap #5 sub-step 2).
 *
 * Covers: CompositeReplayProtection delegates get/set to IdempotencyStore
 * and has/add to NonceRegistry; cleanup triggers prune on the idempotency
 * store; TTL is exposed; fail-closed on invalid nonce input.
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryIdempotencyStore, type IdempotencyRecord } from "../../src/http/idempotency.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import { CompositeReplayProtection } from "../../src/http/replay-protection.ts";

const idem = new InMemoryIdempotencyStore();
const nonce = new InMemoryNonceRegistry();
const rp = new CompositeReplayProtection(idem, nonce);

// ─── Idempotency delegation ───────────────────────────────────────────────────

test("get returns undefined for unknown tenant+key", () => {
  eq(rp.get("t1", "k1"), undefined);
});

test("set + get round-trip for idempotency record", () => {
  const rec: IdempotencyRecord = { status: 200, body: { ok: true }, pathKey: "POST /api/test", state: "done", createdAt: Date.now() };
  rp.set("t1", "k1", rec);
  const got = rp.get("t1", "k1");
  assert(got !== undefined, "expected record");
  eq(got!.status, 200);
  eq(got!.body.ok, true);
});

test("idempotency records are tenant-scoped", () => {
  const rec: IdempotencyRecord = { status: 201, body: null, pathKey: "POST /api/x", state: "done", createdAt: Date.now() };
  rp.set("t-a", "shared-key", rec);
  eq(rp.get("t-b", "shared-key"), undefined);
});

// ─── Nonce registry delegation ────────────────────────────────────────────────

test("has returns false for unseen nonce", () => {
  eq(rp.has("nonce-abc"), false);
});

test("add then has returns true", () => {
  rp.add("nonce-xyz", new Date(Date.now() + 60_000).toISOString());
  eq(rp.has("nonce-xyz"), true);
});

test("add is idempotent (duplicate add is no-op)", () => {
  rp.add("nonce-dup", new Date(Date.now() + 60_000).toISOString());
  rp.add("nonce-dup", new Date(Date.now() + 60_000).toISOString());
  eq(rp.has("nonce-dup"), true);
});

test("expired nonce returns false (TTL respected)", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  rp.add("nonce-old", past);
  eq(rp.has("nonce-old"), false);
});

// ─── Fail-closed: invalid nonce input ─────────────────────────────────────────

test("has throws on empty nonce (fail-closed)", () => {
  let threw = false;
  try { rp.has(""); } catch { threw = true; }
  assert(threw, "expected throw for empty nonce");
});

test("add throws on invalid expiresAt (fail-closed)", () => {
  let threw = false;
  try { rp.add("nonce-valid", "not-a-date"); } catch { threw = true; }
  assert(threw, "expected throw for bad expiresAt");
});

// ─── Cleanup policy ───────────────────────────────────────────────────────────

test("cleanup prunes expired idempotency records", () => {
  const fresh = new InMemoryIdempotencyStore(1000); // 1s TTL
  const freshNonce = new InMemoryNonceRegistry();
  const freshRp = new CompositeReplayProtection(fresh, freshNonce);

  const rec: IdempotencyRecord = { status: 200, body: null, pathKey: "GET /x", state: "done", createdAt: Date.now() - 2000 };
  freshRp.set("t1", "old-key", rec);

  // Explicit cleanup should evict the expired record
  freshRp.cleanup();
  eq(freshRp.get("t1", "old-key"), undefined);
});

test("ttl is exposed on ReplayProtection", () => {
  eq(rp.idempotencyTtlMs, 24 * 60 * 60 * 1000);
  const custom = new CompositeReplayProtection(idem, nonce, 5000);
  eq(custom.idempotencyTtlMs, 5000);
});

// ─── Composite isolation: idempotency and nonce do not leak ───────────────────

test("idempotency keys and nonces are independent namespaces", () => {
  rp.add("key-1", new Date(Date.now() + 60_000).toISOString());
  rp.set("t1", "key-1", { status: 200, body: null, pathKey: "POST /a", state: "done", createdAt: Date.now() });
  // has checks nonce registry; get checks idempotency store — same string, different scopes
  eq(rp.has("key-1"), true);
  eq(rp.get("t1", "key-1")!.status, 200);
  eq(rp.get("t1", "key-1")!.pathKey, "POST /a");
});
