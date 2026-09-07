/**
 * tests/transparency-log/witness.test.ts — witness co-signing for the log.
 *
 * The property under test: independent witnesses co-sign a tree head; a quorum
 * of DISTINCT witnesses over the SAME root is trustworthy, and a verified
 * witness signing a DIFFERENT root at the same position raises a split-view alarm.
 *
 * HAPPY        sign → verify round-trips; quorum of distinct witnesses reached.
 * EDGE         duplicate witnessId counts once; unknown witness ignored;
 *              statements about other log positions ignored; threshold boundary.
 * FAIL-CLOSED  wrong key → not verified; tampered field → not verified;
 *              conflicting roots → SplitViewError; invalid observation → throw;
 *              bad threshold/target → throw.
 */

import { test, assert, eq } from "../_harness.mjs";
import { createHash } from "node:crypto";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import {
  signTreeHead,
  verifyWitnessStatement,
  collectWitnessQuorum,
  witnessSigningPayload,
  SplitViewError,
  WitnessError,
  WITNESS_STATEMENT_VERSION,
  type WitnessStatement,
  type TreeHeadObservation,
} from "../../lib/transparency-log/witness.ts";

const root = (s: string): string => createHash("sha256").update(s).digest("hex");

const R8 = root("tree-at-8");
const wA = new HmacSigner("witness-A-secret-32chars-minimum!");
const wB = new HmacSigner("witness-B-secret-32chars-minimum!");
const wC = new HmacSigner("witness-C-secret-32chars-minimum!");

function obs(witnessId: string, r = R8, treeSize = 8): TreeHeadObservation {
  return { logId: "tenant-a", root: r, treeSize, observedAt: "2026-06-20T00:00:00.000Z", witnessId };
}

function resolver(map: Record<string, HmacSigner>) {
  return (id: string) => map[id] ?? null;
}

// ─── HAPPY: sign → verify round-trip ───────────────────────────────────────────

test("HAPPY: a witness statement verifies against its own signer", () => {
  const st = signTreeHead(wA, obs("wA"));
  eq(st.version, WITNESS_STATEMENT_VERSION);
  eq(st.algorithm, wA.algorithm);
  assert(verifyWitnessStatement(st, wA), "statement verifies against signer A");
});

test("HAPPY: quorum of two distinct witnesses over the same root is reached", () => {
  const sts = [signTreeHead(wA, obs("wA")), signTreeHead(wB, obs("wB"))];
  const res = collectWitnessQuorum(sts, { logId: "tenant-a", root: R8, treeSize: 8 }, 2, resolver({ wA, wB }));
  assert(res.reached, "2 distinct witnesses meet threshold 2");
  eq(res.distinctWitnesses, 2);
  eq(res.witnessIds.join(","), "wA,wB");
});

// ─── EDGE: dedup, unknown, off-position, threshold boundary ────────────────────

test("EDGE: the same witnessId signing twice counts once", () => {
  const sts = [signTreeHead(wA, obs("wA")), signTreeHead(wA, obs("wA"))];
  const res = collectWitnessQuorum(sts, { logId: "tenant-a", root: R8, treeSize: 8 }, 2, resolver({ wA }));
  eq(res.distinctWitnesses, 1, "duplicate witness counts once");
  assert(!res.reached, "one witness cannot meet threshold 2");
});

test("EDGE: unknown witness (no resolver entry) is ignored", () => {
  const sts = [signTreeHead(wA, obs("wA")), signTreeHead(wB, obs("wB"))];
  // resolver only knows wA → wB ignored.
  const res = collectWitnessQuorum(sts, { logId: "tenant-a", root: R8, treeSize: 8 }, 1, resolver({ wA }));
  eq(res.distinctWitnesses, 1, "only wA counted");
  assert(res.reached, "threshold 1 met by wA alone");
});

test("EDGE: statements about a different log position are ignored", () => {
  const sts = [
    signTreeHead(wA, obs("wA")),
    signTreeHead(wB, obs("wB", root("tree-at-9"), 9)), // different size → irrelevant
  ];
  const res = collectWitnessQuorum(sts, { logId: "tenant-a", root: R8, treeSize: 8 }, 1, resolver({ wA, wB }));
  eq(res.distinctWitnesses, 1, "off-position statement ignored");
});

test("EDGE: threshold exactly met vs just missed", () => {
  const sts = [signTreeHead(wA, obs("wA")), signTreeHead(wB, obs("wB")), signTreeHead(wC, obs("wC"))];
  const r = resolver({ wA, wB, wC });
  assert(collectWitnessQuorum(sts, { logId: "tenant-a", root: R8, treeSize: 8 }, 3, r).reached, "3/3 met");
  assert(!collectWitnessQuorum([sts[0]], { logId: "tenant-a", root: R8, treeSize: 8 }, 2, r).reached, "1<2 missed");
});

// ─── FAIL-CLOSED: verification ─────────────────────────────────────────────────

test("FAIL-CLOSED: a statement does not verify against the wrong key", () => {
  const st = signTreeHead(wA, obs("wA"));
  assert(!verifyWitnessStatement(st, wB), "signer B must not verify A's statement");
});

test("FAIL-CLOSED: tampering with any signed field breaks verification", () => {
  const st = signTreeHead(wA, obs("wA"));
  const tampered: WitnessStatement = { ...st, root: root("evil") };
  assert(!verifyWitnessStatement(tampered, wA), "tampered root fails");
  const tampered2: WitnessStatement = { ...st, treeSize: 9 };
  assert(!verifyWitnessStatement(tampered2, wA), "tampered treeSize fails");
});

test("FAIL-CLOSED: wrong version is rejected", () => {
  const st = signTreeHead(wA, obs("wA"));
  const bad = { ...st, version: "tfa-witness-v0" } as unknown as WitnessStatement;
  assert(!verifyWitnessStatement(bad, wA), "version mismatch fails");
});

// ─── FAIL-CLOSED: the split-view alarm (the whole point) ───────────────────────

test("FAIL-CLOSED: conflicting roots at the same position raise SplitViewError", () => {
  const honest = signTreeHead(wA, obs("wA"));
  const fork = signTreeHead(wB, obs("wB", root("FORKED-HISTORY"), 8)); // same size, different root
  let caught: unknown = null;
  try {
    collectWitnessQuorum([honest, fork], { logId: "tenant-a", root: R8, treeSize: 8 }, 1, resolver({ wA, wB }));
  } catch (e) {
    caught = e;
  }
  assert(caught instanceof SplitViewError, "split-view must throw SplitViewError");
  assert((caught as SplitViewError).roots.length >= 2, "alarm names the conflicting roots");
  eq((caught as SplitViewError).treeSize, 8);
});

test("FAIL-CLOSED: a forged conflicting statement that fails to verify does NOT alarm", () => {
  // wB's statement claims a fork root but is 'signed' by an unknown/forged key.
  const honest = signTreeHead(wA, obs("wA"));
  const forged: WitnessStatement = {
    ...signTreeHead(wB, obs("wB", root("FORKED"), 8)),
    signature: "Zm9yZ2VkLXNpZ25hdHVyZQ==", // garbage
  };
  // resolver returns wB, but the signature won't verify → ignored, no alarm, no count.
  const res = collectWitnessQuorum([honest, forged], { logId: "tenant-a", root: R8, treeSize: 8 }, 1, resolver({ wA, wB }));
  assert(res.reached, "honest witness still forms quorum");
  eq(res.distinctWitnesses, 1, "forged conflicting statement ignored, not alarmed");
});

// ─── FAIL-CLOSED: input validation ─────────────────────────────────────────────

test("FAIL-CLOSED: signTreeHead rejects an invalid observation", () => {
  let a = false, b = false;
  try { signTreeHead(wA, obs("wA", "not-a-hex-root")); } catch (e) { a = e instanceof WitnessError; }
  try { signTreeHead(wA, { ...obs("wA"), treeSize: 0 }); } catch (e) { b = e instanceof WitnessError; }
  assert(a, "non-hex root throws");
  assert(b, "treeSize 0 throws");
});

test("FAIL-CLOSED: collectWitnessQuorum rejects bad threshold and target", () => {
  const r = resolver({ wA });
  let a = false, b = false, c = false;
  try { collectWitnessQuorum([], { logId: "t", root: R8, treeSize: 8 }, 0, r); } catch (e) { a = e instanceof WitnessError; }
  try { collectWitnessQuorum([], { logId: "t", root: "bad", treeSize: 8 }, 1, r); } catch (e) { b = e instanceof WitnessError; }
  try { collectWitnessQuorum(null as any, { logId: "t", root: R8, treeSize: 8 }, 1, r); } catch (e) { c = e instanceof WitnessError; }
  assert(a, "threshold 0 throws");
  assert(b, "invalid target root throws");
  assert(c, "non-array statements throws");
});

test("payload is deterministic regardless of object key order", () => {
  const p1 = witnessSigningPayload({ logId: "t", root: R8, treeSize: 8, observedAt: "z", witnessId: "w" });
  const p2 = witnessSigningPayload({ witnessId: "w", observedAt: "z", treeSize: 8, root: R8, logId: "t" } as TreeHeadObservation);
  eq(p1, p2, "canonical payload is order-independent");
});
