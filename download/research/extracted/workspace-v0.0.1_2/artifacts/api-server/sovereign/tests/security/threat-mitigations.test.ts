import "../_flush.mjs";
/**
 * tests/security/threat-mitigations.test.ts — verify SECURITY.md mitigation claims.
 *
 * Coverage (one test per table row, grouped by area):
 *   Webhooks      — HMAC round-trip, secret length, tampered payload rejection
 *   Key rotation  — KeyRing verify with kid, retiring keys valid, revoked key rejects
 *   Cross-tenant  — introduction signature verification, unrelated-tenant access denied
 *   Risk fusion   — monotonic escalation, bad reputationScore throws, unknown class = deny,
 *                   deterministic same-input-same-output, explainable factors
 *   PQC visibility — readyz.checks.pqc reports real vs sim algorithm, omitted when unwired
 *   Proof freshness — validUntil verifies by default, expires against verifier's anchor,
 *                   tampering with validUntil breaks the bundle hash
 */

import { test, eq, assert } from "../_harness.mjs";
import { WebhookService, InMemoryWebhookStore, InMemoryWebhookRelayer } from "../../lib/escrow/webhook.ts";
import { KeyRing, computeKid } from "../../lib/passport/key-ring.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryIntroductionStore } from "../../lib/introduction/introduction-store.ts";
import type { IntroductionRequest } from "../../lib/introduction/types.ts";
import { assessRisk, reputationBand } from "../../lib/risk/risk-intelligence.ts";
import { checkReadiness } from "../../src/http/health-routes.ts";
import type { HealthState } from "../../src/http/health-routes.ts";
import { verifyArdAgent } from "../../lib/adapter/ard-verifier.ts";
import { createDetachedJws, verifyDetachedJws } from "../../lib/adapter/ard-publisher.ts";
import { buildTrustProofBundleV2, verifyProofBundleV2 } from "../../lib/track-record/index.ts";

// ─── Webhook mitigations ────────────────────────────────────────────────────

test("webhook HMAC round-trip: sign + verify succeeds", () => {
  const secret = "a".repeat(32);
  const payload = JSON.stringify({ event: "settlement.released", amount: "1000" });
  const sig = WebhookService.signPayload(secret, payload);
  assert(sig.startsWith("sha256="), "signature must start with sha256=");
  assert(WebhookService.verifySignature(secret, payload, sig), "valid signature must verify");
});

test("webhook tampered payload fails verification", () => {
  const secret = "b".repeat(32);
  const payload = JSON.stringify({ event: "escrow.funded", id: "e-1" });
  const sig = WebhookService.signPayload(secret, payload);
  assert(!WebhookService.verifySignature(secret, payload + "x", sig), "tampered payload must fail");
  assert(!WebhookService.verifySignature(secret + "x", payload, sig), "wrong secret must fail");
});

test("webhook registration generates secret >= 16 bytes when caller omits", async () => {
  const store = new InMemoryWebhookStore();
  const relayer = new InMemoryWebhookRelayer();
  const svc = new WebhookService(store, relayer);
  const reg = await svc.register({ tenantId: "t-webhook", url: "https://example.com/hook", events: ["settlement.released"] });
  assert(reg.secret.length >= 16, "auto-generated secret must be >= 16 bytes");
});

// ─── Key rotation mitigations ───────────────────────────────────────────────

test("KeyRing verify with correct kid succeeds", () => {
  const ring = new KeyRing();
  const secret = "rotation-secret-32bytes-long!!!";
  const kid = computeKid("hmac-sha256", secret);
  ring.register({ kid, algorithm: "hmac-sha256", secret, status: "active", createdAt: "2024-01-01T00:00:00Z" });

  const payload = "test-payload";
  const signer = new HmacSigner(secret);
  const sig = signer.sign(payload);

  assert(ring.verify(payload, sig, kid), "KeyRing must verify with matching kid");
});

test("KeyRing: retiring key still verifies (overlap window)", () => {
  const ring = new KeyRing();
  const secret = "retiring-secret-32bytes-long!!!";
  const kid = computeKid("hmac-sha256", secret);
  ring.register({ kid, algorithm: "hmac-sha256", secret, status: "retiring", createdAt: "2024-01-01T00:00:00Z" });

  const signer = new HmacSigner(secret);
  const sig = signer.sign("overlap-payload");
  assert(ring.verify("overlap-payload", sig, kid), "retiring key must still verify");
});

test("KeyRing: revoked kid rejects verification (fail-closed)", () => {
  const ring = new KeyRing();
  const secret = "revoked-secret-32bytes-long!!!!";
  const kid = computeKid("hmac-sha256", secret);
  ring.register({ kid, algorithm: "hmac-sha256", secret, status: "active", createdAt: "2024-01-01T00:00:00Z" });

  const signer = new HmacSigner(secret);
  const sig = signer.sign("revoked-payload");

  ring.revoke(kid);
  assert(!ring.verify("revoked-payload", sig, kid), "revoked key must reject verification");
});

test("KeyRing: unknown kid returns null and verify returns false", () => {
  const ring = new KeyRing();
  eq(ring.resolve("unknown-kid-1234"), null);
  assert(!ring.verify("any", "sig", "unknown-kid-1234"), "unknown kid must fail verify");
});

// ─── Cross-tenant introduction mitigations ──────────────────────────────────

test("introduction signature verified by kernel signer", () => {
  const signer = new HmacSigner("kernel-secret-32bytes-long-for-test!");
  const req: IntroductionRequest = {
    id: "intro-1",
    sourceTenantId: "tenant-a",
    targetTenantId: "tenant-b",
    proofTarget: { kind: "track-record", identityId: "actor-1" },
    signature: "pending",
    createdAt: "2024-01-01T00:00:00Z",
  };
  const canonical = JSON.stringify({ id: req.id, sourceTenantId: req.sourceTenantId, targetTenantId: req.targetTenantId, proofTarget: req.proofTarget, createdAt: req.createdAt });
  req.signature = signer.sign(canonical);
  assert(signer.verify(canonical, req.signature), "kernel-signed introduction must verify");
});

test("introduction tampered payload breaks signature", () => {
  const signer = new HmacSigner("kernel-secret-32bytes-long-for-test!");
  const canonical = JSON.stringify({ id: "intro-2", sourceTenantId: "tenant-a", targetTenantId: "tenant-b", proofTarget: { kind: "passport", identityId: "actor-2" }, createdAt: "2024-01-01T00:00:00Z" });
  const sig = signer.sign(canonical);
  const tampered = canonical.replace("tenant-b", "tenant-c");
  assert(!signer.verify(tampered, sig), "tampered introduction must fail verification");
});

test("introduction access by unrelated tenant returns null (fail-closed)", () => {
  const store = new InMemoryIntroductionStore();
  const req: IntroductionRequest = {
    id: "intro-3",
    sourceTenantId: "tenant-src",
    targetTenantId: "tenant-tgt",
    proofTarget: { kind: "track-record", identityId: "actor-3" },
    signature: "sig",
    createdAt: "2024-01-01T00:00:00Z",
  };
  store.save(req);
  eq(store.getWithAccess("intro-3", "tenant-evil"), null);
  eq(store.get("intro-3", "tenant-evil"), null);
});

// ─── Risk fusion mitigations ────────────────────────────────────────────────

test("assessRisk: monotonic — trusted reputation cannot lower approval class below floor", () => {
  const result = assessRisk({ baseApprovalClass: "human", context: {}, reputationScore: 95 });
  eq(result.baseApprovalClass, "human");
  // Trusted band (-10 informational points) must not downgrade class below "human"
  assert(
    result.effectiveApprovalClass === "human" || result.effectiveApprovalClass === "opa_check" || result.effectiveApprovalClass === "threshold_escrow" || result.effectiveApprovalClass === "deny",
    "effective class must not be below static floor"
  );
  // Specifically, it must not be "auto"
  assert(result.effectiveApprovalClass !== "auto", "trusted actor must not auto-approve below floor");
});

test("assessRisk: bad reputationScore throws (fail-closed)", () => {
  let threw = false;
  try {
    assessRisk({ baseApprovalClass: "auto", reputationScore: 150 });
  } catch {
    threw = true;
  }
  assert(threw, "out-of-range reputationScore must throw");
});

test("assessRisk: unknown base class falls back to deny", () => {
  const result = assessRisk({ baseApprovalClass: "unknown_class" as any, context: {} });
  eq(result.baseApprovalClass, "deny");
  eq(result.effectiveApprovalClass, "deny");
});

test("assessRisk: deterministic same-input-same-output", () => {
  const input = { baseApprovalClass: "opa_check" as const, context: { valueMicrounits: 1_000_000n, velocityPerHour: 5, offHours: true }, reputationScore: 30 };
  const r1 = assessRisk(input);
  const r2 = assessRisk(input);
  eq(r1.riskScore, r2.riskScore);
  eq(r1.effectiveApprovalClass, r2.effectiveApprovalClass);
  eq(r1.factors.length, r2.factors.length);
});

test("assessRisk: explainable factors present", () => {
  const result = assessRisk({ baseApprovalClass: "auto", context: { valueMicrounits: 10_000_000n }, reputationScore: 20 });
  assert(result.factors.length > 0, "factors must be present");
  assert(result.explanation.length > 0, "explanation must be present");
  assert(result.factors.every((f) => typeof f.factor === "string" && typeof f.contribution === "number" && typeof f.detail === "string"), "each factor must have factor/contribution/detail");
});

test("reputationBand: untrusted < new < normal < trusted boundaries", () => {
  eq(reputationBand(10), "untrusted");
  eq(reputationBand(30), "new");
  eq(reputationBand(50), "normal");
  eq(reputationBand(80), "trusted");
  eq(reputationBand(undefined), "new");
});

// ─── Agent provenance mitigations ───────────────────────────────────────────

import { normalizeAgentProvenance, sameAgent } from "../../lib/adapter/agent-provenance.ts";
import { resolveProvenance } from "../../lib/passport/passport.ts";

test("provenance: deterministic — same inputs produce same provenanceId", () => {
  const input = { vendor: "anthropic", agentId: "claude-opus-4-8", model: "claude-opus-4-8" };
  const a = normalizeAgentProvenance(input);
  const b = normalizeAgentProvenance(input);
  eq(a.provenanceId, b.provenanceId);
  assert(sameAgent(a, b), "sameAgent must return true for identical inputs");
});

test("provenance: different vendor/agentId yields different provenanceId", () => {
  const a = normalizeAgentProvenance({ vendor: "openai", agentId: "gpt-4o" });
  const b = normalizeAgentProvenance({ vendor: "anthropic", agentId: "claude-opus-4-8" });
  assert(a.provenanceId !== b.provenanceId, "different vendors must yield different provenanceId");
  assert(!sameAgent(a, b), "sameAgent must return false");
});

test("provenance: unknown vendor preserved as 'custom' — no false attribution", () => {
  const p = normalizeAgentProvenance({ vendor: "novelAI-xyz", agentId: "agent-1" });
  eq(p.vendor, "custom");
  eq(p.vendorRaw, "novelAI-xyz"); // original raw label preserved (audit fidelity)
});

test("provenance: missing agentId throws (fail-closed)", () => {
  let threw = false;
  try {
    normalizeAgentProvenance({ vendor: "anthropic", agentId: "" });
  } catch {
    threw = true;
  }
  assert(threw, "empty agentId must throw");
});

test("provenance: missing vendor throws (fail-closed)", () => {
  let threw = false;
  try {
    normalizeAgentProvenance({ vendor: "", agentId: "agent-1" });
  } catch {
    threw = true;
  }
  assert(threw, "empty vendor must throw");
});

test("provenance: resolveProvenance is idempotent — already-normalized passes through unchanged", () => {
  const input = { vendor: "google", agentId: "gemini-pro" };
  const normalized = normalizeAgentProvenance(input);
  const passThrough = resolveProvenance(normalized);
  eq(passThrough?.provenanceId, normalized.provenanceId);
  eq(passThrough?.vendor, normalized.vendor);
});

test("provenance: resolveProvenance returns undefined when input is undefined (backward-compat)", () => {
  const result = resolveProvenance(undefined);
  eq(result, undefined);
});

// ─── PQC signer-visibility mitigations ──────────────────────────────────────
// SECURITY.md "Silent signer downgrade" / "PQC check false-claims" rows —
// re-verified here (alongside tests/http/health-shutdown.test.ts) so the doc
// table and the behavior cannot drift apart silently.

test("readyz pqc: real (non-sim) algorithm reported verbatim, no sim: prefix", async () => {
  const state: HealthState = { draining: false, signer: { algorithm: "hybrid:ed25519+ml-dsa-44-oqs" } };
  const result = await checkReadiness(state);
  eq((result.body as any).checks.pqc, "hybrid:ed25519+ml-dsa-44-oqs");
  eq(result.status, 200);
});

test("readyz pqc: -sim algorithm flagged with sim: prefix, readiness still 200 (not an outage)", async () => {
  const state: HealthState = { draining: false, signer: { algorithm: "hybrid:ed25519+ml-dsa-44-local-sim" } };
  const result = await checkReadiness(state);
  eq((result.body as any).checks.pqc, "sim: hybrid:ed25519+ml-dsa-44-local-sim");
  eq(result.status, 200);
});

test("readyz pqc: omitted entirely (not defaulted) when no signer is wired — no false claim", async () => {
  const state: HealthState = { draining: false };
  const result = await checkReadiness(state);
  eq((result.body as any).checks.pqc, undefined);
});

// ─── Reputation-proof freshness mitigations ─────────────────────────────────
// SECURITY.md "Stale reputation proof replayed indefinitely" row — re-verified
// here (alongside tests/track-record/proof-bundle-v2.test.ts) so the doc
// table and the actual verifier behavior cannot drift apart silently.

test("proof freshness: bundle with no validUntil still verifies by default (pre-v370 compatible)", () => {
  const rec = { tenantId: "t1", identityId: "id1", settledAsWorker: 1, settledAsFunder: 0, refunded: 0, denied: 0, settledVolume: "0", score: 50, explanation: [], selfDealing: 0, computedAt: new Date().toISOString() };
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec as any });
  eq(bundle.validUntil, null);
  assert(verifyProofBundleV2(bundle), "no-expiry bundle still verifies");
});

test("proof freshness: bundle is rejected once past its own validUntil, using the verifier's anchor time", () => {
  const rec = { tenantId: "t1", identityId: "id1", settledAsWorker: 1, settledAsFunder: 0, refunded: 0, denied: 0, settledVolume: "0", score: 50, explanation: [], selfDealing: 0, computedAt: new Date().toISOString() };
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec as any, validForMs: 1000 });
  assert(verifyProofBundleV2(bundle), "fresh bundle verifies right after issuance");
  const afterExpiry = new Date(Date.now() + 60_000);
  assert(!verifyProofBundleV2(bundle, { now: afterExpiry }), "expired bundle rejected against a later anchor time");
});

test("proof freshness: extending validUntil without re-issuing breaks the bundle hash", () => {
  const rec = { tenantId: "t1", identityId: "id1", settledAsWorker: 1, settledAsFunder: 0, refunded: 0, denied: 0, settledVolume: "0", score: 50, explanation: [], selfDealing: 0, computedAt: new Date().toISOString() };
  const bundle = buildTrustProofBundleV2({ tenantId: "t1", identityId: "id1", record: rec as any, validForMs: 1000 });
  (bundle as any).validUntil = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
  assert(!verifyProofBundleV2(bundle), "tampered validUntil invalidates the bundle hash — can't be replayed forever by self-extension");
});

// ─── ARD cross-vendor trust-verification mitigations ────────────────────────
// SECURITY.md "ARD domain↔identity spoofing" / "ARD JWS algorithm confusion"
// rows — re-verified here (alongside tests/adapter/ard-verifier.test.ts and
// tests/adapter/ard-publisher.test.ts) so the doc table can't drift from
// the actual fail-closed behavior of the v0.9-draft adapter.

test("ARD: matching URN authority and trustManifest domain verify and align", async () => {
  const signer = new HmacSigner("ard-threat-test-secret-32-bytes!!");
  const tm = { identity: "did:web:trusted-vendor.example" };
  const result = verifyArdAgent({ urn: "urn:ai:trusted-vendor.example:ns:agent-1", trustManifest: tm, signer });
  assert(result.checks.domainAlignment, "matching domain must align");
});

test("ARD: header alg in the allow-list but mismatched from the signer's actual algorithm still rejects", () => {
  const signer = new HmacSigner("ard-threat-test-secret-32-bytes!!");
  const payload = '{"identity":"did:web:test-mismatch.example"}';
  const jws = createDetachedJws(payload, signer); // signer produces HS256
  const parts = jws.split("..");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  header.alg = "EdDSA"; // allow-listed, but not what this HMAC signer actually produced
  const forged = `${Buffer.from(JSON.stringify(header), "utf8").toString("base64url")}..${parts[1]}`;
  assert(!verifyDetachedJws(forged, payload, signer), "allow-listed alg that doesn't match the signer must still fail");
});

test("ARD: domain mismatch between URN authority and trustManifest.identity fails closed (valid=false)", () => {
  const signer = new HmacSigner("ard-threat-test-secret-32-bytes!!");
  const tm = { identity: "did:web:attacker.example" };
  const result = verifyArdAgent({ urn: "urn:ai:victim.com:ns:agent-1", trustManifest: tm, signer });
  eq(result.valid, false);
  assert(!result.checks.domainAlignment, "mismatched domain must not align");
});
