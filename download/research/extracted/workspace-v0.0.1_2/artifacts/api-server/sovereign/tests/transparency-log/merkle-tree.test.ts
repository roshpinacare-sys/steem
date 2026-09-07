import "../_flush.mjs";
/**
 * tests/transparency-log/merkle-tree.test.ts
 *
 * Tests for:
 *   lib/transparency-log/merkle-tree.ts — buildMerkleTree, verifyInclusionProof
 *   lib/transparency-log/receipt-anchor.ts — anchorReceipt, InMemoryTransparencyLog
 *
 * Coverage:
 *   MerkleTree
 *     • single leaf: root equals leaf
 *     • two leaves: root is hash(leaf0 || leaf1)
 *     • four leaves: deterministic root
 *     • inclusion proof verifies for every leaf
 *     • tampered leaf breaks proof
 *     • wrong root breaks proof
 *     • empty tree throws
 *     • invalid leaf throws
 *     • odd-count tree (3 leaves) still builds valid proofs
 *   ReceiptAnchor
 *     • same receipt → same leaf hash (deterministic)
 *     • different receipts → different leaf hashes
 *   InMemoryTransparencyLog
 *     • append receipts, root builds every batchSize
 *     • tenant isolation: leaves/roots are per-tenant
 *     • getProof returns valid proof for every appended receipt
 *     • verifyReceipt returns true for anchored receipts
 *     • verifyReceipt returns false for unknown receipts
 *     • cross-tenant verifyReceipt returns false (fail-closed)
 *     • finalize forces root build
 *     • null root before any build
 *     • invalid batchSize throws
 *     • missing tenantId throws
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  buildMerkleTree,
  verifyInclusionProof,
  MerkleTreeError,
  anchorReceipt,
  InMemoryTransparencyLog,
  TransparencyLogError,
} from "../../lib/transparency-log/index.ts";
import type { ExecutionReceipt } from "../../lib/adapter/agent-adapter.ts";
import { createHash } from "node:crypto";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function hashHex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

// ─── MerkleTree ───────────────────────────────────────────────────────────────

test("buildMerkleTree: single leaf root equals leaf", () => {
  const leaf = hashHex("leaf0");
  const { root, proofs } = buildMerkleTree([leaf]);
  eq(root, leaf);
  eq(proofs.length, 1);
  eq(proofs[0].siblings.length, 0);
});

test("buildMerkleTree: two leaves root is hash(leaf0||leaf1)", () => {
  const l0 = hashHex("a");
  const l1 = hashHex("b");
  const { root } = buildMerkleTree([l0, l1]);
  const expected = createHash("sha256")
    .update(Buffer.from(l0 + l1, "hex"))
    .digest("hex");
  eq(root, expected);
});

test("buildMerkleTree: four leaves deterministic root", () => {
  const leaves = [hashHex("0"), hashHex("1"), hashHex("2"), hashHex("3")];
  const { root } = buildMerkleTree(leaves);
  assert(typeof root === "string" && root.length === 64, "root should be 64-hex");
  // Deterministic: same inputs → same root
  const { root: root2 } = buildMerkleTree(leaves);
  eq(root, root2);
});

test("buildMerkleTree: inclusion proof verifies for every leaf", () => {
  const leaves = [hashHex("0"), hashHex("1"), hashHex("2"), hashHex("3")];
  const { root, proofs } = buildMerkleTree(leaves);
  for (let i = 0; i < leaves.length; i++) {
    assert(verifyInclusionProof(leaves[i], root, proofs[i]), `leaf ${i} should verify`);
  }
});

test("buildMerkleTree: tampered leaf breaks proof", () => {
  const leaves = [hashHex("0"), hashHex("1"), hashHex("2"), hashHex("3")];
  const { root, proofs } = buildMerkleTree(leaves);
  const tampered = hashHex("tampered");
  assert(!verifyInclusionProof(tampered, root, proofs[0]), "tampered leaf should not verify");
});

test("buildMerkleTree: wrong root breaks proof", () => {
  const leaves = [hashHex("0"), hashHex("1")];
  const { proofs } = buildMerkleTree(leaves);
  const wrongRoot = hashHex("wrong");
  assert(!verifyInclusionProof(leaves[0], wrongRoot, proofs[0]), "wrong root should fail");
});

test("buildMerkleTree: empty tree throws", () => {
  let threw = false;
  try {
    buildMerkleTree([]);
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof MerkleTreeError, "should throw MerkleTreeError");
    eq((e as MerkleTreeError).code, "EMPTY_TREE");
  }
  assert(threw, "should have thrown");
});

test("buildMerkleTree: invalid leaf throws", () => {
  let threw = false;
  try {
    buildMerkleTree(["not-a-hash"]);
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof MerkleTreeError, "should throw MerkleTreeError");
    eq((e as MerkleTreeError).code, "INVALID_LEAF");
  }
  assert(threw, "should have thrown");
});

test("buildMerkleTree: odd count (3 leaves) builds valid proofs", () => {
  const leaves = [hashHex("0"), hashHex("1"), hashHex("2")];
  const { root, proofs } = buildMerkleTree(leaves);
  for (let i = 0; i < leaves.length; i++) {
    assert(verifyInclusionProof(leaves[i], root, proofs[i]), `leaf ${i} should verify in odd tree`);
  }
});

test("verifyInclusionProof: returns false for malformed proof", () => {
  assert(!verifyInclusionProof(hashHex("a"), hashHex("b"), { siblings: ["bad"], directionBits: 0 }), "bad sibling length");
  assert(!verifyInclusionProof(hashHex("a"), hashHex("b"), null as any), "null proof");
});

// ─── ReceiptAnchor ────────────────────────────────────────────────────────────

test("anchorReceipt: same receipt → same leaf hash", () => {
  const r = makeReceipt("nonce-1");
  const h1 = anchorReceipt(r);
  const h2 = anchorReceipt(r);
  eq(h1, h2);
  eq(h1.length, 64);
});

test("anchorReceipt: different receipts → different leaf hashes", () => {
  const h1 = anchorReceipt(makeReceipt("a"));
  const h2 = anchorReceipt(makeReceipt("b"));
  assert(h1 !== h2, "different receipts should produce different leaves");
});

// ─── InMemoryTransparencyLog ──────────────────────────────────────────────────

test("TransparencyLog: append receipts and root builds every batchSize", async () => {
  const log = new InMemoryTransparencyLog(4);
  await log.appendReceipt("t1", makeReceipt("r0"));
  await log.appendReceipt("t1", makeReceipt("r1"));
  await log.appendReceipt("t1", makeReceipt("r2"));
  // 3 items, not yet a multiple of 4 → no root built
  eq(await log.currentRoot("t1"), null);
  await log.appendReceipt("t1", makeReceipt("r3"));
  // 4 items → root built
  const root = await log.currentRoot("t1");
  assert(root !== null, "root should be built after 4th receipt");
  eq(root!.leafCount, 4);
  assert(typeof root!.root === "string" && root!.root.length === 64, "root should be 64-hex");
});

test("TransparencyLog: tenant isolation", async () => {
  const log = new InMemoryTransparencyLog(2);
  await log.appendReceipt("alpha", makeReceipt("a1"));
  await log.appendReceipt("alpha", makeReceipt("a2"));
  await log.appendReceipt("beta", makeReceipt("b1"));

  eq(await log.leafCount("alpha"), 2);
  eq(await log.leafCount("beta"), 1);
  assert(await log.currentRoot("alpha") !== null, "alpha should have a root");
  eq(await log.currentRoot("beta"), null, "beta should not have root yet (only 1 leaf)");
});

test("TransparencyLog: getProof returns valid proof for every appended receipt", async () => {
  const log = new InMemoryTransparencyLog(4);
  const receipts = [makeReceipt("p0"), makeReceipt("p1"), makeReceipt("p2"), makeReceipt("p3")];
  for (const r of receipts) await log.appendReceipt("t1", r);

  const root = (await log.currentRoot("t1"))!;
  for (let i = 0; i < receipts.length; i++) {
    const proof = await log.getProof("t1", i);
    assert(proof !== null, `proof for leaf ${i} should exist`);
    const leaf = anchorReceipt(receipts[i]);
    assert(verifyInclusionProof(leaf, root.root, proof!), `leaf ${i} inclusion should verify`);
  }
});

test("TransparencyLog: verifyReceipt returns true for anchored receipts", async () => {
  const log = new InMemoryTransparencyLog(2);
  const r = makeReceipt("anchored");
  await log.appendReceipt("t1", r);
  await log.appendReceipt("t1", makeReceipt("other"));
  assert(await log.verifyReceipt("t1", r), "anchored receipt should verify");
});

test("TransparencyLog: verifyReceipt returns false for unknown receipts", async () => {
  const log = new InMemoryTransparencyLog(2);
  await log.appendReceipt("t1", makeReceipt("known"));
  await log.appendReceipt("t1", makeReceipt("known2"));
  const unknown = makeReceipt("unknown");
  assert(!(await log.verifyReceipt("t1", unknown)), "unknown receipt should not verify");
});

test("TransparencyLog: cross-tenant verifyReceipt returns false (fail-closed)", async () => {
  const log = new InMemoryTransparencyLog(2);
  const r = makeReceipt("cross");
  await log.appendReceipt("owner", r);
  await log.appendReceipt("owner", makeReceipt("cross2"));
  assert(!(await log.verifyReceipt("intruder", r)), "cross-tenant should fail closed");
});

test("TransparencyLog: finalize forces root build", async () => {
  const log = new InMemoryTransparencyLog(8);
  await log.appendReceipt("t1", makeReceipt("f1"));
  eq(await log.currentRoot("t1"), null);
  const root = await log.finalize("t1");
  assert(root !== null, "finalize should build root");
  eq(root!.leafCount, 1);
});

test("TransparencyLog: null root before any build", async () => {
  const log = new InMemoryTransparencyLog(8);
  eq(await log.currentRoot("empty"), null);
});

test("TransparencyLog: invalid batchSize throws", () => {
  let threw = false;
  try {
    new InMemoryTransparencyLog(0);
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof TransparencyLogError, "should throw TransparencyLogError");
    eq((e as TransparencyLogError).code, "INVALID_BATCH_SIZE");
  }
  assert(threw, "should have thrown");
});

test("TransparencyLog: missing tenantId throws on append", async () => {
  const log = new InMemoryTransparencyLog(2);
  let threw = false;
  try {
    await log.appendReceipt("", makeReceipt("bad"));
  } catch (e: unknown) {
    threw = true;
    assert(e instanceof TransparencyLogError, "should throw TransparencyLogError");
    eq((e as TransparencyLogError).code, "MISSING_TENANT");
  }
  assert(threw, "should have thrown");
});

test("TransparencyLog: getProof out of range returns null", async () => {
  const log = new InMemoryTransparencyLog(2);
  await log.appendReceipt("t1", makeReceipt("x"));
  eq(await log.getProof("t1", 99), null);
  eq(await log.getProof("t1", -1), null);
});

test("TransparencyLog: multiple batches produce multiple roots", async () => {
  const log = new InMemoryTransparencyLog(2);
  await log.appendReceipt("t1", makeReceipt("b0"));
  await log.appendReceipt("t1", makeReceipt("b1"));
  const r1 = (await log.currentRoot("t1"))!;

  await log.appendReceipt("t1", makeReceipt("b2"));
  await log.appendReceipt("t1", makeReceipt("b3"));
  const r2 = (await log.currentRoot("t1"))!;

  const roots = await log.getRoots("t1");
  eq(roots.length, 2);
  assert(roots[0].leafCount === 2, "first root should have 2 leaves");
  assert(roots[1].leafCount === 4, "second root should have 4 leaves");
  assert(r1.root !== r2.root, "roots should evolve");
});

test("TransparencyLog: getProofByReceiptId finds anchored receipt", async () => {
  const log = new InMemoryTransparencyLog(2);
  const r = makeReceipt("tagged");
  await log.appendReceipt("t1", r, "my-receipt-id");
  await log.appendReceipt("t1", makeReceipt("other"), "other-id");

  const result = await log.getProofByReceiptId("t1", "my-receipt-id");
  assert(result !== null, "should find receipt by id");
  eq(result!.leafIndex, 0);
});

test("TransparencyLog: getProofByReceiptId unknown returns null", async () => {
  const log = new InMemoryTransparencyLog(2);
  await log.appendReceipt("t1", makeReceipt("x"), "x-id");
  await log.appendReceipt("t1", makeReceipt("y"), "y-id");
  const result = await log.getProofByReceiptId("t1", "unknown");
  eq(result, null);
});

// ── efficiency/hoisted-regex ────────────────────────────────────────────────
// These tests verify correctness is preserved after HEX64_RE was hoisted to
// module scope (compiled once instead of inline on every validation call).

test("efficiency/hoisted-regex: verifyInclusionProof rejects all invalid hex at entry", () => {
  // Short hex (63 chars), long hex (65 chars), and non-hex chars must all return false.
  const good = createHash("sha256").update("seed").digest("hex");
  const short63 = good.slice(0, 63);
  const long65  = good + "a";
  const nonHex  = good.slice(0, 63) + "g";

  assert(!verifyInclusionProof(short63, good, { siblings: [], directionBits: 0 }), "short leaf rejected");
  assert(!verifyInclusionProof(long65,  good, { siblings: [], directionBits: 0 }), "long leaf rejected");
  assert(!verifyInclusionProof(nonHex,  good, { siblings: [], directionBits: 0 }), "non-hex leaf rejected");
  assert(!verifyInclusionProof(good, short63, { siblings: [], directionBits: 0 }), "short root rejected");
  assert(!verifyInclusionProof(good, long65,  { siblings: [], directionBits: 0 }), "long root rejected");
});

test("efficiency/hoisted-regex: buildMerkleTree rejects malformed leaf before constructing tree", () => {
  // A mix of valid and invalid leaves — must throw on the bad one, not silently skip it.
  const good = createHash("sha256").update("ok").digest("hex");
  let threw = false;
  try {
    buildMerkleTree([good, "not-hex-at-all"]);
  } catch (e) {
    threw = true;
    assert(e instanceof MerkleTreeError, "error is MerkleTreeError");
    eq((e as MerkleTreeError).code, "INVALID_LEAF");
  }
  assert(threw, "should have thrown on invalid leaf");
});

test("efficiency/hoisted-regex: hashPair two-update equals single-buffer concatenation", () => {
  // Regression: verifies that the two-update optimization in hashPair produces
  // the same digest as the old left+right concatenation approach.
  const a = createHash("sha256").update("left").digest("hex");
  const b = createHash("sha256").update("right").digest("hex");

  // Build a 2-leaf tree and check proof round-trips (implicitly tests hashPair output).
  const { root, proofs } = buildMerkleTree([a, b]);
  assert(verifyInclusionProof(a, root, proofs[0]), "leaf 0 proof valid after two-update hashPair");
  assert(verifyInclusionProof(b, root, proofs[1]), "leaf 1 proof valid after two-update hashPair");
  assert(!verifyInclusionProof(a, root, proofs[1]), "swapped proof correctly fails");
});

