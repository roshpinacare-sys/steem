import "../_flush.mjs";
/**
 * tests/transparency-log/consistency-routes.test.ts
 *
 * Tests for:
 *   GET /api/transparency-log/consistency?oldSize=N  (consistency proof endpoint)
 *   GET /api/transparency-log/consistency/monitor    (monitor endpoint)
 *
 * Coverage:
 *   Happy path — valid oldSize returns proof with verifiable roots
 *   Edge — oldSize == currentLeafCount (m == n, trivially consistent)
 *   Fail-closed — missing tenant-id → 400
 *   Fail-closed — missing oldSize param → 400
 *   Fail-closed — non-integer oldSize → 400
 *   Fail-closed — oldSize > leafCount → 404
 *   Fail-closed — no leaves yet → 404
 *   Monitor — single root (nothing to check) → ok: true, checked: 0
 *   Monitor — multiple roots, all consistent → ok: true
 *   Monitor — missing tenant-id → 400
 *   Cross-tenant isolation — tenant-b cannot see tenant-a leaves
 */

import { test, assert, eq } from "../_harness.mjs";
import { transparencyLogRoutes } from "../../src/routes/transparency-log-routes.ts";
import { InMemoryTransparencyLog } from "../../lib/transparency-log/index.ts";
import { verifyConsistencyProof } from "../../lib/transparency-log/consistency-proof.ts";
import type { ExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";

function makeReceipt(nonce: string, tenantId = "tenant-a"): ExecutionReceipt {
  return {
    version: "tfa-receipt-v1",
    intentId: nonce,
    tenantId,
    actorId: "actor-1",
    toolId: "tool.read",
    resourceRef: "res-1",
    riskClass: "read_only",
    approvalClass: "auto",
    decision: "allowed",
    valueMicrounits: "0",
    decisionTrace: {
      policy: "tfa-agent-adapter",
      riskClass: "read_only",
      approvalClass: "auto",
      timestamp: "2026-06-20T00:00:00.000Z",
      signature: "sig-" + nonce,
    },
    issuedAt: "2026-06-20T00:00:00.000Z",
    serverRiskClass: "read_only",
    clientClaimedRiskClass: "read_only",
    riskSource: "coding_taxonomy",
    signature: "receipt-sig-" + nonce,
  };
}

function fakeStack(log: InMemoryTransparencyLog) {
  return { transparencyLog: log } as any;
}

function getRoute(log: InMemoryTransparencyLog, pattern: string) {
  const routes = transparencyLogRoutes(fakeStack(log));
  return routes.find((r) => r.method === "GET" && r.pattern === pattern)!;
}

// ─── /api/transparency-log/consistency ───────────────────────────────────────

test("GET /api/transparency-log/consistency — happy path returns verifiable proof", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency");

  // Add 4 receipts (two batches of 2) so we have two anchored roots
  for (let i = 1; i <= 4; i++) {
    await log.appendReceipt("tenant-a", makeReceipt(`r${i}`));
  }
  // Get roots so we know what oldRoot to expect
  const roots = await log.getRoots("tenant-a");
  eq(roots.length, 2, "should have 2 anchored roots after 4 receipts in batches of 2");

  const oldRoot = roots[0];
  const newRoot = roots[1];

  const res = await route.handler({
    tenantId: "tenant-a",
    body: {},
    params: {},
    query: { oldSize: String(oldRoot.leafCount) },
  });
  eq(res.status, 200);
  const body = res.body as any;
  assert(body.ok, "ok should be true");
  assert(body.proof !== null, "proof should be present");
  eq(body.proof.oldSize, oldRoot.leafCount);
  eq(body.proof.newSize, newRoot.leafCount);

  // Caller can independently verify the proof
  const verified = verifyConsistencyProof(body.proof, oldRoot.root, newRoot.root);
  assert(verified, "proof should verify against actual roots");
});

test("GET /api/transparency-log/consistency — oldSize == leafCount (m==n)", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency");

  for (let i = 1; i <= 4; i++) {
    await log.appendReceipt("tenant-a", makeReceipt(`r${i}`));
  }
  const root = await log.currentRoot("tenant-a");
  assert(root !== null);

  // When oldSize == leafCount the proof is trivial (same tree)
  const res = await route.handler({
    tenantId: "tenant-a",
    body: {},
    params: {},
    query: { oldSize: String(root!.leafCount) },
  });
  eq(res.status, 200);
  const body = res.body as any;
  assert(body.ok);
  eq(body.proof.oldSize, body.proof.newSize);
  const verified = verifyConsistencyProof(body.proof, root!.root, root!.root);
  assert(verified, "m==n proof should verify both roots as equal");
});

test("GET /api/transparency-log/consistency — missing tenant-id → 400", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency");

  const res = await route.handler({ tenantId: "", body: {}, params: {}, query: { oldSize: "1" } });
  eq(res.status, 400);
});

test("GET /api/transparency-log/consistency — missing oldSize param → 400", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency");

  await log.appendReceipt("tenant-a", makeReceipt("r1"));
  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: {}, query: {} });
  eq(res.status, 400);
});

test("GET /api/transparency-log/consistency — non-integer oldSize → 400", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency");

  for (let i = 1; i <= 2; i++) await log.appendReceipt("tenant-a", makeReceipt(`r${i}`));
  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: {}, query: { oldSize: "abc" } });
  eq(res.status, 400);
});

test("GET /api/transparency-log/consistency — no leaves yet → 404", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency");

  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: {}, query: { oldSize: "1" } });
  eq(res.status, 404);
});

test("GET /api/transparency-log/consistency — oldSize > leafCount → 404", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency");

  for (let i = 1; i <= 2; i++) await log.appendReceipt("tenant-a", makeReceipt(`r${i}`));
  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: {}, query: { oldSize: "999" } });
  eq(res.status, 404);
});

test("GET /api/transparency-log/consistency — cross-tenant isolation → 404", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency");

  // tenant-a has leaves
  for (let i = 1; i <= 2; i++) await log.appendReceipt("tenant-a", makeReceipt(`r${i}`));
  // tenant-b asks for a proof — should get 404 (no leaves for tenant-b)
  const res = await route.handler({ tenantId: "tenant-b", body: {}, params: {}, query: { oldSize: "1" } });
  eq(res.status, 404);
});

// ─── /api/transparency-log/consistency/monitor ───────────────────────────────

test("GET /api/transparency-log/consistency/monitor — no roots → ok:true, checked:0", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency/monitor");

  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: {}, query: {} });
  eq(res.status, 200);
  const body = res.body as any;
  assert(body.ok);
  eq(body.checked, 0);
  eq(body.failures, 0);
  eq(body.rootCount, 0);
});

test("GET /api/transparency-log/consistency/monitor — single root → ok:true, checked:0", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency/monitor");

  for (let i = 1; i <= 2; i++) await log.appendReceipt("tenant-a", makeReceipt(`r${i}`));
  // batchSize=2 → one root after 2 receipts
  const roots = await log.getRoots("tenant-a");
  eq(roots.length, 1);

  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: {}, query: {} });
  eq(res.status, 200);
  const body = res.body as any;
  assert(body.ok);
  eq(body.checked, 0, "nothing to check with a single root");
  eq(body.rootCount, 1);
});

test("GET /api/transparency-log/consistency/monitor — multiple roots, all consistent", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency/monitor");

  // 6 receipts → 3 roots (every 2 receipts triggers a batch)
  for (let i = 1; i <= 6; i++) await log.appendReceipt("tenant-a", makeReceipt(`r${i}`));
  const roots = await log.getRoots("tenant-a");
  eq(roots.length, 3, "should have 3 anchored roots");

  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: {}, query: {} });
  eq(res.status, 200);
  const body = res.body as any;
  assert(body.ok, "all transitions should be consistent in an append-only log");
  eq(body.checked, 2, "checked 2 consecutive pairs for 3 roots");
  eq(body.failures, 0);
  eq(body.rootCount, 3);
});

test("GET /api/transparency-log/consistency/monitor — missing tenant-id → 400", async () => {
  const log = new InMemoryTransparencyLog(2);
  const route = getRoute(log, "/api/transparency-log/consistency/monitor");

  const res = await route.handler({ tenantId: "", body: {}, params: {}, query: {} });
  eq(res.status, 400);
});
