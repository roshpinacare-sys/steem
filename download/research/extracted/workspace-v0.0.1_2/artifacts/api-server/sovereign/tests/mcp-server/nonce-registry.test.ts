import "../_flush.mjs";
/**
 * tests/mcp-server/nonce-registry.test.ts
 *
 * Tests for:
 *   lib/mcp-server/nonce-registry.ts — NonceRegistry, InMemoryNonceRegistry, PgNonceRegistry
 *   lib/mcp-server/mcp-server.ts — TfaMcpServer accepts a custom nonceRegistry
 *     (additive, replaces the previous bare `usedNonces: Set<string>`)
 *
 * Coverage:
 *   InMemoryNonceRegistry
 *     • happy: add then has → true
 *     • idempotent: re-adding the same nonce is a no-op
 *     • TTL: an entry with an already-past expiresAt is pruned on the next has()
 *     • TTL: size() reflects pruning
 *     • fail-closed: empty/non-string nonce throws on has() and add()
 *     • fail-closed: invalid expiresAt (non-ISO string) throws on add()
 *
 *   PgNonceRegistry
 *     • happy: add/has via pool + init
 *     • DURABILITY: a recorded nonce survives a NEW registry instance over the
 *       same pool (= survives restart) — replay stays rejected
 *     • TTL on preload: a row whose expires_at is already in the past is NOT
 *       loaded into the mirror by init() — has() returns false
 *     • idempotent: re-adding the same nonce does not write a duplicate row
 *     • fail-closed: missing pool throws; empty nonce throws; invalid
 *       expiresAt throws
 *
 *   TfaMcpServer integration
 *     • default nonceRegistry (none passed) — capability-token replay still
 *       rejected (unchanged behaviour, covered more fully in
 *       capability-token.test.ts)
 *     • custom PgNonceRegistry — a capability-token nonce consumed by one
 *       TfaMcpServer instance is rejected by a SECOND instance constructed
 *       over the same pool (durable replay protection across "restart")
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { InMemoryNonceRegistry, PgNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { TfaMcpServer, type JsonRpcRequest } from "../../lib/mcp-server/mcp-server.ts";
import { decodeCapabilityToken } from "../../lib/mcp-server/capability-token.ts";

// helper: drain the fire-and-forget write-through microtask queue
const flush = () => new Promise((r) => setTimeout(r, 0));

const PAST = "2000-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

// ─── InMemoryNonceRegistry ────────────────────────────────────────────────────

test("InMemoryNonceRegistry: add then has → true", () => {
  const reg = new InMemoryNonceRegistry();
  eq(reg.has("n1"), false, "unseen nonce is not present");
  reg.add("n1", FUTURE);
  eq(reg.has("n1"), true, "added nonce is present");
});

test("InMemoryNonceRegistry: re-adding the same nonce is a no-op", () => {
  const reg = new InMemoryNonceRegistry();
  reg.add("n1", FUTURE);
  reg.add("n1", FUTURE);
  eq(reg.size(), 1, "no duplicate entry");
});

test("InMemoryNonceRegistry: TTL — an already-expired entry is pruned on has()", () => {
  const reg = new InMemoryNonceRegistry();
  reg.add("expired", PAST);
  eq(reg.has("expired"), false, "expired nonce is pruned and reported absent");
  eq(reg.size(), 0, "pruned entry is removed from the registry");
});

test("InMemoryNonceRegistry: TTL pruning does not affect unrelated non-expired entries", () => {
  const reg = new InMemoryNonceRegistry();
  reg.add("expired", PAST);
  reg.add("valid", FUTURE);
  eq(reg.has("expired"), false);
  eq(reg.has("valid"), true, "non-expired entry survives pruning of an unrelated expired entry");
  eq(reg.size(), 1);
});

test("InMemoryNonceRegistry [fail-closed]: empty/non-string nonce throws", () => {
  const reg = new InMemoryNonceRegistry();
  let threw = 0;
  try { reg.has(""); } catch { threw++; }
  try { reg.add("", FUTURE); } catch { threw++; }
  try { (reg as any).has(123); } catch { threw++; }
  eq(threw, 3, "all three invalid-nonce calls throw");
});

test("InMemoryNonceRegistry [fail-closed]: invalid expiresAt throws on add()", () => {
  const reg = new InMemoryNonceRegistry();
  let threw = false;
  try { reg.add("n1", "not-a-date"); } catch { threw = true; }
  assert(threw, "non-ISO expiresAt should throw");
  eq(reg.has("n1"), false, "the nonce was not recorded");
});

// ─── PgNonceRegistry ──────────────────────────────────────────────────────────

test("PgNonceRegistry: add/has via pool + init (happy path)", async () => {
  const pool = new InMemoryPool();
  const reg = new PgNonceRegistry(pool);
  await reg.init();
  eq(reg.has("n1"), false);
  reg.add("n1", FUTURE);
  eq(reg.has("n1"), true);
});

test("PgNonceRegistry DURABILITY: a recorded nonce survives a NEW instance over the same pool", async () => {
  const pool = new InMemoryPool();
  const reg1 = new PgNonceRegistry(pool);
  await reg1.init();
  reg1.add("n-restart", FUTURE);
  await flush(); // let the write-through INSERT land

  // Simulate a process restart: brand-new instance, same durable pool.
  const reg2 = new PgNonceRegistry(pool);
  await reg2.init();
  eq(reg2.has("n-restart"), true, "after restart the nonce is still recognised — replay stays blocked");
  eq(reg1.getWriteErrorCount(), 0, "no write-through failures");
});

test("PgNonceRegistry TTL: a row with an already-expired expires_at is not preloaded", async () => {
  const pool = new InMemoryPool();
  // Seed an already-expired row directly (bypassing add(), which would still
  // mirror it in-memory for the writing instance — we want to test preload).
  await pool.query("CREATE TABLE IF NOT EXISTS mcp_nonce_registry (nonce TEXT, expires_at TEXT)", []);
  await pool.query("INSERT INTO mcp_nonce_registry (nonce, expires_at) VALUES ($1, $2)", ["n-old", PAST]);
  await pool.query("INSERT INTO mcp_nonce_registry (nonce, expires_at) VALUES ($1, $2)", ["n-new", FUTURE]);

  const reg = new PgNonceRegistry(pool);
  await reg.init();
  eq(reg.has("n-old"), false, "expired row is not preloaded into the mirror");
  eq(reg.has("n-new"), true, "non-expired row is preloaded into the mirror");
});

test("PgNonceRegistry: re-adding the same nonce does not write a duplicate row", async () => {
  const pool = new InMemoryPool();
  const reg = new PgNonceRegistry(pool);
  await reg.init();
  reg.add("n-dup", FUTURE);
  reg.add("n-dup", FUTURE);
  await flush();
  const res = await pool.query("SELECT nonce FROM mcp_nonce_registry WHERE nonce = $1", ["n-dup"]);
  eq(res.rows.length, 1, "exactly one persisted row for a doubly-added nonce");
});

test("PgNonceRegistry [fail-closed]: missing pool throws", () => {
  let threw = false;
  try { new PgNonceRegistry(undefined as any); } catch { threw = true; }
  assert(threw, "constructing without a pool should throw");
});

test("PgNonceRegistry [fail-closed]: empty nonce / invalid expiresAt throw", async () => {
  const pool = new InMemoryPool();
  const reg = new PgNonceRegistry(pool);
  await reg.init();
  let threw = 0;
  try { reg.has(""); } catch { threw++; }
  try { reg.add("", FUTURE); } catch { threw++; }
  try { reg.add("n1", "not-a-date"); } catch { threw++; }
  eq(threw, 3);
  eq(reg.has("n1"), false, "the malformed-expiry add was rejected, not recorded");
});

// ─── TfaMcpServer integration ─────────────────────────────────────────────────

const signer = new HmacSigner("nonce-registry-test-secret");

function rpc(method: string, params?: unknown, id = 1): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

let _seq = 0;
function intentArgs() {
  _seq++;
  return {
    tenantId: "nonce-tenant",
    actorId: "agent:nonce",
    toolId: "file.delete",
    resourceRef: `res:${_seq}`,
    riskClass: "value_moving",
    valueMicrounits: "1000",
    nonce: `intent-nonce-${_seq}-${Math.random().toString(36).slice(2)}`,
    expiry: FUTURE,
  };
}

test("TfaMcpServer: default nonceRegistry (InMemory) rejects capability-token replay", async () => {
  const store = new InMemoryExecutionStore();
  const server = new TfaMcpServer({ signer, executionStore: store, capabilityTtlMs: 60_000, nonceRegistry: new InMemoryNonceRegistry() });

  const start = await server.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs(),
  }));
  const startBody = JSON.parse((start!.result as any).content[0].text);
  const wfId = startBody.workflow.id as string;
  const encoded = startBody.capabilityToken as string;
  assert(typeof encoded === "string" && encoded.length > 0, "capabilityToken issued");

  const approve1 = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: { tenantId: "nonce-tenant", executionId: wfId, capabilityToken: encoded },
  }, 2));
  const body1 = JSON.parse((approve1!.result as any).content[0].text);
  eq(body1.ok, true);
  eq(body1.capabilityVerified, true);

  // Replay the same token immediately, same server instance.
  const approve2 = await server.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: { tenantId: "nonce-tenant", executionId: wfId, capabilityToken: encoded },
  }, 3));
  const body2 = JSON.parse((approve2!.result as any).content[0].text);
  eq(body2.ok, false);
  assert(body2.error.includes("already been used"), `expected replay error, got: ${body2.error}`);
});

test("TfaMcpServer + PgNonceRegistry: a nonce consumed by one instance is rejected by a SECOND instance over the same pool (durable replay protection)", async () => {
  const pool = new InMemoryPool();
  const store = new InMemoryExecutionStore();

  const reg1 = new PgNonceRegistry(pool);
  await reg1.init();
  const server1 = new TfaMcpServer({ signer, executionStore: store, capabilityTtlMs: 60_000, nonceRegistry: reg1 });

  const start = await server1.handleRequest(rpc("tools/call", {
    name: "tfa_start_execution",
    arguments: intentArgs(),
  }));
  const startBody = JSON.parse((start!.result as any).content[0].text);
  const wfId = startBody.workflow.id as string;
  const encoded = startBody.capabilityToken as string;

  const decoded = decodeCapabilityToken(encoded);
  assert(decoded !== null, "capabilityToken decodes");

  const approve1 = await server1.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: { tenantId: "nonce-tenant", executionId: wfId, capabilityToken: encoded },
  }, 2));
  const body1 = JSON.parse((approve1!.result as any).content[0].text);
  eq(body1.ok, true);
  eq(body1.capabilityVerified, true);

  await flush(); // let the write-through INSERT land

  // Simulate a process restart: a brand-new TfaMcpServer + PgNonceRegistry over the SAME pool.
  const reg2 = new PgNonceRegistry(pool);
  await reg2.init();
  const server2 = new TfaMcpServer({ signer, executionStore: store, capabilityTtlMs: 60_000, nonceRegistry: reg2 });

  const replay = await server2.handleRequest(rpc("tools/call", {
    name: "tfa_approve_execution",
    arguments: { tenantId: "nonce-tenant", executionId: wfId, capabilityToken: encoded },
  }, 3));
  const replayBody = JSON.parse((replay!.result as any).content[0].text);
  eq(replayBody.ok, false);
  assert(replayBody.error.includes("already been used"),
    `expected durable replay rejection, got: ${replayBody.error}`);
});
