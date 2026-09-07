import "../_flush.mjs";
/**
 * tests/passport/claim.test.ts — PassportClaim builder + revocation.
 *
 * Coverage:
 *   • happy path: claim builds with all fields correct.
 *   • canonical JSON determinism (keys sorted, arrays stable).
 *   • fail-closed: missing/empty issuer, subject, scope → ClaimError.
 *   • fail-closed: missing signer → ClaimError.
 *   • fail-closed: null opts → ClaimError.
 *   • revocationStatus normalisation: active/revoked/expired accepted; unknown/empty/null/undefined → "revoked".
 *   • evidenceRefs defaults to empty and filters out non-strings / empties.
 *   • computeClaimHash is deterministic.
 *   • revokeClaim / isClaimRevoked / clearRevocations.
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  buildPassportClaim,
  computeClaimHash,
  canonicalPassportClaim,
  normalizeRevocationStatus,
  revokeClaim,
  isClaimRevoked,
  clearRevocations,
} from "../../lib/passport/claim.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";

const SECRET = "claim-test-secret-0123456789abc!!";

function makeSigner() {
  return new HmacSigner(SECRET);
}

test("happy path: claim builds with correct fields", () => {
  const signer = makeSigner();
  const claim = buildPassportClaim({
    issuer: "tenant-a",
    subject: "passport-123",
    scope: "passport.status",
    evidenceRefs: ["audit-1", "audit-2"],
    revocationStatus: "active",
    signer,
    claimIdFactory: () => "claim-id-1",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  eq(claim.version, "1");
  eq(claim.claimId, "claim-id-1");
  eq(claim.issuedAt, "2026-01-01T00:00:00.000Z");
  eq(claim.issuer, "tenant-a");
  eq(claim.subject, "passport-123");
  eq(claim.scope, "passport.status");
  eq(JSON.stringify(claim.evidenceRefs), JSON.stringify(["audit-1", "audit-2"]));
  eq(claim.revocationStatus, "active");
  eq(claim.algorithm, "hmac-sha256");
  assert(typeof claim.hash === "string" && claim.hash.length === 64, "hash is 64-char hex");
  assert(typeof claim.signature === "string" && claim.signature.length > 0, "signature present");
});

test("canonical JSON determinism", () => {
  const a = canonicalPassportClaim({ z: 1, a: 2, nested: { y: [3, 2, 1], x: null } });
  const b = canonicalPassportClaim({ a: 2, z: 1, nested: { x: null, y: [3, 2, 1] } });
  eq(a, b, "canonical should be deterministic regardless of key order");
});

test("fail-closed: null opts throws", () => {
  try {
    (buildPassportClaim as any)(null);
    assert(false, "should throw");
  } catch (e: any) {
    eq(e.name, "ClaimError");
    eq(e.code, "missing_options");
  }
});

test("fail-closed: missing issuer throws", () => {
  try {
    buildPassportClaim({ issuer: "", subject: "s", scope: "sc", signer: makeSigner() } as any);
    assert(false, "should throw");
  } catch (e: any) {
    eq(e.code, "missing_issuer");
  }
});

test("fail-closed: missing subject throws", () => {
  try {
    buildPassportClaim({ issuer: "i", subject: "", scope: "sc", signer: makeSigner() } as any);
    assert(false, "should throw");
  } catch (e: any) {
    eq(e.code, "missing_subject");
  }
});

test("fail-closed: missing scope throws", () => {
  try {
    buildPassportClaim({ issuer: "i", subject: "s", scope: "", signer: makeSigner() } as any);
    assert(false, "should throw");
  } catch (e: any) {
    eq(e.code, "missing_scope");
  }
});

test("fail-closed: missing signer throws", () => {
  try {
    buildPassportClaim({ issuer: "i", subject: "s", scope: "sc" } as any);
    assert(false, "should throw");
  } catch (e: any) {
    eq(e.code, "missing_signer");
  }
});

test("revocationStatus normalisation: accepted values", () => {
  eq(normalizeRevocationStatus("active"), "active");
  eq(normalizeRevocationStatus("revoked"), "revoked");
  eq(normalizeRevocationStatus("expired"), "expired");
});

test("revocationStatus normalisation: unknown/empty/null/undefined → revoked", () => {
  eq(normalizeRevocationStatus("unknown"), "revoked");
  eq(normalizeRevocationStatus(""), "revoked");
  eq(normalizeRevocationStatus(null as any), "revoked");
  eq(normalizeRevocationStatus(undefined), "revoked");
});

test("evidenceRefs defaults to empty and filters bad entries", () => {
  const signer = makeSigner();
  const claim = buildPassportClaim({
    issuer: "t",
    subject: "s",
    scope: "sc",
    evidenceRefs: ["good", "", null, 123, "also-good"],
    signer,
    claimIdFactory: () => "id",
    now: () => "2026-01-01T00:00:00.000Z",
  });
  eq(JSON.stringify(claim.evidenceRefs), JSON.stringify(["good", "also-good"]));
});

test("evidenceRefs defaults to empty when omitted", () => {
  const signer = makeSigner();
  const claim = buildPassportClaim({
    issuer: "t",
    subject: "s",
    scope: "sc",
    signer,
    claimIdFactory: () => "id",
    now: () => "2026-01-01T00:00:00.000Z",
  });
  eq(JSON.stringify(claim.evidenceRefs), "[]");
});

test("computeClaimHash is deterministic", () => {
  const body = { version: "1", claimId: "id", issuedAt: "t", issuer: "i", subject: "s", scope: "sc", evidenceRefs: [], revocationStatus: "active", algorithm: "hmac-sha256" };
  const h1 = computeClaimHash(body);
  const h2 = computeClaimHash(body);
  eq(h1, h2);
  assert(h1.length === 64, "hash is hex");
});

test("revocation store: revoke and check", () => {
  clearRevocations();
  eq(isClaimRevoked("c1"), false);
  revokeClaim("c1");
  eq(isClaimRevoked("c1"), true);
  eq(isClaimRevoked("c2"), false);
  clearRevocations();
  eq(isClaimRevoked("c1"), false);
});

test("revocation store: idempotent revoke", () => {
  clearRevocations();
  revokeClaim("c1");
  revokeClaim("c1");
  eq(isClaimRevoked("c1"), true);
  clearRevocations();
});
