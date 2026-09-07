import "../_flush.mjs";
/**
 * tests/contract/adapter-flow-live.test.ts
 *
 * Hand-written, STATEFUL contract verification for the adapter/execution/indexer flow —
 * complements the auto-generated `*.contract.test.ts` files (which use one independent
 * probe request per operation and therefore cannot exercise multi-step flows).
 *
 * NOTE on naming: this file deliberately does NOT end in `.contract.test.ts` so the
 * generator/coverage tooling (tests/contract-generator/*) — which treats every
 * `*.contract.test.ts` file as AUTO-GENERATED and counts it toward COVERAGE_REPORT.json —
 * does not pick it up. See `sovereign-new-endpoints-live.test.ts` for the same convention.
 *
 * The auto-generated probes for these five operations are stuck at "reachable-only"
 * because each operation depends on state produced by a *previous* operation in the
 * same flow (e.g. `approveExecution` needs a real `executionId` from `adapterRun`,
 * not the generator's placeholder `"test-id-0000"`). This test drives the real flow
 * end-to-end on a live `startSovereignServer` instance and asserts, for each step:
 *   - live status === the OpenAPI spec's declared success `expectStatus`
 *   - all `required` response-body fields (per `responses.<status>.content
 *     .application/json.schema.required` in lib/api-spec/openapi.yaml) are present
 *
 * Covered operations (spec path → method):
 *   POST /adapter/run                          (adapterRun)               → 201, [ok, decision, receipt]
 *   POST /execution/{id}/approve               (approveExecution)         → 200, [ok, workflow]
 *   GET  /execution/{id}/receipt               (getExecutionReceipt)      → 200, [ok, receipt, workflow]
 *   GET  /index/executions/{id}                (indexGetExecution)        → 200, [execution]
 *   GET  /index/executions/by-action/{actionId}(indexGetExecutionByAction)→ 200, [execution]
 *
 * Two flows are exercised:
 *   1. ALLOWED   (riskClass: read_only)        — adapterRun returns executionId directly,
 *                 workflow is "running"; indexer projections happen via indexerEventBus.
 *   2. APPROVAL  (riskClass: write_destructive)— adapterRun returns approvalToken (planned),
 *                 approveExecution transitions planned → running, receipt reflects "running",
 *                 indexer reflects the post-approval status (projected on /approve too).
 *
 * Edge / fail-closed:
 *   - getExecutionReceipt / approveExecution / indexGetExecution on an unknown id → 404
 *     (declared in spec; not asserted as "verified" success-shape, but confirms the
 *     fail-closed contract for the same routes).
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNonce(): string {
  return "nonce-" + Math.random().toString(36).slice(2);
}

function intent(over: Record<string, unknown> = {}) {
  // Derive a canonical toolId from the riskClass so server-side classification
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

async function call(
  base: string,
  method: string,
  path: string,
  tenantId: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: { "x-tenant-id": tenantId, "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

function assertRequiredFields(body: any, fields: string[], context: string) {
  for (const field of fields) {
    assert(field in body, `${context}: response missing required field "${field}"`);
  }
}

// ─── FLOW 1: allowed (read_only) ───────────────────────────────────────────────

test("contract adapter-flow [allowed]: POST /adapter/run → 201, [ok, decision, receipt]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "contract-flow-allowed";
  try {
    const { status, body } = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "read_only" }));
    eq(status, 201);
    assertRequiredFields(body, ["ok", "decision", "receipt"], "adapterRun (allowed)");
    eq(body.decision, "allowed");
    assert(typeof body.receipt.executionId === "string", "receipt.executionId present");
  } finally { server.close(); }
});

test("contract adapter-flow [allowed]: GET /index/executions/{id} → 200, [execution]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "contract-flow-allowed-idx";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "read_only" }));
    eq(run.status, 201);
    const execId = run.body.receipt.executionId;

    const { status, body } = await call(base, "GET", `/index/executions/${execId}`, tenant);
    eq(status, 200);
    assertRequiredFields(body, ["execution"], "indexGetExecution (allowed)");
    eq(body.execution.id, execId);
    eq(body.execution.status, "running");
  } finally { server.close(); }
});

test("contract adapter-flow [allowed]: GET /index/executions/by-action/{actionId} → 200, [execution]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "contract-flow-allowed-byaction";
  const nonce = makeNonce();
  try {
    // Note: the ExecutionWorkflow's actionId is the intent's nonce (the workflow's
    // intentId doubles as actionId — see lib/adapter/agent-adapter.ts), not toolId.
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "read_only", nonce }));
    eq(run.status, 201);
    const execId = run.body.receipt.executionId;

    const { status, body } = await call(base, "GET", `/index/executions/by-action/${encodeURIComponent(nonce)}`, tenant);
    eq(status, 200);
    assertRequiredFields(body, ["execution"], "indexGetExecutionByAction (allowed)");
    eq(body.execution.id, execId);
  } finally { server.close(); }
});

test("contract adapter-flow [allowed]: GET /execution/{id}/receipt → 200, [ok, receipt, workflow]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "contract-flow-allowed-receipt";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "read_only" }));
    eq(run.status, 201);
    const execId = run.body.receipt.executionId;

    const { status, body } = await call(base, "GET", `/execution/${execId}/receipt`, tenant);
    eq(status, 200);
    assertRequiredFields(body, ["ok", "receipt", "workflow"], "getExecutionReceipt (allowed)");
    assertRequiredFields(
      body.receipt,
      ["version", "executionId", "tenantId", "status", "actorId", "runLogLength", "issuedAt", "signature"],
      "getExecutionReceipt.receipt (allowed)",
    );
    eq(body.receipt.status, "running");
    eq(body.workflow.id, execId);
  } finally { server.close(); }
});

// ─── FLOW 2: approval_required (write_destructive) → approve → receipt ────────

test("contract adapter-flow [approval]: POST /adapter/run → 201 approval_required, then POST /execution/{id}/approve → 200, [ok, workflow]", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "contract-flow-approval";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "write_destructive" }));
    eq(run.status, 201);
    assertRequiredFields(run.body, ["ok", "decision", "receipt"], "adapterRun (approval_required)");
    eq(run.body.decision, "approval_required");
    const token = run.body.receipt.approvalToken;
    assert(typeof token === "string", "receipt.approvalToken present");

    const approve = await call(base, "POST", `/execution/${token}/approve`, tenant, {});
    eq(approve.status, 200);
    assertRequiredFields(approve.body, ["ok", "workflow"], "approveExecution");
    eq(approve.body.workflow.status, "running");
  } finally { server.close(); }
});

test("contract adapter-flow [approval]: GET /execution/{id}/receipt after approve → 200, status=running", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "contract-flow-approval-receipt";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "write_destructive" }));
    eq(run.status, 201);
    const token = run.body.receipt.approvalToken;

    const approve = await call(base, "POST", `/execution/${token}/approve`, tenant, {});
    eq(approve.status, 200);

    const { status, body } = await call(base, "GET", `/execution/${token}/receipt`, tenant);
    eq(status, 200);
    assertRequiredFields(body, ["ok", "receipt", "workflow"], "getExecutionReceipt (post-approval)");
    eq(body.receipt.status, "running");
    eq(body.workflow.status, "running");
  } finally { server.close(); }
});

test("contract adapter-flow [approval]: GET /index/executions/{id} reflects post-approval status", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "contract-flow-approval-idx";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "write_destructive" }));
    eq(run.status, 201);
    const token = run.body.receipt.approvalToken;

    const approve = await call(base, "POST", `/execution/${token}/approve`, tenant, {});
    eq(approve.status, 200);

    const { status, body } = await call(base, "GET", `/index/executions/${token}`, tenant);
    eq(status, 200);
    assertRequiredFields(body, ["execution"], "indexGetExecution (post-approval)");
    eq(body.execution.status, "running");
  } finally { server.close(); }
});

// ─── Fail-closed: unknown id / cross-tenant (404, declared in spec) ────────────

test("contract adapter-flow [fail-closed]: GET /execution/{id}/receipt unknown id → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "GET", "/execution/no-such-id/receipt", "contract-flow-404");
    eq(status, 404);
  } finally { server.close(); }
});

test("contract adapter-flow [fail-closed]: POST /execution/{id}/approve unknown id → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const { status } = await call(base, "POST", "/execution/no-such-id/approve", "contract-flow-404", {});
    eq(status, 404);
  } finally { server.close(); }
});

test("contract adapter-flow [fail-closed]: GET /execution/{id}/receipt cross-tenant → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const run = await call(base, "POST", "/adapter/run", "contract-flow-tenant-a", intent({ riskClass: "read_only" }));
    eq(run.status, 201);
    const execId = run.body.receipt.executionId;

    const { status } = await call(base, "GET", `/execution/${execId}/receipt`, "contract-flow-tenant-b");
    eq(status, 404);
  } finally { server.close(); }
});

test("contract adapter-flow [fail-closed]: GET /index/executions/{id} cross-tenant → 404", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  try {
    const run = await call(base, "POST", "/adapter/run", "contract-flow-tenant-c", intent({ riskClass: "read_only" }));
    eq(run.status, 201);
    const execId = run.body.receipt.executionId;

    const { status } = await call(base, "GET", `/index/executions/${execId}`, "contract-flow-tenant-d");
    eq(status, 404);
  } finally { server.close(); }
});

// ─── DENIED: no workflow opened, no projection ─────────────────────────────────

test("contract adapter-flow [denied]: POST /adapter/run → 201 denied, receipt has no executionId/approvalToken", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "contract-flow-denied";
  try {
    const { status, body } = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "irreversible" }));
    eq(status, 201);
    assertRequiredFields(body, ["ok", "decision", "receipt"], "adapterRun (denied)");
    eq(body.decision, "denied");
    eq(body.receipt.executionId, undefined);
    eq(body.receipt.approvalToken, undefined);
  } finally { server.close(); }
});
