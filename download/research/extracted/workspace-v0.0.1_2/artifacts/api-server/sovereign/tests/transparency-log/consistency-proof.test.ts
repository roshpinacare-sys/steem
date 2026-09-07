/**
 * tests/transparency-log/consistency-proof.test.ts — append-only consistency proofs.
 *
 * The property under test: a verifier holding an OLD signed root can confirm a
 * NEW root is the same history plus appends — and REJECT a rewritten/reordered
 * /forked (split-view) log.
 *
 * HAPPY        valid old→new proof verifies; computeRoot matches the canonical
 *              merkle-tree across sizes (incl. odd-promote cases); store wiring
 *              returns a proof that reconciles real published roots.
 * EDGE         m == n (identity); single-leaf trees; growth across a tree rebuild.
 * FAIL-CLOSED  reordered/rewritten/truncated history rejected; wrong roots
 *              rejected; out-of-range oldSize → null; cross-tenant proof does not
 *              reconcile another tenant's roots; malformed input → false (no throw).
 */

import { test, assert, eq } from "../_harness.mjs";
import { createHash } from "node:crypto";
import { buildMerkleTree } from "../../lib/transparency-log/merkle-tree.ts";
import {
  computeRoot,
  buildConsistencyProof,
  verifyConsistencyProof,
  ConsistencyProofError,
} from "../../lib/transparency-log/consistency-proof.ts";
import { InMemoryTransparencyLog } from "../../lib/transparency-log/receipt-anchor.ts";
import type { ExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";

const h = (s: string): string => createHash("sha256").update(s).digest("hex");

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

// ─── HAPPY: computeRoot is convention-identical to the canonical tree ──────────

test("computeRoot matches buildMerkleTree across sizes 1..12 (incl. odd-promote)", () => {
  for (let n = 1; n <= 12; n++) {
    const leaves = Array.from({ length: n }, (_, i) => h("leaf-" + i));
    eq(computeRoot(leaves), buildMerkleTree(leaves).root, `root mismatch at n=${n}`);
  }
});

// ─── HAPPY: a genuine old→new proof verifies ───────────────────────────────────

test("HAPPY: append-only growth verifies for every old size", () => {
  const leaves = Array.from({ length: 9 }, (_, i) => h("x" + i));
  const newRoot = computeRoot(leaves);
  for (let m = 1; m <= 9; m++) {
    const oldRoot = computeRoot(leaves.slice(0, m));
    const proof = buildConsistencyProof(leaves, m);
    assert(verifyConsistencyProof(proof, oldRoot, newRoot), `m=${m} should reconcile`);
  }
});

// ─── EDGE: identity (m == n) ───────────────────────────────────────────────────

test("EDGE: m == n verifies (no growth is still consistent)", () => {
  const leaves = Array.from({ length: 5 }, (_, i) => h("y" + i));
  const root = computeRoot(leaves);
  assert(verifyConsistencyProof(buildConsistencyProof(leaves, 5), root, root));
});

test("EDGE: single-leaf old tree into a larger tree", () => {
  const leaves = Array.from({ length: 6 }, (_, i) => h("z" + i));
  const oldRoot = computeRoot(leaves.slice(0, 1));
  const newRoot = computeRoot(leaves);
  assert(verifyConsistencyProof(buildConsistencyProof(leaves, 1), oldRoot, newRoot));
});

// ─── FAIL-CLOSED: split-view / rewrite detection (the whole point) ─────────────

test("FAIL-CLOSED: a reordered prefix (split-view) is rejected", () => {
  const leaves = Array.from({ length: 7 }, (_, i) => h("a" + i));
  const oldRoot = computeRoot(leaves.slice(0, 4));
  const honestNewRoot = computeRoot(leaves);
  // Operator rewrites history: swaps two early leaves, then appends.
  const forked = [leaves[1], leaves[0], ...leaves.slice(2)];
  const proof = buildConsistencyProof(forked, 4);
  assert(
    !verifyConsistencyProof(proof, oldRoot, honestNewRoot),
    "reordered history must NOT reconcile the honest old root"
  );
});

test("FAIL-CLOSED: a truncated history is rejected", () => {
  const leaves = Array.from({ length: 8 }, (_, i) => h("b" + i));
  const oldRoot = computeRoot(leaves.slice(0, 6));
  // Operator drops two committed leaves and presents a shorter tree.
  const truncated = leaves.slice(0, 5);
  const proof = buildConsistencyProof(truncated, 5);
  assert(!verifyConsistencyProof(proof, oldRoot, computeRoot(leaves)));
});

test("FAIL-CLOSED: wrong roots and malformed input return false (no throw)", () => {
  const leaves = Array.from({ length: 4 }, (_, i) => h("c" + i));
  const proof = buildConsistencyProof(leaves, 2);
  const real = computeRoot(leaves);
  assert(!verifyConsistencyProof(proof, h("not-the-old-root"), real), "wrong oldRoot rejected");
  assert(!verifyConsistencyProof(proof, computeRoot(leaves.slice(0, 2)), h("wrong-new")), "wrong newRoot rejected");
  assert(!verifyConsistencyProof(null as any, real, real), "null proof → false");
  assert(!verifyConsistencyProof({ oldSize: 2, newSize: 4, leaves: ["bad"] } as any, real, real), "bad leaves → false");
  assert(!verifyConsistencyProof({ oldSize: 5, newSize: 4, leaves } as any, real, real), "oldSize>newSize → false");
});

test("FAIL-CLOSED: buildConsistencyProof rejects bad sizes and leaves", () => {
  const leaves = Array.from({ length: 3 }, (_, i) => h("d" + i));
  let a = false, b = false, c = false;
  try { buildConsistencyProof(leaves, 0); } catch (e) { a = e instanceof ConsistencyProofError; }
  try { buildConsistencyProof(leaves, 4); } catch (e) { b = e instanceof ConsistencyProofError; }
  try { buildConsistencyProof(["not-hex"], 1); } catch (e) { c = e instanceof ConsistencyProofError; }
  assert(a, "oldSize 0 throws");
  assert(b, "oldSize > length throws");
  assert(c, "non-hex leaf throws");
});

// ─── Store wiring: getConsistencyProof reconciles real published roots ─────────

test("STORE: getConsistencyProof reconciles two real published roots", async () => {
  const log = new InMemoryTransparencyLog(4);
  // Append 4 → first published root at size 4.
  for (let i = 0; i < 4; i++) await log.appendReceipt("tenant-a", makeReceipt("r" + i));
  const oldRoot = await log.currentRoot("tenant-a");
  assert(oldRoot && oldRoot.leafCount === 4, "old root at size 4");

  // Append 4 more and finalize → new root at size 8.
  for (let i = 4; i < 8; i++) await log.appendReceipt("tenant-a", makeReceipt("r" + i));
  await log.finalize("tenant-a");
  const newRoot = await log.currentRoot("tenant-a");
  assert(newRoot && newRoot.leafCount === 8, "new root at size 8");

  const proof = await log.getConsistencyProof("tenant-a", oldRoot!.leafCount);
  assert(proof !== null, "proof produced");
  assert(
    verifyConsistencyProof(proof!, oldRoot!.root, newRoot!.root),
    "real published roots reconcile via the store proof"
  );
});

test("STORE: out-of-range oldSize → null; empty tenant → null", async () => {
  const log = new InMemoryTransparencyLog(8);
  eq(await log.getConsistencyProof("empty-tenant", 1), null, "no leaves → null");
  await log.appendReceipt("tenant-a", makeReceipt("only"));
  eq(await log.getConsistencyProof("tenant-a", 0), null, "oldSize 0 → null");
  eq(await log.getConsistencyProof("tenant-a", 99), null, "oldSize > size → null");
});

test("STORE FAIL-CLOSED: one tenant's proof does NOT reconcile another tenant's roots", async () => {
  const log = new InMemoryTransparencyLog(4);
  for (let i = 0; i < 4; i++) await log.appendReceipt("tenant-a", makeReceipt("a" + i, "tenant-a"));
  for (let i = 0; i < 6; i++) await log.appendReceipt("tenant-b", makeReceipt("b" + i, "tenant-b"));
  await log.finalize("tenant-a");
  await log.finalize("tenant-b");
  const aRoot = await log.currentRoot("tenant-a");
  const bRoot = await log.currentRoot("tenant-b");
  const aProof = await log.getConsistencyProof("tenant-a", 2);
  const aOldRoot = computeRoot(aProof!.leaves.slice(0, 2));
  // tenant-a's proof reconciles tenant-a's roots…
  assert(verifyConsistencyProof(aProof!, aOldRoot, aRoot!.root), "a-proof reconciles a-roots");
  // …but NOT tenant-b's root (different history).
  assert(!verifyConsistencyProof(aProof!, aOldRoot, bRoot!.root), "a-proof must not reconcile b's root");
});
