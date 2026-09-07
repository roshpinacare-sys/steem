/**
 * tests/track-record/redacted-proof-bundle.test.ts
 * Coverage: buildRedactedProofBundle + verifyRedactedProofBundle (§2.B-3)
 */
import { test, eq, assert } from "../_harness.mjs";
import { buildTrustProofBundleV2 } from "../../lib/track-record/proof-bundle-v2.ts";
import {
  buildRedactedProofBundle,
  verifyRedactedProofBundle,
} from "../../lib/track-record/redacted-proof-bundle.ts";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const BASE_RECORD = {
  tenantId: "t1",
  identityId: "agent-1",
  settledAsWorker: 5,
  settledAsFunder: 2,
  refunded: 0,
  denied: 1,
  settledVolume: "500000",
  score: 78,
  explanation: ["good history"],
  selfDealing: 0,
};

function makeFullBundle(overrides: Record<string, unknown> = {}) {
  return buildTrustProofBundleV2({
    tenantId: "t1",
    identityId: "agent-1",
    record: BASE_RECORD,
    signerKeys: [{ kid: "k1", algorithm: "hmac-sha256", publicKey: "abc123" }],
    evidenceManifest: [{ evidenceId: "ev1", evidenceType: "action", sha256: "a".repeat(64) }],
    approvalRefs: [{ auditId: "au1", traceDigest: "b".repeat(64) }],
    ledgerRefs: [{ ledgerEntryId: "le1", entryType: "mint", sha256: "c".repeat(64) }],
    policyRefs: [{ policyRef: "p1", version: "1.0", sha256: "d".repeat(64) }],
    passports: [{ auditId: "aud1", passportHash: "ph1", issuedAt: "2025-01-01T00:00:00Z" }] as any,
    ...overrides,
  });
}

// ─── Happy path ───────────────────────────────────────────────────────────────

test("buildRedactedProofBundle: produces version '2r' from a full bundle", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  eq(redacted.version, "2r");
  eq(redacted.tenantId, "t1");
  eq(redacted.identityId, "agent-1");
});

test("buildRedactedProofBundle: record is preserved verbatim (aggregate verdict fields)", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  eq(redacted.record.settledAsWorker, 5);
  eq(redacted.record.denied, 1);
  eq(redacted.record.score, 78);
});

test("buildRedactedProofBundle: sensitive arrays are NOT present — only digests", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  // These keys must NOT appear on the redacted bundle
  assert(!("passports" in redacted), "passports must be redacted");
  assert(!("evidenceManifest" in redacted), "evidenceManifest must be redacted");
  assert(!("signerKeys" in redacted), "signerKeys must be redacted");
  assert(!("approvalRefs" in redacted), "approvalRefs must be redacted");
  assert(!("ledgerRefs" in redacted), "ledgerRefs must be redacted");
  assert(!("policyRefs" in redacted), "policyRefs must be redacted");
  // Commitments are present
  assert("redacted" in redacted, "redacted commitments must exist");
  eq(redacted.redacted.passports.count, 1);
  eq(redacted.redacted.signerKeys.count, 1);
  eq(redacted.redacted.evidenceManifest.count, 1);
  eq(redacted.redacted.approvalRefs.count, 1);
  eq(redacted.redacted.ledgerRefs.count, 1);
  eq(redacted.redacted.policyRefs.count, 1);
});

test("buildRedactedProofBundle: originalBundleHash links back to the full bundle", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  eq(redacted.originalBundleHash, full.bundleHash, "must preserve original hash");
});

test("verifyRedactedProofBundle: valid redacted bundle passes", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  assert(verifyRedactedProofBundle(redacted), "valid bundle must verify");
});

test("buildRedactedProofBundle: deterministic — same full bundle → same redacted bundle", () => {
  const full = makeFullBundle();
  const r1 = buildRedactedProofBundle(full);
  const r2 = buildRedactedProofBundle(full);
  eq(r1.redactedBundleHash, r2.redactedBundleHash, "must be deterministic");
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test("buildRedactedProofBundle: empty arrays → count=0 digests (not omitted)", () => {
  const full = buildTrustProofBundleV2({ tenantId: "t1", identityId: "a1", record: BASE_RECORD });
  const redacted = buildRedactedProofBundle(full);
  eq(redacted.redacted.passports.count, 0);
  eq(redacted.redacted.signerKeys.count, 0);
  eq(redacted.redacted.evidenceManifest.count, 0);
  // sha256 of empty array is deterministic
  assert(redacted.redacted.passports.sha256.length === 64, "sha256 must be hex64");
  assert(verifyRedactedProofBundle(redacted), "empty-array bundle must verify");
});

test("verifyRedactedProofBundle: requirePassports=true fails when count=0", () => {
  const full = buildTrustProofBundleV2({ tenantId: "t1", identityId: "a1", record: BASE_RECORD });
  const redacted = buildRedactedProofBundle(full);
  assert(!verifyRedactedProofBundle(redacted, { requirePassports: true }),
    "must reject when requirePassports=true and count=0");
});

test("verifyRedactedProofBundle: requirePassports=true passes when count>0", () => {
  const full = makeFullBundle(); // has 1 passport
  const redacted = buildRedactedProofBundle(full);
  assert(verifyRedactedProofBundle(redacted, { requirePassports: true }),
    "must accept when requirePassports=true and count>0");
});

test("buildRedactedProofBundle: validUntil is preserved from full bundle", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const full = makeFullBundle({ validUntil: future } as any);
  // Can't pass validUntil via overrides to buildTrustProofBundleV2 directly —
  // use the explicit field
  const fullWithExpiry = buildTrustProofBundleV2({
    tenantId: "t1", identityId: "agent-1", record: BASE_RECORD,
    validUntil: future,
  });
  const redacted = buildRedactedProofBundle(fullWithExpiry);
  eq(redacted.validUntil, future);
  assert(verifyRedactedProofBundle(redacted), "fresh bundle must verify");
});

test("verifyRedactedProofBundle: expired validUntil fails even without requireFreshness", () => {
  const past = new Date(Date.now() - 1000).toISOString();
  const fullWithExpiry = buildTrustProofBundleV2({
    tenantId: "t1", identityId: "agent-1", record: BASE_RECORD,
    validUntil: past,
  });
  const redacted = buildRedactedProofBundle(fullWithExpiry);
  assert(!verifyRedactedProofBundle(redacted), "expired bundle must fail");
});

test("verifyRedactedProofBundle: requireFreshness fails when validUntil=null", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  eq(redacted.validUntil, null);
  assert(!verifyRedactedProofBundle(redacted, { requireFreshness: true }),
    "must reject when requireFreshness=true and no validUntil");
});

// ─── Fail-closed cases ────────────────────────────────────────────────────────

test("verifyRedactedProofBundle: tampered record invalidates hash", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  const tampered = { ...redacted, record: { ...redacted.record, score: 99 } };
  assert(!verifyRedactedProofBundle(tampered), "tampered record must fail");
});

test("verifyRedactedProofBundle: tampered redacted.passports.count invalidates hash", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  const tampered = {
    ...redacted,
    redacted: { ...redacted.redacted, passports: { ...redacted.redacted.passports, count: 99 } },
  };
  assert(!verifyRedactedProofBundle(tampered), "tampered commitment count must fail");
});

test("verifyRedactedProofBundle: tampered originalBundleHash invalidates hash", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  const tampered = { ...redacted, originalBundleHash: "x".repeat(64) };
  assert(!verifyRedactedProofBundle(tampered), "tampered originalBundleHash must fail");
});

test("verifyRedactedProofBundle: wrong version → false", () => {
  const full = makeFullBundle();
  const redacted = buildRedactedProofBundle(full);
  assert(!verifyRedactedProofBundle({ ...redacted, version: "2" }), "version '2' must be rejected");
  assert(!verifyRedactedProofBundle({ ...redacted, version: "3r" }), "unknown version must be rejected");
});

test("verifyRedactedProofBundle: null / undefined / non-object → false", () => {
  assert(!verifyRedactedProofBundle(null));
  assert(!verifyRedactedProofBundle(undefined));
  assert(!verifyRedactedProofBundle("string"));
  assert(!verifyRedactedProofBundle(42));
  assert(!verifyRedactedProofBundle([]));
});

test("buildRedactedProofBundle: non-'2' full bundle throws", () => {
  let threw = false;
  try { buildRedactedProofBundle({ version: "1" } as any); } catch { threw = true; }
  assert(threw, "must throw on version '1' full bundle");
});

test("buildRedactedProofBundle: null input throws", () => {
  let threw = false;
  try { buildRedactedProofBundle(null as any); } catch { threw = true; }
  assert(threw, "must throw on null");
});

test("buildRedactedProofBundle: missing tenantId throws", () => {
  const full = makeFullBundle();
  (full as any).tenantId = "";
  let threw = false;
  try { buildRedactedProofBundle(full); } catch { threw = true; }
  assert(threw, "must throw on empty tenantId");
});

test("buildRedactedProofBundle: missing bundleHash throws", () => {
  const full = makeFullBundle();
  (full as any).bundleHash = "";
  let threw = false;
  try { buildRedactedProofBundle(full); } catch { threw = true; }
  assert(threw, "must throw on empty bundleHash");
});
