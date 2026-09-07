import "../_flush.mjs";
/**
 * tests/potential/kg-signals.test.ts — Knowledge Graph source integration (v79).
 *
 * Coverage:
 *   InMemoryKnowledgeGraphSource
 *     • addSignal + fetchSignals happy path
 *     • tenant isolation — wrong-tenant signals excluded
 *     • user isolation — wrong-user signals excluded
 *     • clearForUser removes only target user
 *     • clearAll removes everything
 *     • totalCount
 *
 *   PgKnowledgeGraphSource (over InMemoryPool)
 *     • init idempotent
 *     • addSignal + fetchSignals happy path
 *     • tenant isolation — wrong-tenant signals excluded
 *     • validation: missing userId → KgSourceError
 *     • validation: missing tenantId → KgSourceError
 *     • validation: missing nodeType → KgSourceError
 *     • validation: missing category → KgSourceError
 *     • clearForUser removes only target user
 *     • totalCount per tenant
 *     • weight clamped 0–1
 *
 *   PotentialEngine + KnowledgeGraphSource
 *     • analyze with kgSource fetches and merges real KG signals
 *     • route with kgSource fetches and merges real KG signals
 *     • input signals + kgSource signals merged correctly
 *     • empty kgSource → only input signals used
 *     • no kgSource (backward compat) → works exactly as before
 *     • tenant isolation: kgSource cross-tenant signals discarded by mapper
 *     • fail-closed: no policies still denies even with kgSource
 */

import { test, eq, assert } from "../_harness.mjs";
import { InMemoryPool } from "../../lib/db/in-memory-driver.ts";
import {
  InMemoryKnowledgeGraphSource,
  PgKnowledgeGraphSource,
  KgSourceError,
  PotentialEngine,
  StrengthMapper,
} from "../../lib/potential/index.ts";
import type { KnowledgeSignal, AnalysisInput, Opportunity } from "../../lib/potential/index.ts";
import { allowAll, denyAll } from "../../lib/orchestrator/guard.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function freshPgSource() {
  const pool = new InMemoryPool();
  const source = new PgKnowledgeGraphSource(pool);
  return { pool, source };
}

// ═══════════════════════════════════════════════════════════════════════════════
// InMemoryKnowledgeGraphSource
// ═══════════════════════════════════════════════════════════════════════════════

test("InMemoryKGSource: addSignal + fetchSignals happy path", async () => {
  const source = new InMemoryKnowledgeGraphSource();
  source.addSignal(makeSignal("u1", "t1", { nodeType: "skill", category: "technical", weight: 0.9 }));
  source.addSignal(makeSignal("u1", "t1", { nodeType: "project", category: "leadership", weight: 0.7 }));
  const fetched = await source.fetchSignals("u1", "t1");
  eq(fetched.length, 2);
  eq(fetched[0].nodeType, "skill");
  eq(fetched[1].nodeType, "project");
});

test("InMemoryKGSource: tenant isolation — wrong-tenant excluded", async () => {
  const source = new InMemoryKnowledgeGraphSource();
  source.addSignal(makeSignal("u1", "t1"));
  source.addSignal(makeSignal("u1", "t-OTHER"));
  const fetched = await source.fetchSignals("u1", "t1");
  eq(fetched.length, 1);
  eq(fetched[0].tenantId, "t1");
});

test("InMemoryKGSource: user isolation — wrong-user excluded", async () => {
  const source = new InMemoryKnowledgeGraphSource();
  source.addSignal(makeSignal("u1", "t1"));
  source.addSignal(makeSignal("u-OTHER", "t1"));
  const fetched = await source.fetchSignals("u1", "t1");
  eq(fetched.length, 1);
  eq(fetched[0].userId, "u1");
});

test("InMemoryKGSource: clearForUser removes only target user", async () => {
  const source = new InMemoryKnowledgeGraphSource();
  source.addSignal(makeSignal("u1", "t1"));
  source.addSignal(makeSignal("u2", "t1"));
  eq(source.totalCount(), 2);
  const removed = source.clearForUser("u1", "t1");
  eq(removed, 1);
  eq(source.totalCount(), 1);
  const fetched = await source.fetchSignals("u2", "t1");
  eq(fetched.length, 1);
});

test("InMemoryKGSource: clearAll removes everything", async () => {
  const source = new InMemoryKnowledgeGraphSource();
  source.addSignal(makeSignal("u1", "t1"));
  source.addSignal(makeSignal("u2", "t2"));
  eq(source.totalCount(), 2);
  source.clearAll();
  eq(source.totalCount(), 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PgKnowledgeGraphSource (over InMemoryPool)
// ═══════════════════════════════════════════════════════════════════════════════

test("PgKGSource: init is idempotent", async () => {
  const { source } = freshPgSource();
  await source.init();
  await source.init();
  eq(await source.totalCount("nobody"), 0);
});

test("PgKGSource: addSignal + fetchSignals happy path", async () => {
  const { source } = freshPgSource();
  await source.init();
  await source.addSignal(makeSignal("u1", "t1", { nodeType: "skill", category: "technical", weight: 0.9 }));
  await source.addSignal(makeSignal("u1", "t1", { nodeType: "project", category: "leadership", weight: 0.7 }));
  const fetched = await source.fetchSignals("u1", "t1");
  eq(fetched.length, 2);
  eq(fetched[0].nodeType, "skill");
  eq(fetched[1].category, "leadership");
});

test("PgKGSource: tenant isolation — wrong-tenant excluded", async () => {
  const { source } = freshPgSource();
  await source.init();
  await source.addSignal(makeSignal("u1", "t1"));
  await source.addSignal(makeSignal("u1", "t-OTHER"));
  const fetched = await source.fetchSignals("u1", "t1");
  eq(fetched.length, 1);
  eq(fetched[0].tenantId, "t1");
});

test("PgKGSource: validation — missing userId throws KgSourceError", async () => {
  const { source } = freshPgSource();
  await source.init();
  try {
    await source.addSignal(makeSignal("", "t1"));
    assert(false, "should throw");
  } catch (err) {
    assert(err instanceof KgSourceError);
    eq((err as KgSourceError).code, "MISSING_USER_ID");
  }
});

test("PgKGSource: validation — missing tenantId throws KgSourceError", async () => {
  const { source } = freshPgSource();
  await source.init();
  try {
    await source.addSignal(makeSignal("u1", ""));
    assert(false, "should throw");
  } catch (err) {
    assert(err instanceof KgSourceError);
    eq((err as KgSourceError).code, "MISSING_TENANT_ID");
  }
});

test("PgKGSource: validation — missing nodeType throws KgSourceError", async () => {
  const { source } = freshPgSource();
  await source.init();
  try {
    await source.addSignal(makeSignal("u1", "t1", { nodeType: "" }));
    assert(false, "should throw");
  } catch (err) {
    assert(err instanceof KgSourceError);
    eq((err as KgSourceError).code, "MISSING_NODE_TYPE");
  }
});

test("PgKGSource: validation — missing category throws KgSourceError", async () => {
  const { source } = freshPgSource();
  await source.init();
  try {
    await source.addSignal(makeSignal("u1", "t1", { category: "" }));
    assert(false, "should throw");
  } catch (err) {
    assert(err instanceof KgSourceError);
    eq((err as KgSourceError).code, "MISSING_CATEGORY");
  }
});

test("PgKGSource: clearForUser removes only target user", async () => {
  const { source } = freshPgSource();
  await source.init();
  await source.addSignal(makeSignal("u1", "t1"));
  await source.addSignal(makeSignal("u2", "t1"));
  eq(await source.totalCount("t1"), 2);
  const removed = await source.clearForUser("u1", "t1");
  eq(removed, 1);
  eq(await source.totalCount("t1"), 1);
  const fetched = await source.fetchSignals("u2", "t1");
  eq(fetched.length, 1);
});

test("PgKGSource: weight clamped 0–1", async () => {
  const { source } = freshPgSource();
  await source.init();
  await source.addSignal(makeSignal("u1", "t1", { weight: 2.5 }));
  await source.addSignal(makeSignal("u1", "t1", { weight: -0.3 }));
  const fetched = await source.fetchSignals("u1", "t1");
  eq(fetched.length, 2);
  eq(fetched[0].weight, 1, "clamped to 1");
  eq(fetched[1].weight, 0, "clamped to 0");
});

// ═══════════════════════════════════════════════════════════════════════════════
// PotentialEngine + KnowledgeGraphSource
// ═══════════════════════════════════════════════════════════════════════════════

test("PotentialEngine + kgSource: analyze fetches and merges real KG signals", async () => {
  const kgSource = new InMemoryKnowledgeGraphSource();
  kgSource.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "skill", category: "technical", weight: 0.9 }));
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", kgSource);
  const result = await engine.analyze(makeInput({ knowledgeSignals: [] }));
  eq(result.ok, true);
  const profile = (result as any).result;
  eq(profile.strengths.length, 1);
  eq(profile.strengths[0].category, "technical");
  eq(profile.strengths[0].score, 90);
});

test("PotentialEngine + kgSource: analyze merges input + KG signals", async () => {
  const kgSource = new InMemoryKnowledgeGraphSource();
  kgSource.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "skill", category: "technical", weight: 0.6 }));
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", kgSource);
  // Input provides one signal, KG source provides another — both same category
  const result = await engine.analyze(makeInput({
    knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "project", category: "technical", weight: 1.0 }],
  }));
  eq(result.ok, true);
  const profile = (result as any).result;
  eq(profile.strengths.length, 1);
  // (60 + 100) / 2 = 80
  eq(profile.strengths[0].score, 80);
  eq(profile.strengths[0].evidence.length, 2, "both nodeTypes appear as evidence");
});

test("PotentialEngine + kgSource: route fetches and merges real KG signals", async () => {
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
  assert(decision.matches[0].fitScore >= 100, "score 90 >= required 70");
});

test("PotentialEngine: empty kgSource → only input signals used", async () => {
  const kgSource = new InMemoryKnowledgeGraphSource();
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", kgSource);
  const result = await engine.analyze(makeInput({
    knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.7 }],
  }));
  eq(result.ok, true);
  const profile = (result as any).result;
  eq(profile.strengths.length, 1);
  eq(profile.strengths[0].score, 70);
});

test("PotentialEngine: no kgSource (backward compat) → works exactly as before", async () => {
  const engine = new PotentialEngine([allowAll()]);
  const result = await engine.analyze(makeInput({
    knowledgeSignals: [{ userId: "user-1", tenantId: "tenant-1", nodeType: "skill", category: "technical", weight: 0.8 }],
  }));
  eq(result.ok, true);
  const profile = (result as any).result;
  eq(profile.strengths.length, 1);
  eq(profile.strengths[0].score, 80);
});

test("PotentialEngine + kgSource: tenant isolation — cross-tenant KG signals discarded", async () => {
  const kgSource = new InMemoryKnowledgeGraphSource();
  kgSource.addSignal(makeSignal("user-1", "tenant-OTHER", { nodeType: "skill", category: "technical", weight: 0.9 }));
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", kgSource);
  const result = await engine.analyze(makeInput({ knowledgeSignals: [] }));
  eq(result.ok, true);
  const profile = (result as any).result;
  eq(profile.strengths.length, 0, "cross-tenant KG signal must be discarded");
});

test("PotentialEngine + kgSource: fail-closed — no policies still denies", async () => {
  const kgSource = new InMemoryKnowledgeGraphSource();
  kgSource.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "skill", category: "technical", weight: 0.9 }));
  const engine = new PotentialEngine([], undefined, {}, "PotentialEngine", kgSource);
  const result = await engine.analyze(makeInput());
  eq(result.ok, false);
  assert("reason" in result && (result as any).reason.includes("fail-closed"));
});

// ═══════════════════════════════════════════════════════════════════════════════
// PgKnowledgeGraphSource + PotentialEngine integration
// ═══════════════════════════════════════════════════════════════════════════════

test("PgKGSource + PotentialEngine: end-to-end with real DB signals", async () => {
  const { source } = freshPgSource();
  await source.init();
  await source.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "skill", category: "technical", weight: 0.85 }));
  await source.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "project", category: "leadership", weight: 0.75 }));
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", source);
  const result = await engine.analyze(makeInput({ knowledgeSignals: [] }));
  eq(result.ok, true);
  const profile = (result as any).result;
  eq(profile.strengths.length, 2);
  const cats = profile.strengths.map((s: any) => s.category).sort();
  assert(cats.includes("technical") && cats.includes("leadership"));
});

test("PgKGSource + PotentialEngine: tenant isolation at DB + mapper layers", async () => {
  const { source } = freshPgSource();
  await source.init();
  await source.addSignal(makeSignal("user-1", "tenant-1", { nodeType: "skill", category: "technical", weight: 0.9 }));
  await source.addSignal(makeSignal("user-1", "tenant-2", { nodeType: "project", category: "leadership", weight: 0.8 }));
  const engine = new PotentialEngine([allowAll()], undefined, {}, "PotentialEngine", source);
  const result = await engine.analyze(makeInput({ userId: "user-1", tenantId: "tenant-1", knowledgeSignals: [] }));
  eq(result.ok, true);
  const profile = (result as any).result;
  eq(profile.strengths.length, 1);
  eq(profile.strengths[0].category, "technical");
});
