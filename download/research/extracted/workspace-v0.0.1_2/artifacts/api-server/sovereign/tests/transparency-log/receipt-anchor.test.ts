/**
 * tests/transparency-log/receipt-anchor.test.ts — v341.
 *
 * InMemoryTransparencyLog.verifyReceipt: efficiency/leaf-index-map.
 *   `verifyReceipt` used to do `leaves.indexOf(leaf)` — an O(n) scan over
 *   every leaf ever anchored for the tenant (append-only, so it only grows).
 *   Replaced with a `tenantLeafIndex: Map<tenantId, Map<leafHash, index>>`
 *   maintained incrementally on append — O(1) lookup, same semantics as
 *   indexOf (first occurrence wins for a duplicate leaf hash).
 *
 *   HAPPY      anchored receipt verifies true; many leaves still resolve.
 *   EDGE       duplicate receipt anchored twice → first index used (matches
 *              the old indexOf behavior); unanchored receipt → false.
 *   FAIL-CLOSED cross-tenant verify → false; no root yet → false.
 */
import { test, assert, eq } from "../_harness.mjs";
import { InMemoryTransparencyLog } from "../../lib/transparency-log/receipt-anchor.ts";
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
      timestamp: "2026-06-19T00:00:00.000Z",
      signature: "sig-" + nonce,
    },
    issuedAt: "2026-06-19T00:00:00.000Z",
    serverRiskClass: "read_only",
    clientClaimedRiskClass: "read_only",
    riskSource: "coding_taxonomy",
    signature: "receipt-sig-" + nonce,
  };
}

test("happy path: anchored receipt verifies true, including after many more leaves", async () => {
  const log = new InMemoryTransparencyLog(8);
  const target = makeReceipt("r-1");
  await log.appendReceipt("tenant-a", target);
  // pad with enough leaves to force several tree rebuilds (batchSize=8)
  for (let i = 0; i < 20; i++) {
    await log.appendReceipt("tenant-a", makeReceipt(`pad-${i}`));
  }
  await log.finalize("tenant-a"); // align the root with the full, current leaf set
  const ok = await log.verifyReceipt("tenant-a", target);
  assert(ok, "receipt anchored early in a growing log must still verify");
});

test("edge case: duplicate-leaf receipt resolves to first index (indexOf semantics); unknown receipt is false", async () => {
  const log = new InMemoryTransparencyLog(8);
  const dup = makeReceipt("r-dup");
  const firstIdx = await log.appendReceipt("tenant-a", dup);
  await log.appendReceipt("tenant-a", makeReceipt("between"));
  const secondIdx = await log.appendReceipt("tenant-a", dup); // identical receipt re-anchored
  eq(firstIdx, 0);
  eq(secondIdx, 2);
  await log.finalize("tenant-a");

  const proof = await log.getProof("tenant-a", firstIdx);
  assert(proof !== null, "first occurrence must have a real inclusion proof");
  const ok = await log.verifyReceipt("tenant-a", dup);
  assert(ok, "duplicate leaf must still verify against its first-occurrence index");

  const unknown = await log.verifyReceipt("tenant-a", makeReceipt("never-anchored"));
  eq(unknown, false, "a receipt that was never anchored must not verify");
});

test("fail-closed: cross-tenant verify is false; verify before any root exists is false", async () => {
  const log = new InMemoryTransparencyLog(8);
  const receiptB = makeReceipt("r-b", "tenant-b");
  await log.appendReceipt("tenant-b", receiptB);
  // not yet finalized/batched → no root for tenant-b yet
  const beforeRoot = await log.verifyReceipt("tenant-b", receiptB);
  eq(beforeRoot, false, "no anchored root yet → fail-closed false");

  await log.finalize("tenant-b");
  const crossTenant = await log.verifyReceipt("tenant-a", receiptB);
  eq(crossTenant, false, "tenant-a must never see tenant-b's leaves");

  const afterRoot = await log.verifyReceipt("tenant-b", receiptB);
  assert(afterRoot, "once anchored and finalized, the receipt verifies for its own tenant");
});
