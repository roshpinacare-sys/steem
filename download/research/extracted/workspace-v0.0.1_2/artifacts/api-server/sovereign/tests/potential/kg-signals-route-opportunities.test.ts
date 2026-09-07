import "../_flush.mjs";
/**
 * tests/potential/kg-signals-route-opportunities.test.ts — v80 type-fix coverage.
 *
 * v79 introduced KnowledgeGraphSource integration via enrichInput(), but
 * enrichInput was typed as returning AnalysisInput, which drops the
 * `opportunities` field present on RoutingInput. This caused a type error
 * in potential-engine.ts line 247: `a.payload.opportunities` does not exist
 * on type `AnalysisInput`.
 *
 * The fix (v80): enrichInput is now generic over T extends AnalysisInput so
 * the caller's concrete type (RoutingInput) is preserved.
 *
 * Coverage:
 *   • route() with kgSource + opportunities — happy path
 *   • route() with kgSource + opportunities + merged KG signals
 *   • route() with kgSource + empty opportunities array
 *   • analyze() with kgSource — backward compat unchanged
 */

import { test, eq, assert } from "../_harness.mjs";
import { InMemoryKnowledgeGraphSource, PotentialEngine } from "../../lib/potential/index.ts";
import type { KnowledgeSignal, AnalysisInput, Opportunity } from "../../lib/potential/index.ts";
import { allowAll } from "../../lib/orchestrator/guard.ts";

function makeSignal(
  userId = "user-1",
  tenantId = "tenant-1",
  overrides: Partial<KnowledgeSignal> = {}
): KnowledgeSignal {
  return {
    userId,
    tenantId,
    nodeType: "skill",
    category: "technical",
    weight: 0.8,
    ...overrides,
  };
}

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
// route() with kgSource must preserve opportunities through enrichInput
// ═══════════════════════════════════════════════════════════════════════════════

test("route + kgSource: opportunities preserved through enrichInput", async () => {
  const kgSource = new InMemoryKnowledgeGraphSource();
  kgSource.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "skill", category: "technical", weight: 0.9 }));
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", kgSource);
  const result = await engine.route({
    ...makeInput(),
    opportunities: [makeOpp({ requiredStrengths: [{ category: "technical", minScore: 70 }] })],
  });
  eq(result.ok, true);
  const decision = (result as any).result;
  eq(decision.matches.length, 1);
  eq(decision.matches[0].opportunity.id, "opp-1");
});

test("route + kgSource: opportunities + merged KG signals both work", async () => {
  const kgSource = new InMemoryKnowledgeGraphSource();
  kgSource.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "skill", category: "technical", weight: 0.5 }));
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", kgSource);
  // Input also provides a signal for the same category
  const result = await engine.route({
    ...makeInput({
      knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "project", category: "technical", weight: 1.0 }],
    }),
    opportunities: [makeOpp({ requiredStrengths: [{ category: "technical", minScore: 70 }] })],
  });
  eq(result.ok, true);
  const decision = (result as any).result;
  eq(decision.matches.length, 1);
  // merged score = (50 + 100) / 2 = 75, which is above required 70
  eq(decision.matches[0].fitScore >= 100, true);
});

test("route + kgSource: empty opportunities array returns zero matches", async () => {
  const kgSource = new InMemoryKnowledgeGraphSource();
  kgSource.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "skill", category: "technical", weight: 0.9 }));
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", kgSource);
  const result = await engine.route({
    ...makeInput(),
    opportunities: [],
  });
  eq(result.ok, true);
  const decision = (result as any).result;
  eq(decision.matches.length, 0);
});

test("analyze + kgSource: backward compat unchanged after generic enrichInput", async () => {
  const kgSource = new InMemoryKnowledgeGraphSource();
  kgSource.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "skill", category: "technical", weight: 0.9 }));
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", kgSource);
  const result = await engine.analyze(makeInput({ knowledgeSignals: [] }));
  eq(result.ok, true);
  const profile = (result as any).result;
  eq(profile.strengths.length, 1);
  eq(profile.strengths[0].category, "technical");
});
