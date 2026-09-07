import "../_flush.mjs";
/**
 * tests/potential/personality-mapping.test.ts — PersonalityMapper, SuccessPathRouter,
 * CollaborationMatcher full test suite.
 *
 * Coverage:
 *   PersonalityMapper
 *     • empty signals → all traits 0, all confidence 0
 *     • KG signal with known nodeType → correct trait accumulation
 *     • analytics signal with known eventType → correct trait
 *     • tenant isolation: wrong-tenant signals discarded
 *     • user isolation: wrong-user signals discarded
 *     • unknown nodeType → infer from category heuristic
 *     • weight clamped: weight > 1 treated as 1
 *     • multiple signals same trait → averaged score
 *     • confidence saturates at 1 after 5 signals
 *     • evidence list populated correctly
 *     • custom traitMap overrides default
 *
 *   SuccessPathRouter
 *     • target not found → throws
 *     • tenant isolation violation → throws
 *     • no gaps → empty steps, projectedFitScore = currentFitScore
 *     • single gap → one step, correct expectedGain and difficulty
 *     • large gap (≥60) → difficulty 5
 *     • small gap (<10) → difficulty 1
 *     • steps sorted: largest gap first
 *     • projectedFitScore increases after steps
 *     • projectedFitScore capped at 100
 *     • totalHours = sum of step hours
 *
 *   CollaborationMatcher
 *     • candidate from different tenant → throws
 *     • empty candidates → empty results
 *     • self-match → skipped
 *     • no complementary, no shared → low compatibilityScore (filtered by minCompatibility)
 *     • perfect complement → high compatibilityScore
 *     • minCompatibility filter works
 *     • results sorted by compatibilityScore descending
 *     • shared strengths identified correctly
 *     • complementary strengths: strongUser / weakUser correct
 *     • synergyReason is non-empty string
 *     • tenant isolation on profile.tenantId
 */

import { test, assert, eq } from "../_harness.mjs";
import { PersonalityMapper, DEFAULT_TRAIT_MAP } from "../../lib/potential/personality-mapper.ts";
import { SuccessPathRouter } from "../../lib/potential/success-path-router.ts";
import { CollaborationMatcher } from "../../lib/potential/collaboration-matcher.ts";
import type { AnalysisInput, StrengthProfile, Opportunity } from "../../lib/potential/types.ts";
import type { SuccessPathInput, CollaborationInput } from "../../lib/potential/personality-types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
    knowledgeSignals: [],
    analyticsSignals: [],
    ...overrides,
  };
}

function makeProfile(
  userId: string,
  tenantId: string,
  strengths: Array<{ category: string; score: number }> = [],
): StrengthProfile {
  return {
    userId,
    tenantId,
    strengths: strengths.map((s) => ({
      category: s.category,
      score: s.score,
      confidence: 0.8,
      evidence: [],
    })),
    analyzedAt: new Date().toISOString(),
  };
}

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    tenantId: "tenant-1",
    title: "Test Opportunity",
    description: "Test",
    requiredStrengths: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PersonalityMapper
// ═══════════════════════════════════════════════════════════════════════════════

test("PersonalityMapper: empty signals → all traits 0, confidence 0", () => {
  const mapper = new PersonalityMapper();
  const profile = mapper.map(makeInput());
  eq(profile.traits.extroversion, 0);
  eq(profile.traits.focus, 0);
  eq(profile.traits.collaboration, 0);
  eq(profile.traits.creativity, 0);
  eq(profile.traits.leadership, 0);
  eq(profile.confidence.focus, 0);
  eq(profile.evidence.length, 0);
  eq(profile.userId, "user-1");
  eq(profile.tenantId, "tenant-1");
});

test("PersonalityMapper: KG signal 'mentorship' → leadership + extroversion", () => {
  const mapper = new PersonalityMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{
      userId: "user-1", tenantId: "tenant-1",
      nodeType: "mentorship", category: "leadership", weight: 1.0,
    }],
  }));
  // mentorship → leadership:0.8, extroversion:0.4
  // leadership: 1.0 * 0.8 * 100 = 80 (single signal, avg = 80)
  // extroversion: 1.0 * 0.4 * 100 = 40
  eq(profile.traits.leadership, 80);
  eq(profile.traits.extroversion, 40);
  eq(profile.traits.focus, 0);
});

test("PersonalityMapper: analytics signal 'deep.work.session' → focus:90", () => {
  const mapper = new PersonalityMapper();
  const profile = mapper.map(makeInput({
    analyticsSignals: [{
      userId: "user-1", tenantId: "tenant-1",
      eventType: "deep.work.session", category: "focus", value: 1.0,
    }],
  }));
  eq(profile.traits.focus, 90); // 1.0 * 0.9 * 100 = 90
  eq(profile.traits.collaboration, 0);
});

test("PersonalityMapper: tenant isolation — wrong-tenant signals discarded", () => {
  const mapper = new PersonalityMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{
      userId: "user-1", tenantId: "tenant-WRONG",
      nodeType: "mentorship", category: "leadership", weight: 1.0,
    }],
  }));
  eq(profile.traits.leadership, 0, "wrong-tenant signal must be discarded");
});

test("PersonalityMapper: user isolation — wrong-user signals discarded", () => {
  const mapper = new PersonalityMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{
      userId: "user-WRONG", tenantId: "tenant-1",
      nodeType: "mentorship", category: "leadership", weight: 1.0,
    }],
  }));
  eq(profile.traits.leadership, 0, "wrong-user signal must be discarded");
});

test("PersonalityMapper: unknown nodeType → infer from category heuristic", () => {
  const mapper = new PersonalityMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{
      userId: "user-1", tenantId: "tenant-1",
      nodeType: "unknown-node-xyz", category: "leadership-role", weight: 1.0,
    }],
  }));
  // "leadership-role" matches /lead/ → trait = "leadership", weight=0.2 → score = 20
  eq(profile.traits.leadership, 20);
});

test("PersonalityMapper: weight > 1 is clamped to 1", () => {
  const mapper = new PersonalityMapper();
  const profile = mapper.map(makeInput({
    analyticsSignals: [{
      userId: "user-1", tenantId: "tenant-1",
      eventType: "deep.work.session", category: "focus", value: 99.0, // over 1
    }],
  }));
  // clamped to 1.0 → 1.0 * 0.9 * 100 = 90
  eq(profile.traits.focus, 90);
});

test("PersonalityMapper: multiple signals same trait → averaged", () => {
  const mapper = new PersonalityMapper();
  const profile = mapper.map(makeInput({
    analyticsSignals: [
      { userId: "user-1", tenantId: "tenant-1", eventType: "deep.work.session", category: "focus", value: 1.0 }, // 90
      { userId: "user-1", tenantId: "tenant-1", eventType: "deep.work.session", category: "focus", value: 0.5 }, // 45
    ],
  }));
  // avg = (90 + 45) / 2 = 67.5, Math.round → 68
  eq(profile.traits.focus, 68);
});

test("PersonalityMapper: confidence saturates at 1 after 5 signals for that trait", () => {
  const mapper = new PersonalityMapper();
  const signals = Array.from({ length: 5 }, () => ({
    userId: "user-1", tenantId: "tenant-1",
    eventType: "deep.work.session", category: "focus", value: 1.0,
  }));
  const profile = mapper.map(makeInput({ analyticsSignals: signals }));
  eq(profile.confidence.focus, 1);
});

test("PersonalityMapper: evidence list populated with source and trait", () => {
  const mapper = new PersonalityMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{
      userId: "user-1", tenantId: "tenant-1",
      nodeType: "talk", category: "leadership", weight: 1.0,
    }],
  }));
  // "talk" → extroversion:0.8, leadership:0.5 = 2 evidence entries
  eq(profile.evidence.length, 2);
  const traits = profile.evidence.map((e) => e.trait);
  assert(traits.includes("extroversion"), "should have extroversion evidence");
  assert(traits.includes("leadership"), "should have leadership evidence");
});

test("PersonalityMapper: custom traitMap overrides default", () => {
  const customMap = {
    "custom-node": [{ trait: "creativity" as const, weight: 1.0 }],
  };
  const mapper = new PersonalityMapper(customMap);
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{
      userId: "user-1", tenantId: "tenant-1",
      nodeType: "custom-node", category: "creative", weight: 1.0,
    }],
  }));
  eq(profile.traits.creativity, 100);
  eq(profile.traits.focus, 0); // "skill" not in custom map → not processed
});

// ═══════════════════════════════════════════════════════════════════════════════
// SuccessPathRouter
// ═══════════════════════════════════════════════════════════════════════════════

test("SuccessPathRouter: target not found → throws", () => {
  const router = new SuccessPathRouter();
  const input: SuccessPathInput = {
    userId: "user-1", tenantId: "tenant-1",
    profile: makeProfile("user-1", "tenant-1"),
    targetOpportunityId: "nonexistent",
    gaps: [],
  };
  let threw = false;
  try { router.plan(input, []); } catch { threw = true; }
  assert(threw, "should throw for missing opportunity");
});

test("SuccessPathRouter: tenant isolation violation → throws", () => {
  const router = new SuccessPathRouter();
  const wrongTenantOpp = makeOpp({ id: "opp-1", tenantId: "tenant-OTHER" });
  const input: SuccessPathInput = {
    userId: "user-1", tenantId: "tenant-1",
    profile: makeProfile("user-1", "tenant-1"),
    targetOpportunityId: "opp-1",
    gaps: [],
  };
  let threw = false;
  try { router.plan(input, [wrongTenantOpp]); } catch { threw = true; }
  assert(threw, "should throw on tenant mismatch");
});

test("SuccessPathRouter: no gaps → empty steps, projectedFitScore = currentFitScore", () => {
  const router = new SuccessPathRouter();
  const opp = makeOpp({ requiredStrengths: [{ category: "technical", minScore: 50 }] });
  const profile = makeProfile("user-1", "tenant-1", [{ category: "technical", score: 80 }]);
  const input: SuccessPathInput = {
    userId: "user-1", tenantId: "tenant-1",
    profile, targetOpportunityId: "opp-1", gaps: [],
  };
  const path = router.plan(input, [opp]);
  eq(path.steps.length, 0);
  eq(path.totalHours, 0);
  eq(path.projectedFitScore, path.currentFitScore);
  eq(path.userId, "user-1");
  eq(path.tenantId, "tenant-1");
});

test("SuccessPathRouter: single gap → one step, correct category", () => {
  const router = new SuccessPathRouter();
  const opp = makeOpp({ requiredStrengths: [{ category: "leadership", minScore: 70 }] });
  const profile = makeProfile("user-1", "tenant-1", [{ category: "leadership", score: 40 }]);
  const input: SuccessPathInput = {
    userId: "user-1", tenantId: "tenant-1",
    profile, targetOpportunityId: "opp-1",
    gaps: [{ category: "leadership", gap: 30 }],
  };
  const path = router.plan(input, [opp]);
  eq(path.steps.length, 1);
  eq(path.steps[0].targetCategory, "leadership");
  eq(path.steps[0].expectedGain, 30); // min(gap=30, 30) = 30
});

test("SuccessPathRouter: large gap ≥ 60 → difficulty 5", () => {
  const router = new SuccessPathRouter();
  const opp = makeOpp({ requiredStrengths: [{ category: "technical", minScore: 100 }] });
  const profile = makeProfile("user-1", "tenant-1", [{ category: "technical", score: 10 }]);
  const input: SuccessPathInput = {
    userId: "user-1", tenantId: "tenant-1",
    profile, targetOpportunityId: "opp-1",
    gaps: [{ category: "technical", gap: 70 }],
  };
  const path = router.plan(input, [opp]);
  eq(path.steps[0].difficulty, 5);
});

test("SuccessPathRouter: small gap < 10 → difficulty 1", () => {
  const router = new SuccessPathRouter();
  const opp = makeOpp({ requiredStrengths: [{ category: "technical", minScore: 55 }] });
  const profile = makeProfile("user-1", "tenant-1", [{ category: "technical", score: 50 }]);
  const input: SuccessPathInput = {
    userId: "user-1", tenantId: "tenant-1",
    profile, targetOpportunityId: "opp-1",
    gaps: [{ category: "technical", gap: 5 }],
  };
  const path = router.plan(input, [opp]);
  eq(path.steps[0].difficulty, 1);
});

test("SuccessPathRouter: steps sorted — largest gap first", () => {
  const router = new SuccessPathRouter();
  const opp = makeOpp({
    requiredStrengths: [
      { category: "leadership", minScore: 80 },
      { category: "technical", minScore: 70 },
    ],
  });
  const profile = makeProfile("user-1", "tenant-1", [
    { category: "leadership", score: 30 }, // gap 50
    { category: "technical", score: 50 },  // gap 20
  ]);
  const input: SuccessPathInput = {
    userId: "user-1", tenantId: "tenant-1",
    profile, targetOpportunityId: "opp-1",
    gaps: [
      { category: "technical", gap: 20 },
      { category: "leadership", gap: 50 }, // larger — should come first
    ],
  };
  const path = router.plan(input, [opp]);
  eq(path.steps[0].targetCategory, "leadership", "largest gap should be first step");
  eq(path.steps[1].targetCategory, "technical");
});

test("SuccessPathRouter: projectedFitScore > currentFitScore after steps", () => {
  const router = new SuccessPathRouter();
  const opp = makeOpp({ requiredStrengths: [{ category: "leadership", minScore: 70 }] });
  const profile = makeProfile("user-1", "tenant-1", [{ category: "leadership", score: 20 }]);
  const input: SuccessPathInput = {
    userId: "user-1", tenantId: "tenant-1",
    profile, targetOpportunityId: "opp-1",
    gaps: [{ category: "leadership", gap: 50 }],
  };
  const path = router.plan(input, [opp]);
  assert(path.projectedFitScore > path.currentFitScore, "projected must exceed current");
});

test("SuccessPathRouter: totalHours = sum of step hours", () => {
  const router = new SuccessPathRouter();
  const opp = makeOpp({
    requiredStrengths: [
      { category: "leadership", minScore: 80 },
      { category: "creativity", minScore: 70 },
    ],
  });
  const profile = makeProfile("user-1", "tenant-1", [
    { category: "leadership", score: 30 },
    { category: "creativity", score: 40 },
  ]);
  const input: SuccessPathInput = {
    userId: "user-1", tenantId: "tenant-1",
    profile, targetOpportunityId: "opp-1",
    gaps: [{ category: "leadership", gap: 50 }, { category: "creativity", gap: 30 }],
  };
  const path = router.plan(input, [opp]);
  const expected = path.steps.reduce((sum, s) => sum + s.estimatedHours, 0);
  eq(path.totalHours, expected);
});

// ═══════════════════════════════════════════════════════════════════════════════
// CollaborationMatcher
// ═══════════════════════════════════════════════════════════════════════════════

test("CollaborationMatcher: candidate from different tenant → throws", () => {
  const matcher = new CollaborationMatcher();
  const userProfile = makeProfile("user-1", "tenant-1", [{ category: "technical", score: 80 }]);
  const input: CollaborationInput = {
    tenantId: "tenant-1",
    userId: "user-1",
    userProfile,
    candidates: [{
      userId: "user-2",
      profile: makeProfile("user-2", "tenant-OTHER", [{ category: "leadership", score: 80 }]),
    }],
  };
  let threw = false;
  try { matcher.match(input); } catch { threw = true; }
  assert(threw, "should throw on cross-tenant candidate");
});

test("CollaborationMatcher: empty candidates → empty results", () => {
  const matcher = new CollaborationMatcher();
  const input: CollaborationInput = {
    tenantId: "tenant-1", userId: "user-1",
    userProfile: makeProfile("user-1", "tenant-1"),
    candidates: [],
  };
  const results = matcher.match(input);
  eq(results.length, 0);
});

test("CollaborationMatcher: self-match skipped", () => {
  const matcher = new CollaborationMatcher();
  const profile = makeProfile("user-1", "tenant-1", [{ category: "technical", score: 80 }]);
  const input: CollaborationInput = {
    tenantId: "tenant-1", userId: "user-1",
    userProfile: profile,
    candidates: [{ userId: "user-1", profile }], // self
  };
  const results = matcher.match(input);
  eq(results.length, 0, "self must be skipped");
});

test("CollaborationMatcher: perfect complement → high compatibilityScore", () => {
  const matcher = new CollaborationMatcher();
  // userA: strong technical, weak leadership
  // userB: weak technical, strong leadership → perfect complement
  const userAProfile = makeProfile("user-1", "tenant-1", [
    { category: "technical", score: 90 },
    { category: "leadership", score: 10 },
  ]);
  const userBProfile = makeProfile("user-2", "tenant-1", [
    { category: "technical", score: 10 },
    { category: "leadership", score: 90 },
  ]);
  const input: CollaborationInput = {
    tenantId: "tenant-1", userId: "user-1",
    userProfile: userAProfile,
    candidates: [{ userId: "user-2", profile: userBProfile }],
  };
  const results = matcher.match(input);
  eq(results.length, 1);
  assert(results[0].compatibilityScore >= 50, `expected high score, got ${results[0].compatibilityScore}`);
});

test("CollaborationMatcher: minCompatibility filter works", () => {
  const matcher = new CollaborationMatcher();
  // Two very similar profiles → low complementarity
  const profileA = makeProfile("user-1", "tenant-1", [{ category: "technical", score: 70 }]);
  const profileB = makeProfile("user-2", "tenant-1", [{ category: "technical", score: 75 }]);
  const input: CollaborationInput = {
    tenantId: "tenant-1", userId: "user-1",
    userProfile: profileA,
    candidates: [{ userId: "user-2", profile: profileB }],
    minCompatibility: 90, // very high threshold
  };
  const results = matcher.match(input);
  eq(results.length, 0, "low-compatibility match should be filtered out");
});

test("CollaborationMatcher: results sorted by compatibilityScore descending", () => {
  const matcher = new CollaborationMatcher();
  const userProfile = makeProfile("user-1", "tenant-1", [
    { category: "technical", score: 80 },
    { category: "leadership", score: 20 },
  ]);
  // user-2: good complement (leadership 80)
  const profile2 = makeProfile("user-2", "tenant-1", [
    { category: "technical", score: 20 },
    { category: "leadership", score: 80 },
  ]);
  // user-3: weaker complement (leadership 50)
  const profile3 = makeProfile("user-3", "tenant-1", [
    { category: "technical", score: 50 },
    { category: "leadership", score: 50 },
  ]);
  const input: CollaborationInput = {
    tenantId: "tenant-1", userId: "user-1",
    userProfile,
    candidates: [
      { userId: "user-3", profile: profile3 },
      { userId: "user-2", profile: profile2 }, // better complement, listed second
    ],
    minCompatibility: 0,
  };
  const results = matcher.match(input);
  assert(results.length >= 1, "should have results");
  // Best match first
  for (let i = 1; i < results.length; i++) {
    assert(
      results[i - 1].compatibilityScore >= results[i].compatibilityScore,
      "results must be sorted descending",
    );
  }
});

test("CollaborationMatcher: complementaryStrengths has correct strongUser/weakUser", () => {
  const matcher = new CollaborationMatcher();
  const userAProfile = makeProfile("user-1", "tenant-1", [
    { category: "creativity", score: 90 },
  ]);
  const userBProfile = makeProfile("user-2", "tenant-1", [
    { category: "creativity", score: 20 }, // 70 delta → complement
  ]);
  const input: CollaborationInput = {
    tenantId: "tenant-1", userId: "user-1",
    userProfile: userAProfile,
    candidates: [{ userId: "user-2", profile: userBProfile }],
    minCompatibility: 0,
  };
  const results = matcher.match(input);
  eq(results.length, 1);
  const comp = results[0].complementaryStrengths.find((c) => c.category === "creativity");
  assert(comp !== undefined, "creativity should be complementary");
  eq(comp!.strongUser, "user-1");
  eq(comp!.weakUser, "user-2");
  eq(comp!.delta, 70);
});

test("CollaborationMatcher: sharedStrengths — both score ≥ 50", () => {
  const matcher = new CollaborationMatcher();
  const userAProfile = makeProfile("user-1", "tenant-1", [
    { category: "technical", score: 80 },
    { category: "collaboration", score: 70 },
  ]);
  const userBProfile = makeProfile("user-2", "tenant-1", [
    { category: "technical", score: 75 },   // both ≥ 50 → shared
    { category: "collaboration", score: 60 }, // both ≥ 50 → shared
  ]);
  const input: CollaborationInput = {
    tenantId: "tenant-1", userId: "user-1",
    userProfile: userAProfile,
    candidates: [{ userId: "user-2", profile: userBProfile }],
    minCompatibility: 0,
  };
  const results = matcher.match(input);
  eq(results.length, 1);
  assert(results[0].sharedStrengths.includes("technical"), "technical should be shared");
  assert(results[0].sharedStrengths.includes("collaboration"), "collaboration should be shared");
});

test("CollaborationMatcher: synergyReason is a non-empty string", () => {
  const matcher = new CollaborationMatcher();
  const userAProfile = makeProfile("user-1", "tenant-1", [
    { category: "technical", score: 90 },
  ]);
  const userBProfile = makeProfile("user-2", "tenant-1", [
    { category: "technical", score: 20 },
  ]);
  const input: CollaborationInput = {
    tenantId: "tenant-1", userId: "user-1",
    userProfile: userAProfile,
    candidates: [{ userId: "user-2", profile: userBProfile }],
    minCompatibility: 0,
  };
  const results = matcher.match(input);
  assert(results.length === 1);
  assert(typeof results[0].synergyReason === "string" && results[0].synergyReason.length > 0);
});
