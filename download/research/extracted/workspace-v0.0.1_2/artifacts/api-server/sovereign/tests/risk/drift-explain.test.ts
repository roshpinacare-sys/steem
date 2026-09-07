import "../_flush.mjs";
/**
 * tests/risk/drift-explain.test.ts
 *
 * Tests for:
 *   lib/risk/drift-explain.ts — explainDriftCompliance (§2.C sub-step 9)
 *   src/routes/drift-explain-routes.ts — POST /api/risk/drift-explain
 *
 * Coverage:
 *   Happy path  — deteriorating agent → escalated report with ranked factors
 *   Edge case   — stable agent → auto class, no escalation, factors still present
 *   Fail-closed — < 2 records → 400; missing agentId → 400; invalid score → 400
 */

import { test, assert, eq } from "../_harness.mjs";
import { explainDriftCompliance } from "../../lib/risk/drift-explain.ts";
import { startSovereignServer } from "../../src/http/sovereign-server.ts";

// ─── Unit tests: explainDriftCompliance ───────────────────────────────────────

test("drift-explain: deteriorating agent returns escalated report with drift factor first", () => {
  // Build a window where score falls steeply: 90 → 30 over 6 records.
  const records = [
    { score: 90, timestampMs: 1000 },
    { score: 78, timestampMs: 2000 },
    { score: 65, timestampMs: 3000 },
    { score: 50, timestampMs: 4000 },
    { score: 40, timestampMs: 5000 },
    { score: 30, timestampMs: 6000 },
  ];
  const report = explainDriftCompliance({ agentId: "agent:test-deteriorating", records });

  eq(report.agentId, "agent:test-deteriorating");
  assert(report.driftScore > 0, "driftScore positive for falling trend");
  eq(report.direction, "deteriorating");
  assert(report.riskScore > 0, "fused riskScore must be positive");
  assert(["human", "threshold_escrow", "deny"].includes(report.effectiveApprovalClass),
    `expected escalated class, got ${report.effectiveApprovalClass}`);
  assert(report.driftEscalated, "driftEscalated must be true for steep fall");

  // Factors must be sorted by absolute contribution descending.
  for (let i = 1; i < report.factors.length; i++) {
    assert(
      Math.abs(report.factors[i - 1].contribution) >= Math.abs(report.factors[i].contribution),
      "factors must be sorted by |contribution| descending",
    );
  }

  // At least one drift factor must be present.
  const driftFactor = report.factors.find((f) => f.isDrift);
  assert(driftFactor !== undefined, "must have at least one drift factor");

  // Recommendation must be non-empty and match the class.
  assert(report.recommendation.length > 0, "recommendation must be non-empty");
  assert(
    !report.recommendation.toLowerCase().includes("no immediate"),
    "escalated agent must not get 'no action' recommendation",
  );

  // Summary sentence must name the agent.
  assert(report.summary.includes("agent:test-deteriorating"), "summary must include agentId");
  assert(report.summary.includes("deteriorating"), "summary must state deteriorating");

  // Explanation lines must include factor breakdown header.
  assert(
    report.explanation.some((l) => l.includes("Factor breakdown")),
    "explanation must include factor breakdown",
  );
});

test("drift-explain: stable agent gets auto class, factors present, no escalation flag", () => {
  // Flat window: all scores ~50 → |rawTrend| small → stable.
  // Supply reputationScore: 50 (neutral) to avoid reputation:new escalation,
  // isolating the drift signal.
  const records = [
    { score: 50, timestampMs: 1000 },
    { score: 51, timestampMs: 2000 },
    { score: 49, timestampMs: 3000 },
    { score: 50, timestampMs: 4000 },
  ];
  const report = explainDriftCompliance({
    agentId: "agent:test-stable",
    records,
    context: { reputationScore: 50 }, // neutral reputation → no reputation escalation
  });

  assert(["stable", "improving"].includes(report.direction),
    `expected stable or improving, got ${report.direction}`);
  eq(report.effectiveApprovalClass, "auto");
  eq(report.driftEscalated, false);
  assert(report.factors.length > 0, "factors array must be non-empty");
  assert(report.recommendation.includes("No immediate"), "stable agent gets no-action recommendation");
  eq(report.agentId, "agent:test-stable");
  eq(report.windowSize, 4);
});

test("drift-explain: improving agent with reputationScore context is reflected in factors", () => {
  // Rising score: 30 → 85 — improving trend.
  const records = [
    { score: 30, timestampMs: 0 },
    { score: 55, timestampMs: 1000 },
    { score: 70, timestampMs: 2000 },
    { score: 85, timestampMs: 3000 },
  ];
  const report = explainDriftCompliance({
    agentId: "agent:rising",
    records,
    context: { reputationScore: 80 }, // high reputation → reputation:trusted factor
  });

  eq(report.direction, "improving");
  assert(report.driftScore < 0, "driftScore negative for rising trend");
  // reputation:trusted factor (contribution -10) should appear.
  const repFactor = report.factors.find((f) => f.factor === "reputation:trusted");
  assert(repFactor !== undefined, "reputation:trusted factor must appear with high reputationScore");
});

// ─── Fail-closed tests ────────────────────────────────────────────────────────

test("drift-explain: throws on < 2 records", () => {
  let threw = false;
  try {
    explainDriftCompliance({ agentId: "agent:x", records: [{ score: 50, timestampMs: 0 }] });
  } catch {
    threw = true;
  }
  assert(threw, "must throw for < 2 records");
});

test("drift-explain: throws on missing agentId", () => {
  let threw = false;
  try {
    explainDriftCompliance({
      agentId: "",
      records: [{ score: 50, timestampMs: 0 }, { score: 60, timestampMs: 1000 }],
    });
  } catch {
    threw = true;
  }
  assert(threw, "must throw for empty agentId");
});

test("drift-explain: throws on out-of-range score in records", () => {
  let threw = false;
  try {
    explainDriftCompliance({
      agentId: "agent:bad",
      records: [{ score: 150, timestampMs: 0 }, { score: 50, timestampMs: 1000 }],
    });
  } catch {
    threw = true;
  }
  assert(threw, "must throw for score > 100");
});

// ─── HTTP route tests ─────────────────────────────────────────────────────────

test("POST /api/risk/drift-explain: 200 with valid deteriorating input", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/risk/drift-explain`, {
      method: "POST",
      headers: {
        "x-tenant-id": "t1",
        "content-type": "application/json",
        "idempotency-key": "drift-explain-test-001",
      },
      body: JSON.stringify({
        agentId: "agent:http-test",
        records: [
          { score: 80, timestampMs: 0 },
          { score: 60, timestampMs: 1000 },
          { score: 40, timestampMs: 2000 },
        ],
      }),
    });
    eq(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert("agentId" in body, "body.agentId");
    assert("riskScore" in body, "body.riskScore");
    assert("driftScore" in body, "body.driftScore");
    assert("direction" in body, "body.direction");
    assert("effectiveApprovalClass" in body, "body.effectiveApprovalClass");
    assert(Array.isArray(body.factors), "body.factors must be array");
    assert("summary" in body, "body.summary");
    assert("recommendation" in body, "body.recommendation");
  } finally {
    server.close();
  }
});

test("POST /api/risk/drift-explain: 400 on missing x-tenant-id", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/risk/drift-explain`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "drift-explain-test-002" },
      body: JSON.stringify({ agentId: "a", records: [] }),
    });
    eq(res.status, 400);
  } finally {
    server.close();
  }
});

test("POST /api/risk/drift-explain: 400 on < 2 records", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/risk/drift-explain`, {
      method: "POST",
      headers: {
        "x-tenant-id": "t1",
        "content-type": "application/json",
        "idempotency-key": "drift-explain-test-003",
      },
      body: JSON.stringify({
        agentId: "agent:x",
        records: [{ score: 50, timestampMs: 0 }],
      }),
    });
    eq(res.status, 400);
    const body = await res.json() as Record<string, unknown>;
    assert(typeof body.error === "string" && body.error.includes("2"), "error must mention minimum records");
  } finally {
    server.close();
  }
});

test("POST /api/risk/drift-explain: 400 on missing agentId", async () => {
  const server = startSovereignServer(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/risk/drift-explain`, {
      method: "POST",
      headers: {
        "x-tenant-id": "t1",
        "content-type": "application/json",
        "idempotency-key": "drift-explain-test-004",
      },
      body: JSON.stringify({
        agentId: "",
        records: [{ score: 50, timestampMs: 0 }, { score: 60, timestampMs: 1000 }],
      }),
    });
    eq(res.status, 400);
  } finally {
    server.close();
  }
});
