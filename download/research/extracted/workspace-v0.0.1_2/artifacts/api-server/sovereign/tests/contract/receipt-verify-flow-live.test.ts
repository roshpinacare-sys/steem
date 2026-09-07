import "../_flush.mjs";
/**
 * tests/contract/receipt-verify-flow-live.test.ts
 *
 * Hand-written, STATEFUL contract verification for POST /receipt/verify —
 * complements the auto-generated `verifyReceipt.contract.test.ts` (which uses
 * a minimal empty receipt and therefore cannot exercise genuine signature +
 * decision integrity validation).
 *
 * NOTE: deliberately does NOT end in `.contract.test.ts` so the generator
 * does not treat it as auto-generated.
 *
 * Flows covered:
 *   1. ALLOWED (read_only)    → real receipt → verify → valid=true
 *   2. APPROVAL (write_destructive) → real receipt → verify → valid=true
 *   3. DENIED (irreversible)  → real receipt → verify → valid=true
 *   4. TAMPERED               → real receipt, tampered decision → valid=false
 *   5. STATUS receipt         → real receipt with status version → decisionValid=true
 *   6. FAIL-CLOSED: missing receipt → 400
 *   7. FAIL-CLOSED: unknown version → 200, valid=false
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

function intent(over: Record<string, unknown> = {}) {
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
    nonce: "nonce-" + Math.random().toString(36).slice(2),
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

// ─── FLOW 1: allowed (read_only) ───────────────────────────────────────────────

test("contract receipt-verify-flow [allowed]: real receipt → valid=true, signatureValid=true, decisionValid=true", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "rvf-allowed";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "read_only" }));
    eq(run.status, 201);
    const receipt = run.body.receipt;
    assert(typeof receipt === "object" && receipt !== null, "receipt must be an object");
    assert(receipt.signature, "receipt must carry a signature");

    const { status, body } = await call(base, "POST", "/receipt/verify", tenant, { receipt });
    eq(status, 200);
    eq(body.ok, true);
    eq(body.valid, true);
    eq(body.signatureValid, true);
    eq(body.decisionValid, true);
    eq(body.reasons.length, 0);
  } finally { server.close(); }
});

// ─── FLOW 2: approval_required (write_destructive) ──────────────────────────────

test("contract receipt-verify-flow [approval]: real receipt → valid=true, signatureValid=true, decisionValid=true", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "rvf-approval";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "write_destructive" }));
    eq(run.status, 201);
    eq(run.body.decision, "approval_required");
    const receipt = run.body.receipt;
    assert(typeof receipt === "object" && receipt !== null, "receipt must be an object");
    assert(receipt.approvalToken, "receipt must carry approvalToken");
    assert(receipt.signature, "receipt must carry a signature");

    const { status, body } = await call(base, "POST", "/receipt/verify", tenant, { receipt });
    eq(status, 200);
    eq(body.ok, true);
    eq(body.valid, true);
    eq(body.signatureValid, true);
    eq(body.decisionValid, true);
    eq(body.reasons.length, 0);
  } finally { server.close(); }
});

// ─── FLOW 3: denied (irreversible) ───────────────────────────────────────────────

test("contract receipt-verify-flow [denied]: real receipt → valid=true, signatureValid=true, decisionValid=true", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "rvf-denied";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "irreversible" }));
    eq(run.status, 201);
    eq(run.body.decision, "denied");
    const receipt = run.body.receipt;
    assert(typeof receipt === "object" && receipt !== null, "receipt must be an object");
    assert(receipt.executionId === undefined, "denied receipt must not have executionId");
    assert(receipt.approvalToken === undefined, "denied receipt must not have approvalToken");
    assert(receipt.signature, "receipt must carry a signature");

    const { status, body } = await call(base, "POST", "/receipt/verify", tenant, { receipt });
    eq(status, 200);
    eq(body.ok, true);
    eq(body.valid, true);
    eq(body.signatureValid, true);
    eq(body.decisionValid, true);
    eq(body.reasons.length, 0);
  } finally { server.close(); }
});

// ─── FLOW 4: tampered receipt ──────────────────────────────────────────────────

test("contract receipt-verify-flow [tampered]: tampered decision → valid=false, reasons present", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "rvf-tampered";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "write_destructive" }));
    eq(run.status, 201);
    const receipt = { ...run.body.receipt, decision: "allowed" };

    const { status, body } = await call(base, "POST", "/receipt/verify", tenant, { receipt });
    eq(status, 200);
    eq(body.ok, true);
    eq(body.valid, false);
    eq(body.signatureValid, false);
    eq(body.decisionValid, false);
    assert(body.reasons.length > 0, "reasons must be present for tampered receipt");
  } finally { server.close(); }
});

// ─── FLOW 5: status receipt ────────────────────────────────────────────────────

test("contract receipt-verify-flow [status]: status receipt → decisionValid=true, no reasons", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "rvf-status";
  try {
    const run = await call(base, "POST", "/adapter/run", tenant, intent({ riskClass: "read_only" }));
    eq(run.status, 201);
    const receipt = { ...run.body.receipt, version: "tfa-status-receipt-v1" };

    const { status, body } = await call(base, "POST", "/receipt/verify", tenant, { receipt });
    eq(status, 200);
    eq(body.ok, true);
    eq(body.decisionValid, true);
    eq(body.reasons.length, 0);
  } finally { server.close(); }
});

// ─── FAIL-CLOSED: missing receipt → 400 ─────────────────────────────────────────

test("contract receipt-verify-flow [fail-closed]: missing receipt → 400", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "rvf-400";
  try {
    const { status, body } = await call(base, "POST", "/receipt/verify", tenant, {});
    eq(status, 400);
    eq(body.error, "receipt must be an object");
  } finally { server.close(); }
});

// ─── Unknown version → 200 but valid=false ───────────────────────────────────────

test("contract receipt-verify-flow [unknown]: unknown version → 200, valid=false, reasons", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port = (server.address() as { port: number }).port;
  const base = "http://127.0.0.1:" + port;
  const tenant = "rvf-unknown";
  try {
    const { status, body } = await call(base, "POST", "/receipt/verify", tenant, { receipt: { version: "bogus" } });
    eq(status, 200);
    eq(body.ok, true);
    eq(body.valid, false);
    eq(body.signatureValid, false);
    eq(body.decisionValid, false);
    assert(body.reasons.includes("unknown receipt version"));
  } finally { server.close(); }
});
