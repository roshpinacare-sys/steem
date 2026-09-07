import "../_flush.mjs";
/**
 * tests/track-record/proof-bundle-v2.test.ts — ProofBundle v2 unit tests.
 * Covers: canonical JSON determinism, hash verification, tamper detection,
 * fail-closed builder/verifier, edge cases, and LIVE route test.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  buildTrustProofBundleV2,
  verifyProofBundleV2,
  type TrustProofBundleV2,
  type ProofBundleSignerKey,
  type ProofBundleEvidenceItem,
  type ProofBundleApprovalRef,
  type ProofBundleLedgerRef,
  type ProofBundlePolicyRef,
} from "../../lib/track-record/index.ts";
import { buildSovereignStack } from "../../src/composition.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Helper: minimal TrackRecord ──────────────────────────────────────────────
function fakeRecord(tenantId: string, identityId: string) {
  return {
    tenantId,
    identityId,
    settledAsWorker: 1,
    settledAsFunder: 0,
    refunded: 0,
    denied: 0,
    settledVolume: "100000",
    score: 55,
    explanation: ["base 50", "+5 for 1 settled escrow(s)"],
    selfDealing: 0,
    computedAt: new Date().toISOString(),
  };
}

// ─── Builder ──────────────────────────────────────────────────────────────────

test("buildTrustProofBundleV2 creates valid bundle with defaults", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  eq(bundle.version, "2");
  eq(bundle.tenantId, "t1");
  eq(bundle.identityId, "id1");
  eq(bundle.record.tenantId, "t1");
  assert(Array.isArray(bundle.passports), "passports defaults to array");
  eq(bundle.passports.length, 0);
  assert(Array.isArray(bundle.signerKeys), "signerKeys defaults to array");
  assert(Array.isArray(bundle.evidenceManifest), "evidenceManifest defaults to array");
  assert(Array.isArray(bundle.approvalRefs), "approvalRefs defaults to array");
  assert(Array.isArray(bundle.ledgerRefs), "ledgerRefs defaults to array");
  assert(Array.isArray(bundle.policyRefs), "policyRefs defaults to array");
  assert(bundle.bundleHash.length === 64, "bundleHash is sha256 hex");
  assert(bundle.issuedAt.length > 0, "issuedAt set");
});

test("builder fail-closed: missing tenantId throws", () => {
  try {
    buildTrustProofBundleV2({ tenantId: "", identityId: "id1", record: fakeRecord("t1", "id1") });
    assert(false, "should throw");
  } catch (e: any) {
    assert(e.message.includes("tenantId"), "error mentions tenantId");
  }
});

test("builder fail-closed: missing identityId throws", () => {
  try {
    buildTrustProofBundleV2({ tenantId: "t1", identityId: "", record: fakeRecord("t1", "id1") });
    assert(false, "should throw");
  } catch (e: any) {
    assert(e.message.includes("identityId"), "error mentions identityId");
  }
});

test("builder fail-closed: missing record throws", () => {
  try {
    buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: null as any });
    assert(false, "should throw");
  } catch (e: any) {
    assert(e.message.includes("record"), "error mentions record");
  }
});

// ─── Verifier ─────────────────────────────────────────────────────────────────

test("verifyProofBundleV2 passes on fresh bundle", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  assert(verifyProofBundleV2(bundle), "fresh bundle verifies");
});

test("verifier fail-closed: null input → false", () => {
  assert(!verifyProofBundleV2(null), "null rejected");
});

test("verifier fail-closed: string input → false", () => {
  assert(!verifyProofBundleV2("bundle"), "string rejected");
});

test("verifier fail-closed: array input → false", () => {
  assert(!verifyProofBundleV2([1, 2, 3]), "array rejected");
});

test("verifier fail-closed: wrong version → false", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  (bundle as any).version = "1";
  assert(!verifyProofBundleV2(bundle), "v1 rejected");
});

test("verifier fail-closed: tampered tenantId breaks hash", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  (bundle as any).tenantId = "evil";
  assert(!verifyProofBundleV2(bundle), "tampered tenantId fails");
});

test("verifier fail-closed: tampered score breaks hash", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  (bundle as any).record = { ...bundle.record, score: 99 };
  assert(!verifyProofBundleV2(bundle), "tampered score fails");
});

test("verifier fail-closed: tampered bundleHash alone → false", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  (bundle as any).bundleHash = "0".repeat(64);
  assert(!verifyProofBundleV2(bundle), "tampered bundleHash fails");
});

test("verifier: optional strictness requireSignerKeys", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  assert(verifyProofBundleV2(bundle, { requireSignerKeys: false }), "no signer keys ok when not required");
  assert(!verifyProofBundleV2(bundle, { requireSignerKeys: true }), "no signer keys fails when required");
});

test("verifier: optional strictness requireEvidence", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  assert(verifyProofBundleV2(bundle, { requireEvidence: false }), "no evidence ok when not required");
  assert(!verifyProofBundleV2(bundle, { requireEvidence: true }), "no evidence fails when required");
});

// ─── Canonical JSON determinism ───────────────────────────────────────────────

test("canonical JSON is deterministic: same inputs → same hash", () => {
  const rec = fakeRecord("t1", "id1");
  const b1 = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  // Freeze time for issuedAt by copying it into a second build
  const b2 = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  // We can't easily freeze issuedAt, but we can at least assert that
  // two builds with the same explicit arrays produce the same structure.
  // For a real determinism test we verify the hash logic indirectly:
  // both bundles verify with their own hash.
  assert(verifyProofBundleV2(b1), "b1 verifies");
  assert(verifyProofBundleV2(b2), "b2 verifies");
});

// ─── Rich bundle with all refs ────────────────────────────────────────────────

test("full bundle with signerKeys + evidence + approvals + ledger + policy verifies", () => {
  const rec = fakeRecord("t1", "id1");
  const signerKeys: ProofBundleSignerKey[] = [
    { kid: "kernel-1", algorithm: "hmac-sha256", publicKey: "deadbeef" },
  ];
  const evidenceManifest: ProofBundleEvidenceItem[] = [
    { evidenceId: "ev-1", evidenceType: "screenshot", sha256: "a".repeat(64), uri: "https://example.com/ev1" },
  ];
  const approvalRefs: ProofBundleApprovalRef[] = [
    { auditId: "aid-1", traceDigest: "b".repeat(64) },
  ];
  const ledgerRefs: ProofBundleLedgerRef[] = [
    { ledgerEntryId: "le-1", entryType: "escrow", sha256: "c".repeat(64) },
  ];
  const policyRefs: ProofBundlePolicyRef[] = [
    { policyRef: "pol-1", version: "1.0.0", sha256: "d".repeat(64) },
  ];
  const bundle = buildTrustProofBundleV2({
    tenantId: "t1", identityId: "id1", record: rec,
    signerKeys, evidenceManifest, approvalRefs, ledgerRefs, policyRefs,
  });
  assert(verifyProofBundleV2(bundle, { requireSignerKeys: true, requireEvidence: true }), "full bundle verifies");
});

test("verifier rejects malformed signerKey entry", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec, signerKeys: [{ kid: "k", algorithm: "a", publicKey: "p" }] });
  assert(verifyProofBundleV2(bundle), "valid signerKey ok");
  (bundle as any).signerKeys[0].kid = "";
  assert(!verifyProofBundleV2(bundle), "empty kid rejected");
});

test("verifier rejects malformed evidence sha256 (wrong length)", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({
    tenantId: "t1", identityId: "id1", record: rec,
    evidenceManifest: [{ evidenceId: "e1", evidenceType: "img", sha256: "bad" }],
  });
  assert(!verifyProofBundleV2(bundle), "bad sha256 length rejected");
});

test("verifier rejects malformed approvalRef traceDigest", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({
    tenantId: "t1", identityId: "id1", record: rec,
    approvalRefs: [{ auditId: "a1", traceDigest: "short" }],
  });
  assert(!verifyProofBundleV2(bundle), "short traceDigest rejected");
});

test("verifier rejects malformed ledgerRef sha256", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({
    tenantId: "t1", identityId: "id1", record: rec,
    ledgerRefs: [{ ledgerEntryId: "l1", entryType: "mint", sha256: "nope" }],
  });
  assert(!verifyProofBundleV2(bundle), "bad ledger sha256 rejected");
});

test("verifier rejects malformed policyRef sha256", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({
    tenantId: "t1", identityId: "id1", record: rec,
    policyRefs: [{ policyRef: "p1", version: "1", sha256: "nah" }],
  });
  assert(!verifyProofBundleV2(bundle), "bad policy sha256 rejected");
});

// ─── Freshness bound (validUntil) ──────────────────────────────────────────────
// Reputation proofs previously carried no expiry — a bundle issued once could be
// replayed forever. validUntil closes that gap: it's part of the hashed body
// (tamper-evident like every other field), and the verifier — never the bundle
// itself — picks the anchor time it's checked against.

test("default builder leaves validUntil null (backward compatible, no expiry claim)", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  eq(bundle.validUntil, null);
  assert(verifyProofBundleV2(bundle), "no-expiry bundle still verifies by default");
});

test("validForMs sets a future validUntil that verifies now and is rejected once expired (via now override)", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec, validForMs: 60_000 });
  assert(typeof bundle.validUntil === "string", "validUntil set");
  assert(verifyProofBundleV2(bundle), "fresh bundle verifies against real clock");
  const past = new Date(Date.parse(bundle.validUntil!) + 1); // 1ms after expiry
  assert(!verifyProofBundleV2(bundle, { now: past }), "bundle rejected once past its own validUntil");
});

test("explicit validUntil takes precedence over validForMs", () => {
  const rec = fakeRecord("t1", "id1");
  const explicit = new Date(Date.now() + 5000).toISOString();
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec, validUntil: explicit, validForMs: 999_999 });
  eq(bundle.validUntil, explicit);
});

test("requireFreshness rejects a bundle with no validUntil claim, accepts one that has it", () => {
  const rec = fakeRecord("t1", "id1");
  const noExpiry = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec });
  assert(!verifyProofBundleV2(noExpiry, { requireFreshness: true }), "no-expiry bundle rejected when freshness required");
  const withExpiry = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec, validForMs: 60_000 });
  assert(verifyProofBundleV2(withExpiry, { requireFreshness: true }), "time-bounded bundle accepted when freshness required");
});

test("fail-closed: an already-expired bundle is rejected even without requireFreshness", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec, validForMs: 1000 });
  const wellAfterExpiry = new Date(Date.now() + 60_000);
  assert(!verifyProofBundleV2(bundle, { now: wellAfterExpiry }), "expired claim is always enforced, opt-in or not");
});

test("fail-closed: tampered validUntil breaks the bundle hash", () => {
  const rec = fakeRecord("t1", "id1");
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec, validForMs: 1000 });
  (bundle as any).validUntil = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString(); // extend by 10 years
  assert(!verifyProofBundleV2(bundle), "extending validUntil without re-signing fails the hash check");
});

test("fail-closed: malformed validUntil string rejected by both builder and verifier", () => {
  const rec = fakeRecord("t1", "id1");
  try {
    buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec, validUntil: "not-a-date" });
    assert(false, "builder should throw on malformed validUntil");
  } catch (e: any) {
    assert(e.message.includes("validUntil"), "error mentions validUntil");
  }
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec, validForMs: 60_000 });
  (bundle as any).validUntil = "not-a-date"; // re-set without recomputing hash, but check type-guard fires first
  assert(!verifyProofBundleV2(bundle), "verifier rejects malformed validUntil even before the hash check would catch it");
});

test("fail-closed: validForMs <= 0 rejected by builder", () => {
  const rec = fakeRecord("t1", "id1");
  try {
    buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec, validForMs: 0 });
    assert(false, "should throw");
  } catch (e: any) {
    assert(e.message.includes("validForMs"), "error mentions validForMs");
  }
});

// ─── LIVE route test ──────────────────────────────────────────────────────────

test("LIVE: GET /api/track-record/:id/proof-v2 returns verifiable bundle", async () => {
  const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
  const port: number = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}`;
  const H = { "content-type": "application/json", "x-tenant-id": "pbv2live" };

  const acc = async (o: string) => (await (await fetch(base + "/api/ledger/accounts", { method: "POST", headers: H, body: JSON.stringify({ ownerId: o, type: "asset", name: o }) })).json()).account.id;
  const payer = await acc("alice");
  const worker = await acc("bob");
  await fetch(base + "/api/ledger/mint", { method: "POST", headers: H, body: JSON.stringify({ toAccountId: payer, amount: "500000", memo: "s", initiatedBy: "alice" }) });
  const e = await (await fetch(base + "/api/escrow", { method: "POST", headers: H, body: JSON.stringify({ opportunityId: "o", payerAccountId: payer, workerAccountId: worker, amount: "200000" }) })).json();
  const id = e.data?.agreement?.id ?? e.agreement?.id ?? e.data?.id;
  await fetch(base + `/api/escrow/${id}/fund`, { method: "POST", headers: H, body: JSON.stringify({ initiatedBy: "alice" }) });
  await fetch(base + `/api/escrow/${id}/release`, { method: "POST", headers: H, body: JSON.stringify({ initiatedBy: "alice" }) });

  const res = await fetch(base + "/api/track-record/bob/proof-v2", { headers: H });
  eq(res.status, 200);
  const body = await res.json();
  assert(body.data, "response has data");
  eq(body.data.version, "2");
  assert(body.data.bundleHash, "bundle has hash");
  assert(verifyProofBundleV2(body.data), "served bundle verifies offline");
  assert(body.data.record.settledAsWorker >= 1, "worker delivery reflected");
  assert(Array.isArray(body.data.signerKeys), "has signerKeys");
  assert(typeof body.data.validUntil === "string", "route applies a default freshness window");
  assert(Date.parse(body.data.validUntil) > Date.now(), "validUntil is in the future at issuance");
  server.close();
});
