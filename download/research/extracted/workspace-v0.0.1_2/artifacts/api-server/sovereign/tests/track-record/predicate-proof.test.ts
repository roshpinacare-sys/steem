/**
 * tests/track-record/predicate-proof.test.ts
 *
 * Coverage: happy path · edge cases · fail-closed
 */

import { test, assert, eq } from "../../tests/_harness.mjs";
import {
  buildPredicateProof,
  verifyPredicateProof,
  predicateProofSigningPayload,
  PREDICATE_PROOF_VERSION,
  PredicateProofError,
} from "../../lib/track-record/predicate-proof.ts";
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

/** Simulate the caller blinding an action (with its value) into a leaf hash. */
function makeLeaf(actionId: string, valueMicroCents: bigint, salt: string): string {
  return createHash("sha256")
    .update(salt)
    .update(actionId)
    .update(valueMicroCents.toString())
    .digest("hex");
}

const TENANT = "tenant-abc";
const IDENTITY = "agent-007";

/** 5 blinded leaf hashes, all representing actions under 10000n micro-cents. */
const LEAVES = [
  makeLeaf("act-1", 100n, "salt-1"),
  makeLeaf("act-2", 200n, "salt-2"),
  makeLeaf("act-3", 300n, "salt-3"),
  makeLeaf("act-4", 400n, "salt-4"),
  makeLeaf("act-5", 500n, "salt-5"),
];

const THRESHOLD = 10_000n;
const ISSUED_AT = "2026-01-15T10:00:00.000Z";

// ── Happy path ────────────────────────────────────────────────────────────────

test("buildPredicateProof + verifyPredicateProof: basic round-trip (5 leaves, allBelowThreshold=true)", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT,
    identityId: IDENTITY,
    leafHashes: LEAVES,
    threshold: THRESHOLD,
    allBelowThreshold: true,
    minCount: 3,
    signer: signerA,
    signerId: "key-A",
    issuedAt: ISSUED_AT,
  });

  eq(proof.version, PREDICATE_PROOF_VERSION, "version tag");
  eq(proof.tenantId, TENANT, "tenantId round-trips");
  eq(proof.identityId, IDENTITY, "identityId round-trips");
  eq(proof.treeSize, 5, "treeSize = number of leaves");
  eq(proof.threshold, "10000", "threshold serialized as decimal string");
  eq(proof.allBelowThreshold, true, "allBelowThreshold round-trips");
  eq(proof.minCount, 3, "minCount round-trips");
  eq(proof.witnesses.length, 3, "exactly minCount witnesses");
  eq(proof.issuedAt, ISSUED_AT, "issuedAt round-trips");
  eq(proof.signerId, "key-A", "signerId round-trips");
  eq(proof.algorithm, "hmac-sha256", "algorithm copied from signer");
  assert(typeof proof.signature === "string" && proof.signature.length > 0, "signature present");

  assert(verifyPredicateProof(proof, signerA), "verification passes with correct signer");
});

test("buildPredicateProof: deterministic — identical inputs produce identical proof", () => {
  const mk = () => buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 2,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const p1 = mk();
  const p2 = mk();

  eq(p1.root, p2.root, "root is identical");
  eq(p1.signature, p2.signature, "signature is identical (deterministic payload)");
  eq(p1.witnesses[0].leafHash, p2.witnesses[0].leafHash, "witness leafHash identical");
});

test("buildPredicateProof: allBelowThreshold=false is also a valid, provable claim", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: false, minCount: 2,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  eq(proof.allBelowThreshold, false, "false claim preserved");
  assert(verifyPredicateProof(proof, signerA), "false claim still verifies (it's a signed assertion, either way)");
});

test("buildPredicateProof: minCount=treeSize proves all leaves", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: LEAVES.length,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  eq(proof.witnesses.length, LEAVES.length, "witnesses = all leaves");
  assert(verifyPredicateProof(proof, signerA), "verifies full coverage");
});

test("buildPredicateProof: single-leaf tree works", () => {
  const leaf = makeLeaf("sole", 50n, "s");
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: [leaf],
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 1,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  eq(proof.treeSize, 1, "treeSize=1");
  assert(verifyPredicateProof(proof, signerA), "verifies single-leaf tree");
});

test("buildPredicateProof: large bigint threshold round-trips exactly (no float precision loss)", () => {
  const bigThreshold = 9_007_199_254_740_993n; // > Number.MAX_SAFE_INTEGER
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: bigThreshold, allBelowThreshold: true, minCount: 1,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  eq(proof.threshold, bigThreshold.toString(), "exact bigint string, not float-rounded");
  assert(verifyPredicateProof(proof, signerA), "verifies with large threshold");
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("predicateProofSigningPayload: deterministic across two calls with same fields", () => {
  const fields = {
    version: PREDICATE_PROOF_VERSION,
    tenantId: "t", identityId: "i",
    root: "a".repeat(64), treeSize: 3, threshold: "10000", allBelowThreshold: true, minCount: 2,
    issuedAt: ISSUED_AT, signerId: "k",
  };
  eq(predicateProofSigningPayload(fields), predicateProofSigningPayload(fields), "payload deterministic");
});

test("verifyPredicateProof: wrong signer key returns false (signature mismatch)", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 2,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  assert(!verifyPredicateProof(proof, signerB), "wrong key → false");
});

test("verifyPredicateProof: tampered root returns false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 2,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const tampered = { ...proof, root: "f".repeat(64) };
  assert(!verifyPredicateProof(tampered, signerA), "tampered root → false");
});

test("verifyPredicateProof: tampered threshold (raising it) returns false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 2,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  // Attacker tries to claim a much higher threshold was proven (cheaper claim weaponized upward).
  const tampered = { ...proof, threshold: "999999999" };
  assert(!verifyPredicateProof(tampered, signerA), "tampered threshold → false (sig mismatch)");
});

test("verifyPredicateProof: flipping allBelowThreshold from false to true returns false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: false, minCount: 2,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const tampered = { ...proof, allBelowThreshold: true };
  assert(!verifyPredicateProof(tampered, signerA), "flipped claim → false (sig mismatch)");
});

test("verifyPredicateProof: tampered treeSize returns false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 2,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const tampered = { ...proof, treeSize: 999 };
  assert(!verifyPredicateProof(tampered, signerA), "tampered treeSize → false");
});

test("verifyPredicateProof: tampered witness leafHash returns false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 2,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const badWitness = { ...proof.witnesses[0], leafHash: "e".repeat(64) };
  const tampered = { ...proof, witnesses: [badWitness, proof.witnesses[1]] };
  assert(!verifyPredicateProof(tampered, signerA), "tampered leafHash → false (inclusion proof fails)");
});

test("verifyPredicateProof: duplicate leafIndex in witnesses returns false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 2,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const tampered = { ...proof, witnesses: [proof.witnesses[0], proof.witnesses[0]] };
  assert(!verifyPredicateProof(tampered, signerA), "duplicate leafIndex → false");
});

// ── Fail-closed ───────────────────────────────────────────────────────────────

test("verifyPredicateProof: null input → false", () => {
  assert(!verifyPredicateProof(null, signerA), "null → false");
});

test("verifyPredicateProof: wrong version → false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 1,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  assert(!verifyPredicateProof({ ...proof, version: "tfa-predicate-proof-v0" as never }, signerA), "wrong version → false");
});

test("verifyPredicateProof: missing tenantId → false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 1,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  assert(!verifyPredicateProof({ ...proof, tenantId: "" }, signerA), "empty tenantId → false");
});

test("verifyPredicateProof: malformed threshold string (non-numeric) → false, never throws", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 1,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  assert(!verifyPredicateProof({ ...proof, threshold: "not-a-number" }, signerA), "non-numeric threshold → false");
  assert(!verifyPredicateProof({ ...proof, threshold: "-100" }, signerA), "negative threshold string → false");
  assert(!verifyPredicateProof({ ...proof, threshold: "" }, signerA), "empty threshold → false");
});

test("verifyPredicateProof: witnesses fewer than minCount → false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 3,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  const tampered = { ...proof, witnesses: proof.witnesses.slice(0, 1) };
  assert(!verifyPredicateProof(tampered, signerA), "too few witnesses → false");
});

test("verifyPredicateProof: null signer → false", () => {
  const proof = buildPredicateProof({
    tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
    threshold: THRESHOLD, allBelowThreshold: true, minCount: 1,
    signer: signerA, signerId: "key-A", issuedAt: ISSUED_AT,
  });
  assert(!verifyPredicateProof(proof, null as unknown as Signer), "null signer → false");
});

test("buildPredicateProof: empty leafHashes throws PredicateProofError", () => {
  let threw = false;
  try {
    buildPredicateProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: [],
      threshold: THRESHOLD, allBelowThreshold: true, minCount: 1,
      signer: signerA, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    assert(e instanceof PredicateProofError, "throws PredicateProofError");
    eq((e as PredicateProofError).code, "BAD_INPUT", "code=BAD_INPUT");
  }
  assert(threw, "must throw on empty leafHashes");
});

test("buildPredicateProof: minCount > leafHashes.length throws PredicateProofError", () => {
  let threw = false;
  try {
    buildPredicateProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
      threshold: THRESHOLD, allBelowThreshold: true, minCount: 99,
      signer: signerA, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    eq((e as PredicateProofError).code, "BAD_INPUT", "code=BAD_INPUT");
  }
  assert(threw, "must throw when minCount > leafCount");
});

test("buildPredicateProof: threshold=0n throws PredicateProofError (fail-closed, not a usable bound)", () => {
  let threw = false;
  try {
    buildPredicateProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
      threshold: 0n, allBelowThreshold: true, minCount: 1,
      signer: signerA, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    assert(e instanceof PredicateProofError, "throws PredicateProofError");
    eq((e as PredicateProofError).code, "BAD_INPUT", "code=BAD_INPUT");
  }
  assert(threw, "must throw on threshold=0n");
});

test("buildPredicateProof: negative threshold throws PredicateProofError", () => {
  let threw = false;
  try {
    buildPredicateProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
      threshold: -50n, allBelowThreshold: true, minCount: 1,
      signer: signerA, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    eq((e as PredicateProofError).code, "BAD_INPUT", "code=BAD_INPUT");
  }
  assert(threw, "must throw on negative threshold");
});

test("buildPredicateProof: non-bigint threshold (number) throws PredicateProofError", () => {
  let threw = false;
  try {
    buildPredicateProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
      threshold: 10000 as unknown as bigint, allBelowThreshold: true, minCount: 1,
      signer: signerA, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    assert(e instanceof PredicateProofError, "throws PredicateProofError — money must be real bigint, not number");
  }
  assert(threw, "must throw on non-bigint threshold");
});

test("buildPredicateProof: null signer throws PredicateProofError", () => {
  let threw = false;
  try {
    buildPredicateProof({
      tenantId: TENANT, identityId: IDENTITY, leafHashes: LEAVES,
      threshold: THRESHOLD, allBelowThreshold: true, minCount: 1,
      signer: null as unknown as Signer, signerId: "key-A",
    });
  } catch (e) {
    threw = true;
    assert(e instanceof PredicateProofError, "throws PredicateProofError");
    eq((e as PredicateProofError).code, "BAD_SIGNER", "code=BAD_SIGNER");
  }
  assert(threw, "must throw on null signer");
});
