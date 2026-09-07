import "../_flush.mjs";
/**
 * tests/adapter/execution-status-receipt.test.ts
 *
 * Tests for:
 *   lib/adapter/agent-adapter.ts — buildStatusReceipt, verifyStatusReceipt
 *   src/routes/adapter-routes.ts — GET /api/execution/:id/receipt
 *
 * Coverage:
 *   buildStatusReceipt
 *     • happy path: builds receipt with correct fields from a live workflow
 *     • status reflects current status (post-transition)
 *     • actorId is from the last run-log entry
 *     • runLogLength is tamper-evident (increases after each transition)
 *     • empty run-log throws (invariant)
 *     • injectable now() for deterministic issuedAt
 *
 *   verifyStatusReceipt
 *     • returns true for a valid receipt
 *     • returns false when signature is wrong
 *     • returns false when status is mutated after signing
 *     • returns false when runLogLength is mutated after signing
 *     • returns false for wrong version
 *
 *   GET /api/execution/:id/receipt (via adapter-routes + sovereign-server)
 *     • 200 + receipt + workflow for a valid planned workflow
 *     • 200 + receipt reflects "running" status after /approve
 *     • 404 for unknown workflow id
 *     • 404 for cross-tenant access
 *     • receipt.signature is verifiable by the signer
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryExecutionStore } from "../../lib/orchestrator/execution-workflow.ts";
import {
  buildStatusReceipt,
  verifyStatusReceipt,
} from "../../lib/adapter/agent-adapter.ts";
import { adapterRoutes } from "../../src/routes/adapter-routes.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import type { ExecutionWorkflow } from "../../lib/orchestrator/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSigner(): HmacSigner {
  return new HmacSigner("status-receipt-test-secret-key");
}

function makeStore(): InMemoryExecutionStore {
  return new InMemoryExecutionStore();
}

let _seq = 0;
function createWorkflow(store: InMemoryExecutionStore, tenantId = "tenant-alpha"): ExecutionWorkflow {
  _seq++;
  return store.create({ tenantId, actionId: `action-${_seq}` });
}

// ─── buildStatusReceipt ───────────────────────────────────────────────────────

test("buildStatusReceipt: builds receipt with correct fields from a planned workflow", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);

  const receipt = buildStatusReceipt(wf, signer);

  eq(receipt.version, "tfa-status-receipt-v1");
  eq(receipt.executionId, wf.id);
  eq(receipt.tenantId, "tenant-alpha");
  eq(receipt.status, "planned");
  eq(receipt.runLogLength, 1);
  assert(typeof receipt.issuedAt === "string" && receipt.issuedAt.length > 0, "issuedAt should be set");
  assert(typeof receipt.signature === "string" && receipt.signature.length > 0, "signature should be set");
});

test("buildStatusReceipt: status reflects current status after transition", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);
  store.transition(wf.id, "tenant-alpha", "approved", "worker-1");
  store.transition(wf.id, "tenant-alpha", "running", "worker-1");
  const updated = store.get(wf.id, "tenant-alpha")!;

  const receipt = buildStatusReceipt(updated, signer);
  eq(receipt.status, "running");
});

test("buildStatusReceipt: actorId is from the last run-log entry", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);
  store.transition(wf.id, "tenant-alpha", "approved", "approver-bot");
  const updated = store.get(wf.id, "tenant-alpha")!;

  const receipt = buildStatusReceipt(updated, signer);
  eq(receipt.actorId, "approver-bot");
});

test("buildStatusReceipt: runLogLength increases with each transition", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);

  const r1 = buildStatusReceipt(store.get(wf.id, "tenant-alpha")!, signer);
  eq(r1.runLogLength, 1);

  store.transition(wf.id, "tenant-alpha", "approved", "w");
  const r2 = buildStatusReceipt(store.get(wf.id, "tenant-alpha")!, signer);
  eq(r2.runLogLength, 2);

  store.transition(wf.id, "tenant-alpha", "running", "w");
  const r3 = buildStatusReceipt(store.get(wf.id, "tenant-alpha")!, signer);
  eq(r3.runLogLength, 3);
});

test("buildStatusReceipt: injectable now() for deterministic issuedAt", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);

  const receipt = buildStatusReceipt(wf, signer, () => "2030-01-01T00:00:00.000Z");
  eq(receipt.issuedAt, "2030-01-01T00:00:00.000Z");
});

test("buildStatusReceipt: empty run-log throws invariant error", () => {
  const signer = makeSigner();
  const fakeWf: ExecutionWorkflow = {
    id: "fake-id",
    tenantId: "t1",
    actionId: "a1",
    status: "planned",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runLog: [], // invariant violation
    leaseExpiresAt: null,
    claimedBy: null,
  };

  let threw = false;
  try {
    buildStatusReceipt(fakeWf, signer);
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof Error, "should throw an Error");
    assert((e as Error).message.includes("empty run-log"), "error should mention empty run-log");
  }
  assert(threw, "should have thrown");
});

// ─── verifyStatusReceipt ──────────────────────────────────────────────────────

test("verifyStatusReceipt: returns true for a valid receipt", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);
  const receipt = buildStatusReceipt(wf, signer);

  assert(verifyStatusReceipt(receipt, signer), "valid receipt should verify");
});

test("verifyStatusReceipt: returns false when signature is wrong", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);
  const receipt = buildStatusReceipt(wf, signer);

  const tampered = { ...receipt, signature: "invalid-sig" };
  assert(!verifyStatusReceipt(tampered, signer), "tampered signature should fail");
});

test("verifyStatusReceipt: returns false when status is mutated after signing", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);
  const receipt = buildStatusReceipt(wf, signer);

  const tampered = { ...receipt, status: "running" }; // planned was signed, running is fake
  assert(!verifyStatusReceipt(tampered, signer), "mutated status should fail verification");
});

test("verifyStatusReceipt: returns false when runLogLength is mutated after signing", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);
  const receipt = buildStatusReceipt(wf, signer);

  const tampered = { ...receipt, runLogLength: 99 };
  assert(!verifyStatusReceipt(tampered, signer), "mutated runLogLength should fail verification");
});

test("verifyStatusReceipt: returns false for wrong version", () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);
  const receipt = buildStatusReceipt(wf, signer);

  const tampered = { ...receipt, version: "tfa-status-receipt-v0" as any };
  assert(!verifyStatusReceipt(tampered, signer), "wrong version should fail");
});

test("verifyStatusReceipt: returns false for different signer key", () => {
  const signer = makeSigner();
  const otherSigner = new HmacSigner("completely-different-secret-key");
  const store = makeStore();
  const wf = createWorkflow(store);
  const receipt = buildStatusReceipt(wf, signer);

  assert(!verifyStatusReceipt(receipt, otherSigner), "different signer key should fail");
});

// ─── HTTP route: GET /api/execution/:id/receipt ───────────────────────────────

async function apiCall(
  server: import("node:http").Server,
  method: string,
  path: string,
  tenantId: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const port = (server.address() as { port: number }).port;
  const headers: Record<string, string> = {
    "x-tenant-id": tenantId,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let responseBody: unknown;
  try { responseBody = await resp.json(); } catch { responseBody = await resp.text(); }
  return { status: resp.status, body: responseBody };
}

// Build a valid ActionIntent body for POST /api/adapter/run
function intentBody(tenantId: string, riskClass = "read_only") {
  const expiry = new Date(Date.now() + 60_000).toISOString();
  // Map riskClass to a canonical toolId so server-side classification matches intent
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
    actorId: "agent-1",
    toolId: canonicalToolId,
    resourceRef: "resource/data",
    riskClass,
    valueMicrounits: "0",
    privacyLevel: "internal",
    nonce: `nonce-${Date.now()}-${Math.random()}`,
    expiry,
    provenance: "api",
    evidencePolicy: "default",
  };
}

test("GET /api/execution/:id/receipt returns 200 + receipt + workflow for planned workflow", async () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
  await new Promise<void>((r) => server.once("listening", r));
  try {
    // Create a workflow via adapter run (approval_required for human risk class)
    const runRes = await apiCall(server, "POST", "/api/adapter/run", "tenant-r",
      { ...intentBody("tenant-r", "value_moving") });
    const runBody = runRes.body as Record<string, unknown>;
    // value_moving → approval_required → workflow in planned state
    const receipt = runBody.receipt as Record<string, unknown>;
    const approvalToken = receipt?.approvalToken as string | undefined;
    if (!approvalToken) {
      // If auto-approved (depends on policy), fall back to executionId
      const executionId = receipt?.executionId as string;
      assert(typeof executionId === "string", "should have executionId or approvalToken");
      const getRes = await apiCall(server, "GET", `/api/execution/${executionId}/receipt`, "tenant-r");
      eq(getRes.status, 200);
      const getBody = getRes.body as Record<string, unknown>;
      assert(getBody.ok === true, "ok should be true");
      assert(typeof (getBody.receipt as any)?.signature === "string", "receipt.signature should be a string");
    } else {
      const getRes = await apiCall(server, "GET", `/api/execution/${approvalToken}/receipt`, "tenant-r");
      eq(getRes.status, 200);
      const getBody = getRes.body as Record<string, unknown>;
      assert(getBody.ok === true, "ok should be true");
      assert(getBody.receipt !== null, "receipt should be present");
      assert(getBody.workflow !== null, "workflow should be present");
    }
  } finally { server.close(); }
});

test("GET /api/execution/:id/receipt reflects running status after /approve", async () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
  await new Promise<void>((r) => server.once("listening", r));
  try {
    // value_moving → approval_required
    const runRes = await apiCall(server, "POST", "/api/adapter/run", "tenant-ap",
      { ...intentBody("tenant-ap", "value_moving") });
    const runBody = runRes.body as Record<string, unknown>;
    const runReceipt = runBody.receipt as Record<string, unknown>;
    const approvalToken = runReceipt?.approvalToken as string | undefined;

    if (!approvalToken) {
      // auto-approved — check receipt reflects running
      const exId = runReceipt?.executionId as string;
      const getRes = await apiCall(server, "GET", `/api/execution/${exId}/receipt`, "tenant-ap");
      const b = getRes.body as Record<string, unknown>;
      eq((b.receipt as any)?.status, "running");
    } else {
      // approval_required → approve → check receipt reflects running
      await apiCall(server, "POST", `/api/execution/${approvalToken}/approve`, "tenant-ap", {});
      const getRes = await apiCall(server, "GET", `/api/execution/${approvalToken}/receipt`, "tenant-ap");
      eq(getRes.status, 200);
      const b = getRes.body as Record<string, unknown>;
      eq((b.receipt as any)?.status, "running");
    }
  } finally { server.close(); }
});

test("GET /api/execution/:id/receipt returns 404 for unknown workflow", async () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const res = await apiCall(server, "GET", "/api/execution/no-such-id/receipt", "tenant-404");
    eq(res.status, 404);
  } finally { server.close(); }
});

test("GET /api/execution/:id/receipt returns 404 for cross-tenant access", async () => {
  const stack = buildSovereignStack(undefined, { provider: new InMemoryLedger() });
  const server = startSovereignServer(0, stack, { requireIdempotencyKey: false });
  await new Promise<void>((r) => server.once("listening", r));
  try {
    // Create workflow under tenant-owner
    const runRes = await apiCall(server, "POST", "/api/adapter/run", "tenant-owner",
      { ...intentBody("tenant-owner", "value_moving") });
    const runBody = runRes.body as Record<string, unknown>;
    const runReceipt = runBody.receipt as Record<string, unknown>;
    const wfId = (runReceipt?.approvalToken ?? runReceipt?.executionId) as string;
    assert(typeof wfId === "string", "should have a workflow id");

    // Attempt access from a different tenant
    const res = await apiCall(server, "GET", `/api/execution/${wfId}/receipt`, "tenant-intruder");
    eq(res.status, 404);
  } finally { server.close(); }
});

test("GET /api/execution/:id/receipt: receipt.signature is verifiable offline", async () => {
  const signer = makeSigner();
  const store = makeStore();
  const wf = createWorkflow(store);
  store.transition(wf.id, "tenant-alpha", "approved", "approver");
  store.transition(wf.id, "tenant-alpha", "running", "runner");
  const updated = store.get(wf.id, "tenant-alpha")!;

  const receipt = buildStatusReceipt(updated, signer);
  assert(verifyStatusReceipt(receipt, signer), "receipt should be verifiable offline");
  eq(receipt.status, "running");
  eq(receipt.runLogLength, 3);
});
