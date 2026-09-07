import "../_flush.mjs";
/**
 * tests/mcp-server/nonce-registry-composition.test.ts
 *
 * Tests for PgNonceRegistry composition wiring in buildSovereignStack.
 *
 * Coverage:
 *   Composition wiring
 *     • no pool → nonceRegistry is InMemoryNonceRegistry (in-memory)
 *     • pool present → nonceRegistry is PgNonceRegistry (durable)
 *     • pool present → persistenceReport.nonceRegistry === "pg"
 *     • no pool → persistenceReport.nonceRegistry === "in-memory"
 *
 *   Functional integration (stack.nonceRegistry is wired and works)
 *     • stack.nonceRegistry.has() initially false for unseen nonce
 *     • stack.nonceRegistry.add() + has() → true (nonce registered)
 *     • two stacks with same pool share the durable layer (restart simulation)
 *     • TfaMcpServer can be constructed with stack.nonceRegistry, rejects replay
 *
 *   fail-closed
 *     • empty nonce throws on both InMemory and Pg registries
 *     • invalid expiresAt throws on both
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack, buildSovereignStackAsync } from "../../src/composition.ts";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { InMemoryNonceRegistry, PgNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import { TfaMcpServer } from "../../lib/mcp-server/mcp-server.ts";
import { issueCapabilityToken, encodeCapabilityToken } from "../../lib/mcp-server/capability-token.ts";

const FUTURE = new Date(Date.now() + 60_000).toISOString(); // 1 minute from now

// ─── Composition wiring: no pool ──────────────────────────────────────────────

test("no pool → stack.nonceRegistry is InMemoryNonceRegistry", () => {
  const stack = buildSovereignStack();
  assert(
    stack.nonceRegistry instanceof InMemoryNonceRegistry,
    `Expected InMemoryNonceRegistry, got ${stack.nonceRegistry?.constructor?.name}`,
  );
});

test("no pool → persistenceReport.nonceRegistry === 'in-memory'", () => {
  const stack = buildSovereignStack();
  eq((stack as any).persistenceReport.nonceRegistry, "in-memory");
});

// ─── Composition wiring: with pool ───────────────────────────────────────────

test("pool present → stack.nonceRegistry is PgNonceRegistry", () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool } as any);
  assert(
    stack.nonceRegistry instanceof PgNonceRegistry,
    `Expected PgNonceRegistry, got ${stack.nonceRegistry?.constructor?.name}`,
  );
});

test("pool present → persistenceReport.nonceRegistry === 'pg'", () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool } as any);
  eq((stack as any).persistenceReport.nonceRegistry, "pg");
});

// ─── buildSovereignStackAsync wires PgNonceRegistry with init() ───────────────

test("buildSovereignStackAsync: with pool → nonceRegistry is PgNonceRegistry (init awaited)", async () => {
  const pool = new InMemoryPool();
  const stack = await buildSovereignStackAsync(undefined, { pool } as any);
  assert(
    stack.nonceRegistry instanceof PgNonceRegistry,
    `Expected PgNonceRegistry after async init, got ${stack.nonceRegistry?.constructor?.name}`,
  );
  eq((stack as any).persistenceReport.nonceRegistry, "pg");
});

test("buildSovereignStackAsync: no pool → nonceRegistry is InMemoryNonceRegistry", async () => {
  const stack = await buildSovereignStackAsync();
  assert(stack.nonceRegistry instanceof InMemoryNonceRegistry);
  eq((stack as any).persistenceReport.nonceRegistry, "in-memory");
});

// ─── Functional: stack.nonceRegistry works correctly ─────────────────────────

test("stack.nonceRegistry (in-memory): initially returns false for unseen nonce", () => {
  const stack = buildSovereignStack();
  eq(stack.nonceRegistry.has("some-nonce"), false);
});

test("stack.nonceRegistry (in-memory): add() then has() → true", () => {
  const stack = buildSovereignStack();
  stack.nonceRegistry.add("nonce-abc", FUTURE);
  eq(stack.nonceRegistry.has("nonce-abc"), true);
});

test("stack.nonceRegistry (in-memory): add() is idempotent (double-add no-op)", () => {
  const stack = buildSovereignStack();
  stack.nonceRegistry.add("nonce-idem", FUTURE);
  stack.nonceRegistry.add("nonce-idem", FUTURE); // second add — must not throw or corrupt state
  eq(stack.nonceRegistry.has("nonce-idem"), true);
});

test("stack.nonceRegistry (pg): add() + has() via in-memory pool", () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool } as any);
  stack.nonceRegistry.add("pg-nonce-1", FUTURE);
  eq(stack.nonceRegistry.has("pg-nonce-1"), true);
  eq(stack.nonceRegistry.has("pg-nonce-unknown"), false);
});

test("stack.nonceRegistry (pg): DURABILITY — second stack over same pool sees recorded nonce after init", async () => {
  const pool = new InMemoryPool();
  const stack1 = buildSovereignStack(undefined, { pool } as any);
  // Await the fire-and-forget init by calling it explicitly
  await (stack1.nonceRegistry as PgNonceRegistry).init();
  stack1.nonceRegistry.add("durable-nonce", FUTURE);

  // Simulate a process restart: fresh stack over same pool
  const stack2 = buildSovereignStack(undefined, { pool } as any);
  await (stack2.nonceRegistry as PgNonceRegistry).init();

  assert(
    stack2.nonceRegistry.has("durable-nonce"),
    "PgNonceRegistry must survive restart: nonce recorded by stack1 must be seen by stack2",
  );
});

// ─── TfaMcpServer integration: stack.nonceRegistry used as nonceRegistry ─────

test("TfaMcpServer constructed with stack.nonceRegistry — registry used for replay protection", async () => {
  const stack = buildSovereignStack();

  // Build TfaMcpServer using stack.nonceRegistry directly
  const mcpServer = new TfaMcpServer({
    signer: stack.signer,
    executionStore: stack.executionStore,
    nonceRegistry: stack.nonceRegistry, // ← wired from stack
  });

  // Verify the nonceRegistry is the same object (pointer equality)
  // The MCP server should use the registry passed in config, not create a new one.
  // We can verify this by recording a nonce directly and checking the server
  // would see it as "already used".
  const testNonce = "test-nonce-from-stack-" + Date.now();
  const futureTs = new Date(Date.now() + 60_000).toISOString();

  // Pre-record the nonce in the stack registry
  stack.nonceRegistry.add(testNonce, futureTs);

  // The registry the server uses must see the same nonce as consumed.
  // Since TfaMcpServer stores nonceRegistry privately, we verify via the shared
  // stack.nonceRegistry reference — both should agree.
  assert(
    stack.nonceRegistry.has(testNonce),
    "Nonce recorded via stack.nonceRegistry must be visible in has()",
  );

  // If we issue a capability token, extract its nonce, pre-record it in
  // stack.nonceRegistry, then submit the token — the server should reject replay.
  const rawToken = issueCapabilityToken("exec-replay-test", "tenant-replay", stack.signer);
  const tokenStr = encodeCapabilityToken(rawToken);

  // Pre-consume the nonce (simulating a previous use)
  stack.nonceRegistry.add(rawToken.nonce, rawToken.expiresAt);

  const req = {
    jsonrpc: "2.0" as const,
    id: 42,
    method: "tools/call" as const,
    params: {
      name: "tfa_approve_execution",
      arguments: {
        capabilityToken: tokenStr,
        tenantId: "tenant-replay",
        executionId: "exec-replay-test",
      },
    },
  };

  const result = await mcpServer.handleRequest(req);
  const body = JSON.stringify(result);
  assert(
    body.includes("already used") || body.includes("replay") || body.includes("nonce"),
    `Pre-consumed nonce should cause replay rejection. Got: ${body.slice(0, 300)}`,
  );
});

// ─── fail-closed: empty/invalid inputs throw ─────────────────────────────────

test("stack.nonceRegistry (in-memory): empty nonce → throws on has()", () => {
  const stack = buildSovereignStack();
  let threw = false;
  try {
    stack.nonceRegistry.has("");
  } catch {
    threw = true;
  }
  assert(threw, "has('') must throw for InMemoryNonceRegistry");
});

test("stack.nonceRegistry (in-memory): empty nonce → throws on add()", () => {
  const stack = buildSovereignStack();
  let threw = false;
  try {
    stack.nonceRegistry.add("", FUTURE);
  } catch {
    threw = true;
  }
  assert(threw, "add('', ...) must throw for InMemoryNonceRegistry");
});

test("stack.nonceRegistry (in-memory): invalid expiresAt → throws on add()", () => {
  const stack = buildSovereignStack();
  let threw = false;
  try {
    stack.nonceRegistry.add("valid-nonce", "not-a-date");
  } catch {
    threw = true;
  }
  assert(threw, "add(nonce, 'not-a-date') must throw");
});

test("stack.nonceRegistry (pg): empty nonce → throws on has()", () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool } as any);
  let threw = false;
  try {
    stack.nonceRegistry.has("");
  } catch {
    threw = true;
  }
  assert(threw, "has('') must throw for PgNonceRegistry");
});

test("stack.nonceRegistry (pg): invalid expiresAt → throws on add()", () => {
  const pool = new InMemoryPool();
  const stack = buildSovereignStack(undefined, { pool } as any);
  let threw = false;
  try {
    stack.nonceRegistry.add("some-nonce", "invalid-ts");
  } catch {
    threw = true;
  }
  assert(threw, "add(nonce, 'invalid-ts') must throw for PgNonceRegistry");
});

// ─── persistenceReport completeness ──────────────────────────────────────────

test("persistenceReport includes nonceRegistry key in both pool and no-pool scenarios", () => {
  const s1 = buildSovereignStack();
  assert("nonceRegistry" in (s1 as any).persistenceReport, "persistenceReport must have nonceRegistry key (no-pool)");

  const s2 = buildSovereignStack(undefined, { pool: new InMemoryPool() } as any);
  assert("nonceRegistry" in (s2 as any).persistenceReport, "persistenceReport must have nonceRegistry key (pool)");
});
