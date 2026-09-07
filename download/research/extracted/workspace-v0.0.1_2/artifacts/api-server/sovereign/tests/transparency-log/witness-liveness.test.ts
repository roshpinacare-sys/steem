/**
 * tests/transparency-log/witness-liveness.test.ts — witness liveness/staleness (v405, §2.D-12).
 *
 * The property under test: a registered witness with no verified statement
 * inside the freshness window — including one that never signed at all, and
 * one whose only "evidence" is an unverified or future-dated statement —
 * is reported stale. Only a genuinely verified, past/now-dated statement
 * within the window counts as liveness.
 *
 * HAPPY        a witness with a recent verified statement is live; multiple
 *              registered witnesses each get their own correct status;
 *              the most recent of several statements from the same witness
 *              is the one used to compute age.
 * EDGE         zero registered witnesses → vacuously allLive; a witness
 *              exactly at the maxAgeMs boundary is live (<=, not <);
 *              one statement just over the boundary → stale; logId scoping
 *              ignores statements for a different log.
 * FAIL-CLOSED  a witness that never signed anything → stale, not live;
 *              an unverified (forged/wrong-key) statement does not count;
 *              a future-dated statement is ignored, not treated as fresh;
 *              invalid maxAgeMs (0, negative, NaN, missing) throws;
 *              non-array registeredWitnessIds/statements throws.
 */

import { test, assert, eq } from "../_harness.mjs";
import { HmacSigner } from "../../lib/orchestrator/signer.ts";
import { createHash } from "node:crypto";
import { signTreeHead, type TreeHeadObservation } from "../../lib/transparency-log/witness.ts";
import {
  checkWitnessLiveness,
  WitnessLivenessError,
} from "../../lib/transparency-log/witness-liveness.ts";
import { WitnessRegistry } from "../../lib/transparency-log/witness-registry.ts";

const root = (s: string): string => createHash("sha256").update(s).digest("hex");
const R1 = root("liveness-tree-1");

const wA = new HmacSigner("witness-A-secret-32chars-minimum!");
const wB = new HmacSigner("witness-B-secret-32chars-minimum!");
const wEvil = new HmacSigner("evil-impersonator-secret-32-chars!");

const NOW = new Date("2026-06-21T12:00:00.000Z");

function obs(witnessId: string, observedAt: string, logId = "log-1", treeSize = 1): TreeHeadObservation {
  return { logId, root: R1, treeSize, observedAt, witnessId };
}

function resolve(signers: Record<string, HmacSigner>) {
  return (witnessId: string) => signers[witnessId] ?? null;
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

test("HAPPY: a witness with a recent verified statement is live", () => {
  const st = signTreeHead(wA, obs("wA", "2026-06-21T11:59:00.000Z")); // 1 min ago
  const report = checkWitnessLiveness(["wA"], [st], resolve({ wA }), { maxAgeMs: 60_000 * 10, now: NOW });
  eq(report.allLive, true);
  eq(report.statuses[0].live, true);
  eq(report.statuses[0].witnessId, "wA");
  eq(report.staleWitnessIds.length, 0);
});

test("HAPPY: multiple registered witnesses each get their own correct status", () => {
  const stA = signTreeHead(wA, obs("wA", "2026-06-21T11:59:00.000Z")); // 1 min ago — fresh
  const stB = signTreeHead(wB, obs("wB", "2026-06-20T12:00:00.000Z")); // 24h ago — stale for a 1h window
  const report = checkWitnessLiveness(["wA", "wB"], [stA, stB], resolve({ wA, wB }), {
    maxAgeMs: 60 * 60 * 1000, // 1 hour
    now: NOW,
  });
  eq(report.allLive, false);
  eq(report.staleWitnessIds.join(","), "wB");
  const byId = Object.fromEntries(report.statuses.map((s) => [s.witnessId, s]));
  eq(byId.wA.live, true);
  eq(byId.wB.live, false);
});

test("HAPPY: the most recent of several statements from the same witness determines age", () => {
  const older = signTreeHead(wA, obs("wA", "2026-06-01T00:00:00.000Z", "log-1", 1));
  const newer = signTreeHead(wA, obs("wA", "2026-06-21T11:59:30.000Z", "log-1", 2));
  const report = checkWitnessLiveness(["wA"], [older, newer], resolve({ wA }), { maxAgeMs: 60_000, now: NOW });
  eq(report.statuses[0].lastTreeSize, 2, "should use the newer statement's treeSize");
  eq(report.statuses[0].live, true);
});

// ─── EDGE ────────────────────────────────────────────────────────────────────

test("EDGE: zero registered witnesses is vacuously allLive", () => {
  const report = checkWitnessLiveness([], [], resolve({}), { maxAgeMs: 1000, now: NOW });
  eq(report.statuses.length, 0);
  eq(report.allLive, true);
});

test("EDGE: a statement exactly at the maxAgeMs boundary is live (<=, not <)", () => {
  const st = signTreeHead(wA, obs("wA", "2026-06-21T11:59:00.000Z")); // exactly 60_000ms before NOW
  const report = checkWitnessLiveness(["wA"], [st], resolve({ wA }), { maxAgeMs: 60_000, now: NOW });
  eq(report.statuses[0].ageMs, 60_000);
  eq(report.statuses[0].live, true, "age === maxAgeMs must still count as live");
});

test("EDGE: a statement just over the boundary is stale", () => {
  const st = signTreeHead(wA, obs("wA", "2026-06-21T11:58:59.999Z")); // 60_001ms before NOW
  const report = checkWitnessLiveness(["wA"], [st], resolve({ wA }), { maxAgeMs: 60_000, now: NOW });
  eq(report.statuses[0].live, false);
});

test("EDGE: logId scoping ignores statements for a different log", () => {
  const st = signTreeHead(wA, obs("wA", "2026-06-21T11:59:00.000Z", "other-log"));
  const report = checkWitnessLiveness(["wA"], [st], resolve({ wA }), { maxAgeMs: 60_000, now: NOW, logId: "log-1" });
  eq(report.statuses[0].live, false, "statement is for a different logId, must not count");
  eq(report.statuses[0].lastObservedAt, null);
});

// ─── FAIL-CLOSED ─────────────────────────────────────────────────────────────

test("FAIL-CLOSED: a registered witness that never signed anything is stale, not live", () => {
  const report = checkWitnessLiveness(["wA"], [], resolve({ wA }), { maxAgeMs: 60_000, now: NOW });
  eq(report.statuses[0].live, false);
  eq(report.statuses[0].lastObservedAt, null);
  eq(report.statuses[0].ageMs, null);
  eq(report.staleWitnessIds.join(","), "wA");
});

test("FAIL-CLOSED: an unverified statement (wrong key / impersonation) does not count toward liveness", () => {
  const forged = signTreeHead(wEvil, obs("wA", "2026-06-21T11:59:00.000Z")); // claims to be wA, signed by wEvil
  const report = checkWitnessLiveness(["wA"], [forged], resolve({ wA }), { maxAgeMs: 60_000, now: NOW });
  eq(report.statuses[0].live, false, "an unverified statement must not prove liveness");
});

test("FAIL-CLOSED: a future-dated statement is ignored, never treated as proof of freshness", () => {
  const fromTheFuture = signTreeHead(wA, obs("wA", "2026-06-21T13:00:00.000Z")); // 1h after NOW
  const report = checkWitnessLiveness(["wA"], [fromTheFuture], resolve({ wA }), { maxAgeMs: 60_000 * 60 * 24, now: NOW });
  eq(report.statuses[0].live, false, "a future timestamp must not count as a verified-fresh observation");
  eq(report.statuses[0].lastObservedAt, null);
});

test("FAIL-CLOSED: invalid maxAgeMs (0, negative, NaN, missing) throws WitnessLivenessError", () => {
  let threw0 = false, threwNeg = false, threwNaN = false, threwMissing = false;
  try { checkWitnessLiveness(["wA"], [], resolve({ wA }), { maxAgeMs: 0, now: NOW }); } catch (e) { threw0 = e instanceof WitnessLivenessError; }
  try { checkWitnessLiveness(["wA"], [], resolve({ wA }), { maxAgeMs: -1000, now: NOW }); } catch (e) { threwNeg = e instanceof WitnessLivenessError; }
  try { checkWitnessLiveness(["wA"], [], resolve({ wA }), { maxAgeMs: NaN, now: NOW }); } catch (e) { threwNaN = e instanceof WitnessLivenessError; }
  try { checkWitnessLiveness(["wA"], [], resolve({ wA }), {} as any); } catch (e) { threwMissing = e instanceof WitnessLivenessError; }
  assert(threw0 && threwNeg && threwNaN && threwMissing, "every invalid maxAgeMs must throw, never silently default");
});

test("FAIL-CLOSED: non-array registeredWitnessIds/statements throws WitnessLivenessError", () => {
  let threw1 = false, threw2 = false, threw3 = false;
  try { checkWitnessLiveness("wA" as any, [], resolve({ wA }), { maxAgeMs: 1000 }); } catch (e) { threw1 = e instanceof WitnessLivenessError; }
  try { checkWitnessLiveness(["wA"], "not-an-array" as any, resolve({ wA }), { maxAgeMs: 1000 }); } catch (e) { threw2 = e instanceof WitnessLivenessError; }
  try { checkWitnessLiveness(["wA"], [], null as any, { maxAgeMs: 1000 }); } catch (e) { threw3 = e instanceof WitnessLivenessError; }
  assert(threw1 && threw2 && threw3, "malformed inputs must throw, never run with undefined behaviour");
});

// ─── WitnessRegistry.checkLiveness() integration ────────────────────────────

test("INTEGRATION: WitnessRegistry.checkLiveness() wires registered witnesses + stored statements", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  reg.registerWitness("t1", "wB", wB);
  reg.signAndSubmit("t1", wA, obs("wA", "2026-06-21T11:59:30.000Z"));
  // wB never submits anything.
  const report = reg.checkLiveness("t1", { maxAgeMs: 60_000, now: NOW });
  eq(report.allLive, false);
  eq(report.staleWitnessIds.join(","), "wB");
});

test("INTEGRATION: WitnessRegistry.checkLiveness() is tenant-isolated", () => {
  const reg = new WitnessRegistry();
  reg.registerWitness("t1", "wA", wA);
  reg.registerWitness("t2", "wA", wA);
  reg.signAndSubmit("t1", wA, obs("wA", "2026-06-21T11:59:30.000Z"));
  // t2's wA never submits, even though t1's wA (same key) did.
  const reportT1 = reg.checkLiveness("t1", { maxAgeMs: 60_000, now: NOW });
  const reportT2 = reg.checkLiveness("t2", { maxAgeMs: 60_000, now: NOW });
  eq(reportT1.allLive, true);
  eq(reportT2.allLive, false, "t2's own witness never submitted to t2, regardless of t1's activity");
});

// ─── efficiency/single-pass-stale-accumulation ──────────────────────────────
// Regression for replacing statuses.filter((s) => !s.live).map((s) => s.witnessId)
// (two extra full scans of `statuses`, after the map() that built it) with a
// single loop that builds each status and pushes into staleWitnessIds in the
// same pass. staleWitnessIds must remain exactly the witnessIds whose status
// is not live — same membership, same derivation from `statuses` — just
// computed in one pass instead of three.

test("efficiency: staleWitnessIds contains exactly the non-live witnesses in a large mixed set", () => {
  const signers: Record<string, HmacSigner> = {};
  const ids: string[] = [];
  const statements: ReturnType<typeof signTreeHead>[] = [];

  // 30 live witnesses (signed 1 min ago), 20 stale (never signed).
  for (let i = 0; i < 30; i++) {
    const id = `live-${i}`;
    ids.push(id);
    const signer = new HmacSigner(`live-secret-${i}-32-chars-minimum!!`);
    signers[id] = signer;
    statements.push(signTreeHead(signer, obs(id, "2026-06-21T11:59:00.000Z")));
  }
  for (let i = 0; i < 20; i++) {
    const id = `stale-${i}`;
    ids.push(id);
    signers[id] = new HmacSigner(`stale-secret-${i}-32-chars-minimum!`);
    // no statement submitted for this witness
  }

  const report = checkWitnessLiveness(ids, statements, resolve(signers), { maxAgeMs: 60_000 * 10, now: NOW });

  // staleWitnessIds must match exactly the set derived independently from statuses.
  const expectedStale = new Set(report.statuses.filter((s) => !s.live).map((s) => s.witnessId));
  eq(report.staleWitnessIds.length, expectedStale.size);
  for (const id of report.staleWitnessIds) {
    assert(expectedStale.has(id), `staleWitnessIds entry "${id}" must correspond to a non-live status`);
  }
  eq(report.staleWitnessIds.length, 20);
  eq(report.allLive, false);
});

test("efficiency: staleWitnessIds preserves the sorted dedup order of registeredWitnessIds, not statement order", () => {
  // Deliberately register in non-alphabetical order with duplicates; the
  // function internally dedupes+sorts before building statuses, so the
  // stale list (a sub-sequence of statuses) must follow that same order.
  const ids = ["wZ", "wA", "wZ", "wM"];
  // None of them ever sign — all three distinct ids end up stale.
  const report = checkWitnessLiveness(ids, [], resolve({}), { maxAgeMs: 60_000, now: NOW });
  eq(report.staleWitnessIds.join(","), "wA,wM,wZ", "stale order follows sorted-dedup order of statuses, not input order");
});

test("efficiency: all-live set produces an empty staleWitnessIds without a spurious entry", () => {
  const st = signTreeHead(wA, obs("wA", "2026-06-21T11:59:00.000Z"));
  const st2 = signTreeHead(wB, obs("wB", "2026-06-21T11:59:30.000Z"));
  const report = checkWitnessLiveness(["wA", "wB"], [st, st2], resolve({ wA, wB }), { maxAgeMs: 60_000 * 10, now: NOW });
  eq(report.allLive, true);
  eq(report.staleWitnessIds.length, 0);
  eq(report.statuses.length, 2, "both witnesses still appear in statuses even though none is stale");
});
