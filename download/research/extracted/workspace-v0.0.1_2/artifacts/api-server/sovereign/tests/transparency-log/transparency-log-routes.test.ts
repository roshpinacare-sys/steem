import "../_flush.mjs";
/**
 * tests/transparency-log/transparency-log-routes.test.ts
 *
 * Tests for src/routes/transparency-log-routes.ts
 * Coverage:
 *   GET /api/transparency/log/root — returns current root
 *   GET /api/transparency/log/proof/:receiptId — returns proof or 404
 *   Missing tenant-id → 400
 *   Unknown receiptId → 404 (fail-closed)
 *   Cross-tenant isolation via TransparencyLog
 */

import { test, assert, eq } from "../_harness.mjs";
import { transparencyLogRoutes } from "../../src/routes/transparency-log-routes.ts";
import { InMemoryTransparencyLog } from "../../lib/transparency-log/index.ts";
import type { ExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";

function makeReceipt(nonce: string): ExecutionReceipt {
  return {
    version: "tfa-receipt-v1",
    intentId: nonce,
    tenantId: "tenant-a",
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
      timestamp: "2026-06-15T00:00:00.000Z",
      signature: "sig-" + nonce,
    },
    issuedAt: "2026-06-15T00:00:00.000Z",
    serverRiskClass: "read_only",
    clientClaimedRiskClass: "read_only",
    riskSource: "coding_taxonomy",
    signature: "receipt-sig-" + nonce,
  };
}

function fakeStack(log: InMemoryTransparencyLog) {
  return {
    transparencyLog: log,
  } as any;
}

// ─── GET /api/transparency/log/root ───────────────────────────────────────────

test("GET /api/transparency/log/root — returns root", async () => {
  const log = new InMemoryTransparencyLog(2);
  const routes = transparencyLogRoutes(fakeStack(log));
  const route = routes.find((r) => r.method === "GET" && r.pattern === "/api/transparency/log/root")!;

  await log.appendReceipt("tenant-a", makeReceipt("r1"), "r1-id");
  await log.appendReceipt("tenant-a", makeReceipt("r2"), "r2-id");

  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: {}, query: {} });
  eq(res.status, 200);
  const body = res.body as any;
  assert(body.ok, "should be ok");
  assert(body.root !== null, "root should exist");
  eq(body.root.leafCount, 2);
});

test("GET /api/transparency/log/root — missing tenant → 400", async () => {
  const log = new InMemoryTransparencyLog(2);
  const routes = transparencyLogRoutes(fakeStack(log));
  const route = routes.find((r) => r.method === "GET" && r.pattern === "/api/transparency/log/root")!;

  const res = await route.handler({ tenantId: "", body: {}, params: {}, query: {} });
  eq(res.status, 400);
});

test("GET /api/transparency/log/root — no receipts yet → null root", async () => {
  const log = new InMemoryTransparencyLog(2);
  const routes = transparencyLogRoutes(fakeStack(log));
  const route = routes.find((r) => r.method === "GET" && r.pattern === "/api/transparency/log/root")!;

  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: {}, query: {} });
  eq(res.status, 200);
  const body = res.body as any;
  eq(body.root, null);
});

// ─── GET /api/transparency/log/proof/:receiptId ───────────────────────────────

test("GET /api/transparency/log/proof/:receiptId — returns proof", async () => {
  const log = new InMemoryTransparencyLog(2);
  const routes = transparencyLogRoutes(fakeStack(log));
  const route = routes.find((r) => r.method === "GET" && r.pattern === "/api/transparency/log/proof/:receiptId")!;

  await log.appendReceipt("tenant-a", makeReceipt("r1"), "r1-id");
  await log.appendReceipt("tenant-a", makeReceipt("r2"), "r2-id");

  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: { receiptId: "r1-id" }, query: {} });
  eq(res.status, 200);
  const body = res.body as any;
  assert(body.ok, "should be ok");
  assert(body.proof !== null, "proof should exist");
  assert(body.root !== null, "root should exist");
  eq(body.leafIndex, 0);
});

test("GET /api/transparency/log/proof/:receiptId — unknown → 404", async () => {
  const log = new InMemoryTransparencyLog(2);
  const routes = transparencyLogRoutes(fakeStack(log));
  const route = routes.find((r) => r.method === "GET" && r.pattern === "/api/transparency/log/proof/:receiptId")!;

  await log.appendReceipt("tenant-a", makeReceipt("r1"), "r1-id");
  await log.appendReceipt("tenant-a", makeReceipt("r2"), "r2-id");

  const res = await route.handler({ tenantId: "tenant-a", body: {}, params: { receiptId: "unknown" }, query: {} });
  eq(res.status, 404);
});

test("GET /api/transparency/log/proof/:receiptId — missing tenant → 400", async () => {
  const log = new InMemoryTransparencyLog(2);
  const routes = transparencyLogRoutes(fakeStack(log));
  const route = routes.find((r) => r.method === "GET" && r.pattern === "/api/transparency/log/proof/:receiptId")!;

  const res = await route.handler({ tenantId: "", body: {}, params: { receiptId: "r1" }, query: {} });
  eq(res.status, 400);
});

test("GET /api/transparency/log/proof/:receiptId — cross-tenant → 404", async () => {
  const log = new InMemoryTransparencyLog(2);
  const routes = transparencyLogRoutes(fakeStack(log));
  const route = routes.find((r) => r.method === "GET" && r.pattern === "/api/transparency/log/proof/:receiptId")!;

  await log.appendReceipt("tenant-a", makeReceipt("r1"), "r1-id");
  await log.appendReceipt("tenant-a", makeReceipt("r2"), "r2-id");

  const res = await route.handler({ tenantId: "tenant-b", body: {}, params: { receiptId: "r1-id" }, query: {} });
  eq(res.status, 404);
});
