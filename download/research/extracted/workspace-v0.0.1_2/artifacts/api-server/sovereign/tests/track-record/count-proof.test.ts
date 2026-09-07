/**
 * tests/track-record/count-proof.test.ts
 *
 * Coverage: happy path · edge cases · fail-closed
 */

import { test, assert, eq } from "../../tests/_harness.mjs";
import {
  buildCountProof,
  verifyCountProof,
  countProofSigningPayload,
  COUNT_PROOF_VERSION,
  CountProofError,
} from "../../lib/track-record/count-proof.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";
import { createHash, createHmac } from "node:crypto";

// ── Minimal HMAC signer ───────────────────────────────────────────────────────

function makeSigner(secret: string): Signer {
  return {
    algorithm: "hmac-sha256",
    sign(payload: string): string {
      return createHmac("sha256", secret).update(payload).digest("base64");
    },
    verify(payload: string, sig: string): boolean {
      return createHmac("sha256", secret).update(payload).digest("base64") === sig;
    },
  };
}

const signerA = makeSigner("secret-A");
const signerB = makeSigner("secret-B");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate the caller blinding an action into a leaf hash. */
function makeLeaf(actionId: string, outcome: string, salt: string): string {
  return createHash("sha256")
    .update(salt)
    .update(actionId)
    .update(outcome)
    .digest("hex");
}

const TENANT = "tenant-abc";
const IDENTITY = "agent-007";

/** 5 blinded leaf hashes representing 5 actions (all allowed). */
const LEAVES = [
  makeLeaf("act-1", "allowed", "salt-1"),
  makeLeaf("act-2", "allowed", "salt-2"),
  makeLeaf("act-3", "allowed", "salt-3"),
  makeLeaf("act-4", "allowed", "salt-4"),
  makeLeaf("act-5", "allowed", "salt-5"),
];

const ISSUED_AT = "2026-01-15T10:00:00.000Z";

// ── Happy path ────────────────────────────────────────────────────────────────

test("buildCountProof + verifyCountProof: basic round-trip (5 leaves, minCount=3)", () => {
  const proof = buildCountProof({
    tenantId: TENANT,
    identityId: IDENTITY,
    leafHashes: LEAVES,
    deniedCount: 0,
    minCount: 3,
    signer: signerA,
    signerId: "key-A",
    issuedAt: ISSUED_AT,
  });

  eq(proof.version, COUNT_PROOF_VERSION, "version tag");
  eq(proof.tenantId, TENANT, "tenantId round-trips");
  eq(proof.identityId, IDENTITY, "identityId round-trips");
  eq(proof.treeSize, 5, "treeSize = number of leaves");
  eq(proof.minCount, 3, "minCount round-trips");
  eq(proof.deniedCount, 0, "deniedCount round-trips");
  eq(proof.witnesses.length, 3, "exactly minCount witnesses");
  eq(proof.issuedAt, ISSUED_AT, "issuedAt round-trips");
  eq(proof.signerId, "key-A", "signerId round-trips");
  eq(proof.algorithm, "hmac-sha256", "algorithm copied from signer");
  assert(typeof proof.signature === "string" && proof.signature.length > 0, "signature present");

  assert(verifyCountProof(proof, signerA), "verification passes with correct signer");
});

test("buildCountProof: deterministic — identical inputs produce identical proof", () => {
  const p1 = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const p2 = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });

  eq(p1.root, p2.root, "root is identical");
  eq(p1.signature, p2.signature, "signature is identical (deterministic payload)");
  eq(p1.witnesses[0].leafHash, p2.witnesses[0].leafHash, "witness leafHash identical");
});

test("buildCountProof: minCount=1 produces exactly 1 witness", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 1, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  eq(proof.witnesses.length, 1, "1 witness");
  assert(verifyCountProof(proof, signerA), "verifies");
});

test("buildCountProof: minCount=treeSize proves all leaves", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: LEAVES.length, signer: signerA, signerId: "key-A",
    issuedAt: ISSUED_AT,
  });
  eq(proof.witnesses.length, LEAVES.length, "witnesses = all leaves");
  assert(verifyCountProof(proof, signerA), "verifies full coverage");
});

test("buildCountProof: single-leaf tree works", () => {
  const leaf = makeLeaf("sole", "allowed", "s");
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: [leaf],
    deniedCount: 0, minCount: 1, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  eq(proof.treeSize, 1, "treeSize=1");
  eq(proof.witnesses.length, 1, "1 witness");
  assert(verifyCountProof(proof, signerA), "verifies single-leaf tree");
});

test("buildCountProof: deniedCount>0 is preserved and verifiable", () => {
  const leaves = [
    makeLeaf("act-a", "allowed", "sa"),
    makeLeaf("act-b", "denied", "sb"),
    makeLeaf("act-c", "allowed", "sc"),
  ];
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: leaves,
    deniedCount: 1, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  eq(proof.deniedCount, 1, "deniedCount=1 round-trips");
  assert(verifyCountProof(proof, signerA), "verifies even with denials");
});

test("witness leafIndex values are distinct and ordered", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 4, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const indices = proof.witnesses.map(w => w.leafIndex);
  const unique = new Set(indices);
  eq(unique.size, 4, "all indices distinct");
  // First N leaves, 0-based
  eq(indices[0], 0, "first witness is leaf 0");
  eq(indices[3], 3, "fourth witness is leaf 3");
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("countProofSigningPayload: deterministic across two calls with same fields", () => {
  const fields = {
    version: COUNT_PROOF_VERSION,
    tenantId: "t", identityId: "i",
    root: "a".repeat(64), treeSize: 3, minCount: 2, deniedCount: 0,
    issuedAt: ISSUED_AT, signerId: "k",
  };
  eq(countProofSigningPayload(fields), countProofSigningPayload(fields), "payload deterministic");
});

test("verifyCountProof: wrong signer key returns false (signature mismatch)", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  assert(!verifyCountProof(proof, signerB), "wrong key → false");
});

test("verifyCountProof: tampered root returns false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const tampered = { ...proof, root: "f".repeat(64) };
  assert(!verifyCountProof(tampered, signerA), "tampered root → false");
});

test("verifyCountProof: tampered deniedCount returns false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const tampered = { ...proof, deniedCount: 99 };
  assert(!verifyCountProof(tampered, signerA), "tampered deniedCount → false");
});

test("verifyCountProof: tampered treeSize returns false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const tampered = { ...proof, treeSize: 999 };
  assert(!verifyCountProof(tampered, signerA), "tampered treeSize → false");
});

test("verifyCountProof: tampered minCount returns false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const tampered = { ...proof, minCount: 1 };
  assert(!verifyCountProof(tampered, signerA), "tampered minCount → false (sig mismatch)");
});

test("verifyCountProof: tampered witness leafHash returns false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const badWitness = { ...proof.witnesses[0], leafHash: "e".repeat(64) };
  const tampered = { ...proof, witnesses: [badWitness, proof.witnesses[1]] };
  assert(!verifyCountProof(tampered, signerA), "tampered leafHash → false (inclusion proof fails)");
});

test("verifyCountProof: duplicate leafIndex in witnesses returns false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  // Duplicate the first witness
  const tampered = { ...proof, witnesses: [proof.witnesses[0], proof.witnesses[0]] };
  assert(!verifyCountProof(tampered, signerA), "duplicate leafIndex → false");
});

// ─── efficiency/single-pass-witness-check ──────────────────────────────────────
// verifyCountProof used to walk p.witnesses twice: once to verify each Merkle
// inclusion proof, once more (Set-based) to check leafIndex distinctness. Both
// checks now run in one loop. These tests pin that the merge didn't change
// outcomes: all-valid distinct witnesses still pass (regression), and a
// witness whose inclusion proof is invalid is still caught even when it's
// also a leafIndex duplicate of an earlier witness (the inclusion-proof check
// runs before the duplicate check on every iteration, so it still fails
// closed on the proof itself, not silently on the duplicate check instead).
test("efficiency/single-pass-witness-check — regression: 5 distinct valid witnesses still verify", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 5, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  eq(proof.witnesses.length, 5);
  assert(verifyCountProof(proof, signerA), "5 distinct, valid witnesses must still verify after the loop merge");
});

test("efficiency/single-pass-witness-check — duplicate witness with a bad inclusion proof fails on the proof check, not just the duplicate check", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 2, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  // Second entry repeats witnesses[0]'s leafIndex AND carries a corrupted
  // leafHash — the merged loop must still return false (via the inclusion
  // proof check on that same iteration), not pass through to a later
  // duplicate-only check that no longer exists.
  const corrupted = { ...proof.witnesses[0], leafHash: "f".repeat(64) };
  const tampered = { ...proof, witnesses: [proof.witnesses[0], corrupted] };
  assert(!verifyCountProof(tampered, signerA), "duplicate leafIndex with a bad inclusion proof must still fail-closed");
});

// ── Fail-closed ───────────────────────────────────────────────────────────────

test("verifyCountProof: null input → false", () => {
  assert(!verifyCountProof(null, signerA), "null → false");
});

test("verifyCountProof: wrong version → false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 1, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  assert(!verifyCountProof({ ...proof, version: "tfa-count-proof-v0" as never }, signerA), "wrong version → false");
});

test("verifyCountProof: missing tenantId → false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 1, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  assert(!verifyCountProof({ ...proof, tenantId: "" }, signerA), "empty tenantId → false");
});

test("verifyCountProof: witnesses fewer than minCount → false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 3, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  // Strip witnesses below minCount
  const tampered = { ...proof, witnesses: proof.witnesses.slice(0, 1) };
  assert(!verifyCountProof(tampered, signerA), "too few witnesses → false");
});

test("verifyCountProof: null signer → false", () => {
  const proof = buildCountProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    deniedCount: 0, minCount: 1, signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  assert(!verifyCountProof(proof, null as unknown as Signer), "null signer → false");
});

test("buildCountProof: empty leafHashes throws CountProofError", () => {
  let threw = false;
  try {
    buildCountProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: [],
      deniedCount: 0, minCount: 1, signer: signerA, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    assert(e instanceof CountProofError, "throws CountProofError");
    eq((e as CountProofError).code, "BAD_INPUT", "code=BAD_INPUT");
  }
  assert(threw, "must throw on empty leafHashes");
});

test("buildCountProof: minCount > leafHashes.length throws CountProofError", () => {
  let threw = false;
  try {
    buildCountProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
      deniedCount: 0, minCount: 99, signer: signerA, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    assert(e instanceof CountProofError, "throws CountProofError");
    eq((e as CountProofError).code, "BAD_INPUT", "code=BAD_INPUT");
  }
  assert(threw, "must throw when minCount > leafCount");
});

test("buildCountProof: deniedCount > leafHashes.length throws CountProofError", () => {
  let threw = false;
  try {
    buildCountProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
      deniedCount: 999, minCount: 1, signer: signerA, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    eq((e as CountProofError).code, "BAD_INPUT", "code=BAD_INPUT");
  }
  assert(threw, "must throw when deniedCount > leafCount");
});

test("buildCountProof: null signer throws CountProofError", () => {
  let threw = false;
  try {
    buildCountProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
      deniedCount: 0, minCount: 1, signer: null as unknown as Signer, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    assert(e instanceof CountProofError, "throws CountProofError");
    eq((e as CountProofError).code, "BAD_SIGNER", "code=BAD_SIGNER");
  }
  assert(threw, "must throw on null signer");
});
