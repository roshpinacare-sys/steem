import "../_flush.mjs";
/**
 * tests/routes/execution-routes.test.ts — ExecutionWorkflow HTTP route handlers.
 *
 * Uses InMemoryExecutionStore — no pool, no Postgres.
 * Tests the handler logic (status codes, body shape, fail-closed guards).
 *
 * Coverage:
 *   POST /api/execution         — create workflow (happy + bad input)
 *   GET  /api/execution         — list workflows for tenant
 *   GET  /api/execution/:id     — get by id (happy + wrong tenant → 404)
 *   POST /api/execution/:id/transition  — transition (happy + invalid → 422 + wrong tenant → 404)
 *   POST /api/execution/:id/supervise   — supervise failed workflow (happy + not-failed → 422)
 *   Tenant isolation            — no x-tenant-id → 400; cross-tenant → 404
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import { executionRoutes } from "../../src/routes/execution-routes.ts";
import type { Ctx } from "../../src/routes/execution-routes.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRouter() {
  const store = new InMemoryExecutionStore();
  const routes = executionRoutes(store);

  function call(method: string, path: string, ctx: Partial<Ctx>) {
    const fullCtx: Ctx = {
      tenantId: ctx.tenantId ?? "tenant-a",
      body: ctx.body ?? {},
      params: ctx.params ?? {},
    };
    const route = routes.find(
      (r) => r.method === method && r.pattern === path,
    );
    if (!route) throw new Error(`No route: ${method} ${path}`);
    return Promise.resolve(route.handler(fullCtx));
  }

  return { store, call };
}

// ─── POST /api/execution ──────────────────────────────────────────────────────

test("POST /api/execution creates a workflow and returns 201", async () => {
  const { call } = makeRouter();
  const res = await call("POST", "/api/execution", {
    body: { actionId: "action-123" },
  });
  eq(res.status, 201);
  assert(res.body.ok, "ok");
  assert(res.body.workflow.id.length > 0, "has id");
  eq(res.body.workflow.status, "planned");
  eq(res.body.workflow.actionId, "action-123");
});

test("POST /api/execution stores optional fields", async () => {
  const { call } = makeRouter();
  const res = await call("POST", "/api/execution", {
    body: {
      actionId: "action-x",
      intentId: "intent-1",
      executionRef: "ref-abc",
      approvalId: "appr-7",
      evidenceRefs: ["ev-1", "ev-2"],
      retryOfWorkflowId: "prev-id",
    },
  });
  eq(res.status, 201);
  const wf = res.body.workflow;
  eq(wf.intentId, "intent-1");
  eq(wf.executionRef, "ref-abc");
  eq(wf.retryOfWorkflowId, "prev-id");
});

test("POST /api/execution without actionId returns 400", async () => {
  const { call } = makeRouter();
  const res = await call("POST", "/api/execution", { body: {} });
  eq(res.status, 400);
  assert(res.body.error.length > 0);
});

test("POST /api/execution without tenantId returns 400", async () => {
  const { call } = makeRouter();
  const res = await call("POST", "/api/execution", {
    tenantId: "",
    body: { actionId: "a1" },
  });
  eq(res.status, 400);
});

// ─── GET /api/execution ───────────────────────────────────────────────────────

test("GET /api/execution lists workflows for tenant", async () => {
  const { call } = makeRouter();
  await call("POST", "/api/execution", { body: { actionId: "a1" } });
  await call("POST", "/api/execution", { body: { actionId: "a2" } });
  await call("POST", "/api/execution", { tenantId: "tenant-b", body: { actionId: "a3" } });

  const res = await call("GET", "/api/execution", {});
  eq(res.status, 200);
  eq(res.body.workflows.length, 2);
  assert(res.body.workflows.every((w: any) => w.tenantId === "tenant-a"));
});

test("GET /api/execution returns empty list for unknown tenant", async () => {
  const { call } = makeRouter();
  const res = await call("GET", "/api/execution", { tenantId: "unknown-tenant" });
  eq(res.status, 200);
  eq(res.body.workflows.length, 0);
});

// ─── GET /api/execution/:id ───────────────────────────────────────────────────

test("GET /api/execution/:id returns the workflow", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", { body: { actionId: "a1" } });
  const id = created.body.workflow.id;

  const res = await call("GET", "/api/execution/:id", { params: { id } });
  eq(res.status, 200);
  eq(res.body.workflow.id, id);
  eq(res.body.workflow.status, "planned");
});

test("GET /api/execution/:id returns 404 for wrong tenant", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", {
    tenantId: "tenant-a",
    body: { actionId: "a1" },
  });
  const id = created.body.workflow.id;

  const res = await call("GET", "/api/execution/:id", {
    tenantId: "tenant-b",
    params: { id },
  });
  eq(res.status, 404);
});

test("GET /api/execution/:id returns 404 for non-existent workflow", async () => {
  const { call } = makeRouter();
  const res = await call("GET", "/api/execution/:id", {
    params: { id: "nonexistent" },
  });
  eq(res.status, 404);
});

// ─── POST /api/execution/:id/transition ──────────────────────────────────────

test("POST /api/execution/:id/transition transitions status successfully", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", { body: { actionId: "a1" } });
  const id = created.body.workflow.id;

  const res = await call("POST", "/api/execution/:id/transition", {
    params: { id },
    body: { toStatus: "approved", actor: "operator-1", reason: "approved by policy" },
  });
  eq(res.status, 200);
  eq(res.body.workflow.status, "approved");
  eq(res.body.workflow.runLog.length, 2);
});

test("POST /api/execution/:id/transition invalid transition returns 422", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", { body: { actionId: "a1" } });
  const id = created.body.workflow.id;

  const res = await call("POST", "/api/execution/:id/transition", {
    params: { id },
    body: { toStatus: "settled", actor: "hacker" },
  });
  eq(res.status, 422);
});

test("POST /api/execution/:id/transition missing toStatus returns 400", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", { body: { actionId: "a1" } });
  const id = created.body.workflow.id;

  const res = await call("POST", "/api/execution/:id/transition", {
    params: { id },
    body: { actor: "op" },
  });
  eq(res.status, 400);
});

test("POST /api/execution/:id/transition wrong tenant returns 404", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", {
    tenantId: "tenant-a",
    body: { actionId: "a1" },
  });
  const id = created.body.workflow.id;

  const res = await call("POST", "/api/execution/:id/transition", {
    tenantId: "tenant-b",
    params: { id },
    body: { toStatus: "approved", actor: "op" },
  });
  eq(res.status, 404);
});

// ─── POST /api/execution/:id/supervise ───────────────────────────────────────

test("POST /api/execution/:id/supervise schedules a retry for a failed workflow", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", { body: { actionId: "a1" } });
  const id = created.body.workflow.id;

  await call("POST", "/api/execution/:id/transition", {
    params: { id }, body: { toStatus: "approved", actor: "op" },
  });
  await call("POST", "/api/execution/:id/transition", {
    params: { id }, body: { toStatus: "running", actor: "worker" },
  });
  await call("POST", "/api/execution/:id/transition", {
    params: { id }, body: { toStatus: "failed", actor: "worker", reason: "crash" },
  });

  const res = await call("POST", "/api/execution/:id/supervise", {
    params: { id },
    body: { workerId: "supervisor-1" },
  });

  eq(res.status, 200);
  assert(res.body.ok);
  assert(res.body.plan.retry, "retry scheduled");
  assert(res.body.retryWorkflow !== null, "retry workflow created");
  eq(res.body.retryWorkflow.retryOfWorkflowId, id);
  eq(res.body.original.id, id);
});

test("POST /api/execution/:id/supervise on non-failed workflow returns 422", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", { body: { actionId: "a1" } });
  const id = created.body.workflow.id;

  const res = await call("POST", "/api/execution/:id/supervise", {
    params: { id },
    body: { workerId: "supervisor-1" },
  });
  eq(res.status, 422);
});

test("POST /api/execution/:id/supervise without workerId returns 400", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", { body: { actionId: "a1" } });
  const id = created.body.workflow.id;

  const res = await call("POST", "/api/execution/:id/supervise", {
    params: { id },
    body: {},
  });
  eq(res.status, 400);
});

test("POST /api/execution/:id/supervise wrong tenant returns 404", async () => {
  const { call } = makeRouter();
  const created = await call("POST", "/api/execution", {
    tenantId: "tenant-a",
    body: { actionId: "a1" },
  });
  const id = created.body.workflow.id;

  const res = await call("POST", "/api/execution/:id/supervise", {
    tenantId: "tenant-b",
    params: { id },
    body: { workerId: "supervisor-1" },
  });
  eq(res.status, 404);
});
