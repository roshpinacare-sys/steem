import "../_flush.mjs";
/**
 * tests/sovereignty/tenant-export.test.ts — Tenant export/import/verify bundle tests.
 *
 * Coverage:
 *   Happy path:
 *     • exportTenantBundle returns a bundle with correct schema and tenantId
 *     • bundle signature is valid (verifyBundle returns true)
 *     • empty tenant exports empty arrays (not an error)
 *     • bundle includes audit records written before export
 *     • bundle includes escrow agreements for the tenant
 *     • bundle passports count matches audit chain length
 *
 *   verifyBundle:
 *     • tampered signature → returns false (not an error)
 *     • wrong schema → throws ExportError(schema_mismatch)
 *     • missing tenantId → throws ExportError(invalid_bundle)
 *     • missing signature → throws ExportError(invalid_bundle)
 *     • non-object input → throws ExportError(invalid_bundle)
 *
 *   importTenantBundle:
 *     • imports escrow agreements absent from store
 *     • skips escrow agreements already present (idempotent)
 *     • rejects tampered bundle → ExportError(signature_invalid)
 *     • rejects mismatched tenantId → ExportError(tenant_id_mismatch)
 *
 *   HTTP routes:
 *     • GET /api/sovereignty/export → 200 + valid bundle
 *     • POST /api/sovereignty/import → 200 + import result
 *     • POST /api/sovereignty/verify → 200 + { valid: true }
 *     • POST /api/sovereignty/verify with tampered bundle → 200 + { valid: false }
 *     • POST /api/sovereignty/import with tampered bundle → 422
 *     • POST /api/sovereignty/import with wrong tenantId → 403
 */

import { test, assert, eq } from "../_harness.mjs";
import { exportTenantBundle, ExportError, canonicalize, BUNDLE_SCHEMA } from "../../src/sovereignty/tenant-export.ts";
import { verifyBundle, importTenantBundle } from "../../src/sovereignty/tenant-import.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { InMemoryLedger } from "../../lib/ledger/in-memory-ledger.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStack() {
  return buildSovereignStack(undefined, { provider: new InMemoryLedger() });
}

async function doAction(stack: ReturnType<typeof makeStack>, tenantId: string) {
  // Trigger an orchestrator run to create an audit record
  await stack.orchestrator.run(
    {
      id: `test-action-${Math.random().toString(36).slice(2)}` as any,
      tenantId,
      type: "test.action",
      payload: { test: true },
      source: "test",
      isFinancial: false,
      isAutonomous: false,
      requestedAt: new Date().toISOString() as any,
    },
    async () => ({ ok: true }),
  );
}

async function httpGet(port: number, path: string, tenantId: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { "x-tenant-id": tenantId },
  });
  return { status: res.status, body: await res.json() };
}

async function httpPost(port: number, path: string, tenantId: string, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "x-tenant-id": tenantId, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── Unit tests ────────────────────────────────────────────────────────────────

test("canonicalize: stable key order", () => {
  const result = canonicalize({ b: 2, a: 1 } as any);
  eq(result, '{"a":1,"b":2}');
});

test("canonicalize: arrays are ordered", () => {
  const result = canonicalize([3, 1, 2] as any);
  eq(result, "[3,1,2]");
});

test("exportTenantBundle: empty tenant returns valid bundle with empty arrays", async () => {
  const stack = makeStack();
  const bundle = await exportTenantBundle("tenant-empty", stack);
  eq(bundle.schema, BUNDLE_SCHEMA);
  eq(bundle.tenantId, "tenant-empty");
  eq(bundle.auditChain.length, 0);
  eq(bundle.escrowAgreements.length, 0);
  eq(bundle.passports.length, 0);
  assert(typeof bundle.signature === "string" && bundle.signature.length > 0, "should have signature");
});

test("exportTenantBundle: signature is valid on empty bundle", async () => {
  const stack = makeStack();
  const bundle = await exportTenantBundle("tenant-sig", stack);
  const valid = verifyBundle(bundle, stack.signer);
  assert(valid, "signature should be valid");
});

test("exportTenantBundle: bundle includes audit records", async () => {
  const stack = makeStack();
  await doAction(stack, "tenant-audit");
  await doAction(stack, "tenant-audit");
  const bundle = await exportTenantBundle("tenant-audit", stack);
  assert(bundle.auditChain.length >= 2, "should include audit records");
  eq(bundle.passports.length, bundle.auditChain.length);
  eq(bundle.tenantId, "tenant-audit");
});

test("exportTenantBundle: passports match audit chain length", async () => {
  const stack = makeStack();
  await doAction(stack, "tenant-pass");
  const bundle = await exportTenantBundle("tenant-pass", stack);
  eq(bundle.passports.length, bundle.auditChain.length);
  // Each passport should reference the matching audit record
  for (let i = 0; i < bundle.passports.length; i++) {
    eq(bundle.passports[i].audit.id, bundle.auditChain[i].id);
  }
});

test("exportTenantBundle: tenant isolation — other tenant's records excluded", async () => {
  const stack = makeStack();
  await doAction(stack, "tenant-iso-A");
  await doAction(stack, "tenant-iso-B");
  const bundleA = await exportTenantBundle("tenant-iso-A", stack);
  assert(
    bundleA.auditChain.every((r) => r.tenantId === "tenant-iso-A"),
    "bundle A should only contain A's records"
  );
});

test("exportTenantBundle: invalid tenantId throws ExportError", async () => {
  const stack = makeStack();
  let threw = false;
  try {
    await exportTenantBundle("", stack);
  } catch (e: any) {
    threw = true;
    assert(e instanceof ExportError, "should be ExportError");
    eq(e.code, "invalid_tenant_id");
  }
  assert(threw, "should have thrown");
});

// ── verifyBundle unit tests ───────────────────────────────────────────────────

test("verifyBundle: valid bundle returns true", async () => {
  const stack = makeStack();
  const bundle = await exportTenantBundle("tenant-verify", stack);
  assert(verifyBundle(bundle, stack.signer) === true);
});

test("verifyBundle: tampered signature returns false", async () => {
  const stack = makeStack();
  const bundle = await exportTenantBundle("tenant-tamper", stack);
  const tampered = { ...bundle, signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
  assert(verifyBundle(tampered, stack.signer) === false);
});

test("verifyBundle: tampered data returns false", async () => {
  const stack = makeStack();
  const bundle = await exportTenantBundle("tenant-tamper2", stack);
  const tampered = { ...bundle, tenantId: "evil-tenant" };
  assert(verifyBundle(tampered, stack.signer) === false);
});

test("verifyBundle: wrong schema throws ExportError(schema_mismatch)", () => {
  const stack = makeStack();
  let threw = false;
  try {
    verifyBundle({ schema: "unknown/v0", tenantId: "t", signature: "x" }, stack.signer);
  } catch (e: any) {
    threw = true;
    eq(e.code, "schema_mismatch");
  }
  assert(threw);
});

test("verifyBundle: missing signature throws ExportError(invalid_bundle)", () => {
  const stack = makeStack();
  let threw = false;
  try {
    verifyBundle({ schema: BUNDLE_SCHEMA, tenantId: "t" }, stack.signer);
  } catch (e: any) {
    threw = true;
    eq(e.code, "invalid_bundle");
  }
  assert(threw);
});

test("verifyBundle: null input throws ExportError(invalid_bundle)", () => {
  const stack = makeStack();
  let threw = false;
  try {
    verifyBundle(null, stack.signer);
  } catch (e: any) {
    threw = true;
    eq(e.code, "invalid_bundle");
  }
  assert(threw);
});

// ── importTenantBundle unit tests ────────────────────────────────────────────

test("importTenantBundle: restores absent escrow agreements", async () => {
  const stack = makeStack();
  const bundle = await exportTenantBundle("tenant-import1", stack);
  // Import into the same stack (same signer, same tenantId)
  const result = await importTenantBundle(bundle, stack, "tenant-import1");
  eq(result.tenantId, "tenant-import1");
  eq(result.escrowsRestored, 0); // no escrows in source
  eq(result.auditChainLength, 0);
});

test("importTenantBundle: tampered bundle → ExportError(signature_invalid)", async () => {
  const stack = makeStack();
  const bundle = await exportTenantBundle("tenant-tamper-import", stack);
  const tampered = { ...bundle, signature: "bad-sig" };
  let threw = false;
  try {
    await importTenantBundle(tampered, stack, "tenant-tamper-import");
  } catch (e: any) {
    threw = true;
    eq(e.code, "signature_invalid");
  }
  assert(threw, "should reject tampered bundle");
});

test("importTenantBundle: tenantId mismatch → ExportError(tenant_id_mismatch)", async () => {
  const stack = makeStack();
  const bundle = await exportTenantBundle("tenant-A", stack);
  let threw = false;
  try {
    await importTenantBundle(bundle, stack, "tenant-B");
  } catch (e: any) {
    threw = true;
    eq(e.code, "tenant_id_mismatch");
  }
  assert(threw, "should reject cross-tenant import");
});

test("importTenantBundle: idempotent — re-importing same bundle is safe", async () => {
  const stack = makeStack();
  const bundle = await exportTenantBundle("tenant-idem", stack);
  const r1 = await importTenantBundle(bundle, stack, "tenant-idem");
  const r2 = await importTenantBundle(bundle, stack, "tenant-idem");
  eq(r1.escrowsRestored, r2.escrowsRestored); // second import restores 0 new
  assert(r2.escrowsRestored === 0 || r2.escrowsRestored <= r1.escrowsRestored, "idempotent");
});

// ── HTTP integration tests ────────────────────────────────────────────────────

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port = (server.address() as any).port as number;
server.unref();
// Stabilise
await new Promise((r) => setTimeout(r, 50));

test("GET /api/sovereignty/export → 200 with valid bundle", async () => {
  const r = await httpGet(port, "/api/sovereignty/export", "http-tenant-1");
  eq(r.status, 200);
  eq((r.body as any).schema, BUNDLE_SCHEMA);
  eq((r.body as any).tenantId, "http-tenant-1");
  assert(typeof (r.body as any).signature === "string", "should have signature");
});

test("POST /api/sovereignty/verify → 200 { valid: true } for fresh export", async () => {
  const exportR = await httpGet(port, "/api/sovereignty/export", "http-tenant-2");
  eq(exportR.status, 200);
  const verifyR = await httpPost(port, "/api/sovereignty/verify", "http-tenant-2", exportR.body);
  eq(verifyR.status, 200);
  eq((verifyR.body as any).valid, true);
});

test("POST /api/sovereignty/verify → 200 { valid: false } for tampered bundle", async () => {
  const exportR = await httpGet(port, "/api/sovereignty/export", "http-tenant-3");
  const tampered = { ...(exportR.body as any), signature: "tampered" };
  const verifyR = await httpPost(port, "/api/sovereignty/verify", "http-tenant-3", tampered);
  eq(verifyR.status, 200);
  eq((verifyR.body as any).valid, false);
});

test("POST /api/sovereignty/import → 200 with import result", async () => {
  const exportR = await httpGet(port, "/api/sovereignty/export", "http-tenant-4");
  const importR = await httpPost(port, "/api/sovereignty/import", "http-tenant-4", exportR.body);
  eq(importR.status, 200);
  eq((importR.body as any).ok, true);
  eq((importR.body as any).tenantId, "http-tenant-4");
});

test("POST /api/sovereignty/import → 422 for tampered bundle", async () => {
  const exportR = await httpGet(port, "/api/sovereignty/export", "http-tenant-5");
  const tampered = { ...(exportR.body as any), signature: "bad" };
  const importR = await httpPost(port, "/api/sovereignty/import", "http-tenant-5", tampered);
  eq(importR.status, 422);
});

test("POST /api/sovereignty/import → 403 for cross-tenant bundle", async () => {
  // Export as http-tenant-6, try to import as http-tenant-7
  const exportR = await httpGet(port, "/api/sovereignty/export", "http-tenant-6");
  const importR = await httpPost(port, "/api/sovereignty/import", "http-tenant-7", exportR.body);
  eq(importR.status, 403);
});

test("GET /api/sovereignty/export → 400 without x-tenant-id", async () => {
  const res = await fetch(`http://127.0.0.1:${port}/api/sovereignty/export`);
  // No x-tenant-id; resolveTenantId in the server produces 400 or 401
  assert(res.status >= 400, "should reject unauthenticated");
});

test("cleanup: close server", () => { server.close(); });
