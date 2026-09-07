import "../_flush.mjs";
/**
 * tests/track-record/track-record-memoize.test.ts — v383
 *
 * Verifies the per-call memoization of ownerOf (accountOwnerResolver) and
 * getRoot (buildDelegationChain) inside computeTrackRecord.
 *
 * The efficiency invariant: when the same accountId appears as the worker
 * in N escrows, the resolver must be called exactly once, not N times.
 * Similarly, getRoot for the same identity id must traverse the delegation
 * chain exactly once per computeTrackRecord invocation.
 *
 * Tests:
 *   Happy path
 *     • resolver called once per distinct accountId, regardless of escrow count
 *     • correct score produced when accountId appears in multiple escrows
 *   Edge / fail-closed
 *     • resolver returning null → falls back to accountId (null cached, not re-fetched)
 *     • no resolver provided → zero calls made, correct results
 *   getRoot memoization
 *     • delegation-chain traversal runs once per distinct identity per call
 */

import { test, eq, assert } from "../_harness.mjs";
import { computeTrackRecord } from "../../lib/track-record/track-record.ts";
import type { AccountOwnerResolver } from "../../lib/track-record/track-record.ts";

// ─── Minimal fakes ────────────────────────────────────────────────────────────

/** Fake ChainReader — no audit records (denials not relevant here). */
function emptyChain(): { getChain: (t: string) => [] } {
  return { getChain: () => [] };
}

/** Build a fake EscrowReader with pre-set escrow entries. */
function makeEscrowReader(entries: Array<{
  state: string;
  amount: bigint;
  payerAccountId: string;
  workerAccountId: string;
  fundedBy?: string;
}>) {
  return {
    list: async (_tenantId: string) => entries,
  };
}

// ─── Happy path: resolver called once per distinct accountId ─────────────────

test("ownerOf: resolver called once per distinct accountId across N escrows", async () => {
  const calls: string[] = [];
  const resolver: AccountOwnerResolver = async (_tenantId, accountId) => {
    calls.push(accountId);
    return "worker-alice"; // all accounts owned by alice
  };

  // Same worker account appears as workerAccountId in 5 escrows.
  const SHARED_WORKER = "acct-worker-shared";
  const PAYER = "acct-payer-unique";
  const escrows = Array.from({ length: 5 }, (_, i) => ({
    state: "released",
    amount: 10_000n,
    payerAccountId: PAYER,
    workerAccountId: SHARED_WORKER,
    fundedBy: "funder-bob",  // different from alice → not self-dealing
  }));

  await computeTrackRecord(
    emptyChain(),
    makeEscrowReader(escrows),
    "tenant-memo",
    "worker-alice",
    { accountOwnerResolver: resolver },
  );

  // SHARED_WORKER and PAYER are both distinct accountIds.
  // SHARED_WORKER appears 5×, PAYER appears 5× — but each should be resolved once.
  const workerCallCount = calls.filter(id => id === SHARED_WORKER).length;
  const payerCallCount  = calls.filter(id => id === PAYER).length;
  eq(workerCallCount, 1, "SHARED_WORKER resolved once, not once-per-escrow");
  eq(payerCallCount, 1,  "PAYER resolved once, not once-per-escrow");
});

test("ownerOf memoize: score is still correct when accountId appears in multiple escrows", async () => {
  const WORKER_ACCT = "acct-w";
  const PAYER_ACCT  = "acct-p";
  const resolver: AccountOwnerResolver = async (_t, id) =>
    id === WORKER_ACCT ? "alice" : "bob";

  const escrows = Array.from({ length: 3 }, () => ({
    state: "released",
    amount: 100_000n,
    payerAccountId: PAYER_ACCT,
    workerAccountId: WORKER_ACCT,
    fundedBy: "bob",
  }));

  const r = await computeTrackRecord(
    emptyChain(),
    makeEscrowReader(escrows),
    "t-score",
    "alice",
    { accountOwnerResolver: resolver },
  );

  eq(r.settledAsWorker, 3, "three settlements counted");
  assert(r.score > 50, "score raised above neutral");
});

// ─── Edge: resolver returning null is cached (not re-fetched) ─────────────────

test("ownerOf: null-returning resolver is memoized — account falls back to raw id, not re-queried", async () => {
  const calls: string[] = [];
  const resolver: AccountOwnerResolver = async (_t, id) => {
    calls.push(id);
    return null; // unknown account
  };

  const UNKNOWN_ACCT = "acct-unknown";
  const escrows = Array.from({ length: 4 }, () => ({
    state: "released",
    amount: 50_000n,
    payerAccountId: UNKNOWN_ACCT,
    workerAccountId: UNKNOWN_ACCT,
    fundedBy: "someone",
  }));

  await computeTrackRecord(
    emptyChain(),
    makeEscrowReader(escrows),
    "t-null",
    "someone",
    { accountOwnerResolver: resolver },
  );

  // UNKNOWN_ACCT appears as both worker and payer on every escrow but must be resolved once.
  eq(calls.filter(id => id === UNKNOWN_ACCT).length, 1,
     "null-returning resolver called once — result cached, not re-queried");
});

// ─── Edge: no resolver → zero calls ──────────────────────────────────────────

test("ownerOf: no resolver provided → zero resolver calls, accountId used directly", async () => {
  let calls = 0;
  // Deliberately NOT providing accountOwnerResolver — verify no surprises
  const escrows = Array.from({ length: 5 }, () => ({
    state: "released",
    amount: 10_000n,
    payerAccountId: "acct-payer",
    workerAccountId: "alice",
    fundedBy: "bob",
  }));

  const r = await computeTrackRecord(
    emptyChain(),
    makeEscrowReader(escrows),
    "t-nores",
    "alice",
    {}, // no accountOwnerResolver
  );
  eq(r.settledAsWorker, 5, "worker identity matched by raw accountId fallback");
  eq(calls, 0, "resolver never invoked");
});

// ─── getRoot memoization: delegation chain traversed once per identity ────────

test("getRoot: delegation chain traversed once per distinct identity id", async () => {
  let getByIdCalls = 0;

  // Minimal IdentityStore shim using the correct interface (getById).
  // Returns a root-human identity (no parentId) so the chain resolves immediately.
  const identityStore = {
    getById: (id: string) => {
      getByIdCalls++;
      return { id, tenantId: "t-root", type: "human" as const, parentId: null };
    },
    list:   (_tenantId: string) => [],
    create: (_identity: any) => { throw new Error("create not supported"); },
    update: (_identity: any) => { throw new Error("update not supported"); },
  } as any;

  const WORKER_ID = "agent-root";
  const resolver: AccountOwnerResolver = async () => WORKER_ID;

  // WORKER_ID appears as fundedBy AND as the resolved workerOwner on every one of 6 escrows.
  // Without memoization getRoot(WORKER_ID) would be called 12 times (×6 ×2).
  const escrows = Array.from({ length: 6 }, () => ({
    state: "released",
    amount: 10_000n,
    payerAccountId: "payer-acct",
    workerAccountId: "worker-acct",
    fundedBy: WORKER_ID,
  }));

  await computeTrackRecord(
    emptyChain(),
    makeEscrowReader(escrows),
    "t-root",
    WORKER_ID,
    { accountOwnerResolver: resolver, identityStore },
  );

  // Memoized: the delegation store should be queried exactly once for WORKER_ID
  // regardless of how many escrows reference it.
  eq(getByIdCalls, 1,
    `getById called ${getByIdCalls} times — expected 1 (memoized across all escrows)`);
});
