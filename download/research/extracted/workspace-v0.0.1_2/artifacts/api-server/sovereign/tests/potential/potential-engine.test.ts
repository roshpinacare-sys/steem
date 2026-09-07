import "../_flush.mjs";
/**
 * tests/potential/potential-engine.test.ts — PotentialEngine full test suite.
 *
 * Coverage:
 *   StrengthMapper
 *     • empty signals → empty strengths
 *     • single KG signal → correct score / confidence / evidence
 *     • single analytics signal → correct score / confidence / evidence
 *     • multiple signals same category → averaged score
 *     • confidence saturates at 1 after 5+ signals
 *     • tenant isolation: wrong-tenant signals discarded
 *     • user isolation: wrong-user signals discarded
 *     • multiple categories → multiple strengths
 *     • evidence deduplication (same nodeType appears once)
 *
 *   OpportunityRouter
 *     • no opportunities → empty matches
 *     • opportunity with no required strengths → fitScore 100
 *     • all requirements met → full match, no missing
 *     • no requirements met → fitScore 0, all missing
 *     • partial match → intermediate fitScore
 *     • multiple opportunities sorted by fitScore descending
 *     • tenant isolation: wrong-tenant opportunity skipped
 *     • gap calculation on missing strength
 *
 *   PotentialEngine
 *     • analyze — no policies → fail-closed deny (isAutonomous)
 *     • analyze — allowAll policy → success, returns StrengthProfile
 *     • analyze — audit record written on success
 *     • analyze — auditId in result cross-references getRecord()
 *     • route — no policies → fail-closed deny
 *     • route — allowAll policy → success, returns RoutingDecision with matches
 *     • route — decision tenant isolation (wrong-tenant opportunities not matched)
 *     • audit chain — verifyChain after multiple runs
 *     • audit chain — denied action also writes audit record
 */

import { test, assert, eq } from "../_harness.mjs";
import { StrengthMapper } from "../../lib/potential/strength-mapper.ts";
import { OpportunityRouter } from "../../lib/potential/opportunity-router.ts";
import { PotentialEngine } from "../../lib/potential/potential-engine.ts";
import { allowAll, denyAll } from "../../lib/orchestrator/guard.ts";
import type {
  AnalysisInput,
  RoutingInput,
  Opportunity,
} from "../../lib/potential/types.ts";

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

function makeOpp(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp-1",
    tenantId: "tenant-1",
    title: "Test Opportunity",
    description: "A test opportunity",
    requiredStrengths: [],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// StrengthMapper
// ═══════════════════════════════════════════════════════════════════════════════

test("StrengthMapper: empty signals → empty strengths", () => {
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput());
  eq(profile.strengths.length, 0, "no strengths from empty signals");
  eq(profile.userId, "user-1");
  eq(profile.tenantId, "tenant-1");
});

test("StrengthMapper: single KG signal → correct score / confidence / evidence", () => {
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [
      { userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.8 },
    ],
  }));
  eq(profile.strengths.length, 1);
  const s = profile.strengths[0];
  eq(s.category, "technical");
  eq(s.score, 80, "0.8 × 100 = 80");
  eq(s.confidence, 0.2, "1/5 = 0.2");
  assert(s.evidence.includes("skill"), "evidence includes nodeType");
});

test("StrengthMapper: single analytics signal → correct score", () => {
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    analyticsSignals: [
      { userId: "user-1", tenantId: "tenant-1", eventType: "task.completed", category: "leadership", value: 0.6 },
    ],
  }));
  eq(profile.strengths.length, 1);
  eq(profile.strengths[0].score, 60, "0.6 × 100 = 60");
  assert(profile.strengths[0].evidence.includes("task.completed"));
});

test("StrengthMapper: multiple signals same category → averaged score", () => {
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [
      { userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.6 },
      { userId: "user-1", tenantId: "tenant-1", nodeType: "project", category: "technical", weight: 1.0 },
    ],
  }));
  // (60 + 100) / 2 = 80
  eq(profile.strengths[0].score, 80);
});

test("StrengthMapper: confidence saturates at 1 after 5 signals", () => {
  const mapper = new StrengthMapper();
  const sigs = Array.from({ length: 6 }, (_, i) => ({
    userId: "user-1", tenantId: "tenant-1", nodeType: `type-${i}`, category: "creative", weight: 0.5,
  }));
  const profile = mapper.map(makeInput({ knowledgeSignals: sigs }));
  eq(profile.strengths[0].confidence, 1, "6 signals → confidence capped at 1");
});

test("StrengthMapper: tenant isolation — wrong-tenant signals discarded", () => {
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [
      { userId: "user-1", tenantId: "tenant-OTHER", nodeType: "skill", category: "technical", weight: 1.0 },
    ],
  }));
  eq(profile.strengths.length, 0, "cross-tenant signal must be discarded");
});

test("StrengthMapper: user isolation — wrong-user signals discarded", () => {
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [
      { userId: "user-OTHER", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 1.0 },
    ],
  }));
  eq(profile.strengths.length, 0, "cross-user signal must be discarded");
});

test("StrengthMapper: multiple categories → multiple strengths", () => {
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [
      { userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.9 },
      { userId: "user-1", tenantId: "tenant-1", nodeType: "award", category: "leadership", weight: 0.7 },
    ],
  }));
  eq(profile.strengths.length, 2);
  const cats = profile.strengths.map(s => s.category).sort();
  assert(cats.includes("technical") && cats.includes("leadership"));
});

test("StrengthMapper: evidence deduplication — same nodeType appears once", () => {
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [
      { userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.8 },
      { userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.6 },
    ],
  }));
  eq(profile.strengths[0].evidence.filter((e: string) => e === "skill").length, 1, "dedup evidence");
});

// ═══════════════════════════════════════════════════════════════════════════════
// OpportunityRouter
// ═══════════════════════════════════════════════════════════════════════════════

test("OpportunityRouter: no opportunities → empty matches", () => {
  const router = new OpportunityRouter();
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.8 }],
  }));
  const matches = router.route(profile, []);
  eq(matches.length, 0);
});

test("OpportunityRouter: opportunity with no required strengths → fitScore 100", () => {
  const router = new OpportunityRouter();
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput());
  const opp = makeOpp({ requiredStrengths: [] });
  const matches = router.route(profile, [opp]);
  eq(matches.length, 1);
  eq(matches[0].fitScore, 100, "open opportunity = perfect fit");
  eq(matches[0].matchedStrengths.length, 0);
  eq(matches[0].missingStrengths.length, 0);
});

test("OpportunityRouter: all requirements met → full match", () => {
  const router = new OpportunityRouter();
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.9 }],
  }));
  const opp = makeOpp({ requiredStrengths: [{ category: "technical", minScore: 70 }] });
  const matches = router.route(profile, [opp]);
  eq(matches[0].matchedStrengths.length, 1);
  eq(matches[0].missingStrengths.length, 0);
  assert(matches[0].fitScore >= 100, "score 90 >= required 70 → capped at 100");
});

test("OpportunityRouter: no requirements met → fitScore 0, all missing", () => {
  const router = new OpportunityRouter();
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput()); // no signals → no strengths
  const opp = makeOpp({ requiredStrengths: [{ category: "technical", minScore: 80 }] });
  const matches = router.route(profile, [opp]);
  eq(matches[0].fitScore, 0, "user has 0 score, required 80 → ratio 0");
  eq(matches[0].missingStrengths.length, 1);
  eq(matches[0].missingStrengths[0].gap, 80);
});

test("OpportunityRouter: partial match → intermediate fitScore", () => {
  const router = new OpportunityRouter();
  const mapper = new StrengthMapper();
  // user has 50 technical, 0 leadership
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.5 }],
  }));
  const opp = makeOpp({
    requiredStrengths: [
      { category: "technical", minScore: 100 },
      { category: "leadership", minScore: 100 },
    ],
  });
  const matches = router.route(profile, [opp]);
  // technical: 50/100 = 0.5; leadership: 0/100 = 0; avg = 0.25 → fitScore = 25
  eq(matches[0].fitScore, 25);
  eq(matches[0].matchedStrengths.length, 0, "50 < 100 → not matched");
  eq(matches[0].missingStrengths.length, 2);
});

test("OpportunityRouter: multiple opportunities sorted by fitScore descending", () => {
  const router = new OpportunityRouter();
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.8 }],
  }));
  const opps: Opportunity[] = [
    makeOpp({ id: "opp-low",  requiredStrengths: [{ category: "technical", minScore: 100 }] }),  // fitScore 80
    makeOpp({ id: "opp-high", requiredStrengths: [{ category: "technical", minScore: 60 }] }),   // fitScore 100
    makeOpp({ id: "opp-zero", requiredStrengths: [{ category: "leadership", minScore: 80 }] }),  // fitScore 0
  ];
  const matches = router.route(profile, opps);
  assert(matches[0].fitScore >= matches[1].fitScore, "sorted desc");
  assert(matches[1].fitScore >= matches[2].fitScore, "sorted desc");
  eq(matches[0].opportunity.id, "opp-high");
});

test("OpportunityRouter: tenant isolation — wrong-tenant opportunity skipped", () => {
  const router = new OpportunityRouter();
  const mapper = new StrengthMapper();
  const profile = mapper.map(makeInput());
  const opp = makeOpp({ tenantId: "tenant-OTHER" });
  const matches = router.route(profile, [opp]);
  eq(matches.length, 0, "cross-tenant opportunity must be discarded");
});

test("OpportunityRouter: gap calculation is correct", () => {
  const router = new OpportunityRouter();
  const mapper = new StrengthMapper();
  // technical score = 30
  const profile = mapper.map(makeInput({
    knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.3 }],
  }));
  const opp = makeOpp({ requiredStrengths: [{ category: "technical", minScore: 70 }] });
  const matches = router.route(profile, [opp]);
  eq(matches[0].missingStrengths[0].gap, 40, "70 - 30 = 40");
});

// ═══════════════════════════════════════════════════════════════════════════════
// PotentialEngine
// ═══════════════════════════════════════════════════════════════════════════════

test("PotentialEngine: analyze — no policies → fail-closed deny (isAutonomous)", async () => {
  const engine = new PotentialEngine([]);
  const result = await engine.analyze(makeInput());
  eq(result.ok, false, "no policies = deny for autonomous action");
  assert("reason" in result && (result as any).reason.includes("fail-closed"));
});

test("PotentialEngine: analyze — allowAll policy → success, returns StrengthProfile", async () => {
  const engine = new PotentialEngine([allowAll()]);
  const input = makeInput({
    knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.7 }],
  });
  const result = await engine.analyze(input);
  eq(result.ok, true);
  assert("result" in result);
  const profile = (result as any).result;
  eq(profile.userId, "user-1");
  eq(profile.tenantId, "tenant-1");
  eq(profile.strengths.length, 1);
  eq(profile.strengths[0].category, "technical");
});

test("PotentialEngine: analyze — audit record written on success", async () => {
  const engine = new PotentialEngine([allowAll()]);
  const result = await engine.analyze(makeInput());
  eq(result.ok, true);
  const records = engine.audit.getChain("tenant-1");
  assert(records.length >= 1, "at least one audit record");
  eq(records[records.length - 1].outcome, "allowed");
});

test("PotentialEngine: analyze — auditId in result cross-references getRecord()", async () => {
  const engine = new PotentialEngine([allowAll()]);
  const result = await engine.analyze(makeInput());
  eq(result.ok, true);
  const { auditId } = result as any;
  const record = engine.audit.getRecord(auditId);
  assert(record !== null, "audit record found by id");
  eq(record!.actionType, "potential.analyze");
  eq(record!.outcome, "allowed");
});

test("PotentialEngine: route — no policies → fail-closed deny", async () => {
  const engine = new PotentialEngine([]);
  const input: RoutingInput = { ...makeInput(), opportunities: [] };
  const result = await engine.route(input);
  eq(result.ok, false);
});

test("PotentialEngine: route — allowAll policy → success, returns RoutingDecision", async () => {
  const engine = new PotentialEngine([allowAll()]);
  const input: RoutingInput = {
    ...makeInput({
      knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.9 }],
    }),
    opportunities: [makeOpp({ requiredStrengths: [{ category: "technical", minScore: 70 }] })],
  };
  const result = await engine.route(input);
  eq(result.ok, true);
  const decision = (result as any).result;
  eq(decision.userId, "user-1");
  eq(decision.tenantId, "tenant-1");
  assert(decision.matches.length === 1, "one match");
  assert(decision.matches[0].fitScore >= 100, "score 90 >= required 70 → capped");
});

test("PotentialEngine: route — decision tenant isolation (wrong-tenant opps not matched)", async () => {
  const engine = new PotentialEngine([allowAll()]);
  const input: RoutingInput = {
    ...makeInput(),
    opportunities: [
      makeOpp({ id: "opp-good", tenantId: "tenant-1", requiredStrengths: [] }),
      makeOpp({ id: "opp-bad",  tenantId: "tenant-OTHER", requiredStrengths: [] }),
    ],
  };
  const result = await engine.route(input);
  eq(result.ok, true);
  const decision = (result as any).result;
  eq(decision.matches.length, 1, "cross-tenant opp filtered out");
  eq(decision.matches[0].opportunity.id, "opp-good");
});

test("PotentialEngine: audit chain — verifyChain intact after multiple runs", async () => {
  const engine = new PotentialEngine([allowAll()]);
  await engine.analyze(makeInput());
  await engine.analyze(makeInput());
  await engine.analyze(makeInput());
  const ok = engine.audit.verifyChain("tenant-1");
  eq(ok, true, "hash chain must be intact after multiple runs");
});

test("PotentialEngine: audit chain — denied action also writes audit record", async () => {
  const engine = new PotentialEngine([denyAll("test-deny")]);
  const result = await engine.analyze(makeInput());
  eq(result.ok, false);
  const records = engine.audit.getChain("tenant-1");
  assert(records.length >= 1, "denied action must still write audit record");
  eq(records[records.length - 1].outcome, "denied");
});
