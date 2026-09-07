/**
 * tests/potential/collaboration-matcher.test.ts
 *
 * Covers CollaborationMatcher.match():
 *   - happy path: complementary + shared strengths produce a sensible match
 *   - efficiency/max-find: the top complementary pair (used in synergyReason)
 *     is found correctly even when the true max delta is "buried" in the
 *     middle of insertion order — regression for the sort()->single-pass
 *     max-find refactor in buildSynergyReason.
 *   - fail-closed: a candidate from a different tenantId throws rather than
 *     silently being included or dropped.
 */

import { CollaborationMatcher } from "../../lib/potential/collaboration-matcher.ts";
import type { StrengthProfile, UserStrength } from "../../lib/potential/types.ts";
import type { CollaborationInput } from "../../lib/potential/personality-types.ts";

let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${msg}`);
  }
}

function strength(category: string, score: number): UserStrength {
  return { category, score, confidence: 1, evidence: ["test"] };
}

function profile(userId: string, tenantId: string, strengths: UserStrength[]): StrengthProfile {
  return { userId, tenantId, strengths, analyzedAt: new Date().toISOString() };
}

// ── Happy path ────────────────────────────────────────────────────────────
{
  const matcher = new CollaborationMatcher();

  const userProfile = profile("alice", "t1", [
    strength("technical", 90),
    strength("leadership", 20),
    strength("design", 60),
  ]);

  const candidateProfile = profile("bob", "t1", [
    strength("technical", 25),   // complementary: alice strong, bob weak (delta 65)
    strength("leadership", 85),  // complementary: bob strong, alice weak (delta 65)
    strength("design", 70),      // shared: both >= 50
  ]);

  const input: CollaborationInput = {
    tenantId: "t1",
    userId: "alice",
    userProfile,
    candidates: [{ userId: "bob", profile: candidateProfile }],
    minCompatibility: 0,
  };

  const results = matcher.match(input);

  assert(results.length === 1, "happy path: one match returned for one candidate");
  const m = results[0];
  assert(m.userA === "alice" && m.userB === "bob", "happy path: match references correct users");
  assert(m.sharedStrengths.includes("design"), "happy path: design recognized as shared strength");
  assert(m.complementaryStrengths.length === 2, "happy path: two complementary categories found");
  assert(m.synergyReason.length > 0 && m.synergyReason.endsWith("."), "happy path: synergyReason is a non-empty sentence");
  assert(m.compatibilityScore > 0, "happy path: compatibilityScore is positive");
}

// ── Edge case: true max delta buried mid-list (max-find regression) ───────
{
  const matcher = new CollaborationMatcher();

  // Insertion order deliberately puts a small delta first, the TRUE max
  // delta in the middle, and another small delta last — exercising the
  // single-pass max-find rather than relying on array order or [0].
  const userProfile = profile("alice", "t1", [
    strength("catA", 55), // delta vs bob's 30 = 25 (complementary, small)
    strength("catB", 99), // delta vs bob's 1  = 98 (complementary, TRUE MAX)
    strength("catC", 50), // delta vs bob's 28 = 22 (complementary, small)
  ]);

  const candidateProfile = profile("bob", "t1", [
    strength("catA", 30),
    strength("catB", 1),
    strength("catC", 28),
  ]);

  const input: CollaborationInput = {
    tenantId: "t1",
    userId: "alice",
    userProfile,
    candidates: [{ userId: "bob", profile: candidateProfile }],
    minCompatibility: 0,
  };

  const results = matcher.match(input);
  assert(results.length === 1, "buried-max: one match returned");
  const m = results[0];

  // The synergy reason text is built from the single max-delta entry — it
  // must reference catB (delta 98), not catA or catC, even though catB sits
  // in the middle of insertion order.
  assert(
    m.synergyReason.includes("catB") && m.synergyReason.includes("Δ98"),
    `buried-max: synergyReason references the true max-delta category (catB, Δ98); got: "${m.synergyReason}"`,
  );
  assert(
    !m.synergyReason.includes("catA strength") && !m.synergyReason.includes("catC strength"),
    `buried-max: synergyReason does not reference a smaller-delta category as the top pair; got: "${m.synergyReason}"`,
  );
}

// ── Fail-closed: cross-tenant candidate must throw, never silently pass ───
{
  const matcher = new CollaborationMatcher();

  const userProfile = profile("alice", "t1", [strength("technical", 90)]);
  const wrongTenantCandidate = profile("eve", "t2", [strength("technical", 10)]);

  const input: CollaborationInput = {
    tenantId: "t1",
    userId: "alice",
    userProfile,
    candidates: [{ userId: "eve", profile: wrongTenantCandidate }],
  };

  let threw = false;
  try {
    matcher.match(input);
  } catch (err) {
    threw = true;
    assert(
      err instanceof Error && err.message.includes("Tenant isolation violation"),
      "fail-closed: error message identifies tenant isolation violation",
    );
  }
  assert(threw, "fail-closed: cross-tenant candidate throws rather than being silently included or dropped");
}

console.log(`Passed: ${pass} / Failed: ${fail}`);
if (fail > 0) process.exit(1);
