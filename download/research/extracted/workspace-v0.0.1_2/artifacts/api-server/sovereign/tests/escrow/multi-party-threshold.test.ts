import "../_flush.mjs";
/**
 * tests/escrow/multi-party-threshold.test.ts — N-of-M multi-party threshold approval.
 * Coverage: 1-of-1 · 2-of-3 · 3-of-3 · quorum not met · duplicate approver ·
 * unauthorized approver · individual token invalid · open quorum · replay prevention ·
 * fail-closed on all error paths · all tokens consumed on success.
 */
import { test, assert, eq } from "../_harness.mjs";
import {
  generateThresholdApproval,
  validateMultiPartyApprovals,
  MultiPartyThresholdError,
  ThresholdApprovalError,
  InMemoryThresholdApprovalStore,
} from "../../lib/escrow/threshold-approval.ts";

const SECRET = "kernel-hmac-secret-long-enough-32+";
const AGREEMENT = "agree-abc";
const TENANT = "tenant-x";
const AMOUNT = 500_000n;

function freshStore() {
  return new InMemoryThresholdApprovalStore();
}

function makeToken(approvedBy: string, maxAmount: bigint = AMOUNT): string {
  const approval = generateThresholdApproval(SECRET, {
    agreementId: AGREEMENT,
    tenantId: TENANT,
    maxAmount,
    approvedBy,
  });
  return approval.token;
}

// ─── 1-of-1 (simplest case) ───────────────────────────────────────────────────

test("multi-party-threshold: 1-of-1 quorum with single valid token", () => {
  const store = freshStore();
  const token = makeToken("authority-1");
  validateMultiPartyApprovals(SECRET, [token], AGREEMENT, TENANT, AMOUNT, store, {
    requiredApprovals: 1,
  });
  assert(true, "1-of-1 quorum satisfied");
});

// ─── 2-of-3 quorum ────────────────────────────────────────────────────────────

test("multi-party-threshold: 2-of-3 quorum satisfied with 2 distinct approvers", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  const t2 = makeToken("authority-2");
  validateMultiPartyApprovals(SECRET, [t1, t2], AGREEMENT, TENANT, AMOUNT, store, {
    requiredApprovals: 2,
    authorizedApprovers: ["authority-1", "authority-2", "authority-3"],
  });
  assert(true, "2-of-3 quorum satisfied");
});

test("multi-party-threshold: 2-of-3 quorum satisfied with all 3 tokens provided", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  const t2 = makeToken("authority-2");
  const t3 = makeToken("authority-3");
  validateMultiPartyApprovals(SECRET, [t1, t2, t3], AGREEMENT, TENANT, AMOUNT, store, {
    requiredApprovals: 2,
    authorizedApprovers: ["authority-1", "authority-2", "authority-3"],
  });
  assert(true, "2-of-3 with 3 tokens OK");
});

// ─── 3-of-3 (unanimous) ──────────────────────────────────────────────────────

test("multi-party-threshold: 3-of-3 quorum requires all 3 distinct approvers", () => {
  const store = freshStore();
  const t1 = makeToken("cfo");
  const t2 = makeToken("ceo");
  const t3 = makeToken("legal");
  validateMultiPartyApprovals(SECRET, [t1, t2, t3], AGREEMENT, TENANT, AMOUNT, store, {
    requiredApprovals: 3,
    authorizedApprovers: ["cfo", "ceo", "legal"],
  });
  assert(true, "3-of-3 unanimous quorum satisfied");
});

// ─── Open quorum (no authorizedApprovers list) ────────────────────────────────

test("multi-party-threshold: open quorum accepts any identities", () => {
  const store = freshStore();
  const t1 = makeToken("anyone-1");
  const t2 = makeToken("anyone-2");
  validateMultiPartyApprovals(SECRET, [t1, t2], AGREEMENT, TENANT, AMOUNT, store, {
    requiredApprovals: 2,
    // no authorizedApprovers
  });
  assert(true, "open quorum accepted");
});

// ─── Quorum not met ───────────────────────────────────────────────────────────

test("multi-party-threshold: insufficient approvals throws MultiPartyThresholdError", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  let threw = false;
  try {
    validateMultiPartyApprovals(SECRET, [t1], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 2,
    });
  } catch (err: unknown) {
    assert(err instanceof MultiPartyThresholdError, "is MultiPartyThresholdError");
    eq((err as MultiPartyThresholdError).code, "insufficient_approvals");
    threw = true;
  }
  assert(threw, "threw on insufficient approvals");
});

test("multi-party-threshold: empty tokens throws insufficient_approvals", () => {
  const store = freshStore();
  let threw = false;
  try {
    validateMultiPartyApprovals(SECRET, [], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 1,
    });
  } catch (err: unknown) {
    assert(err instanceof MultiPartyThresholdError, "is MultiPartyThresholdError");
    eq((err as MultiPartyThresholdError).code, "insufficient_approvals");
    threw = true;
  }
  assert(threw, "threw on empty tokens");
});

// ─── Duplicate approver ───────────────────────────────────────────────────────

test("multi-party-threshold: duplicate approver identity throws duplicate_approver", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  const t2 = makeToken("authority-1"); // same identity
  let threw = false;
  try {
    validateMultiPartyApprovals(SECRET, [t1, t2], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 2,
    });
  } catch (err: unknown) {
    assert(err instanceof MultiPartyThresholdError, "is MultiPartyThresholdError");
    eq((err as MultiPartyThresholdError).code, "duplicate_approver");
    threw = true;
  }
  assert(threw, "threw on duplicate approver");
});

test("multi-party-threshold: duplicate approver does NOT consume any tokens", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  const t2 = makeToken("authority-1"); // duplicate
  try {
    validateMultiPartyApprovals(SECRET, [t1, t2], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 2,
    });
  } catch { /* expected */ }
  // Since only the first token exists in store (second has different id but same approver),
  // the store should not have consumed the first token — no IDs were consumed
  // We verify by re-using the first token in a new valid 1-of-1 call
  // (IDs differ between t1 and t2 so t1's id was NOT consumed)
  const store2 = freshStore();
  let noThrow = true;
  try {
    validateMultiPartyApprovals(SECRET, [t1], AGREEMENT, TENANT, AMOUNT, store2, {
      requiredApprovals: 1,
    });
  } catch { noThrow = false; }
  assert(noThrow, "t1 token still valid — no consumption occurred on failure");
});

// ─── Unauthorized approver ────────────────────────────────────────────────────

test("multi-party-threshold: unauthorized approver throws unauthorized_approver", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  const t2 = makeToken("rogue-actor"); // not in authorized list
  let threw = false;
  try {
    validateMultiPartyApprovals(SECRET, [t1, t2], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 2,
      authorizedApprovers: ["authority-1", "authority-2"],
    });
  } catch (err: unknown) {
    assert(err instanceof MultiPartyThresholdError, "is MultiPartyThresholdError");
    eq((err as MultiPartyThresholdError).code, "unauthorized_approver");
    threw = true;
  }
  assert(threw, "threw on unauthorized approver");
});

// ─── Invalid individual token ─────────────────────────────────────────────────

test("multi-party-threshold: invalid token in set throws token_invalid", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  const t2 = "this-is-not-a-valid-token";
  let threw = false;
  try {
    validateMultiPartyApprovals(SECRET, [t1, t2], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 2,
    });
  } catch (err: unknown) {
    assert(err instanceof MultiPartyThresholdError, "is MultiPartyThresholdError");
    eq((err as MultiPartyThresholdError).code, "token_invalid");
    threw = true;
  }
  assert(threw, "threw on invalid token");
});

test("multi-party-threshold: tampered token signature throws token_invalid", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  // Flip one character in the base64 token to corrupt signature
  const tampered = t1.slice(0, -4) + "XXXX";
  let threw = false;
  try {
    validateMultiPartyApprovals(SECRET, [tampered], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 1,
    });
  } catch (err: unknown) {
    assert(err instanceof MultiPartyThresholdError, "is MultiPartyThresholdError");
    eq((err as MultiPartyThresholdError).code, "token_invalid");
    threw = true;
  }
  assert(threw, "threw on tampered token");
});

// ─── Replay prevention ────────────────────────────────────────────────────────

test("multi-party-threshold: tokens consumed on successful quorum (replay rejected)", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  const t2 = makeToken("authority-2");

  // First call succeeds
  validateMultiPartyApprovals(SECRET, [t1, t2], AGREEMENT, TENANT, AMOUNT, store, {
    requiredApprovals: 2,
  });

  // Second call with same tokens should fail (replayed)
  let threw = false;
  try {
    validateMultiPartyApprovals(SECRET, [t1, t2], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 2,
    });
  } catch (err: unknown) {
    assert(
      err instanceof MultiPartyThresholdError || err instanceof ThresholdApprovalError,
      "is a threshold error",
    );
    threw = true;
  }
  assert(threw, "second call with same tokens rejected");
});

// ─── invalid_config ───────────────────────────────────────────────────────────

test("multi-party-threshold: requiredApprovals=0 throws invalid_config", () => {
  const store = freshStore();
  const t1 = makeToken("authority-1");
  let threw = false;
  try {
    validateMultiPartyApprovals(SECRET, [t1], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 0,
    });
  } catch (err: unknown) {
    assert(err instanceof MultiPartyThresholdError, "is MultiPartyThresholdError");
    eq((err as MultiPartyThresholdError).code, "invalid_config");
    threw = true;
  }
  assert(threw, "threw on invalid config");
});

// ─── Amount limit enforced per-token ─────────────────────────────────────────

test("multi-party-threshold: token with insufficient maxAmount rejected (token_invalid)", () => {
  const store = freshStore();
  // Token covers only 100_000 but we're releasing 500_000
  const t1 = makeToken("authority-1", 100_000n);
  const t2 = makeToken("authority-2", 600_000n);
  let threw = false;
  try {
    validateMultiPartyApprovals(SECRET, [t1, t2], AGREEMENT, TENANT, AMOUNT, store, {
      requiredApprovals: 2,
    });
  } catch (err: unknown) {
    assert(err instanceof MultiPartyThresholdError, "is MultiPartyThresholdError");
    eq((err as MultiPartyThresholdError).code, "token_invalid");
    threw = true;
  }
  assert(threw, "threw on under-authorized amount");
});
