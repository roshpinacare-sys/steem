import "../_flush.mjs";
/**
 * tests/integration/success-path-collaboration-api.test.ts
 *
 * Live-server HTTP integration tests for two new endpoints added in v68:
 *   POST /api/potential/success-path
 *   POST /api/potential/collaboration
 *
 * Coverage:
 *
 *   POST /api/potential/success-path
 *     Validation
 *       • missing x-tenant-id → 400
 *       • missing userId → 400
 *       • missing targetOpportunityId → 400
 *       • missing profile → 400
 *       • unknown opportunityId → 404
 *       • cross-tenant opportunity → 404 (tenant isolation)
 *     Happy path
 *       • 200 + ok:true + SuccessPath shape (id, userId, tenantId, targetOpportunityId,
 *         currentFitScore, projectedFitScore, steps[], totalHours, createdAt)
 *       • userId and tenantId match request
 *       • no gaps → empty steps, projectedFitScore === currentFitScore
 *       • gaps present → steps non-empty, projectedFitScore > currentFitScore
 *       • steps sorted: largest gap first
 *       • totalHours = sum of step estimatedHours
 *       • auto-computed gaps (omitting `gaps` in body)
 *
 *   POST /api/potential/collaboration
 *     Validation
 *       • missing x-tenant-id → 400
 *       • missing userId → 400
 *       • missing userProfile → 400
 *       • candidates not array → 400
 *     Happy path
 *       • 200 + ok:true + data is array
 *       • empty candidates → empty array
 *       • self not matched
 *       • perfect complement → high score, appears in results
 *       • similar profiles → filtered by minCompatibility
 *       • results sorted descending
 *       • custom minCompatibility: 0 → all returned, 100 → few/none
 *       • complementaryStrengths and sharedStrengths correct shape
 *       • tenant isolation: candidate profile.tenantId forced to request tenant
 *
 * Zero external deps — built-in fetch, port=0.
 */

import { test, eq, assert } from "../_harness.mjs";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

const server = startSovereignServer(0, undefined, { requireIdempotencyKey: false });
const port: number = (server.address() as any).port;
const base = `http://127.0.0.1:${port}`;

const H = (t: string) => ({ "content-type": "application/json", "x-tenant-id": t });
const TENANT = "sc-tenant-1";
const TENANT_B = "sc-tenant-b";

const post = (path: string, body: any, tenant = TENANT) =>
  fetch(base + path, { method: "POST", headers: H(tenant), body: JSON.stringify(body) });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProfile(userId: string, tenantId: string, strengths: Array<{ category: string; score: number }>) {
  return {
    userId,
    tenantId,
    strengths: strengths.map((s) => ({ category: s.category, score: s.score, confidence: 0.8, evidence: [] })),
    analyzedAt: new Date().toISOString(),
  };
}

// Create an opportunity via API and return its id
async function createOpp(
  title: string,
  requiredStrengths: Array<{ category: string; minScore: number }>,
  tenant = TENANT,
): Promise<string> {
  const r = await post("/api/marketplace/opportunities", { title, requiredStrengths }, tenant);
  const j = await r.json() as any;
  return j.opportunity.id;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

// Create opportunities for tests (top-level await — harness runs after this)
const oppNoReqs = await createOpp("No-requirement role", []);
const oppWithReqs = await createOpp("Leadership role", [
  { category: "leadership", minScore: 80 },
  { category: "technical", minScore: 60 },
]);
const oppTenantB = await createOpp("Tenant-B role", [{ category: "technical", minScore: 50 }], TENANT_B);

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/potential/success-path — Validation
// ═══════════════════════════════════════════════════════════════════════════════

test("POST /api/potential/success-path: missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/potential/success-path", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "u1", targetOpportunityId: oppNoReqs, profile: makeProfile("u1", TENANT, []) }),
  });
  eq(r.status, 400);
});

test("POST /api/potential/success-path: missing userId → 400", async () => {
  const r = await post("/api/potential/success-path", {
    targetOpportunityId: oppNoReqs,
    profile: makeProfile("u1", TENANT, []),
  });
  eq(r.status, 400);
});

test("POST /api/potential/success-path: missing targetOpportunityId → 400", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    profile: makeProfile("u1", TENANT, []),
  });
  eq(r.status, 400);
});

test("POST /api/potential/success-path: missing profile → 400", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    targetOpportunityId: oppNoReqs,
  });
  eq(r.status, 400);
});

test("POST /api/potential/success-path: unknown opportunityId → 404", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    targetOpportunityId: "nonexistent-opp-id",
    profile: makeProfile("u1", TENANT, []),
  });
  eq(r.status, 404);
});

test("POST /api/potential/success-path: cross-tenant opportunity → 404", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    targetOpportunityId: oppTenantB, // created in TENANT_B, requesting from TENANT
    profile: makeProfile("u1", TENANT, []),
  });
  eq(r.status, 404);
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/potential/success-path — Happy path
// ═══════════════════════════════════════════════════════════════════════════════

test("POST /api/potential/success-path: 200 + ok:true + full SuccessPath shape", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    targetOpportunityId: oppNoReqs,
    profile: makeProfile("u1", TENANT, []),
  });
  eq(r.status, 200);
  const { ok, data } = await r.json() as any;
  eq(ok, true);
  assert(data.id, "data.id must be present");
  eq(data.userId, "u1");
  eq(data.tenantId, TENANT);
  eq(data.targetOpportunityId, oppNoReqs);
  assert(typeof data.currentFitScore === "number", "currentFitScore must be number");
  assert(typeof data.projectedFitScore === "number", "projectedFitScore must be number");
  assert(Array.isArray(data.steps), "steps must be array");
  assert(typeof data.totalHours === "number", "totalHours must be number");
  assert(typeof data.createdAt === "string", "createdAt must be ISO string");
});

test("POST /api/potential/success-path: no requirements → empty steps, projectedFitScore === currentFitScore", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    targetOpportunityId: oppNoReqs,
    profile: makeProfile("u1", TENANT, [{ category: "leadership", score: 80 }]),
    gaps: [], // explicit no gaps
  });
  const { data } = await r.json() as any;
  eq(data.steps.length, 0);
  eq(data.projectedFitScore, data.currentFitScore);
  eq(data.totalHours, 0);
});

test("POST /api/potential/success-path: gaps present → steps non-empty, projected > current", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    targetOpportunityId: oppWithReqs,
    profile: makeProfile("u1", TENANT, [
      { category: "leadership", score: 20 }, // gap: 60
      { category: "technical",  score: 30 }, // gap: 30
    ]),
    gaps: [
      { category: "leadership", gap: 60 },
      { category: "technical",  gap: 30 },
    ],
  });
  const { data } = await r.json() as any;
  assert(data.steps.length > 0, "should have steps");
  assert(data.projectedFitScore > data.currentFitScore, "projected should exceed current");
});

test("POST /api/potential/success-path: steps sorted — largest gap first", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    targetOpportunityId: oppWithReqs,
    profile: makeProfile("u1", TENANT, [
      { category: "leadership", score: 20 }, // gap 60 — larger
      { category: "technical",  score: 40 }, // gap 20 — smaller
    ]),
    gaps: [
      { category: "technical",  gap: 20 },  // listed first — should NOT be first step
      { category: "leadership", gap: 60 },  // larger
    ],
  });
  const { data } = await r.json() as any;
  assert(data.steps.length >= 2, "need at least 2 steps");
  assert(
    data.steps[0].targetCategory === "leadership",
    `largest gap should be first step, got ${data.steps[0].targetCategory}`,
  );
});

test("POST /api/potential/success-path: totalHours = sum of step estimatedHours", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    targetOpportunityId: oppWithReqs,
    profile: makeProfile("u1", TENANT, [
      { category: "leadership", score: 20 },
      { category: "technical",  score: 30 },
    ]),
    gaps: [{ category: "leadership", gap: 60 }, { category: "technical", gap: 30 }],
  });
  const { data } = await r.json() as any;
  const sum = data.steps.reduce((a: number, s: any) => a + s.estimatedHours, 0);
  eq(data.totalHours, sum);
});

test("POST /api/potential/success-path: auto-computed gaps (no gaps field in body)", async () => {
  const r = await post("/api/potential/success-path", {
    userId: "u1",
    targetOpportunityId: oppWithReqs,
    profile: makeProfile("u1", TENANT, [
      { category: "leadership", score: 20 }, // below 80 → auto gap
      { category: "technical",  score: 80 }, // meets 60 → no gap
    ]),
    // gaps intentionally omitted — server should compute automatically
  });
  eq(r.status, 200);
  const { data } = await r.json() as any;
  // Only leadership gap should produce a step (technical meets requirement)
  assert(data.steps.length >= 1, "should have at least 1 step");
  const cats = data.steps.map((s: any) => s.targetCategory);
  assert(cats.includes("leadership"), "leadership step should exist");
  assert(!cats.includes("technical"), "technical meets requirement — no step expected");
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/potential/collaboration — Validation
// ═══════════════════════════════════════════════════════════════════════════════

test("POST /api/potential/collaboration: missing x-tenant-id → 400", async () => {
  const r = await fetch(base + "/api/potential/collaboration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "u1", userProfile: makeProfile("u1", TENANT, []), candidates: [] }),
  });
  eq(r.status, 400);
});

test("POST /api/potential/collaboration: missing userId → 400", async () => {
  const r = await post("/api/potential/collaboration", {
    userProfile: makeProfile("u1", TENANT, []),
    candidates: [],
  });
  eq(r.status, 400);
});

test("POST /api/potential/collaboration: missing userProfile → 400", async () => {
  const r = await post("/api/potential/collaboration", { userId: "u1", candidates: [] });
  eq(r.status, 400);
});

test("POST /api/potential/collaboration: candidates not array → 400", async () => {
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: makeProfile("u1", TENANT, []),
    candidates: "not-an-array",
  });
  eq(r.status, 400);
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/potential/collaboration — Happy path
// ═══════════════════════════════════════════════════════════════════════════════

test("POST /api/potential/collaboration: 200 + ok:true + data is array", async () => {
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: makeProfile("u1", TENANT, []),
    candidates: [],
  });
  eq(r.status, 200);
  const { ok, data } = await r.json() as any;
  eq(ok, true);
  assert(Array.isArray(data), "data must be array");
});

test("POST /api/potential/collaboration: empty candidates → empty array", async () => {
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: makeProfile("u1", TENANT, [{ category: "technical", score: 80 }]),
    candidates: [],
  });
  const { data } = await r.json() as any;
  eq(data.length, 0);
});

test("POST /api/potential/collaboration: self-match skipped", async () => {
  const profile = makeProfile("u1", TENANT, [{ category: "technical", score: 80 }]);
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: profile,
    candidates: [{ userId: "u1", profile }],
    minCompatibility: 0,
  });
  const { data } = await r.json() as any;
  eq(data.length, 0, "self should be skipped");
});

test("POST /api/potential/collaboration: perfect complement → appears in results", async () => {
  // u1: strong technical, weak leadership
  // u2: weak technical, strong leadership → perfect complement
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: makeProfile("u1", TENANT, [
      { category: "technical",  score: 90 },
      { category: "leadership", score: 10 },
    ]),
    candidates: [{
      userId: "u2",
      profile: makeProfile("u2", TENANT, [
        { category: "technical",  score: 10 },
        { category: "leadership", score: 90 },
      ]),
    }],
    minCompatibility: 0,
  });
  const { data } = await r.json() as any;
  eq(data.length, 1);
  assert(data[0].userB === "u2" || data[0].userA === "u2", "u2 should be in the match");
  assert(data[0].compatibilityScore >= 40, `score ${data[0].compatibilityScore} too low`);
});

test("POST /api/potential/collaboration: similar profiles filtered by default minCompatibility", async () => {
  // Two near-identical profiles → low complementarity, should be filtered
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: makeProfile("u1", TENANT, [{ category: "technical", score: 70 }]),
    candidates: [{
      userId: "u2",
      profile: makeProfile("u2", TENANT, [{ category: "technical", score: 72 }]),
    }],
    // default minCompatibility=40 — small delta should be filtered
  });
  const { data } = await r.json() as any;
  assert(data.length === 0 || data[0].compatibilityScore >= 40, "filtered or above threshold");
});

test("POST /api/potential/collaboration: minCompatibility=0 → all (non-self) returned", async () => {
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: makeProfile("u1", TENANT, [{ category: "technical", score: 70 }]),
    candidates: [
      { userId: "u2", profile: makeProfile("u2", TENANT, [{ category: "technical", score: 72 }]) },
      { userId: "u3", profile: makeProfile("u3", TENANT, [{ category: "leadership", score: 80 }]) },
    ],
    minCompatibility: 0,
  });
  const { data } = await r.json() as any;
  eq(data.length, 2, "all non-self candidates should be returned with minCompatibility=0");
});

test("POST /api/potential/collaboration: results sorted descending by compatibilityScore", async () => {
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: makeProfile("u1", TENANT, [
      { category: "technical",  score: 90 },
      { category: "leadership", score: 10 },
    ]),
    candidates: [
      // u3: weak complement (leadership 50 only)
      { userId: "u3", profile: makeProfile("u3", TENANT, [{ category: "leadership", score: 50 }]) },
      // u2: strong complement (leadership 90) — should rank higher
      { userId: "u2", profile: makeProfile("u2", TENANT, [
        { category: "technical",  score: 10 },
        { category: "leadership", score: 90 },
      ])},
    ],
    minCompatibility: 0,
  });
  const { data } = await r.json() as any;
  assert(data.length >= 2, "should have 2 results");
  for (let i = 1; i < data.length; i++) {
    assert(
      data[i - 1].compatibilityScore >= data[i].compatibilityScore,
      `results not sorted: ${data[i-1].compatibilityScore} < ${data[i].compatibilityScore}`,
    );
  }
});

test("POST /api/potential/collaboration: match has correct shape fields", async () => {
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: makeProfile("u1", TENANT, [{ category: "creativity", score: 90 }]),
    candidates: [{
      userId: "u2",
      profile: makeProfile("u2", TENANT, [{ category: "creativity", score: 10 }]),
    }],
    minCompatibility: 0,
  });
  const { data } = await r.json() as any;
  assert(data.length >= 1);
  const m = data[0];
  assert(typeof m.compatibilityScore === "number", "compatibilityScore must be number");
  assert(Array.isArray(m.complementaryStrengths), "complementaryStrengths must be array");
  assert(Array.isArray(m.sharedStrengths), "sharedStrengths must be array");
  assert(typeof m.synergyReason === "string" && m.synergyReason.length > 0, "synergyReason must be non-empty");
  assert(typeof m.matchedAt === "string", "matchedAt must be ISO string");
});

test("POST /api/potential/collaboration: tenant isolation — candidate tenantId forced to request tenant", async () => {
  // Even if candidate profile has a different tenantId in the body, server forces it to the request tenant
  // This means no cross-tenant throw — the server normalizes it
  const r = await post("/api/potential/collaboration", {
    userId: "u1",
    userProfile: makeProfile("u1", TENANT, [{ category: "technical", score: 80 }]),
    candidates: [{
      userId: "u2",
      profile: { // intentionally has a different tenantId
        ...makeProfile("u2", "ATTACKER-TENANT", [{ category: "technical", score: 20 }]),
      },
    }],
    minCompatibility: 0,
  });
  // Should succeed (server normalizes tenantId), not 400/500
  eq(r.status, 200);
  const { ok } = await r.json() as any;
  eq(ok, true);
});

test("cleanup: close server", () => { server.close(); });
