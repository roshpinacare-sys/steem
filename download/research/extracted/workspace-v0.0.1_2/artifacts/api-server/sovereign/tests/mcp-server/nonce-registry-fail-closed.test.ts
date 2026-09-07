import "../_flush.mjs";
/**
 * tests/mcp-server/nonce-registry-fail-closed.test.ts
 *
 * Tests the fail-closed behavior when TfaMcpServer is constructed without a
 * nonceRegistry (v212, sub-step 3 — the deprecation-warning period in v211 is
 * over; the constructor now throws).
 *
 * Coverage:
 *   • Default (no nonceRegistry) → throws with guidance message
 *   • Explicit nonceRegistry → constructs successfully
 *   • Explicit InMemoryNonceRegistry → constructs successfully (caller choice)
 *   • mcpServerFromStack → constructs successfully (wires stack.nonceRegistry)
 *   • Error text quality check (contains expected guidance phrases)
 */

import { test, assert, eq } from "../_harness.mjs";
import { TfaMcpServer } from "../../lib/mcp-server/mcp-server.ts";
import { buildSovereignStack, mcpServerFromStack } from "../../src/composition.ts";
import { InMemoryNonceRegistry } from "../../lib/mcp-server/nonce-registry.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";

// ─── Throws when nonceRegistry is omitted ─────────────────────────────────────

test("TfaMcpServer default (no nonceRegistry) throws fail-closed error", () => {
  let threw = false;
  let err: Error | undefined;
  try {
    const signer = new HmacSigner("test-secret-32bytes-long!!!!!");
    const store = new InMemoryExecutionStore();
    new TfaMcpServer({ signer, executionStore: store });
  } catch (e) {
    threw = true;
    err = e as Error;
  }
  assert(threw, "expected TfaMcpServer to throw when nonceRegistry is missing");
  assert(err!.message.includes("nonceRegistry is required"), `expected 'nonceRegistry is required' in error message, got: ${err!.message}`);
  assert(err!.message.includes("mcpServerFromStack"), `expected mention of mcpServerFromStack, got: ${err!.message}`);
  assert(err!.message.includes("InMemoryNonceRegistry"), `expected mention of InMemoryNonceRegistry, got: ${err!.message}`);
  assert(err!.message.includes("PgNonceRegistry"), `expected mention of PgNonceRegistry, got: ${err!.message}`);
});

// ─── No throw when nonceRegistry is provided explicitly ───────────────────────

test("TfaMcpServer with explicit nonceRegistry → constructs successfully", () => {
  const signer = new HmacSigner("test-secret-32bytes-long!!!!!");
  const store = new InMemoryExecutionStore();
  const registry = new InMemoryNonceRegistry();
  const server = new TfaMcpServer({ signer, executionStore: store, nonceRegistry: registry });
  assert(typeof (server as any).handleRequest === "function", "server must be valid");
});

// ─── No throw when caller explicitly passes InMemoryNonceRegistry ────────────

test("TfaMcpServer with explicit InMemoryNonceRegistry → constructs successfully (caller choice)", () => {
  const signer = new HmacSigner("test-secret-32bytes-long!!!!!");
  const store = new InMemoryExecutionStore();
  const registry = new InMemoryNonceRegistry();
  const server = new TfaMcpServer({ signer, executionStore: store, nonceRegistry: registry });
  assert(typeof (server as any).handleRequest === "function", "server must be valid");
});

// ─── mcpServerFromStack does not throw ─────────────────────────────────────────

test("mcpServerFromStack does not throw (wires stack.nonceRegistry)", () => {
  const stack = buildSovereignStack();
  const server = mcpServerFromStack(stack);
  assert(typeof (server as any).handleRequest === "function", "factory server must be valid");
});

// ─── Error text quality ─────────────────────────────────────────────────────

test("Fail-closed error text contains required guidance phrases", () => {
  let err: Error | undefined;
  try {
    const signer = new HmacSigner("test-secret-32bytes-long!!!!!");
    const store = new InMemoryExecutionStore();
    new TfaMcpServer({ signer, executionStore: store });
  } catch (e) {
    err = e as Error;
  }
  assert(err !== undefined, "must throw");
  assert(err.message.includes("[TFA]") || err.message.includes("TfaMcpServer"), `error must be prefixed with TfaMcpServer: ${err.message}`);
  assert(err.message.includes("required"), `error must mention required: ${err.message}`);
  assert(err.message.includes("automatically"), `error must mention automatically: ${err.message}`);
  assert(err.message.includes("explicitly"), `error must mention explicitly: ${err.message}`);
});
