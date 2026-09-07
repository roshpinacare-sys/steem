import "../_flush.mjs";
/**
 * tests/passport/claim-risk-evidence.test.ts — risk-intelligence embedded in VC (v303).
 *
 * Coverage:
 *   • happy path: buildPassportClaim with riskEvidence includes it in the claim body.
 *   • hash coverage: changing riskEvidence after signing breaks hash verification.
 *   • verification: verifyPassportClaim succeeds when riskEvidence is present.
 *   • extractRiskEvidence: parses DecisionTrace with riskIntelligence correctly.
 *   • extractRiskEvidence: fail-closed on bad JSON, missing riskIntelligence, malformed factors.
 *   • extractRiskEvidence: returns undefined for plain string reason (denied actions).
 *   • issuePassport: auto-extracts riskEvidence from audit record reason field.
 *   • issuePassport: no riskEvidence when audit reason lacks riskIntelligence (legacy path).
 *   • tenant isolation: riskEvidence from tenant-A audit not visible in tenant-B claim.
 */

import { test, assert, eq } from "../_harness.mjs";
import {
  buildPassportClaim,
  computeClaimHash,
  canonicalPassportClaim,
} from "../../lib/passport/claim.ts";
import { verifyPassportClaim } from "../../lib/passport/claim-verifier.ts";
import { issuePassport, extractRiskEvidence } from "../../lib/passport/passport.ts";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import type { AuditRecord } from "../../lib/orchestrator/types.ts";

const SECRET = "claim-risk-evidence-test-secret-0123456789abc!!";

function makeSigner() {
  return new HmacSigner(SECRET);
}

function makeTraceWithRiskIntelligence(riskScore: number, factors: { factor: string; contribution: number; detail: string }[]) {
  return JSON.stringify({
    policy: "approval-policy-router",
    riskClass: "value_moving",
    approvalClass: "threshold_escrow",
    timestamp: "2026-01-01T00:00:00.000Z",
    riskIntelligence: { riskScore, effectiveApprovalClass: "threshold_escrow", factors, reputationBand: "normal" },
    signature: "dummy-sig",
  });
}

// ── BuildClaimOptions with riskEvidence ──
test("claim with riskEvidence includes it in body and hash", () => {
  const signer = makeSigner();
  const riskEvidence = {
    riskScore: 55,
    factors: [{ factor: "static_floor", contribution: 55, detail: "base class human" }],
  };
  const claim = buildPassportClaim({
    issuer: "tenant-a",
    subject: "passport-123",
    scope: "passport.status",
    evidenceRefs: ["audit-1"],
    revocationStatus: "active",
    signer,
    riskEvidence,
    claimIdFactory: () => "claim-id-1",
    now: () => "2026-01-01T00:00:00.000Z",
  });

  eq(claim.riskEvidence!.riskScore, 55);
  eq(claim.riskEvidence!.factors.length, 1);
  eq(claim.riskEvidence!.factors[0].factor, "static_floor");
  assert(typeof claim.hash === "string" && claim.hash.length === 64, "hash present");
  assert(typeof claim.signature === "string" && claim.signature.length > 0, "signature present");
});

// ── Hash coverage: tampering riskEvidence breaks verification ──
test("tampering riskEvidence breaks claim hash", () => {
  const signer = makeSigner();
  const riskEvidence = {
    riskScore: 55,
    factors: [{ factor: "static_floor", contribution: 55, detail: "base class human" }],
  };
  const claim = buildPassportClaim({
    issuer: "tenant-a",
    subject: "passport-123",
    scope: "passport.status",
    evidenceRefs: ["audit-1"],
    revocationStatus: "active",
    signer,
    riskEvidence,
  });

  const tampered = { ...claim, riskEvidence: { ...claim.riskEvidence, riskScore: 10 } };
  const { hash: _h, signature: _s, ...body } = tampered;
  const recomputed = computeClaimHash(body);
  assert(recomputed !== tampered.hash, "tampered riskEvidence should break hash");
});

// ── Verification with riskEvidence ──
test("verifyPassportClaim succeeds with riskEvidence", () => {
  const signer = makeSigner();
  const riskEvidence = {
    riskScore: 42,
    factors: [
      { factor: "static_floor", contribution: 30, detail: "base class opa_check" },
      { factor: "reputation:trusted", contribution: -10, detail: "established trust" },
    ],
  };
  const claim = buildPassportClaim({
    issuer: "tenant-a",
    subject: "passport-123",
    scope: "passport.status",
    evidenceRefs: ["audit-1"],
    revocationStatus: "active",
    signer,
    riskEvidence,
  });

  const result = verifyPassportClaim(claim, { hmacSecret: SECRET });
  assert(result.ok, "verification should pass with riskEvidence present");
  assert(result.checks.some((c) => c.name === "claim.hash" && c.status === "pass"), "hash check passes");
});

// ── extractRiskEvidence: parses valid trace ──
test("extractRiskEvidence parses DecisionTrace with riskIntelligence", () => {
  const trace = makeTraceWithRiskIntelligence(55, [
    { factor: "static_floor", contribution: 55, detail: "base class human" },
  ]);
  const ev = extractRiskEvidence(trace);
  assert(ev !== undefined, "should extract riskEvidence");
  eq(ev!.riskScore, 55);
  eq(ev!.factors.length, 1);
  eq(ev!.factors[0].factor, "static_floor");
  eq(ev!.factors[0].contribution, 55);
});

// ── extractRiskEvidence: fail-closed on bad JSON ──
test("extractRiskEvidence: bad JSON → undefined", () => {
  eq(extractRiskEvidence("not json at all"), undefined);
});

// ── extractRiskEvidence: missing riskIntelligence → undefined ──
test("extractRiskEvidence: missing riskIntelligence → undefined", () => {
  const trace = JSON.stringify({ policy: "x", riskClass: "read_only", approvalClass: "auto", timestamp: "2026-01-01T00:00:00.000Z", signature: "s" });
  eq(extractRiskEvidence(trace), undefined);
});

// ── extractRiskEvidence: malformed factor → undefined ──
test("extractRiskEvidence: malformed factor shape → undefined", () => {
  const trace = JSON.stringify({
    riskIntelligence: {
      riskScore: 55,
      factors: [{ factor: "ok", contribution: 10, detail: "ok" }, { bad: true }],
    },
  });
  eq(extractRiskEvidence(trace), undefined);
});

// ── extractRiskEvidence: plain string reason (denied) → undefined ──
test("extractRiskEvidence: plain string reason → undefined", () => {
  eq(extractRiskEvidence("approval policy denied: riskClass=write_destructive → base=human effective=deny"), undefined);
});

// ── extractRiskEvidence: empty/undefined input → undefined ──
test("extractRiskEvidence: empty or undefined input → undefined", () => {
  eq(extractRiskEvidence(""), undefined);
  eq(extractRiskEvidence(undefined), undefined);
});

// ── issuePassport: auto-extracts riskEvidence from audit reason ──
test("issuePassport auto-extracts riskEvidence from audit record reason", () => {
  const store = new InMemoryAuditStore();
  const trace = makeTraceWithRiskIntelligence(30, [
    { factor: "static_floor", contribution: 30, detail: "base class opa_check" },
  ]);
  const record: AuditRecord = {
    id: "audit-1",
    tenantId: "t1",
    actionId: "a1",
    actionType: "ledger.mint",
    source: "alice",
    outcome: "allowed",
    reason: trace,
    occurredAt: "2026-01-01T00:00:00.000Z",
    prevHash: "0",
    hash: "ignored-for-test",
  };
  store.append(record);

  const passport = issuePassport({ auditId: "audit-1", auditStore: store, signer: makeSigner() });
  assert(passport.riskEvidence !== undefined, "passport should carry auto-extracted riskEvidence");
  eq(passport.riskEvidence!.riskScore, 30);
  eq(passport.riskEvidence!.factors.length, 1);
});

// ── issuePassport: no riskEvidence when audit reason lacks riskIntelligence ──
test("issuePassport: no riskEvidence when audit reason is legacy trace without riskIntelligence", () => {
  const store = new InMemoryAuditStore();
  const trace = JSON.stringify({
    policy: "approval-policy-router",
    riskClass: "read_only",
    approvalClass: "auto",
    timestamp: "2026-01-01T00:00:00.000Z",
    signature: "dummy",
  });
  const record: AuditRecord = {
    id: "audit-2",
    tenantId: "t1",
    actionId: "a1",
    actionType: "agent.task.run",
    source: "alice",
    outcome: "allowed",
    reason: trace,
    occurredAt: "2026-01-01T00:00:00.000Z",
    prevHash: "0",
    hash: "ignored-for-test",
  };
  store.append(record);

  const passport = issuePassport({ auditId: "audit-2", auditStore: store, signer: makeSigner() });
  assert(passport.riskEvidence === undefined, "legacy trace without riskIntelligence → no riskEvidence");
});

// ── issuePassport: no riskEvidence when audit reason is plain string ──
test("issuePassport: no riskEvidence when audit reason is plain string (denied)", () => {
  const store = new InMemoryAuditStore();
  const record: AuditRecord = {
    id: "audit-3",
    tenantId: "t1",
    actionId: "a1",
    actionType: "ledger.mint",
    source: "alice",
    outcome: "denied",
    reason: "approval policy denied: riskClass=irreversible → base=deny effective=deny",
    occurredAt: "2026-01-01T00:00:00.000Z",
    prevHash: "0",
    hash: "ignored-for-test",
  };
  store.append(record);

  const passport = issuePassport({ auditId: "audit-3", auditStore: store, signer: makeSigner() });
  assert(passport.riskEvidence === undefined, "denied action with plain reason → no riskEvidence");
});

// ── Tenant isolation: cross-tenant audit not visible ──
test("issuePassport: tenant isolation through expectedTenantId", () => {
  const store = new InMemoryAuditStore();
  const trace = makeTraceWithRiskIntelligence(55, [
    { factor: "static_floor", contribution: 55, detail: "base class human" },
  ]);
  const record: AuditRecord = {
    id: "audit-4",
    tenantId: "tenant-A",
    actionId: "a1",
    actionType: "ledger.mint",
    source: "alice",
    outcome: "allowed",
    reason: trace,
    occurredAt: "2026-01-01T00:00:00.000Z",
    prevHash: "0",
    hash: "ignored-for-test",
  };
  store.append(record);

  try {
    issuePassport({ auditId: "audit-4", auditStore: store, signer: makeSigner(), expectedTenantId: "tenant-B" });
    assert(false, "should throw tenant_mismatch");
  } catch (e: any) {
    eq(e.code, "tenant_mismatch");
  }
});

// ── Deterministic canonical JSON with riskEvidence ──
test("canonicalPassportClaim with riskEvidence is deterministic", () => {
  const body = {
    version: "1",
    claimId: "id",
    issuedAt: "t",
    issuer: "i",
    subject: "s",
    scope: "sc",
    evidenceRefs: [],
    revocationStatus: "active",
    algorithm: "hmac-sha256",
    riskEvidence: {
      riskScore: 42,
      factors: [{ factor: "f1", contribution: 10, detail: "d1" }],
    },
  };
  const a = canonicalPassportClaim(body);
  const b = canonicalPassportClaim(body);
  eq(a, b, "canonical with riskEvidence must be deterministic");
  assert(a.includes("riskEvidence"), "canonical must include riskEvidence key");
});
