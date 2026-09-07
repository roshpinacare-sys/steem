import "../_flush.mjs";
/**
 * tests/indexer/audit-trail.test.ts — One Audit Trail (v314).
 *
 * Coverage:
 *   listExecutionsByProvenance — by provenanceId (exact), by vendor, by both,
 *     cross-tenant isolation, no-filter fail-closed, empty result.
 *   GET /api/audit-trail route — 200 with results, 400 missing filter,
 *     400 wrong tenant header, cross-tenant isolation (empty, not 403).
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryReadModelStore, IndexerError } from "../../lib/indexer/index.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { indexerRoutes } from "../../src/routes/indexer-routes.ts";
import type { ExecutionWorkflow } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeWorkflow(tenantId: string, actionId: string): ExecutionWorkflow {
  const s = new InMemoryExecutionStore();
  return s.create({ tenantId, actionId });
}

const PROV_A = {
  provenanceId: "a".repeat(64),
  provenanceVendor: "anthropic",
  provenanceAgentId: "claude-code-1",
};

const PROV_B = {
  provenanceId: "b".repeat(64),
  provenanceVendor: "openai",
  provenanceAgentId: "gpt-agent-1",
};

// ─── InMemoryReadModelStore.listExecutionsByProvenance ─────────────────────────

test("listExecutionsByProvenance returns executions matching provenanceId", () => {
  const store = new InMemoryReadModelStore();
  const wfA = makeWorkflow("tenant-a", "action-1");
  const wfB = makeWorkflow("tenant-a", "action-2");
  store.projectExecution(wfA, PROV_A);
  store.projectExecution(wfB, PROV_B);

  const results = store.listExecutionsByProvenance("tenant-a", { provenanceId: PROV_A.provenanceId });
  eq(results.length, 1);
  eq(results[0].provenanceId, PROV_A.provenanceId);
  eq(results[0].provenanceVendor, "anthropic");
});

test("listExecutionsByProvenance filters by vendor only", () => {
  const store = new InMemoryReadModelStore();
  store.projectExecution(makeWorkflow("tenant-a", "action-1"), PROV_A);
  store.projectExecution(makeWorkflow("tenant-a", "action-2"), PROV_B);
  store.projectExecution(makeWorkflow("tenant-a", "action-3"), PROV_A);

  const results = store.listExecutionsByProvenance("tenant-a", { vendor: "anthropic" });
  eq(results.length, 2);
  assert(results.every((r) => r.provenanceVendor === "anthropic"), "all results should be anthropic vendor");
});

test("listExecutionsByProvenance with both provenanceId and vendor (AND)", () => {
  const store = new InMemoryReadModelStore();
  // Same vendor but different provenanceId (different agent identity)
  const PROV_A2 = { provenanceId: "c".repeat(64), provenanceVendor: "anthropic", provenanceAgentId: "claude-code-2" };
  store.projectExecution(makeWorkflow("tenant-a", "action-1"), PROV_A);
  store.projectExecution(makeWorkflow("tenant-a", "action-2"), PROV_A2);
  store.projectExecution(makeWorkflow("tenant-a", "action-3"), PROV_B);

  const results = store.listExecutionsByProvenance("tenant-a", {
    provenanceId: PROV_A.provenanceId,
    vendor: "anthropic",
  });
  eq(results.length, 1);
  eq(results[0].provenanceId, PROV_A.provenanceId);
});

test("listExecutionsByProvenance returns empty when provenanceId not found", () => {
  const store = new InMemoryReadModelStore();
  store.projectExecution(makeWorkflow("tenant-a", "action-1"), PROV_A);

  const results = store.listExecutionsByProvenance("tenant-a", { provenanceId: "d".repeat(64) });
  eq(results.length, 0);
});

test("listExecutionsByProvenance is tenant-isolated", () => {
  const store = new InMemoryReadModelStore();
  store.projectExecution(makeWorkflow("tenant-a", "action-1"), PROV_A);
  store.projectExecution(makeWorkflow("tenant-b", "action-2"), PROV_A); // same provenanceId, different tenant

  const resultsA = store.listExecutionsByProvenance("tenant-a", { provenanceId: PROV_A.provenanceId });
  const resultsB = store.listExecutionsByProvenance("tenant-b", { provenanceId: PROV_A.provenanceId });
  eq(resultsA.length, 1);
  eq(resultsB.length, 1);
  eq(resultsA[0].tenantId, "tenant-a");
  eq(resultsB[0].tenantId, "tenant-b");
});

test("listExecutionsByProvenance fail-closed: no filter throws IndexerError", () => {
  const store = new InMemoryReadModelStore();
  let threw = false;
  try {
    store.listExecutionsByProvenance("tenant-a", {});
  } catch (e) {
    threw = true;
    assert(e instanceof IndexerError, "should throw IndexerError");
    eq((e as IndexerError).code, "invalid_input");
  }
  assert(threw, "should have thrown");
});

test("listExecutionsByProvenance returns executions WITHOUT provenance when no provenanceId set", () => {
  const store = new InMemoryReadModelStore();
  store.projectExecution(makeWorkflow("tenant-a", "action-no-prov")); // no provenance
  store.projectExecution(makeWorkflow("tenant-a", "action-with-prov"), PROV_B);

  // Querying by vendor should NOT return the one without provenance set
  const results = store.listExecutionsByProvenance("tenant-a", { vendor: "openai" });
  eq(results.length, 1);
  eq(results[0].actionId, "action-with-prov");
});

// ─── GET /api/audit-trail route ───────────────────────────────────────────────

function makeRouteCtx(tenantId: string, query: Record<string, string>) {
  return { tenantId, body: {}, params: {}, query };
}

async function callAuditTrail(
  store: InMemoryReadModelStore,
  tenantId: string,
  query: Record<string, string>,
) {
  const routes = indexerRoutes(store);
  const route = routes.find((r) => r.method === "GET" && r.pattern === "/api/audit-trail");
  assert(route !== undefined, "audit-trail route must exist");
  return route!.handler(makeRouteCtx(tenantId, query));
}

test("GET /api/audit-trail 200 with provenanceId filter", async () => {
  const store = new InMemoryReadModelStore();
  store.projectExecution(makeWorkflow("tenant-x", "action-1"), PROV_A);
  store.projectExecution(makeWorkflow("tenant-x", "action-2"), PROV_B);

  const res = await callAuditTrail(store, "tenant-x", { provenanceId: PROV_A.provenanceId });
  eq(res.status, 200);
  eq(res.body.executions.length, 1);
  eq(res.body.executions[0].provenanceId, PROV_A.provenanceId);
});

test("GET /api/audit-trail 200 with vendor filter", async () => {
  const store = new InMemoryReadModelStore();
  store.projectExecution(makeWorkflow("tenant-x", "action-1"), PROV_A);
  store.projectExecution(makeWorkflow("tenant-x", "action-2"), PROV_B);
  store.projectExecution(makeWorkflow("tenant-x", "action-3"), PROV_A);

  const res = await callAuditTrail(store, "tenant-x", { vendor: "anthropic" });
  eq(res.status, 200);
  eq(res.body.executions.length, 2);
  assert(res.body.executions.every((e: any) => e.provenanceVendor === "anthropic"), "all results anthropic");
});

test("GET /api/audit-trail 400 when no filter provided", async () => {
  const store = new InMemoryReadModelStore();
  const res = await callAuditTrail(store, "tenant-x", {});
  eq(res.status, 400);
  assert(typeof res.body.error === "string", "error message expected");
});

test("GET /api/audit-trail 400 when tenantId missing", async () => {
  const store = new InMemoryReadModelStore();
  const routes = indexerRoutes(store);
  const route = routes.find((r) => r.pattern === "/api/audit-trail")!;
  const res = await route.handler({ tenantId: "", body: {}, params: {}, query: { vendor: "openai" } });
  eq(res.status, 400);
});

test("GET /api/audit-trail cross-tenant isolation: other tenant gets empty list", async () => {
  const store = new InMemoryReadModelStore();
  store.projectExecution(makeWorkflow("tenant-a", "action-1"), PROV_A);

  // tenant-b queries by same provenanceId — should get empty, not tenant-a's data
  const res = await callAuditTrail(store, "tenant-b", { provenanceId: PROV_A.provenanceId });
  eq(res.status, 200);
  eq(res.body.executions.length, 0);
});

test("GET /api/audit-trail 200 empty list when no matches", async () => {
  const store = new InMemoryReadModelStore();
  const res = await callAuditTrail(store, "tenant-x", { vendor: "xai" });
  eq(res.status, 200);
  eq(res.body.executions.length, 0);
});
