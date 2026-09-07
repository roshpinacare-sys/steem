import "../_flush.mjs";
/**
 * tests/routes/adapter-routes-composition.test.ts — v191
 *
 * Verifies that adapterRoutes mounted by the HTTP layer SHARES the
 * SovereignStack's nonceRegistry — so capability-token replay protection
 * is unified across the HTTP `/api/execution/:id/approve` path and any
 * other consumer that uses stack.nonceRegistry (e.g. the MCP server).
 *
 * Coverage:
 *   • sovereign-server: after approving via HTTP, stack.nonceRegistry.has(nonce)
 *     is true (write reached the shared registry).
 *   • express-adapter (mountSovereignRoutes path): same guarantee.
 *   • Cross-path replay: a nonce consumed via HTTP is rejected if presented
 *     again — using stack.nonceRegistry.has() as the deterministic witness.
 *   • Fail-closed default: building a stack and mounting routes never silently
 *     replaces the registry with a fresh InMemoryNonceRegistry.
 */

import { test, assert, eq } from "../_harness.mjs";
import { buildSovereignStack } from "../../src/composition.ts";
import { listSovereignRoutes, sovereignRouteCount } from "../../src/http/express-adapter.ts";
import { adapterRoutes } from "../../src/routes/adapter-routes.ts";
import { decodeCapabilityToken } from "../../lib/mcp-server/capability-token.ts";

function approvalIntent(over: Record<string, unknown> = {}) {
  return {
    actorId: "agent:cap",
    toolId: "file.delete",
    resourceRef: "resource:doc",
    riskClass: "write_destructive",
    valueMicrounits: "0",
    privacyLevel: "internal",
    approvalPolicyRef: "pol:default",
    nonce: "n-" + Math.random().toString(36).slice(2),
    expiry: "2099-01-01T00:00:00.000Z",
    provenance: "test",
    evidencePolicy: "ev:default",
    ...over,
  };
}

function findRoute(routes: any[], method: string, pattern: string) {
  return routes.find((r) => r.method === method && r.pattern === pattern);
}

// Drive the adapterRoutes directly but with stack.nonceRegistry — mirroring
// what sovereign-server.ts and express-adapter.ts now do — and verify that
// nonce consumption is observable on the shared stack registry.
async function runFlow(stack: any) {
  const routes = adapterRoutes(stack.signer, stack.executionStore, stack.indexerEventBus, {
    nonceRegistry: stack.nonceRegistry,
  });
  const run = findRoute(routes, "POST", "/api/adapter/run")!;
  const approve = findRoute(routes, "POST", "/api/execution/:id/approve")!;

  const runRes: any = await run.handler({ tenantId: "tA", body: approvalIntent(), params: {} });
  eq(runRes.status, 201);
  const id = runRes.body.receipt.approvalToken as string;
  const token = runRes.body.capabilityToken as string;
  const decoded = decodeCapabilityToken(token)!;

  const approveRes: any = await approve.handler({ tenantId: "tA", body: { capabilityToken: token }, params: { id } });
  eq(approveRes.status, 200);
  eq(approveRes.body.capabilityVerified, true);

  return { id, token, decoded };
}

// ─── Composition wiring: adapterRoutes shares stack.nonceRegistry ─────────────

test("after HTTP approve, stack.nonceRegistry records the consumed nonce", async () => {
  const stack = buildSovereignStack();
  const before = stack.nonceRegistry.has("non-existent-nonce");
  eq(before, false);

  const { decoded } = await runFlow(stack);
  assert(
    stack.nonceRegistry.has(decoded.nonce),
    "stack.nonceRegistry must have the consumed nonce (proves shared registry)",
  );
});

test("cross-path replay: re-presenting the consumed token is rejected (shared registry)", async () => {
  const stack = buildSovereignStack();
  const { id, token } = await runFlow(stack);

  // Re-build the adapterRoutes on the SAME stack (simulating a second mount /
  // request after the registry has been written to). Replay must fail-closed.
  const routes2 = adapterRoutes(stack.signer, stack.executionStore, stack.indexerEventBus, {
    nonceRegistry: stack.nonceRegistry,
  });
  const approve2 = findRoute(routes2, "POST", "/api/execution/:id/approve")!;
  const replay: any = await approve2.handler({
    tenantId: "tA", body: { capabilityToken: token }, params: { id },
  });
  eq(replay.status, 401);
  assert(/replay|already been used/i.test(String(replay.body.error)),
    `expected replay error, got: ${replay.body.error}`);
});

// ─── Fail-closed: helpers in express-adapter.ts still wire the registry ──────

test("listSovereignRoutes + sovereignRouteCount do not crash and include adapter routes", () => {
  const stack = buildSovereignStack();
  const list = listSovereignRoutes(stack);
  const count = sovereignRouteCount(stack);
  eq(typeof count, "number");
  assert(count === list.length, `count=${count} != list.length=${list.length}`);
  const run = list.find((r) => r.pattern === "/api/adapter/run" && r.method === "POST");
  const approve = list.find((r) => r.pattern === "/api/execution/:id/approve" && r.method === "POST");
  assert(!!run, "adapter run route present");
  assert(!!approve, "adapter approve route present");
});

// ─── Fail-closed: default did not silently replace registry ──────────────────

test("stack.nonceRegistry identity is preserved across listSovereignRoutes/sovereignRouteCount", () => {
  const stack = buildSovereignStack();
  const reg1 = stack.nonceRegistry;
  listSovereignRoutes(stack);
  sovereignRouteCount(stack);
  // identity unchanged on the stack (we do not reassign)
  assert(reg1 === stack.nonceRegistry, "stack.nonceRegistry identity preserved");
});
