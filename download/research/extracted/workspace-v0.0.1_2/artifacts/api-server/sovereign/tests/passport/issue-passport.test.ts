import "../_flush.mjs";
/**
 * tests/passport/issue-passport.test.ts — Action Passport: issuePassport unit tests.
 *
 * Coverage:
 *   • happy path: passport built from a live audit record, signed by HmacSigner.
 *   • signature verifies via the same signer; payload tampering breaks it.
 *   • delegation chain resolved when `source` is a registered identity.
 *   • delegationChain null when no IdentityStore is provided.
 *   • delegationChain null when `source` is a free-form label (not an identity).
 *   • denied audit record → policyDecision carries outcome + reason.
 *   • ledgerEffect with huge BigInt amount is serialised as decimal string.
 *   • canonical hash is deterministic across key ordering.
 *   • Ed25519Signer integration: passport is verifiable with the public key.
 *   • failure: unknown auditId throws PassportError(audit_not_found).
 *   • failure: missing auditId / store / signer throw PassportError.
 *   • failure: tenant_mismatch when expectedTenantId differs from record.
 *   • tenant isolation: passport.tenantId matches the audit record's tenant.
 */

import { test, assert, eq } from "../_harness.mjs";
import { issuePassport, computePassportHash, canonicalStringify, PassportError } from "../../lib/passport/index.ts";
import { InMemoryAuditStore } from "../../lib/orchestrator/audit.ts";
import { HmacSigner, Ed25519Signer, generateAuditKeyPair } from "../../lib/orchestrator/signer.ts";
import { InMemoryIdentityStore } from "../../lib/agent-identity/identity.ts";
import type { AuditRecord } from "../../lib/orchestrator/types.ts";
import type { LedgerTransaction } from "../../lib/ledger/types.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let _seq = 0;
function nextId(prefix: string): string {
  _seq++;
  return `${prefix}-${_seq}`;
}

function makeAuditStore(signer?: HmacSigner | Ed25519Signer) {
  return new InMemoryAuditStore(signer);
}

function appendAllowed(store: InMemoryAuditStore, opts: { tenantId?: string; source?: string; actionType?: string } = {}): AuditRecord {
  return store.append({
    id: nextId("audit"),
    tenantId: opts.tenantId ?? "tenant-1",
    actionId: nextId("action"),
    actionType: opts.actionType ?? "agent.task.run",
    source: opts.source ?? "test-agent",
    outcome: "allowed",
    occurredAt: new Date().toISOString(),
  });
}

function appendDenied(store: InMemoryAuditStore, reason: string): AuditRecord {
  return store.append({
    id: nextId("audit"),
    tenantId: "tenant-1",
    actionId: nextId("action"),
    actionType: "billing.charge",
    source: "test-agent",
    outcome: "denied",
    reason,
    occurredAt: new Date().toISOString(),
  });
}

function makeLedgerTx(amount: bigint): LedgerTransaction {
  return {
    id: nextId("tx"),
    tenantId: "tenant-1",
    kind: "mint",
    debitAccountId: "reserve",
    creditAccountId: "user-1",
    amount,
    memo: "test mint",
    initiatedBy: "test-agent",
    createdAt: new Date().toISOString(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("issuePassport builds signed passport from audit record", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  const record = appendAllowed(store);

  const passport = issuePassport({ auditId: record.id, auditStore: store, signer });

  eq(passport.version, "1");
  eq(passport.tenantId, record.tenantId);
  eq(passport.audit.id, record.id);
  eq(passport.audit.hash, record.hash);
  eq(passport.audit.signature, record.signature);
  eq(passport.policyDecision.outcome, "allowed");
  eq(passport.delegationChain, null);
  eq(passport.ledgerEffect, null);
  eq(passport.algorithm, "hmac-sha256");
  assert(typeof passport.hash === "string" && passport.hash.length === 64, "hash is sha256 hex");
  assert(typeof passport.signature === "string" && passport.signature.length > 0, "signature present");
});

test("passport signature verifies via the issuing signer", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  const record = appendAllowed(store);
  const passport = issuePassport({ auditId: record.id, auditStore: store, signer });

  assert(signer.verify(passport.hash, passport.signature), "signature verifies");
});

test("tampering with passport body breaks the hash", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  const record = appendAllowed(store);
  const passport = issuePassport({ auditId: record.id, auditStore: store, signer });

  const { hash: _h, signature: _s, ...body } = passport;
  const tampered = { ...body, tenantId: "tenant-evil" };
  const recomputed = computePassportHash(tampered);
  assert(recomputed !== passport.hash, "tampered body yields different hash");
});

test("delegation chain resolved when source is a registered identity", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  const identities = new InMemoryIdentityStore();
  const now = new Date().toISOString();
  const human = identities.create({ id: "h1", tenantId: "tenant-1", type: "human", parentId: null, createdAt: now });
  const agent = identities.create({ id: "a1", tenantId: "tenant-1", type: "agent", parentId: human.id, createdAt: now });

  const record = appendAllowed(store, { source: agent.id });
  const passport = issuePassport({ auditId: record.id, auditStore: store, signer, identityStore: identities });

  assert(passport.delegationChain !== null, "chain resolved");
  eq(passport.delegationChain!.length, 2);
  eq(passport.delegationChain![0].id, agent.id);
  eq(passport.delegationChain![1].id, human.id);
});

test("delegationChain null when source is a free-form label", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  const identities = new InMemoryIdentityStore();

  const record = appendAllowed(store, { source: "scheduler-cron" });
  const passport = issuePassport({ auditId: record.id, auditStore: store, signer, identityStore: identities });

  eq(passport.delegationChain, null);
});

test("denied audit record carries policyDecision.reason", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  const record = appendDenied(store, "limit exceeded");
  const passport = issuePassport({ auditId: record.id, auditStore: store, signer });

  eq(passport.policyDecision.outcome, "denied");
  eq(passport.policyDecision.reason, "limit exceeded");
  eq(passport.audit.reason, "limit exceeded");
});

test("ledgerEffect serialises huge BigInt amount as decimal string", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  const record = appendAllowed(store, { actionType: "ledger.mint" });
  const huge = 12345678901234567890123456789n;
  const tx = makeLedgerTx(huge);
  const passport = issuePassport({ auditId: record.id, auditStore: store, signer, ledgerEffect: tx });

  assert(passport.ledgerEffect !== null, "ledgerEffect present");
  eq(passport.ledgerEffect!.amount, huge.toString());
  eq(passport.ledgerEffect!.transactionId, tx.id);
  // Confirm passport round-trips through JSON without BigInt errors:
  const json = JSON.stringify(passport);
  assert(json.includes(huge.toString()), "amount survives JSON round-trip");
});

test("canonicalStringify is deterministic across key ordering", () => {
  const a = canonicalStringify({ b: 1, a: 2, c: [3, { y: 4, x: 5 }] });
  const b = canonicalStringify({ c: [3, { x: 5, y: 4 }], a: 2, b: 1 });
  eq(a, b);
});

test("Ed25519 passport verifies with the public key", () => {
  const kp = generateAuditKeyPair();
  const signer = new Ed25519Signer(kp.privateKey, kp.publicKey);
  const store = makeAuditStore(signer);
  const record = appendAllowed(store);
  const passport = issuePassport({ auditId: record.id, auditStore: store, signer });

  eq(passport.algorithm, "ed25519");
  const verifier = new Ed25519Signer(kp.privateKey, kp.publicKey);
  assert(verifier.verify(passport.hash, passport.signature), "ed25519 signature verifies");
});

test("issuePassport throws on unknown auditId (fail-closed)", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  let caught: unknown = null;
  try {
    issuePassport({ auditId: "does-not-exist", auditStore: store, signer });
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof PassportError, "throws PassportError");
  eq((caught as PassportError).code, "audit_not_found");
});

test("issuePassport throws when required options are missing", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);

  let e1: unknown = null;
  try { issuePassport({ auditId: "", auditStore: store, signer } as any); } catch (e) { e1 = e; }
  assert(e1 instanceof PassportError && (e1 as PassportError).code === "missing_audit_id", "missing auditId");

  let e2: unknown = null;
  try { issuePassport({ auditId: "x", auditStore: undefined as any, signer }); } catch (e) { e2 = e; }
  assert(e2 instanceof PassportError && (e2 as PassportError).code === "missing_audit_store", "missing store");

  let e3: unknown = null;
  try { issuePassport({ auditId: "x", auditStore: store, signer: undefined as any }); } catch (e) { e3 = e; }
  assert(e3 instanceof PassportError && (e3 as PassportError).code === "missing_signer", "missing signer");
});

test("expectedTenantId mismatch is rejected (defence-in-depth)", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  const record = appendAllowed(store, { tenantId: "tenant-1" });

  let caught: unknown = null;
  try {
    issuePassport({ auditId: record.id, auditStore: store, signer, expectedTenantId: "tenant-2" });
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof PassportError, "throws PassportError");
  eq((caught as PassportError).code, "tenant_mismatch");
});

test("tenant isolation: passport.tenantId matches the audit record's tenant", () => {
  const signer = new HmacSigner("test-secret-with-enough-entropy-xx");
  const store = makeAuditStore(signer);
  const r1 = appendAllowed(store, { tenantId: "tenant-A" });
  const r2 = appendAllowed(store, { tenantId: "tenant-B" });
  const p1 = issuePassport({ auditId: r1.id, auditStore: store, signer });
  const p2 = issuePassport({ auditId: r2.id, auditStore: store, signer });

  eq(p1.tenantId, "tenant-A");
  eq(p2.tenantId, "tenant-B");
  assert(p1.hash !== p2.hash, "different passports have different hashes");
});
