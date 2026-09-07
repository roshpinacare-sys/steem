import "../_flush.mjs";
/**
 * tests/routes/adapter-routes.test.ts — v157.
 * End-to-end flow verification: POST /api/adapter/run → receipt + workflow,
 * GET /api/execution/:id (via execution-routes), POST /api/execution/:id/approve.
 *
 * This is the GTMTECH "flow one" test:
 *   intent → adapter → execution → status queryable → approval path
 *
 *   ALLOWED   read_only → decision "allowed" → executionId in receipt,
 *             workflow status "running", receipt verifiable.
 *   APPROVAL  write_destructive → decision "approval_required" → approvalToken,
 *             workflow status "planned", then /approve → "running".
 *   DENIED    irreversible → decision "denied" → no workflow opened.
 *   FAIL-CLOSED  bad intent (missing field) → 400; missing tenantId → 400;
 *                approve non-planned → 422; approve unknown id → 404;
 *                cross-tenant approve → 404.
 *   EDGE      valueMicrounits as decimal string; verify receipt; tampered receipt.
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { adapterRoutes } from "../../src/routes/adapter-routes.ts";
import { executionRoutes } from "../../src/routes/execution-routes.ts";
import { verifyExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";
import type { Ctx } from "../../src/routes/adapter-routes.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const signer = new HmacSigner("adapter-routes-test-secret-42");

function makeStack() {
  const store = new InMemoryExecutionStore();
  const adRoutes = adapterRoutes(signer, store);
  const exRoutes = executionRoutes(store);
  const allRoutes = [...adRoutes, ...exRoutes];

  function call(method: string, path: string, ctx: Partial<Ctx> & { tenantId?: string }) {
    // Find the route: exact pattern match or parameterized match.
    const route = allRoutes.find((r) => {
      if (r.method !== method) return false;
      if (r.pattern === path) return true;
      // match /api/x/:id style
      const paramRe = new RegExp(
        "^" + r.pattern.replace(/:([a-zA-Z_]+)/g, "([^/]+)") + "$"
      );
      return paramRe.test(path);
    });
    if (!route) throw new Error(`No route: ${method} ${path}`);

    // Extract path params
    const params: Record<string, string> = ctx.params ?? {};
    if (!ctx.params) {
      const paramRe = new RegExp("^" + route.pattern.replace(/:([a-zA-Z_]+)/g, "([^/]+)") + "$");
      const names = [...route.pattern.matchAll(/:([a-zA-Z_]+)/g)].map((m) => m[1]);
      const match = path.match(paramRe);
      if (match) names.forEach((n, i) => (params[n] = match[i + 1]));
    }

    const fullCtx: Ctx = {
      tenantId: ctx.tenantId ?? "tenant-a",
      body: ctx.body ?? {},
      params,
    };
    return Promise.resolve(route.handler(fullCtx));
  }

  return { store, call };
}

function makeNonce() {
  return "nonce-" + Math.random().toString(36).slice(2);
}

function intent(over: Record<string, unknown> = {}) {
  // Derive a canonical toolId from riskClass so server-side classification
  // matches the intended test path. Overrides can still set an explicit toolId.
  const riskClass = (over.riskClass as string) ?? "read_only";
  const toolIdForRisk: Record<string, string> = {
    read_only: "file.read",
    write_safe: "git.commit",
    write_destructive: "file.delete",
    value_moving: "ledger.mint",
    irreversible: "shell.exec",
    privacy_sensitive: "env.read",
  };
  const canonicalToolId = toolIdForRisk[riskClass];
  if (!canonicalToolId) throw new Error(`No canonical toolId for riskClass: ${riskClass}`);
  return {
    actorId: "agent:alpha",
    toolId: canonicalToolId,
    resourceRef: "resource:doc-1",
    riskClass,
    valueMicrounits: "0",
    privacyLevel: "internal",
    approvalPolicyRef: "pol:default",
    nonce: makeNonce(),
    expiry: "2099-01-01T00:00:00.000Z",
    provenance: "test",
    evidencePolicy: "ev:default",
    ...over,
  };
}

// ─── ALLOWED: read_only → executionId in receipt → workflow "running" ─────────

test("POST /api/adapter/run: allowed → receipt.executionId, workflow status=running", async () => {
  const { call, store } = makeStack();
  const res = await call("POST", "/api/adapter/run", {
    tenantId: "t1",
    body: intent({ riskClass: "read_only", nonce: makeNonce() }),
  });
  eq(res.status, 201);
  assert(res.body.ok, "ok");
  eq(res.body.decision, "allowed");
  assert(typeof res.body.receipt.executionId === "string", "executionId present");
  eq(res.body.receipt.approvalToken, undefined);
  // receipt is self-verifying
  assert(verifyExecutionReceipt(res.body.receipt, signer), "receipt verifies");
  // workflow is queryable and in "running" state
  const wf = store.get(res.body.receipt.executionId, "t1");
  eq(wf!.status, "running");
  eq(wf!.runLog.length, 3, "genesis + approved + running = 3 entries");
});

test("POST /api/adapter/run: GET /api/execution/:id returns the same workflow", async () => {
  const { call } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", {
    tenantId: "t1",
    body: intent({ riskClass: "write_safe", nonce: makeNonce() }),
  });
  const execId = runRes.body.receipt.executionId;
  assert(execId, "executionId present");

  const getRes = await call("GET", `/api/execution/${execId}`, { tenantId: "t1" });
  eq(getRes.status, 200);
  eq(getRes.body.workflow.id, execId);
  eq(getRes.body.workflow.status, "running");
});

// ─── APPROVAL_REQUIRED: write_destructive → planned → POST /approve → running ─

test("POST /api/adapter/run: approval_required → approvalToken, status=planned", async () => {
  const { call, store } = makeStack();
  const res = await call("POST", "/api/adapter/run", {
    tenantId: "t2",
    body: intent({ riskClass: "write_destructive", nonce: makeNonce() }),
  });
  eq(res.status, 201);
  eq(res.body.decision, "approval_required");
  assert(typeof res.body.receipt.approvalToken === "string", "approvalToken present");
  eq(res.body.receipt.executionId, undefined);
  assert(verifyExecutionReceipt(res.body.receipt, signer), "receipt verifies");
  const wf = store.get(res.body.receipt.approvalToken, "t2");
  eq(wf!.status, "planned");
});

test("POST /api/execution/:id/approve: planned → running (full approval flow)", async () => {
  const { call } = makeStack();
  // 1. Run → planned
  const runRes = await call("POST", "/api/adapter/run", {
    tenantId: "t2",
    body: intent({ riskClass: "write_destructive", nonce: makeNonce() }),
  });
  const token = runRes.body.receipt.approvalToken;
  eq(runRes.body.workflow.status, "planned");

  // 2. Approve → running
  const approveRes = await call("POST", `/api/execution/${token}/approve`, {
    tenantId: "t2",
    body: { actor: "human-reviewer", reason: "looks good" },
  });
  eq(approveRes.status, 200);
  assert(approveRes.body.ok, "ok");
  eq(approveRes.body.workflow.status, "running");
  eq(approveRes.body.workflow.id, token);

  // 3. GET confirms running
  const getRes = await call("GET", `/api/execution/${token}`, { tenantId: "t2" });
  eq(getRes.status, 200);
  eq(getRes.body.workflow.status, "running");
});

// ─── DENIED: irreversible → no workflow ──────────────────────────────────────

test("POST /api/adapter/run: denied → no executionId, no approvalToken, no workflow", async () => {
  const { call, store } = makeStack();
  const res = await call("POST", "/api/adapter/run", {
    tenantId: "t1",
    body: intent({ riskClass: "irreversible", nonce: makeNonce() }),
  });
  eq(res.status, 201);
  eq(res.body.decision, "denied");
  eq(res.body.receipt.executionId, undefined);
  eq(res.body.receipt.approvalToken, undefined);
  assert(verifyExecutionReceipt(res.body.receipt, signer), "receipt verifies even for denial");
  // No workflows in store for this tenant
  const wfs = store.list("t1");
  eq(wfs.length, 0);
});

// ─── EDGE: valueMicrounits as decimal string ──────────────────────────────────

test("POST /api/adapter/run: valueMicrounits as decimal string is accepted", async () => {
  const { call } = makeStack();
  const res = await call("POST", "/api/adapter/run", {
    tenantId: "t1",
    body: intent({ riskClass: "read_only", valueMicrounits: "500000", nonce: makeNonce() }),
  });
  eq(res.status, 201);
  eq(res.body.receipt.valueMicrounits, "500000");
  assert(verifyExecutionReceipt(res.body.receipt, signer), "receipt verifies");
});

// ─── FAIL-CLOSED ─────────────────────────────────────────────────────────────

test("POST /api/adapter/run: missing tenantId → 400", async () => {
  const { call } = makeStack();
  const res = await call("POST", "/api/adapter/run", {
    tenantId: "",
    body: intent(),
  });
  eq(res.status, 400);
});

test("POST /api/adapter/run: missing actorId → 400 (invalid intent)", async () => {
  const { call } = makeStack();
  const body = intent();
  delete (body as any).actorId;
  const res = await call("POST", "/api/adapter/run", { tenantId: "t1", body });
  eq(res.status, 400);
  assert(res.body.error.length > 0, "error message present");
});

test("POST /api/adapter/run: expired intent → 400", async () => {
  const { call } = makeStack();
  const res = await call("POST", "/api/adapter/run", {
    tenantId: "t1",
    body: intent({ expiry: "2000-01-01T00:00:00.000Z", nonce: makeNonce() }),
  });
  eq(res.status, 400);
  assert(res.body.error.includes("expiry"), "expiry mentioned in error");
});

test("POST /api/execution/:id/approve: non-planned workflow → 422", async () => {
  const { call } = makeStack();
  // Create a "running" workflow via allowed
  const runRes = await call("POST", "/api/adapter/run", {
    tenantId: "t3",
    body: intent({ riskClass: "read_only", nonce: makeNonce() }),
  });
  const id = runRes.body.receipt.executionId;
  eq(runRes.body.workflow.status, "running");

  const approveRes = await call("POST", `/api/execution/${id}/approve`, {
    tenantId: "t3",
    body: {},
  });
  eq(approveRes.status, 422);
  assert(approveRes.body.error.includes("planned"), "error mentions planned");
});

test("POST /api/execution/:id/approve: unknown id → 404", async () => {
  const { call } = makeStack();
  const res = await call("POST", `/api/execution/no-such-id/approve`, {
    tenantId: "t1",
    body: {},
  });
  eq(res.status, 404);
});

test("POST /api/execution/:id/approve: cross-tenant access → 404", async () => {
  const { call } = makeStack();
  const runRes = await call("POST", "/api/adapter/run", {
    tenantId: "t4",
    body: intent({ riskClass: "write_destructive", nonce: makeNonce() }),
  });
  const token = runRes.body.receipt.approvalToken;

  // Different tenant tries to approve
  const approveRes = await call("POST", `/api/execution/${token}/approve`, {
    tenantId: "t5",
    body: {},
  });
  eq(approveRes.status, 404);
});
