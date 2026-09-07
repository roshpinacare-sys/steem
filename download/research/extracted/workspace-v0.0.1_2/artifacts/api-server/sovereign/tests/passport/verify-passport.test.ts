import "../_flush.mjs";
/**
 * tests/passport/verify-passport.test.ts — standalone verifier.
 *
 * Coverage:
 *   • happy path: issued passport verifies (HMAC) — all sig checks pass.
 *   • Ed25519 path: passport verifies with public-key only.
 *   • canonicalStringify in verifier matches the issuer's output byte-for-byte.
 *   • tamper passport body → passport.hash check fails.
 *   • tamper passport signature → passport.signature check fails.
 *   • wrong HMAC secret → passport.signature check fails.
 *   • tamper audit record field → audit.hash check fails.
 *   • missing keys with --strict → skipped becomes fail.
 *   • missing required field → shape check fails fast.
 *   • unknown algorithm → fails.
 *   • audit signature verifies when audit secret supplied.
 */

import { test, assert, eq } from "../_harness.mjs";
import { verifyPassport, canonicalStringify } from "../../scripts/verify-passport.mjs";
import { issuePassport, canonicalStringify as libCanonical } from "../../lib/passport/index.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { HmacSigner, Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { createHash } from "node:crypto";

const SECRET = "verify-passport-test-secret-xx!!";

function makeRecord(store: InMemoryAuditStore, tenantId = "tenant-1") {
  return store.append({
    id: "audit-" + Math.random().toString(36).slice(2),
    tenantId,
    actionId: "action-" + Math.random().toString(36).slice(2),
    actionType: "agent.task.run",
    source: "test-agent",
    outcome: "allowed",
    occurredAt: new Date().toISOString(),
  });
}

function findCheck(checks: any[], name: string) {
  return checks.find((c) => c.name === name);
}

test("happy path: HMAC-signed passport fully verifies", () => {
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = makeRecord(store);
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });

  const report = verifyPassport(passport, { hmacSecret: SECRET, auditHmacSecret: SECRET });
  assert(report.ok, "report ok; got " + JSON.stringify(report.checks));
  eq(findCheck(report.checks, "audit.hash").status, "pass");
  eq(findCheck(report.checks, "passport.hash").status, "pass");
  eq(findCheck(report.checks, "passport.signature.hmac").status, "pass");
  eq(findCheck(report.checks, "audit.signature.hmac").status, "pass");
});

test("Ed25519 path: passport verifies with public key only", () => {
  const { publicKey, privateKey } = generateAuditKeyPair();
  const signer = new Ed25519Signer(privateKey, publicKey);
  const store = new InMemoryAuditStore(signer);
  const rec = makeRecord(store);
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });

  const report = verifyPassport(passport, { publicKey, auditPublicKey: publicKey });
  assert(report.ok, "ed25519 report ok; got " + JSON.stringify(report.checks));
  eq(findCheck(report.checks, "passport.signature.ed25519").status, "pass");
  eq(findCheck(report.checks, "audit.signature.ed25519").status, "pass");
});

test("canonicalStringify in verifier matches the library byte-for-byte", () => {
  const samples = [
    { z: 1, a: 2, m: { y: [3, 2, 1], x: null } },
    [1, "a", { b: true, a: false }],
    "scalar",
    null,
    { unicode: "שלום", n: 0 },
  ];
  for (const s of samples) {
    eq(canonicalStringify(s), libCanonical(s), "mismatch for " + JSON.stringify(s));
  }
});

test("tampered passport body breaks passport.hash check", () => {
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = makeRecord(store);
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });

  const tampered = { ...passport, tenantId: "tenant-evil" };
  const report = verifyPassport(tampered, { hmacSecret: SECRET, auditHmacSecret: SECRET });
  assert(!report.ok, "tampered passport must fail");
  eq(findCheck(report.checks, "passport.hash").status, "fail");
});

test("tampered passport signature fails signature check", () => {
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = makeRecord(store);
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });

  // Flip a byte in the signature (decode/encode to keep base64 valid).
  const sigBuf = Buffer.from(passport.signature, "base64");
  sigBuf[0] = sigBuf[0] ^ 0xff;
  const tampered = { ...passport, signature: sigBuf.toString("base64") };

  const report = verifyPassport(tampered, { hmacSecret: SECRET });
  assert(!report.ok, "must fail");
  eq(findCheck(report.checks, "passport.signature.hmac").status, "fail");
});

test("wrong HMAC secret fails the passport signature check", () => {
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = makeRecord(store);
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });

  const report = verifyPassport(passport, { hmacSecret: "wrong-secret-xxxxxxxxxxxxxx-yy" });
  assert(!report.ok, "wrong secret must fail");
  eq(findCheck(report.checks, "passport.signature.hmac").status, "fail");
  // hash recomputation still passes.
  eq(findCheck(report.checks, "passport.hash").status, "pass");
});

test("tampered audit field breaks audit.hash check", () => {
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = makeRecord(store);
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });

  // Mutate audit.actionType — covered by computeAuditHash.
  const tampered = JSON.parse(JSON.stringify(passport));
  tampered.audit.actionType = "billing.charge";

  const report = verifyPassport(tampered, { hmacSecret: SECRET, auditHmacSecret: SECRET });
  assert(!report.ok, "must fail");
  eq(findCheck(report.checks, "audit.hash").status, "fail");
});

test("strict mode upgrades skipped signature checks to failure", () => {
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = makeRecord(store);
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });

  // No keys at all → would normally be "skipped", strict → not ok.
  const lax = verifyPassport(passport, {});
  assert(lax.ok, "lax mode tolerates skipped sig checks");
  const strict = verifyPassport(passport, {}, { strict: true });
  assert(!strict.ok, "strict mode must fail on skipped sig checks");
});

test("missing required field fails fast on shape", () => {
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = makeRecord(store);
  const passport = issuePassport({ auditId: rec.id, auditStore: store, signer });

  const { signature: _s, ...broken } = passport;
  const report = verifyPassport(broken as any, { hmacSecret: SECRET });
  assert(!report.ok, "must fail");
  eq(report.checks[0].status, "fail");
});

test("unknown algorithm fails", () => {
  const signer = new HmacSigner(SECRET);
  const store = new InMemoryAuditStore(signer);
  const rec = makeRecord(store);
  const passport: any = issuePassport({ auditId: rec.id, auditStore: store, signer });
  passport.algorithm = "totally-unknown";
  // Recompute the hash so we reach the algorithm branch (not the hash branch).
  const { hash: _h, signature: _s, ...body } = passport;
  passport.hash = createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex");

  const report = verifyPassport(passport, { hmacSecret: SECRET });
  assert(!report.ok, "unknown algo must fail");
  eq(findCheck(report.checks, "passport.algorithm").status, "fail");
});
