import "../_flush.mjs";
/**
 * tests/transparency-log/pg-transparency-log-store.test.ts
 *
 * Tests for PgTransparencyLogStore with InMemoryPool (zero external DB).
 * Coverage: appendReceipt, appendAuditRecord, currentRoot, getRoots,
 *   leafCount, getProof, getProofByReceiptId, verifyReceipt,
 *   tenant isolation, cross-tenant fail-closed, finalize.
 */

import { test, assert, eq } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import { PgTransparencyLogStore } from "../../lib/transparency-log/index.ts";
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

async function setup(): Promise<{ pool: InMemoryPool; store: PgTransparencyLogStore }> {
  const pool = new InMemoryPool();
  const store = new PgTransparencyLogStore(pool);
  await store.init();
  return { pool, store };
}

// ─── Core operations ──────────────────────────────────────────────────────────

test("PgTransparencyLogStore: appendReceipt returns sequential indices", async () => {
  const { store } = await setup();
  const r1 = makeReceipt("n1");
  const r2 = makeReceipt("n2");
  const idx1 = await store.appendReceipt("tenant-a", r1, r1.intentId);
  const idx2 = await store.appendReceipt("tenant-a", r2, r2.intentId);
  eq(idx1, 0);
  eq(idx2, 1);
});

test("PgTransparencyLogStore: currentRoot after batch of 8", async () => {
  const { store } = await setup();
  for (let i = 0; i < 8; i++) {
    await store.appendReceipt("tenant-a", makeReceipt(`batch-${i}`), `batch-${i}`);
  }
  const root = await store.currentRoot("tenant-a");
  assert(root !== null, "root should exist after 8 leaves");
  eq(root!.leafCount, 8);
  assert(typeof root!.root === "string" && root!.root.length === 64, "root should be 64-hex");
});

test("PgTransparencyLogStore: currentRoot before batch is null", async () => {
  const { store } = await setup();
  await store.appendReceipt("tenant-a", makeReceipt("n1"), "n1");
  const root = await store.currentRoot("tenant-a");
  eq(root, null);
});

test("PgTransparencyLogStore: finalize forces root build", async () => {
  const { store } = await setup();
  await store.appendReceipt("tenant-a", makeReceipt("n1"), "n1");
  const root = await store.finalize("tenant-a");
  assert(root !== null, "finalize should return root");
  eq(root!.leafCount, 1);
});

test("PgTransparencyLogStore: getRoots returns all roots", async () => {
  const { store } = await setup();
  for (let i = 0; i < 16; i++) {
    await store.appendReceipt("tenant-a", makeReceipt(`r-${i}`), `r-${i}`);
  }
  const roots = await store.getRoots("tenant-a");
  eq(roots.length, 2);
  eq(roots[0].leafCount, 8);
  eq(roots[1].leafCount, 16);
});

test("PgTransparencyLogStore: getProof for valid index", async () => {
  const { store } = await setup();
  for (let i = 0; i < 8; i++) {
    await store.appendReceipt("tenant-a", makeReceipt(`p-${i}`), `p-${i}`);
  }
  const proof = await store.getProof("tenant-a", 3);
  assert(proof !== null, "proof should exist");
  assert(proof!.siblings.length > 0, "proof should have siblings");
});

test("PgTransparencyLogStore: getProof out of range returns null", async () => {
  const { store } = await setup();
  await store.appendReceipt("tenant-a", makeReceipt("n1"), "n1");
  const proof = await store.getProof("tenant-a", 99);
  eq(proof, null);
});

test("PgTransparencyLogStore: getProofByReceiptId finds receipt", async () => {
  const { store } = await setup();
  const r = makeReceipt("find-me");
  await store.appendReceipt("tenant-a", r, "find-me");
  await store.finalize("tenant-a");
  const result = await store.getProofByReceiptId("tenant-a", "find-me");
  assert(result !== null, "should find receipt");
  eq(result!.leafIndex, 0);
  assert(result!.proof !== null, "proof should exist");
});

test("PgTransparencyLogStore: getProofByReceiptId unknown returns null", async () => {
  const { store } = await setup();
  await store.appendReceipt("tenant-a", makeReceipt("n1"), "n1");
  await store.finalize("tenant-a");
  const result = await store.getProofByReceiptId("tenant-a", "unknown");
  eq(result, null);
});

test("PgTransparencyLogStore: verifyReceipt true for anchored receipt", async () => {
  const { store } = await setup();
  const r = makeReceipt("verify-true");
  await store.appendReceipt("tenant-a", r, "verify-true");
  await store.finalize("tenant-a");
  const ok = await store.verifyReceipt("tenant-a", r);
  assert(ok, "receipt should verify");
});

test("PgTransparencyLogStore: verifyReceipt false for unknown receipt", async () => {
  const { store } = await setup();
  await store.appendReceipt("tenant-a", makeReceipt("n1"), "n1");
  await store.finalize("tenant-a");
  const ok = await store.verifyReceipt("tenant-a", makeReceipt("other"));
  assert(!ok, "unknown receipt should not verify");
});

// ─── Tenant isolation (fail-closed) ───────────────────────────────────────────

test("PgTransparencyLogStore: cross-tenant currentRoot returns null", async () => {
  const { store } = await setup();
  for (let i = 0; i < 8; i++) {
    await store.appendReceipt("tenant-a", makeReceipt(`a-${i}`), `a-${i}`);
  }
  const root = await store.currentRoot("tenant-b");
  eq(root, null);
});

test("PgTransparencyLogStore: cross-tenant getProofByReceiptId returns null", async () => {
  const { store } = await setup();
  await store.appendReceipt("tenant-a", makeReceipt("n1"), "n1");
  await store.finalize("tenant-a");
  const result = await store.getProofByReceiptId("tenant-b", "n1");
  eq(result, null);
});

test("PgTransparencyLogStore: leafCount is per-tenant", async () => {
  const { store } = await setup();
  await store.appendReceipt("tenant-a", makeReceipt("a1"), "a1");
  await store.appendReceipt("tenant-a", makeReceipt("a2"), "a2");
  await store.appendReceipt("tenant-b", makeReceipt("b1"), "b1");
  eq(await store.leafCount("tenant-a"), 2);
  eq(await store.leafCount("tenant-b"), 1);
});

// ─── Audit record ─────────────────────────────────────────────────────────────

test("PgTransparencyLogStore: appendAuditRecord works and builds root", async () => {
  const { store } = await setup();
  for (let i = 0; i < 8; i++) {
    await store.appendAuditRecord("tenant-a", {
      id: `audit-${i}`,
      tenantId: "tenant-a",
      actionId: `action-${i}`,
      actionType: "test.action",
      source: "test",
      outcome: "allowed",
      reason: "test",
      occurredAt: "2026-06-15T00:00:00.000Z",
      prevHash: "prev",
      hash: "hash",
    });
  }
  const root = await store.currentRoot("tenant-a");
  assert(root !== null, "root should exist after 8 audit records");
  eq(root!.leafCount, 8);
});

// ─── Error handling ───────────────────────────────────────────────────────────

test("PgTransparencyLogStore: missing tenantId throws", async () => {
  const { store } = await setup();
  let threw = false;
  try {
    await store.appendReceipt("", makeReceipt("n1"), "n1");
  } catch (e: any) {
    threw = true;
    eq(e.code, "MISSING_TENANT");
  }
  assert(threw, "should throw for missing tenantId");
});
