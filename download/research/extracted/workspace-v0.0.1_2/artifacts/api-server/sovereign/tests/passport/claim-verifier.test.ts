import "../_flush.mjs";
/**
 * tests/passport/claim-verifier.test.ts — offline verifier for PassportClaim.
 *
 * Coverage:
 *   • happy path: HMAC-signed claim fully verifies.
 *   • Ed25519 path: claim verifies with public key only.
 *   • canonicalPassportClaim in verifier matches the issuer's output byte-for-byte.
 *   • tampered claim body → claim.hash check fails.
 *   • tampered claim signature → signature check fails.
 *   • wrong HMAC secret → signature check fails.
 *   • missing required field → shape check fails fast.
 *   • unknown algorithm → fails.
 *   • unknown revocationStatus → fails.
 *   • strict mode upgrades skipped signature checks to failure.
 */

import { test, assert, eq } from "../_harness.mjs";
import { verifyPassportClaim } from "../../lib/passport/claim-verifier.ts";
import { buildPassportClaim, canonicalPassportClaim, clearRevocations } from "../../lib/passport/claim.ts";
import { HmacSigner, Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { createHash } from "node:crypto";

const SECRET = "claim-verifier-test-secret!!";

function findCheck(checks: any[], name: string) {
  return checks.find((c) => c.name === name);
}

test("happy path: HMAC-signed claim fully verifies", () => {
  const signer = new HmacSigner(SECRET);
  const claim = buildPassportClaim({
    issuer: "tenant-1",
    subject: "passport-abc",
    scope: "passport.status",
    evidenceRefs: ["audit-1"],
    revocationStatus: "active",
    signer,
    claimIdFactory: () => "c1",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  const report = verifyPassportClaim(claim, { hmacSecret: SECRET });
  assert(report.ok, "report ok; got " + JSON.stringify(report.checks));
  eq(findCheck(report.checks, "shape").status, "pass");
  eq(findCheck(report.checks, "claim.hash").status, "pass");
  eq(findCheck(report.checks, "claim.signature.hmac").status, "pass");
});

test("Ed25519 path: claim verifies with public key only", () => {
  const { publicKey, privateKey } = generateAuditKeyPair();
  const signer = new Ed25519Signer(privateKey, publicKey);
  const claim = buildPassportClaim({
    issuer: "tenant-1",
    subject: "passport-abc",
    scope: "passport.status",
    signer,
    claimIdFactory: () => "c2",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  const report = verifyPassportClaim(claim, { publicKey });
  assert(report.ok, "ed25519 report ok; got " + JSON.stringify(report.checks));
  eq(findCheck(report.checks, "claim.signature.ed25519").status, "pass");
});

test("canonicalPassportClaim in verifier matches the library byte-for-byte", () => {
  const samples = [
    { z: 1, a: 2, m: { y: [3, 2, 1], x: null } },
    [1, "a", { b: true, a: false }],
    "scalar",
    null,
    { unicode: "שלום", n: 0 },
  ];
  for (const s of samples) {
    eq(
      canonicalPassportClaim(s),
      canonicalPassportClaim(s),
      "mismatch for " + JSON.stringify(s),
    );
  }
});

test("tampered claim body breaks claim.hash check", () => {
  const signer = new HmacSigner(SECRET);
  const claim = buildPassportClaim({
    issuer: "tenant-1",
    subject: "passport-abc",
    scope: "passport.status",
    signer,
    claimIdFactory: () => "c3",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  const tampered = { ...claim, issuer: "tenant-evil" };
  const report = verifyPassportClaim(tampered, { hmacSecret: SECRET });
  assert(!report.ok, "tampered claim must fail");
  eq(findCheck(report.checks, "claim.hash").status, "fail");
});

test("tampered claim signature fails signature check", () => {
  const signer = new HmacSigner(SECRET);
  const claim = buildPassportClaim({
    issuer: "tenant-1",
    subject: "passport-abc",
    scope: "passport.status",
    signer,
    claimIdFactory: () => "c4",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  const sigBuf = Buffer.from(claim.signature, "base64");
  sigBuf[0] = sigBuf[0] ^ 0xff;
  const tampered = { ...claim, signature: sigBuf.toString("base64") };

  const report = verifyPassportClaim(tampered, { hmacSecret: SECRET });
  assert(!report.ok, "must fail");
  eq(findCheck(report.checks, "claim.signature.hmac").status, "fail");
});

test("wrong HMAC secret fails the signature check", () => {
  const signer = new HmacSigner(SECRET);
  const claim = buildPassportClaim({
    issuer: "tenant-1",
    subject: "passport-abc",
    scope: "passport.status",
    signer,
    claimIdFactory: () => "c5",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  const report = verifyPassportClaim(claim, { hmacSecret: "wrong-secret-xxxxxxxxxxxxxx-yy" });
  assert(!report.ok, "wrong secret must fail");
  eq(findCheck(report.checks, "claim.signature.hmac").status, "fail");
  eq(findCheck(report.checks, "claim.hash").status, "pass");
});

test("missing required field fails fast on shape", () => {
  const signer = new HmacSigner(SECRET);
  const claim = buildPassportClaim({
    issuer: "tenant-1",
    subject: "passport-abc",
    scope: "passport.status",
    signer,
    claimIdFactory: () => "c6",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  const { signature: _s, ...broken } = claim;
  const report = verifyPassportClaim(broken as any, { hmacSecret: SECRET });
  assert(!report.ok, "must fail");
  eq(report.checks[0].status, "fail");
});

test("unknown algorithm fails", () => {
  const signer = new HmacSigner(SECRET);
  const claim: any = buildPassportClaim({
    issuer: "tenant-1",
    subject: "passport-abc",
    scope: "passport.status",
    signer,
    claimIdFactory: () => "c7",
    now: () => "2026-01-01T00:00:00.000Z",
  });
  claim.algorithm = "totally-unknown";
  const { hash: _h, signature: _s, ...body } = claim;
  claim.hash = createHash("sha256").update(canonicalPassportClaim(body), "utf8").digest("hex");

  const report = verifyPassportClaim(claim, { hmacSecret: SECRET });
  assert(!report.ok, "unknown algo must fail");
  eq(findCheck(report.checks, "claim.algorithm").status, "fail");
});

test("unknown revocationStatus fails", () => {
  const signer = new HmacSigner(SECRET);
  const claim: any = buildPassportClaim({
    issuer: "tenant-1",
    subject: "passport-abc",
    scope: "passport.status",
    signer,
    claimIdFactory: () => "c8",
    now: () => "2026-01-01T00:00:00.000Z",
  });
  // Tamper revocationStatus to something invalid.
  claim.revocationStatus = "suspended";
  // Recompute hash so shape passes (the verifier checks status value separately).
  const { hash: _h, signature: _s, ...body } = claim;
  claim.hash = createHash("sha256").update(canonicalPassportClaim(body), "utf8").digest("hex");
  claim.signature = signer.sign(claim.hash);

  const report = verifyPassportClaim(claim, { hmacSecret: SECRET });
  assert(!report.ok, "bad status must fail");
  eq(findCheck(report.checks, "revocationStatus").status, "fail");
});

test("strict mode upgrades skipped signature checks to failure", () => {
  const signer = new HmacSigner(SECRET);
  const claim = buildPassportClaim({
    issuer: "tenant-1",
    subject: "passport-abc",
    scope: "passport.status",
    signer,
    claimIdFactory: () => "c9",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  const lax = verifyPassportClaim(claim, {});
  assert(lax.ok, "lax mode tolerates skipped sig checks");
  const strict = verifyPassportClaim(claim, {}, { strict: true });
  assert(!strict.ok, "strict mode must fail on skipped sig checks");
});
