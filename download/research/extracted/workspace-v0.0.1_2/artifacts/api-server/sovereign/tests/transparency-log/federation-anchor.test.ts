/**
 * tests/transparency-log/federation-anchor.test.ts
 *
 * Coverage: happy path · edge cases · fail-closed
 */

import { test, assert, eq } from "../../tests/_harness.mjs";
import {
  buildFederationAnchor,
  verifyFederationAnchor,
  federationAnchorSigningPayload,
  FEDERATION_ANCHOR_VERSION,
  FederationAnchorError,
} from "../../lib/transparency-log/federation-anchor.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";
import { createHmac } from "node:crypto";

// ── Minimal HMAC signer (mirrors the pattern in witness.test.ts) ──────────────

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

// Deterministic fake roots (64 hex chars)
const ROOT_A = "a".repeat(64);
const ROOT_B = "b".repeat(64);

const LOG_A = { logId: "org.acme/audit", root: ROOT_A, treeSize: 42 };
const LOG_B = { logId: "org.partner/audit", root: ROOT_B, treeSize: 17 };
const ANCHOR_ID = "anchor-001";
const ANCHORED_AT = "2026-01-01T00:00:00.000Z";
const SIGNER_ID = "key-fingerprint-A";

// ── Happy path ────────────────────────────────────────────────────────────────

test("buildFederationAnchor: produces a valid, verifiable anchor", () => {
  const anchor = buildFederationAnchor(
    signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID,
  );

  eq(anchor.version, FEDERATION_ANCHOR_VERSION, "version tag");
  eq(anchor.anchorId, ANCHOR_ID, "anchorId round-trips");
  eq(anchor.logA.logId, LOG_A.logId, "logA.logId");
  eq(anchor.logA.root, LOG_A.root, "logA.root");
  eq(anchor.logA.treeSize, LOG_A.treeSize, "logA.treeSize");
  eq(anchor.logB.logId, LOG_B.logId, "logB.logId");
  eq(anchor.logB.root, LOG_B.root, "logB.root");
  eq(anchor.logB.treeSize, LOG_B.treeSize, "logB.treeSize");
  eq(anchor.anchoredAt, ANCHORED_AT, "anchoredAt");
  eq(anchor.signerId, SIGNER_ID, "signerId");
  eq(anchor.algorithm, "hmac-sha256", "algorithm");
  assert(typeof anchor.signature === "string" && anchor.signature.length > 0, "signature present");

  // Must verify with the same signer
  assert(verifyFederationAnchor(anchor, signerA), "verifies with correct signer");
});

test("verifyFederationAnchor: payload is deterministic (recompute matches)", () => {
  const anchor = buildFederationAnchor(
    signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID,
  );
  // Manually recompute the expected signature
  const payload = federationAnchorSigningPayload({
    version: FEDERATION_ANCHOR_VERSION,
    anchorId: ANCHOR_ID,
    logA: LOG_A,
    logB: LOG_B,
    anchoredAt: ANCHORED_AT,
    signerId: SIGNER_ID,
  });
  const expected = signerA.sign(payload);
  eq(anchor.signature, expected, "signature matches manual recompute");
});

test("buildFederationAnchor: two signers produce different signatures for same data", () => {
  const anchorA = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  const anchorB = buildFederationAnchor(signerB, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  assert(anchorA.signature !== anchorB.signature, "different secrets → different sigs");
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("verifyFederationAnchor: fails with wrong signer (key mismatch)", () => {
  const anchor = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  assert(!verifyFederationAnchor(anchor, signerB), "wrong signer → false");
});

test("verifyFederationAnchor: fails if root is tampered after signing", () => {
  const anchor = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  const tampered = { ...anchor, logA: { ...anchor.logA, root: "c".repeat(64) } };
  assert(!verifyFederationAnchor(tampered, signerA), "tampered root → false");
});

test("verifyFederationAnchor: fails if treeSize is tampered after signing", () => {
  const anchor = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  const tampered = { ...anchor, logB: { ...anchor.logB, treeSize: anchor.logB.treeSize + 1 } };
  assert(!verifyFederationAnchor(tampered, signerA), "tampered treeSize → false");
});

test("verifyFederationAnchor: fails if anchorId is tampered", () => {
  const anchor = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  const tampered = { ...anchor, anchorId: "anchor-999" };
  assert(!verifyFederationAnchor(tampered, signerA), "tampered anchorId → false");
});

test("buildFederationAnchor: logA and logB may share same logId (single-org cross-version)", () => {
  // Not prohibited — the signer is responsible for what they attest to.
  const sameLog = { logId: "org.acme/audit", root: ROOT_A, treeSize: 10 };
  const sameLogV2 = { logId: "org.acme/audit", root: ROOT_B, treeSize: 20 };
  const anchor = buildFederationAnchor(signerA, "same-log", sameLog, sameLogV2, ANCHORED_AT, SIGNER_ID);
  assert(verifyFederationAnchor(anchor, signerA), "same logId in both endpoints is allowed");
});

// ── Fail-closed: build rejects bad inputs ────────────────────────────────────

test("buildFederationAnchor: rejects null/missing signer", () => {
  let threw = false;
  try {
    buildFederationAnchor(null as unknown as Signer, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  } catch (e) {
    threw = true;
    assert(e instanceof FederationAnchorError, "throws FederationAnchorError");
    eq((e as FederationAnchorError).code, "BAD_SIGNER", "code is BAD_SIGNER");
  }
  assert(threw, "must throw on null signer");
});

test("buildFederationAnchor: rejects empty anchorId", () => {
  let threw = false;
  try {
    buildFederationAnchor(signerA, "", LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  } catch (e) {
    threw = true;
    assert(e instanceof FederationAnchorError, "throws FederationAnchorError");
    eq((e as FederationAnchorError).code, "BAD_INPUT", "code is BAD_INPUT");
  }
  assert(threw, "must throw on empty anchorId");
});

test("buildFederationAnchor: rejects empty signerId", () => {
  let threw = false;
  try {
    buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, "");
  } catch (e) {
    threw = true;
    assert(e instanceof FederationAnchorError, "throws FederationAnchorError");
    eq((e as FederationAnchorError).code, "BAD_INPUT", "code is BAD_INPUT");
  }
  assert(threw, "must throw on empty signerId");
});

test("buildFederationAnchor: rejects empty anchoredAt", () => {
  let threw = false;
  try {
    buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, "", SIGNER_ID);
  } catch (e) {
    threw = true;
    assert(e instanceof FederationAnchorError, "throws FederationAnchorError");
    eq((e as FederationAnchorError).code, "BAD_INPUT", "code is BAD_INPUT");
  }
  assert(threw, "must throw on empty anchoredAt");
});

test("buildFederationAnchor: rejects logA with invalid root (not 64-hex)", () => {
  let threw = false;
  try {
    buildFederationAnchor(
      signerA, ANCHOR_ID,
      { logId: "x", root: "not-a-hash", treeSize: 1 },
      LOG_B, ANCHORED_AT, SIGNER_ID,
    );
  } catch (e) {
    threw = true;
    assert(e instanceof FederationAnchorError, "throws FederationAnchorError");
    eq((e as FederationAnchorError).code, "BAD_ENDPOINT", "code is BAD_ENDPOINT");
  }
  assert(threw, "must throw on bad root in logA");
});

test("buildFederationAnchor: rejects logB with treeSize = 0", () => {
  let threw = false;
  try {
    buildFederationAnchor(
      signerA, ANCHOR_ID, LOG_A,
      { logId: "y", root: ROOT_B, treeSize: 0 },
      ANCHORED_AT, SIGNER_ID,
    );
  } catch (e) {
    threw = true;
    assert(e instanceof FederationAnchorError, "throws FederationAnchorError");
    eq((e as FederationAnchorError).code, "BAD_ENDPOINT", "code is BAD_ENDPOINT");
  }
  assert(threw, "must throw on treeSize=0 in logB");
});

test("buildFederationAnchor: rejects logA with empty logId", () => {
  let threw = false;
  try {
    buildFederationAnchor(
      signerA, ANCHOR_ID,
      { logId: "", root: ROOT_A, treeSize: 1 },
      LOG_B, ANCHORED_AT, SIGNER_ID,
    );
  } catch (e) {
    threw = true;
    assert(e instanceof FederationAnchorError, "throws FederationAnchorError");
    eq((e as FederationAnchorError).code, "BAD_ENDPOINT", "code is BAD_ENDPOINT");
  }
  assert(threw, "must throw on empty logId in logA");
});

// ── Fail-closed: verify rejects structurally broken anchors ──────────────────

test("verifyFederationAnchor: returns false on null input", () => {
  assert(!verifyFederationAnchor(null as unknown as never, signerA), "null → false");
});

test("verifyFederationAnchor: returns false on wrong version tag", () => {
  const anchor = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  const bad = { ...anchor, version: "tfa-federation-anchor-v0" as never };
  assert(!verifyFederationAnchor(bad, signerA), "wrong version → false");
});

test("verifyFederationAnchor: returns false on missing signature", () => {
  const anchor = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  const bad = { ...anchor, signature: "" };
  assert(!verifyFederationAnchor(bad, signerA), "empty signature → false");
});

test("verifyFederationAnchor: returns false if logA root is invalid hex", () => {
  const anchor = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  const bad = { ...anchor, logA: { ...anchor.logA, root: "not-a-root" } };
  assert(!verifyFederationAnchor(bad, signerA), "invalid root → false");
});

test("verifyFederationAnchor: returns false if logB treeSize is 0", () => {
  const anchor = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  const bad = { ...anchor, logB: { ...anchor.logB, treeSize: 0 } };
  assert(!verifyFederationAnchor(bad, signerA), "treeSize=0 → false");
});

test("verifyFederationAnchor: returns false on null signer", () => {
  const anchor = buildFederationAnchor(signerA, ANCHOR_ID, LOG_A, LOG_B, ANCHORED_AT, SIGNER_ID);
  assert(!verifyFederationAnchor(anchor, null as unknown as Signer), "null signer → false");
});
