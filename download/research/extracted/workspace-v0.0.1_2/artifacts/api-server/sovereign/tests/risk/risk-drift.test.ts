/**
 * tests/risk/risk-drift.test.ts — v398.
 * scoreRiskDrift: deterministic deterioration slope (§2.C sub-step 7).
 *
 *   HAPPY         flat window → stable/0; rising → improving; falling → deteriorating
 *   MONOTONIC     escalation is "auto" when stable/improving; escalates on deterioration
 *   EDGE          two-record window; unsorted input; identical timestamps (zero span)
 *   FAIL-CLOSED   < 2 records, non-number score, out-of-range score, non-number ts,
 *                 null input, non-array input, non-object record
 */
import { test, assert, eq } from "../_harness.mjs";
import { scoreRiskDrift } from "../../lib/risk/risk-drift.ts";
import type { DriftRecord } from "../../lib/risk/risk-drift.ts";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build an evenly-spaced window: N records, each 1 hour apart, with the
 *  score changing by `delta` per step. */
function buildWindow(n: number, startScore: number, delta: number): DriftRecord[] {
  const MS_PER_HOUR = 3_600_000;
  return Array.from({ length: n }, (_, i) => ({
    score: startScore + i * delta,
    timestampMs: 1_000_000_000_000 + i * MS_PER_HOUR,
  }));
}

// ─── happy path ─────────────────────────────────────────────────────────────

test("flat window → driftScore ≈ 0, direction stable, escalation auto", () => {
  const records = buildWindow(5, 60, 0); // score constant at 60
  const r = scoreRiskDrift(records);
  eq(r.driftScore, 0);
  eq(r.direction, "stable");
  eq(r.driftEscalation, "auto");
  eq(r.windowSize, 5);
  assert(r.windowSpanMs > 0);
});

test("clearly rising score → direction improving, driftScore negative, escalation auto", () => {
  // Score rises 5 points per hour over 10 hours → large positive rawTrend
  const records = buildWindow(11, 40, 5);
  const r = scoreRiskDrift(records);
  assert(r.driftScore < 0, `expected driftScore < 0, got ${r.driftScore}`);
  eq(r.direction, "improving");
  eq(r.driftEscalation, "auto");
});

test("mildly falling score → deteriorating, escalation human", () => {
  // Score falls 3 points per hour over 10 hours → rawTrend = -30 → driftScore = 30
  const records = buildWindow(11, 70, -3);
  const r = scoreRiskDrift(records);
  assert(r.driftScore > 0, `expected driftScore > 0, got ${r.driftScore}`);
  eq(r.direction, "deteriorating");
  eq(r.driftEscalation, "human");
});

test("rapidly falling score → escalation threshold_escrow", () => {
  // Score falls 6 points per hour over 10 hours → rawTrend = -60 → driftScore ≈ 60
  const records = buildWindow(11, 70, -6);
  const r = scoreRiskDrift(records);
  assert(r.driftScore >= 55, `expected driftScore ≥ 55, got ${r.driftScore}`);
  eq(r.driftEscalation, "threshold_escrow");
});

test("catastrophically falling score → escalation deny", () => {
  // Score drops from 90 to 0 over 10 steps: -9 per step → rawTrend ≈ -90
  const records = buildWindow(11, 90, -9);
  const r = scoreRiskDrift(records);
  assert(r.driftScore >= 80, `expected driftScore ≥ 80, got ${r.driftScore}`);
  eq(r.driftEscalation, "deny");
  eq(r.direction, "deteriorating");
});

test("result contains non-empty explanation and factors", () => {
  const records = buildWindow(4, 50, -2);
  const r = scoreRiskDrift(records);
  assert(Array.isArray(r.explanation) && r.explanation.length > 0, "explanation non-empty");
  assert(Array.isArray(r.factors) && r.factors.length > 0, "factors non-empty");
  assert(r.explanation[0].includes("drift score"), "explanation summary present");
});

test("determinism: same input always yields same output", () => {
  const records = buildWindow(8, 60, -4);
  const a = scoreRiskDrift(records);
  const b = scoreRiskDrift(records);
  eq(a.driftScore, b.driftScore);
  eq(a.direction, b.direction);
  eq(a.driftEscalation, b.driftEscalation);
  eq(a.slopePerMs, b.slopePerMs);
});

// ─── edge cases ──────────────────────────────────────────────────────────────

test("two-record window — minimum valid input", () => {
  const records: DriftRecord[] = [
    { score: 70, timestampMs: 1_000_000_000_000 },
    { score: 40, timestampMs: 1_000_003_600_000 }, // 1 hour later, fell 30 pts
  ];
  const r = scoreRiskDrift(records);
  eq(r.windowSize, 2);
  assert(r.driftScore > 0, "falling score → positive drift");
  eq(r.direction, "deteriorating");
});

test("unsorted input is sorted before regression — same result as sorted", () => {
  const sorted = buildWindow(5, 60, -4);
  const shuffled = [sorted[4], sorted[2], sorted[0], sorted[3], sorted[1]];
  const rSorted = scoreRiskDrift(sorted);
  const rShuffled = scoreRiskDrift(shuffled);
  eq(rSorted.driftScore, rShuffled.driftScore);
  eq(rSorted.direction, rShuffled.direction);
  eq(rSorted.slopePerMs, rShuffled.slopePerMs);
});

test("all identical timestamps → slope=0, stable, no divide-by-zero", () => {
  const ts = 1_700_000_000_000;
  const records: DriftRecord[] = [
    { score: 80, timestampMs: ts },
    { score: 40, timestampMs: ts },
    { score: 60, timestampMs: ts },
  ];
  const r = scoreRiskDrift(records);
  eq(r.slopePerMs, 0);
  eq(r.driftScore, 0);
  eq(r.direction, "stable");
  eq(r.driftEscalation, "auto");
  eq(r.windowSpanMs, 0);
});

test("boundary score values 0 and 100 are valid", () => {
  const records: DriftRecord[] = [
    { score: 0, timestampMs: 1_000_000_000_000 },
    { score: 100, timestampMs: 1_000_003_600_000 },
  ];
  const r = scoreRiskDrift(records); // rising from 0 to 100 → improving
  assert(r.driftScore <= 0, `expected non-positive drift, got ${r.driftScore}`);
  eq(r.direction, "improving");
});

test("slopePerMs is raw and unscaled (returns real number)", () => {
  const records = buildWindow(3, 50, -10);
  const r = scoreRiskDrift(records);
  assert(typeof r.slopePerMs === "number" && Number.isFinite(r.slopePerMs));
  assert(r.slopePerMs < 0, "score falling → negative slope");
});

// ─── fail-closed ─────────────────────────────────────────────────────────────

test("fail-closed: null input throws", () => {
  let threw = false;
  try { scoreRiskDrift(null as unknown as DriftRecord[]); } catch { threw = true; }
  assert(threw, "null input must throw");
});

test("fail-closed: non-array input throws", () => {
  let threw = false;
  try { scoreRiskDrift("oops" as unknown as DriftRecord[]); } catch { threw = true; }
  assert(threw, "non-array must throw");
});

test("fail-closed: empty array throws", () => {
  let threw = false;
  try { scoreRiskDrift([]); } catch { threw = true; }
  assert(threw, "0 records must throw");
});

test("fail-closed: single record throws", () => {
  let threw = false;
  try { scoreRiskDrift([{ score: 70, timestampMs: 1_000_000_000_000 }]); } catch { threw = true; }
  assert(threw, "1 record must throw");
});

test("fail-closed: score below 0 throws", () => {
  let threw = false;
  try {
    scoreRiskDrift([
      { score: -1, timestampMs: 1_000_000_000_000 },
      { score: 50, timestampMs: 1_000_003_600_000 },
    ]);
  } catch { threw = true; }
  assert(threw, "score < 0 must throw");
});

test("fail-closed: score above 100 throws", () => {
  let threw = false;
  try {
    scoreRiskDrift([
      { score: 101, timestampMs: 1_000_000_000_000 },
      { score: 50, timestampMs: 1_000_003_600_000 },
    ]);
  } catch { threw = true; }
  assert(threw, "score > 100 must throw");
});

test("fail-closed: NaN score throws", () => {
  let threw = false;
  try {
    scoreRiskDrift([
      { score: NaN, timestampMs: 1_000_000_000_000 },
      { score: 50, timestampMs: 1_000_003_600_000 },
    ]);
  } catch { threw = true; }
  assert(threw, "NaN score must throw");
});

test("fail-closed: non-number score throws", () => {
  let threw = false;
  try {
    scoreRiskDrift([
      { score: "high" as unknown as number, timestampMs: 1_000_000_000_000 },
      { score: 50, timestampMs: 1_000_003_600_000 },
    ]);
  } catch { threw = true; }
  assert(threw, "string score must throw");
});

test("fail-closed: NaN timestampMs throws", () => {
  let threw = false;
  try {
    scoreRiskDrift([
      { score: 70, timestampMs: NaN },
      { score: 50, timestampMs: 1_000_003_600_000 },
    ]);
  } catch { threw = true; }
  assert(threw, "NaN timestamp must throw");
});

test("fail-closed: non-number timestampMs throws", () => {
  let threw = false;
  try {
    scoreRiskDrift([
      { score: 70, timestampMs: "yesterday" as unknown as number },
      { score: 50, timestampMs: 1_000_003_600_000 },
    ]);
  } catch { threw = true; }
  assert(threw, "string timestamp must throw");
});

test("fail-closed: non-object record entry throws", () => {
  let threw = false;
  try {
    scoreRiskDrift([
      null as unknown as DriftRecord,
      { score: 50, timestampMs: 1_000_003_600_000 },
    ]);
  } catch { threw = true; }
  assert(threw, "null record entry must throw");
});
