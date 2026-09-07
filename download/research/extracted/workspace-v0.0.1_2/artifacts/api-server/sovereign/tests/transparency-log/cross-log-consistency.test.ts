/**
 * tests/transparency-log/cross-log-consistency.test.ts
 *
 * Coverage: happy path · edge cases · fail-closed
 *
 * Tests for verifyCrossLogConsistency (sub-step 3-A-2, TRUST_INTEGRITY_ROADMAP §2.A):
 * given two FederationAnchors, verify that a SHARED witness quorum co-signed ALL
 * log roots embedded in both anchors.
 */

import { test, assert, eq } from "../../tests/_harness.mjs";
import {
  verifyCrossLogConsistency,
  CrossLogConsistencyError,
} from "../../lib/transparency-log/cross-log-consistency.ts";
import {
  buildFederationAnchor,
  FEDERATION_ANCHOR_VERSION,
} from "../../lib/transparency-log/federation-anchor.ts";
import { signTreeHead, SplitViewError } from "../../lib/transparency-log/witness.ts";
import type { Signer } from "../../lib/orchestrator/types.ts";
import { createHmac } from "node:crypto";

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeSigner(secret: string): Signer {
  return {
    algorithm: "hmac-sha256",
    sign(payload: string): string {
      return createHmac("sha256", secret).update(payload).digest("base64");
    },
    verify(payload: string, sig: string): boolean {
      return createHmac("sha256", secret).update(payload).digest("base64") === sig;
    },
  };
}

// Federation signers (sign anchors)
const fedSigner = makeSigner("fed-secret");

// Three independent witness signers
const witSigner1 = makeSigner("witness-1-secret");
const witSigner2 = makeSigner("witness-2-secret");
const witSigner3 = makeSigner("witness-3-secret");

// Deterministic 64-hex roots
const ROOT_X = "a".repeat(64);
const ROOT_Y = "b".repeat(64);
const ROOT_Z = "c".repeat(64);
const ROOT_W = "d".repeat(64);

// Log endpoints
const LOG_X = { logId: "org.acme/audit", root: ROOT_X, treeSize: 42 };
const LOG_Y = { logId: "org.partner/audit", root: ROOT_Y, treeSize: 17 };
const LOG_Z = { logId: "org.third/audit", root: ROOT_Z, treeSize: 8 };
const LOG_W = { logId: "org.fourth/audit", root: ROOT_W, treeSize: 3 };

const NOW = "2026-01-01T00:00:00.000Z";

// Anchors: each binds two logs
const anchor1 = buildFederationAnchor(fedSigner, "anchor-001", LOG_X, LOG_Y, NOW, "fed-key-A");
const anchor2 = buildFederationAnchor(fedSigner, "anchor-002", LOG_Z, LOG_W, NOW, "fed-key-A");

// Helper: sign a tree head as a given witness
function witnessStatement(signer: Signer, logId: string, root: string, treeSize: number, witnessId: string) {
  return signTreeHead(signer, { logId, root, treeSize, observedAt: NOW, witnessId });
}

// resolveSigner maps witnessId to the signer that produced that witness's statements
function makeResolver(map: Record<string, Signer>): (id: string) => Signer | null {
  return (id) => map[id] ?? null;
}

const W1_ID = "witness-1";
const W2_ID = "witness-2";
const W3_ID = "witness-3";

const resolver123 = makeResolver({
  [W1_ID]: witSigner1,
  [W2_ID]: witSigner2,
  [W3_ID]: witSigner3,
});

// ── Happy path ────────────────────────────────────────────────────────────────

test("consistent: two witnesses co-signed all four unique log roots", () => {
  const statements = [
    // witness-1 signs all four roots
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_W.logId, ROOT_W, LOG_W.treeSize, W1_ID),
    // witness-2 signs all four roots
    witnessStatement(witSigner2, LOG_X.logId, ROOT_X, LOG_X.treeSize, W2_ID),
    witnessStatement(witSigner2, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W2_ID),
    witnessStatement(witSigner2, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W2_ID),
    witnessStatement(witSigner2, LOG_W.logId, ROOT_W, LOG_W.treeSize, W2_ID),
  ];

  const result = verifyCrossLogConsistency(anchor1, anchor2, statements, 2, resolver123);

  assert(result.consistent, "two shared witnesses → consistent");
  eq(result.sharedWitnessIds.length, 2, "two shared witness IDs");
  eq(result.sharedWitnessIds[0], W1_ID, "witness-1 in shared set");
  eq(result.sharedWitnessIds[1], W2_ID, "witness-2 in shared set");
  eq(result.threshold, 2, "threshold echoed");
  eq(result.endpointResults.length, 4, "four unique endpoints checked");
});

test("consistent: threshold=1, one witness signs all roots", () => {
  const statements = [
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_W.logId, ROOT_W, LOG_W.treeSize, W1_ID),
  ];

  const result = verifyCrossLogConsistency(anchor1, anchor2, statements, 1, resolver123);
  assert(result.consistent, "single shared witness meets threshold=1");
  eq(result.sharedWitnessIds.length, 1, "one shared witness");
});

test("endpointResults: per-endpoint witness breakdown is accurate", () => {
  const statements = [
    // W1 signs X and Y only; W2 signs all four
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
    witnessStatement(witSigner2, LOG_X.logId, ROOT_X, LOG_X.treeSize, W2_ID),
    witnessStatement(witSigner2, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W2_ID),
    witnessStatement(witSigner2, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W2_ID),
    witnessStatement(witSigner2, LOG_W.logId, ROOT_W, LOG_W.treeSize, W2_ID),
  ];

  const result = verifyCrossLogConsistency(anchor1, anchor2, statements, 1, resolver123);
  // Only W2 signed all four; shared set = {W2}
  assert(result.consistent, "W2 covers all four endpoints → consistent");
  eq(result.sharedWitnessIds[0], W2_ID, "W2 is the shared witness");
  eq(result.sharedWitnessIds.length, 1, "only W2 is shared");
  // X and Y endpoints have both W1 and W2; Z and W have only W2
  const epX = result.endpointResults.find(e => e.logId === LOG_X.logId);
  assert(epX !== undefined, "X endpoint present");
  assert(epX!.witnessIds.includes(W1_ID), "W1 signed X");
  assert(epX!.witnessIds.includes(W2_ID), "W2 signed X");
});

test("not consistent: one witness misses one endpoint → consistent=false", () => {
  const statements = [
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W1_ID),
    // W1 does NOT sign LOG_W → cannot be shared for threshold=1
  ];

  const result = verifyCrossLogConsistency(anchor1, anchor2, statements, 1, resolver123);
  assert(!result.consistent, "missing root for W1 → not consistent");
  eq(result.sharedWitnessIds.length, 0, "shared set is empty");
});

test("not consistent: threshold exceeds shared witness count", () => {
  // Only one witness signs all roots, but threshold=2
  const statements = [
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_W.logId, ROOT_W, LOG_W.treeSize, W1_ID),
  ];

  const result = verifyCrossLogConsistency(anchor1, anchor2, statements, 2, resolver123);
  assert(!result.consistent, "only 1 shared witness < threshold=2 → not consistent");
  eq(result.sharedWitnessIds.length, 1, "one shared witness (but below threshold)");
});

test("empty statements → not consistent", () => {
  const result = verifyCrossLogConsistency(anchor1, anchor2, [], 1, resolver123);
  assert(!result.consistent, "no witnesses → not consistent");
  eq(result.sharedWitnessIds.length, 0, "no shared witnesses");
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("shared log endpoint between anchors — deduplicated, counted once", () => {
  // anchor3 has logA=LOG_X (same as anchor1.logA) and logB=LOG_Y (same as anchor1.logB)
  // When verifying anchor1 against anchor3, only 2 unique endpoints exist (not 4)
  const anchor3 = buildFederationAnchor(fedSigner, "anchor-003", LOG_X, LOG_Y, NOW, "fed-key-A");

  const statements = [
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
  ];

  const result = verifyCrossLogConsistency(anchor1, anchor3, statements, 1, resolver123);
  assert(result.consistent, "identical endpoints deduplicated → consistent");
  eq(result.endpointResults.length, 2, "only 2 unique endpoints (not 4)");
});

test("two anchors share one log endpoint — 3 unique endpoints checked", () => {
  // anchor4 has logA=LOG_Y (shared with anchor1.logB) and logB=LOG_Z (new)
  const anchor4 = buildFederationAnchor(fedSigner, "anchor-004", LOG_Y, LOG_Z, NOW, "fed-key-A");

  const statements = [
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W1_ID),
  ];

  const result = verifyCrossLogConsistency(anchor1, anchor4, statements, 1, resolver123);
  assert(result.consistent, "3 unique endpoints, all covered by W1 → consistent");
  eq(result.endpointResults.length, 3, "3 unique endpoints");
});

test("unknown witness (not in resolver) is ignored — fail-closed", () => {
  // W3 signs all roots but resolver only knows W1 and W2
  const partialResolver = makeResolver({ [W1_ID]: witSigner1 });

  const statements = [
    witnessStatement(witSigner3, LOG_X.logId, ROOT_X, LOG_X.treeSize, W3_ID),
    witnessStatement(witSigner3, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W3_ID),
    witnessStatement(witSigner3, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W3_ID),
    witnessStatement(witSigner3, LOG_W.logId, ROOT_W, LOG_W.treeSize, W3_ID),
  ];

  const result = verifyCrossLogConsistency(anchor1, anchor2, statements, 1, partialResolver);
  assert(!result.consistent, "unknown witness ignored → not consistent");
  eq(result.sharedWitnessIds.length, 0, "no known witnesses → empty shared set");
});

// ── efficiency/set-based-witness-intersection ──────────────────────────────
// The shared-witness intersection was refactored from re-scanning
// `qr.witnessIds` with `.includes()` on every sharedSet member (O(W) per
// check, O(W^2) per endpoint) to building a Set once per endpoint and doing
// O(1) lookups. These tests pin the externally-observable intersection
// result so the refactor can't silently change which witnesses are shared.

test("set-based intersection: larger witness pool — all five witnesses shared across all endpoints", () => {
  const witSigner4 = makeSigner("witness-4-secret");
  const witSigner5 = makeSigner("witness-5-secret");
  const W4_ID = "witness-4";
  const W5_ID = "witness-5";
  const resolver = makeResolver({
    [W1_ID]: witSigner1,
    [W2_ID]: witSigner2,
    [W3_ID]: witSigner3,
    [W4_ID]: witSigner4,
    [W5_ID]: witSigner5,
  });
  const signers: Array<[Signer, string]> = [
    [witSigner1, W1_ID], [witSigner2, W2_ID], [witSigner3, W3_ID],
    [witSigner4, W4_ID], [witSigner5, W5_ID],
  ];
  const statements = [];
  for (const [signer, id] of signers) {
    for (const log of [LOG_X, LOG_Y, LOG_Z, LOG_W]) {
      statements.push(witnessStatement(signer, log.logId, log.root, log.treeSize, id));
    }
  }
  const result = verifyCrossLogConsistency(anchor1, anchor2, statements, 5, resolver);
  assert(result.consistent, "all 5 witnesses sign all 4 roots → consistent at threshold=5");
  eq(result.sharedWitnessIds.length, 5, "all five witnesses should be in the shared intersection");
  eq(
    JSON.stringify(result.sharedWitnessIds),
    JSON.stringify([W1_ID, W2_ID, W3_ID, W4_ID, W5_ID].slice().sort()),
    "shared set matches exactly, sorted",
  );
});

test("set-based intersection: shrinks correctly when different witnesses miss different endpoints", () => {
  // W1 signs all 4 roots. W2 misses LOG_W. W3 misses LOG_X. Only W1 is
  // shared across every endpoint — the intersection must narrow correctly
  // across multiple endpoint passes, each rebuilding its own lookup Set.
  const statements = [
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_W.logId, ROOT_W, LOG_W.treeSize, W1_ID),
    witnessStatement(witSigner2, LOG_X.logId, ROOT_X, LOG_X.treeSize, W2_ID),
    witnessStatement(witSigner2, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W2_ID),
    witnessStatement(witSigner2, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W2_ID),
    // W2 does NOT sign LOG_W
    witnessStatement(witSigner3, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W3_ID),
    witnessStatement(witSigner3, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W3_ID),
    witnessStatement(witSigner3, LOG_W.logId, ROOT_W, LOG_W.treeSize, W3_ID),
    // W3 does NOT sign LOG_X
  ];
  const result = verifyCrossLogConsistency(anchor1, anchor2, statements, 1, resolver123);
  eq(result.sharedWitnessIds.length, 1, "only W1 is shared across all four endpoints");
  eq(result.sharedWitnessIds[0], W1_ID);
});

test("set-based intersection: regression — duplicate witness statements for the same id don't break Set dedup", () => {
  // A witness id appearing in witnessIds for an endpoint is naturally a Set
  // member; nothing should change if the underlying quorum has redundant
  // internal bookkeeping. This pins that .has() on a freshly-built Set
  // behaves identically to the old .includes() scan for normal membership.
  const statements = [
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_W.logId, ROOT_W, LOG_W.treeSize, W1_ID),
  ];
  const result = verifyCrossLogConsistency(anchor1, anchor2, statements, 1, resolver123);
  assert(result.consistent, "single witness signing all roots is still consistent");
  eq(result.sharedWitnessIds.length, 1);
  eq(result.sharedWitnessIds[0], W1_ID);
});

test("sharedWitnessIds are sorted", () => {
  const anchor5 = buildFederationAnchor(fedSigner, "anchor-005", LOG_X, LOG_Y, NOW, "fed-key-A");
  const anchor6 = buildFederationAnchor(fedSigner, "anchor-006", LOG_X, LOG_Y, NOW, "fed-key-A");
  const statements = [
    witnessStatement(witSigner2, LOG_X.logId, ROOT_X, LOG_X.treeSize, W2_ID),
    witnessStatement(witSigner2, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W2_ID),
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
  ];
  const result = verifyCrossLogConsistency(anchor5, anchor6, statements, 1, resolver123);
  assert(result.consistent, "consistent");
  // sharedWitnessIds must be sorted
  const sorted = [...result.sharedWitnessIds].sort();
  eq(JSON.stringify(result.sharedWitnessIds), JSON.stringify(sorted), "sharedWitnessIds are sorted");
});

// ── Fail-closed: SplitViewError propagates ────────────────────────────────────

test("SplitViewError propagates when witness signs conflicting root for same position", () => {
  const ALT_ROOT_X = "e".repeat(64);
  const statements = [
    // W1 signs the correct ROOT_X
    witnessStatement(witSigner1, LOG_X.logId, ROOT_X, LOG_X.treeSize, W1_ID),
    // W2 signs a DIFFERENT root for the same (logId, treeSize) → split-view alarm
    witnessStatement(witSigner2, LOG_X.logId, ALT_ROOT_X, LOG_X.treeSize, W2_ID),
    witnessStatement(witSigner1, LOG_Y.logId, ROOT_Y, LOG_Y.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_Z.logId, ROOT_Z, LOG_Z.treeSize, W1_ID),
    witnessStatement(witSigner1, LOG_W.logId, ROOT_W, LOG_W.treeSize, W1_ID),
  ];

  let threw = false;
  try {
    verifyCrossLogConsistency(anchor1, anchor2, statements, 1, resolver123);
  } catch (e) {
    threw = true;
    assert(e instanceof SplitViewError, "throws SplitViewError");
    eq((e as SplitViewError).logId, LOG_X.logId, "SplitViewError carries logId");
  }
  assert(threw, "must propagate SplitViewError");
});

// ── Fail-closed: bad inputs ───────────────────────────────────────────────────

test("throws CrossLogConsistencyError on null anchor1", () => {
  let threw = false;
  try {
    verifyCrossLogConsistency(null as never, anchor2, [], 1, resolver123);
  } catch (e) {
    threw = true;
    assert(e instanceof CrossLogConsistencyError, "throws CrossLogConsistencyError");
    eq((e as CrossLogConsistencyError).code, "BAD_ANCHOR", "code is BAD_ANCHOR");
  }
  assert(threw, "must throw on null anchor1");
});

test("throws CrossLogConsistencyError on null anchor2", () => {
  let threw = false;
  try {
    verifyCrossLogConsistency(anchor1, null as never, [], 1, resolver123);
  } catch (e) {
    threw = true;
    assert(e instanceof CrossLogConsistencyError, "throws CrossLogConsistencyError");
    eq((e as CrossLogConsistencyError).code, "BAD_ANCHOR", "code is BAD_ANCHOR");
  }
  assert(threw, "must throw on null anchor2");
});

test("throws CrossLogConsistencyError on wrong version in anchor1", () => {
  const badAnchor = { ...anchor1, version: "tfa-federation-anchor-v0" as never };
  let threw = false;
  try {
    verifyCrossLogConsistency(badAnchor, anchor2, [], 1, resolver123);
  } catch (e) {
    threw = true;
    assert(e instanceof CrossLogConsistencyError, "throws CrossLogConsistencyError");
    eq((e as CrossLogConsistencyError).code, "BAD_ANCHOR", "code is BAD_ANCHOR");
  }
  assert(threw, "must throw on wrong version");
});

test("throws CrossLogConsistencyError if anchor2 has invalid root in logA", () => {
  const badAnchor2 = {
    ...anchor2,
    logA: { ...anchor2.logA, root: "not-a-valid-root" },
  };
  let threw = false;
  try {
    verifyCrossLogConsistency(anchor1, badAnchor2 as never, [], 1, resolver123);
  } catch (e) {
    threw = true;
    assert(e instanceof CrossLogConsistencyError, "throws CrossLogConsistencyError");
    eq((e as CrossLogConsistencyError).code, "BAD_ANCHOR", "code is BAD_ANCHOR");
  }
  assert(threw, "must throw on bad root in anchor2.logA");
});

test("throws CrossLogConsistencyError on non-array statements", () => {
  let threw = false;
  try {
    verifyCrossLogConsistency(anchor1, anchor2, "not-an-array" as never, 1, resolver123);
  } catch (e) {
    threw = true;
    assert(e instanceof CrossLogConsistencyError, "throws CrossLogConsistencyError");
    eq((e as CrossLogConsistencyError).code, "BAD_INPUT", "code is BAD_INPUT");
  }
  assert(threw, "must throw on non-array statements");
});

test("throws CrossLogConsistencyError on threshold = 0", () => {
  let threw = false;
  try {
    verifyCrossLogConsistency(anchor1, anchor2, [], 0, resolver123);
  } catch (e) {
    threw = true;
    assert(e instanceof CrossLogConsistencyError, "throws CrossLogConsistencyError");
    eq((e as CrossLogConsistencyError).code, "BAD_INPUT", "code is BAD_INPUT");
  }
  assert(threw, "must throw on threshold=0");
});

test("throws CrossLogConsistencyError on non-integer threshold", () => {
  let threw = false;
  try {
    verifyCrossLogConsistency(anchor1, anchor2, [], 1.5, resolver123);
  } catch (e) {
    threw = true;
    assert(e instanceof CrossLogConsistencyError, "throws CrossLogConsistencyError");
    eq((e as CrossLogConsistencyError).code, "BAD_INPUT", "code is BAD_INPUT");
  }
  assert(threw, "must throw on fractional threshold");
});

test("throws CrossLogConsistencyError on null resolveSigner", () => {
  let threw = false;
  try {
    verifyCrossLogConsistency(anchor1, anchor2, [], 1, null as never);
  } catch (e) {
    threw = true;
    assert(e instanceof CrossLogConsistencyError, "throws CrossLogConsistencyError");
    eq((e as CrossLogConsistencyError).code, "BAD_INPUT", "code is BAD_INPUT");
  }
  assert(threw, "must throw on null resolveSigner");
});

test("throws CrossLogConsistencyError if anchor2.logB has treeSize=0", () => {
  const badAnchor2 = {
    ...anchor2,
    logB: { ...anchor2.logB, treeSize: 0 },
  };
  let threw = false;
  try {
    verifyCrossLogConsistency(anchor1, badAnchor2 as never, [], 1, resolver123);
  } catch (e) {
    threw = true;
    assert(e instanceof CrossLogConsistencyError, "throws CrossLogConsistencyError");
    eq((e as CrossLogConsistencyError).code, "BAD_ANCHOR", "code is BAD_ANCHOR");
  }
  assert(threw, "must throw on treeSize=0 in anchor2.logB");
});
