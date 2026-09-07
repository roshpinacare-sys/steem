import "../_flush.mjs";
/**
 * tests/escrow/threshold-approval.test.ts — ThresholdApproval: generate + validate + consume.
 * Coverage: happy path · expiry · replay prevention · tampered token · amount exceeded ·
 * tenant mismatch · agreement mismatch · invalid token · fail-closed on all errors.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  generateThresholdApproval,
  validateAndConsumeApproval,
  ThresholdApprovalError,
  InMemoryThresholdApprovalStore,
  validateMultiPartyApprovals,
  MultiPartyThresholdError,
} from "../../lib/escrow/threshold-approval.ts";

const SECRET = "kernel-hmac-secret-long-enough-32+";
const BASE_INPUT = {
  agreementId: "agree-123",
  tenantId: "tenant-1",
  maxAmount: 500_000n,
  approvedBy: "authority-1",
};

function freshStore() { return new InMemoryThresholdApprovalStore(); }

// ─── Generation ───────────────────────────────────────────────────────────────

test("threshold-approval: generate produces valid approval with token", () => {
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);
  assert(approval.id, "has id");
  eq(approval.agreementId, "agree-123");
  eq(approval.tenantId, "tenant-1");
  eq(approval.maxAmount, "500000");
  eq(approval.approvedBy, "authority-1");
  assert(approval.issuedAt, "has issuedAt");
  assert(approval.expiresAt, "has expiresAt");
  assert(approval.token, "has token");
  assert(approval.token.length > 50, "token is non-trivial");
});

test("threshold-approval: expiresAt is after issuedAt", () => {
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);
  const issued = new Date(approval.issuedAt).getTime();
  const expires = new Date(approval.expiresAt).getTime();
  assert(expires > issued, "expires after issued");
});

test("threshold-approval: custom TTL is respected", () => {
  const ttl = 60_000; // 1 minute
  const approval = generateThresholdApproval(SECRET, BASE_INPUT, ttl);
  const issued = new Date(approval.issuedAt).getTime();
  const expires = new Date(approval.expiresAt).getTime();
  const diff = expires - issued;
  assert(diff >= ttl - 100 && diff <= ttl + 100, `TTL within 100ms of ${ttl}ms`);
});

test("threshold-approval: generate rejects invalid inputs", () => {
  let bad = 0;
  try { generateThresholdApproval(SECRET, { ...BASE_INPUT, agreementId: "" }); } catch (e) { if (e instanceof ThresholdApprovalError) bad++; }
  try { generateThresholdApproval(SECRET, { ...BASE_INPUT, tenantId: "" }); } catch (e) { if (e instanceof ThresholdApprovalError) bad++; }
  try { generateThresholdApproval(SECRET, { ...BASE_INPUT, maxAmount: 0n }); } catch (e) { if (e instanceof ThresholdApprovalError) bad++; }
  try { generateThresholdApproval(SECRET, { ...BASE_INPUT, maxAmount: -1n }); } catch (e) { if (e instanceof ThresholdApprovalError) bad++; }
  try { generateThresholdApproval(SECRET, { ...BASE_INPUT, approvedBy: "" }); } catch (e) { if (e instanceof ThresholdApprovalError) bad++; }
  eq(bad, 5, "all five invalid inputs rejected");
});

// ─── Validation: happy path ───────────────────────────────────────────────────

test("threshold-approval: valid token passes validation and is consumed", () => {
  const store = freshStore();
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);

  // Should not throw
  validateAndConsumeApproval(SECRET, approval.token, "agree-123", "tenant-1", 400_000n, store);

  assert(store.hasConsumed(approval.id), "nonce is consumed after validation");
});

test("threshold-approval: amount equal to maxAmount is accepted", () => {
  const store = freshStore();
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);
  validateAndConsumeApproval(SECRET, approval.token, "agree-123", "tenant-1", 500_000n, store);
});

// ─── Validation: fail-closed paths ───────────────────────────────────────────

test("threshold-approval: replayed token is rejected (fail-closed)", () => {
  const store = freshStore();
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);
  validateAndConsumeApproval(SECRET, approval.token, "agree-123", "tenant-1", 100_000n, store);

  let code = "";
  try { validateAndConsumeApproval(SECRET, approval.token, "agree-123", "tenant-1", 100_000n, store); }
  catch (e) { if (e instanceof ThresholdApprovalError) code = e.code; }
  eq(code, "replayed", "replay rejected");
});

test("threshold-approval: amount exceeding maxAmount is rejected", () => {
  const store = freshStore();
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);
  let code = "";
  try { validateAndConsumeApproval(SECRET, approval.token, "agree-123", "tenant-1", 500_001n, store); }
  catch (e) { if (e instanceof ThresholdApprovalError) code = e.code; }
  eq(code, "amount_exceeded");
  assert(!store.hasConsumed(approval.id), "nonce NOT consumed on failure (fail-closed)");
});

test("threshold-approval: tenant mismatch is rejected", () => {
  const store = freshStore();
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);
  let code = "";
  try { validateAndConsumeApproval(SECRET, approval.token, "agree-123", "wrong-tenant", 100_000n, store); }
  catch (e) { if (e instanceof ThresholdApprovalError) code = e.code; }
  eq(code, "tenant_mismatch");
});

test("threshold-approval: agreement mismatch is rejected", () => {
  const store = freshStore();
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);
  let code = "";
  try { validateAndConsumeApproval(SECRET, approval.token, "wrong-agreement", "tenant-1", 100_000n, store); }
  catch (e) { if (e instanceof ThresholdApprovalError) code = e.code; }
  eq(code, "agreement_mismatch");
});

test("threshold-approval: tampered token (field mutation) is rejected", () => {
  const store = freshStore();
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);

  // Decode, mutate maxAmount, re-encode without updating signature
  const decoded = JSON.parse(Buffer.from(approval.token, "base64").toString());
  decoded.maxAmount = "99999999"; // inflate approved amount
  const tampered = Buffer.from(JSON.stringify(decoded)).toString("base64");

  let code = "";
  try { validateAndConsumeApproval(SECRET, tampered, "agree-123", "tenant-1", 99_999_999n, store); }
  catch (e) { if (e instanceof ThresholdApprovalError) code = e.code; }
  eq(code, "invalid_token", "tampered token rejected (signature invalid)");
});

test("threshold-approval: malformed token is rejected", () => {
  const store = freshStore();
  let code = "";
  try { validateAndConsumeApproval(SECRET, "not-a-valid-base64-token!!", "agree-123", "tenant-1", 100n, store); }
  catch (e) { if (e instanceof ThresholdApprovalError) code = e.code; }
  eq(code, "invalid_token");
});

test("threshold-approval: expired token is rejected", async () => {
  const store = freshStore();
  // Generate with 1ms TTL — will be expired by the time we validate
  const approval = generateThresholdApproval(SECRET, BASE_INPUT, 1);

  await new Promise((r) => setTimeout(r, 10)); // wait for expiry

  let code = "";
  try { validateAndConsumeApproval(SECRET, approval.token, "agree-123", "tenant-1", 100_000n, store); }
  catch (e) { if (e instanceof ThresholdApprovalError) code = e.code; }
  eq(code, "expired");
});

test("threshold-approval: wrong signing secret is rejected", () => {
  const store = freshStore();
  const approval = generateThresholdApproval(SECRET, BASE_INPUT);
  let code = "";
  try { validateAndConsumeApproval("wrong-secret-long-enough-here-!!!", approval.token, "agree-123", "tenant-1", 100_000n, store); }
  catch (e) { if (e instanceof ThresholdApprovalError) code = e.code; }
  eq(code, "invalid_token");
});

// ─── InMemoryThresholdApprovalStore ──────────────────────────────────────────

test("threshold-approval: store hasConsumed returns false before consume", () => {
  const store = freshStore();
  assert(!store.hasConsumed("some-id"), "not consumed initially");
});

test("threshold-approval: store hasConsumed returns true after consume", () => {
  const store = freshStore();
  store.consume("nonce-1");
  assert(store.hasConsumed("nonce-1"), "consumed after call");
});

test("threshold-approval: multiple distinct tokens can each be used once", () => {
  const store = freshStore();
  const a1 = generateThresholdApproval(SECRET, BASE_INPUT);
  const a2 = generateThresholdApproval(SECRET, BASE_INPUT);

  // Use both (different ids)
  validateAndConsumeApproval(SECRET, a1.token, "agree-123", "tenant-1", 100n, store);
  validateAndConsumeApproval(SECRET, a2.token, "agree-123", "tenant-1", 100n, store);

  assert(store.hasConsumed(a1.id));
  assert(store.hasConsumed(a2.id));
});

// ─── validateMultiPartyApprovals: efficiency/set-based-authorized-approvers ───
// Regression for replacing authorizedApprovers.includes(approvedBy) (O(approvers),
// re-scanned for every one of the N tokens — O(tokens × approvers)) with a Set
// built once before the loop — O(tokens). Same semantics: empty list means
// "no restriction"; non-empty list is an allow-list.

test("validateMultiPartyApprovals: quorum met by authorized approvers among a large allow-list", () => {
  const store = freshStore();
  // 200-entry authorized allow-list — large enough that an O(approvers) scan
  // per token would be the dominant cost if the Set conversion regressed.
  const authorizedApprovers = Array.from({ length: 200 }, (_, i) => `authority-${i}`);
  const tokens = ["authority-50", "authority-150", "authority-199"].map(
    (approvedBy) => generateThresholdApproval(SECRET, { ...BASE_INPUT, approvedBy }).token,
  );

  validateMultiPartyApprovals(
    SECRET, tokens, "agree-123", "tenant-1", 500_000n, store,
    { requiredApprovals: 3, authorizedApprovers },
  );
  // No throw — quorum met, all three are within the allow-list.
  assert(true, "quorum met without throwing");
});

test("validateMultiPartyApprovals: unauthorized approver is rejected even from a large allow-list", () => {
  const store = freshStore();
  const authorizedApprovers = Array.from({ length: 200 }, (_, i) => `authority-${i}`);
  const tokens = [
    generateThresholdApproval(SECRET, { ...BASE_INPUT, approvedBy: "authority-1" }).token,
    generateThresholdApproval(SECRET, { ...BASE_INPUT, approvedBy: "intruder-not-on-list" }).token,
  ];

  let threw = false;
  try {
    validateMultiPartyApprovals(
      SECRET, tokens, "agree-123", "tenant-1", 500_000n, store,
      { requiredApprovals: 2, authorizedApprovers },
    );
  } catch (err) {
    threw = true;
    assert(err instanceof MultiPartyThresholdError, "throws MultiPartyThresholdError");
    eq((err as InstanceType<typeof MultiPartyThresholdError>).code, "unauthorized_approver");
  }
  assert(threw, "unauthorized approver must be rejected, fail-closed");
});

test("validateMultiPartyApprovals: empty authorizedApprovers means open quorum (no restriction)", () => {
  const store = freshStore();
  const tokens = [
    generateThresholdApproval(SECRET, { ...BASE_INPUT, approvedBy: "anyone-1" }).token,
    generateThresholdApproval(SECRET, { ...BASE_INPUT, approvedBy: "anyone-2" }).token,
  ];

  validateMultiPartyApprovals(
    SECRET, tokens, "agree-123", "tenant-1", 500_000n, store,
    { requiredApprovals: 2, authorizedApprovers: [] },
  );
  assert(true, "open quorum accepts any approver when authorizedApprovers is empty");
});

test("validateMultiPartyApprovals: duplicate approver across tokens is rejected (fail-closed), even when authorized", () => {
  const store = freshStore();
  const authorizedApprovers = ["authority-1", "authority-2"];
  const tokens = [
    generateThresholdApproval(SECRET, { ...BASE_INPUT, approvedBy: "authority-1" }).token,
    generateThresholdApproval(SECRET, { ...BASE_INPUT, approvedBy: "authority-1" }).token,
  ];

  let threw = false;
  try {
    validateMultiPartyApprovals(
      SECRET, tokens, "agree-123", "tenant-1", 500_000n, store,
      { requiredApprovals: 2, authorizedApprovers },
    );
  } catch (err) {
    threw = true;
    assert(err instanceof MultiPartyThresholdError, "throws MultiPartyThresholdError");
    eq((err as InstanceType<typeof MultiPartyThresholdError>).code, "duplicate_approver");
  }
  assert(threw, "duplicate approver must be rejected even if authorized");
});
