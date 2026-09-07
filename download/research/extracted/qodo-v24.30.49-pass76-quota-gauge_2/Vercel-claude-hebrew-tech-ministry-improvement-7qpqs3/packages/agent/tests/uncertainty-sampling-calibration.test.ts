/**
 * uncertainty-sampling-calibration.test.ts  —  Task-21  (Pass 60)
 *
 * CALIBRATION AUDIT for uncertainty-sampling.ts and confidence-scorer.ts
 *
 * ─── Background ────────────────────────────────────────────────────────────
 * uncertainty-sampling.ts computes a composite uncertainty score (0–1) from
 * five weighted signals and routes the run to either "auto-proceed" or
 * "mentor-mode" based on a threshold of 0.30.
 *
 *   uncertainty =
 *     (1 − historicalReliability) × 0.30
 *   + (1 − confidenceScore/100)   × 0.25
 *   + consensusUncertainty(votes) × 0.25
 *   + (redTeamHighSeverity ? 1:0) × 0.15
 *   + (1 − trustBondScore/100)    × 0.05
 *
 * ─── The calibration question ──────────────────────────────────────────────
 * "Does a patch scored, say, '80% confident' (confidenceScore=80) actually
 *  produce a routing decision commensurate with 80% auto-proceed probability?
 *  Or does the composite weight scheme create a gap between the raw score and
 *  the effective routing?"
 *
 * ─── Scope clarification (per task-21 notes) ───────────────────────────────
 * TRUE calibration — "of all patches scored ≥80% confident, do ≥80% pass
 * the gate?" — requires a labeled outcome distribution from production runs
 * (task-6, not yet available).  This pass validates the calibration MATH:
 *   1. Weight invariants (weights sum to 1, all positive).
 *   2. Input clamping (out-of-range inputs are safe).
 *   3. Extreme inputs produce the expected min/max uncertainty.
 *   4. Each factor drives uncertainty independently (monotonicity).
 *   5. Routing threshold mechanics at the 0.30 boundary.
 *   6. Consensus sub-formula math (agreement, variance, mixed votes).
 *   7. Calibration curve shape: a synthetic 11-point confidence decile sweep
 *      produces a monotonically-decreasing, linearly-spaced uncertainty curve.
 *   8. Design boundaries: documented gaps that cannot be fixed by math alone.
 *
 * ─── Design boundaries discovered ─────────────────────────────────────────
 * DB-1 (Neutral-input bias toward mentor-mode):
 *   Perfectly neutral inputs (historicalReliability=0.5, confidenceScore=50,
 *   no votes, no redTeam, trustBond=50) produce uncertainty ≈ 0.3875, which
 *   is above the 0.30 threshold and therefore routes to mentor-mode.
 *   The "safe default" is caution, not auto-proceed.  This is intentional —
 *   the threshold is deliberately asymmetric.  Documented here so future
 *   passes don't try to "fix" it without understanding the reasoning.
 *
 * DB-2 (Confidence score ≠ gate-pass probability):
 *   With all other signals held neutral (historical=0.5, no votes, trust=50),
 *   a confidenceScore of exactly 85 produces uncertainty = 0.30 (threshold).
 *   A confidenceScore of 86 produces uncertainty ≈ 0.2975 (auto-proceed).
 *   A user-visible "85% confidence" does not map to "85% auto-proceed rate";
 *   the effective crossing point depends on all five weight components.
 *
 * DB-3 (No-votes consensus is non-zero uncertainty):
 *   When no model votes are supplied, normalizedAgreement returns 0.5
 *   (neutral/unknown) and variance returns 0.  This produces a consensus
 *   uncertainty of (1-0.5)*0.7 + 0*0.3 = 0.35, not 0.  Absence of evidence
 *   is treated as partial uncertainty, contributing 0.35 × 0.25 = 0.0875 to
 *   the total.  Callers that supply zero votes should be aware they are not
 *   getting "zero consensus uncertainty" — they get 0.0875.
 *
 * DB-4 (High confidence alone is not sufficient for auto-proceed):
 *   With worst-case historical reliability (historicalReliability=0) and all
 *   else held constant (no votes, no redTeam, trustBond=50), even a
 *   confidenceScore of 100 produces:
 *     uncertainty = 0.30 + 0 + 0.0875 + 0 + 0.025 = 0.4125 → mentor-mode.
 *   All five signals together gate the route; confidence alone is insufficient.
 *
 * ─── Test structure ────────────────────────────────────────────────────────
 *  Suite A: Weight invariants
 *  Suite B: Input clamping and normalization
 *  Suite C: Extreme-input calibration (min/max uncertainty)
 *  Suite D: Monotonicity — each factor independently drives uncertainty
 *  Suite E: Routing threshold mechanics at 0.30
 *  Suite F: Consensus sub-formula math
 *  Suite G: Calibration curve shape (synthetic decile sweep)
 *  Suite H: Design boundary documentation
 *
 * ─── Implementation note ──────────────────────────────────────────────────
 * All tests use the real sampleUncertainty() synchronous function directly.
 * No Redis, no D1, no network.  sampleUncertaintyAsync() is not exercised
 * here — it delegates to the synchronous path after an optional D1 lookup
 * that requires live state; that surface belongs in an integration test.
 */

import { describe, it, expect } from "vitest";
import {
  sampleUncertainty,
  type UncertaintyInput,
  type ModelVote,
} from "../src/services/uncertainty-sampling.js";

// ── Exported constants from the module (re-declared here for test assertions)
// These match the source; if the source changes, update here AND fix the tests.
const HISTORICAL_WEIGHT = 0.30;
const CONFIDENCE_WEIGHT = 0.25;
const CONSENSUS_WEIGHT  = 0.25;
const RED_TEAM_WEIGHT   = 0.15;
const TRUST_WEIGHT      = 0.05;
const ROUTE_THRESHOLD   = 0.30; // uncertainty >= this → mentor-mode

/** Precision for floating-point assertions (5 decimal places). */
const PREC = 5;

function round(n: number, digits = PREC): number {
  return Number(n.toFixed(digits));
}

/** Compute expected consensus uncertainty from optional votes (mirrors source). */
function expectedConsensusUncertainty(votes: ModelVote[] | undefined): number {
  if (!votes || votes.length < 2) {
    // agreement = 0.5 (neutral), variance = 0
    return (1 - 0.5) * 0.7 + 0 * 0.3;
  }
  const groups = new Map<string, number>();
  for (const v of votes) {
    const key = v.answer.trim().toLowerCase();
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const maxCount = Math.max(...groups.values());
  const agreement = maxCount / votes.length;
  const mean = votes.reduce((s, v) => s + v.confidence, 0) / votes.length;
  const variance = votes.reduce((s, v) => s + Math.pow(v.confidence - mean, 2), 0) / votes.length;
  const normVariance = Math.min(1, variance / 2500);
  return (1 - agreement) * 0.7 + normVariance * 0.3;
}

/** Compute the expected raw uncertainty given fully-specified inputs. */
function expectedUncertainty(input: Omit<Required<UncertaintyInput>, "modelVotes"> & { modelVotes?: ModelVote[] }): number {
  const historicalUncertainty = 1 - Math.min(1, Math.max(0, input.historicalReliability));
  const confidenceUncertainty = 1 - Math.min(100, Math.max(0, input.confidenceScore)) / 100;
  const consensusU = expectedConsensusUncertainty(input.modelVotes);
  const redTeamU = input.redTeamHighSeverity ? 1.0 : 0.0;
  const trustU = 1 - Math.min(100, Math.max(0, input.trustBondScore)) / 100;

  return (
    historicalUncertainty * HISTORICAL_WEIGHT +
    confidenceUncertainty * CONFIDENCE_WEIGHT +
    consensusU            * CONSENSUS_WEIGHT  +
    redTeamU              * RED_TEAM_WEIGHT   +
    trustU                * TRUST_WEIGHT
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite A — Weight invariants
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite A — Weight invariants", () => {
  it("A1: weights sum to exactly 1.0", () => {
    const sum = HISTORICAL_WEIGHT + CONFIDENCE_WEIGHT + CONSENSUS_WEIGHT +
                RED_TEAM_WEIGHT   + TRUST_WEIGHT;
    expect(round(sum)).toBe(1.00000);
  });

  it("A2: each weight is strictly positive", () => {
    expect(HISTORICAL_WEIGHT).toBeGreaterThan(0);
    expect(CONFIDENCE_WEIGHT).toBeGreaterThan(0);
    expect(CONSENSUS_WEIGHT).toBeGreaterThan(0);
    expect(RED_TEAM_WEIGHT).toBeGreaterThan(0);
    expect(TRUST_WEIGHT).toBeGreaterThan(0);
  });

  it("A3: historical carries the single largest weight (anchors the formula)", () => {
    const weights = [HISTORICAL_WEIGHT, CONFIDENCE_WEIGHT, CONSENSUS_WEIGHT,
                     RED_TEAM_WEIGHT,   TRUST_WEIGHT];
    expect(HISTORICAL_WEIGHT).toBe(Math.max(...weights));
  });

  it("A4: red-team weight is greater than trust weight", () => {
    // Red-team findings should carry more weight than trust-bond signal alone.
    expect(RED_TEAM_WEIGHT).toBeGreaterThan(TRUST_WEIGHT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite B — Input clamping and normalization
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite B — Input clamping and normalization", () => {
  it("B1: historicalReliability > 1 is clamped to 1 (zero historical uncertainty)", () => {
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 100, historicalReliability: 999,
      trustBondScore: 100, redTeamHighSeverity: false,
    });
    // Clamped to 1 → historicalUncertainty = 0
    // confidence=100 → 0, no votes → 0.0875, trust=100 → 0
    expect(round(result.uncertainty)).toBe(round(0 + 0 + 0.0875 + 0 + 0));
    expect(result.route).toBe("auto-proceed");
  });

  it("B2: historicalReliability < 0 is clamped to 0 (full historical uncertainty)", () => {
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 100, historicalReliability: -5,
      trustBondScore: 100, redTeamHighSeverity: false,
    });
    // historicalReliability clamped to 0 → historicalUncertainty = 1
    // confidence=100 → 0, no votes → 0.0875, trust=100 → 0
    expect(round(result.uncertainty)).toBe(round(0.30 + 0 + 0.0875 + 0 + 0));
    expect(result.route).toBe("mentor-mode");
  });

  it("B3: confidenceScore > 100 is clamped to 100 (zero confidence uncertainty)", () => {
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 9999, historicalReliability: 1,
      trustBondScore: 100, redTeamHighSeverity: false,
    });
    // clamped to 100 → confidenceUncertainty = 0
    expect(round(result.uncertainty)).toBe(round(0 + 0 + 0.0875 + 0 + 0));
    expect(result.route).toBe("auto-proceed");
  });

  it("B4: confidenceScore < 0 is clamped to 0 (full confidence uncertainty)", () => {
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: -100, historicalReliability: 1,
      trustBondScore: 100, redTeamHighSeverity: false,
    });
    // clamped to 0 → confidenceUncertainty = 1
    expect(round(result.uncertainty)).toBe(round(0 + 0.25 + 0.0875 + 0 + 0));
    expect(result.route).toBe("mentor-mode");
  });

  it("B5: trustBondScore > 100 is clamped to 100 (zero trust uncertainty)", () => {
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 100, historicalReliability: 1,
      trustBondScore: 200, redTeamHighSeverity: false,
    });
    expect(round(result.uncertainty)).toBe(round(0 + 0 + 0.0875 + 0 + 0));
    expect(result.route).toBe("auto-proceed");
  });

  it("B6: trustBondScore < 0 is clamped to 0 (full trust uncertainty)", () => {
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 100, historicalReliability: 1,
      trustBondScore: -10, redTeamHighSeverity: false,
    });
    // trustUncertainty = 1 → 0.05
    expect(round(result.uncertainty)).toBe(round(0 + 0 + 0.0875 + 0 + 0.05));
    expect(result.route).toBe("auto-proceed");
  });

  it("B7: missing historicalReliability defaults to 0.5 (neutral)", () => {
    const withDefault = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 50, trustBondScore: 50, redTeamHighSeverity: false,
    });
    const withExplicit = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 50, historicalReliability: 0.5,
      trustBondScore: 50, redTeamHighSeverity: false,
    });
    expect(round(withDefault.uncertainty)).toBe(round(withExplicit.uncertainty));
  });

  it("B8: missing trustBondScore defaults to 50 (neutral)", () => {
    const withDefault = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 50, historicalReliability: 0.5,
      redTeamHighSeverity: false,
    });
    const withExplicit = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 50, historicalReliability: 0.5,
      trustBondScore: 50, redTeamHighSeverity: false,
    });
    expect(round(withDefault.uncertainty)).toBe(round(withExplicit.uncertainty));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite C — Extreme-input calibration (min/max uncertainty)
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite C — Extreme-input calibration", () => {
  const perfectVotes: ModelVote[] = [
    { provider: "groq",       answer: "yes", confidence: 100 },
    { provider: "openrouter", answer: "yes", confidence: 100 },
    { provider: "gemini",     answer: "yes", confidence: 100 },
  ];

  it("C1: all-best inputs produce uncertainty = 0 and route to auto-proceed", () => {
    const result = sampleUncertainty({
      objective: "fix typo", category: "cosmetic",
      confidenceScore: 100,
      historicalReliability: 1,
      modelVotes: perfectVotes,
      redTeamHighSeverity: false,
      trustBondScore: 100,
    });
    expect(result.uncertainty).toBe(0);
    expect(result.route).toBe("auto-proceed");
  });

  it("C2: all-best inputs without model votes produce non-zero consensus contribution", () => {
    // DB-3: absence of votes always contributes 0.0875 to uncertainty
    const result = sampleUncertainty({
      objective: "fix typo", category: "cosmetic",
      confidenceScore: 100,
      historicalReliability: 1,
      redTeamHighSeverity: false,
      trustBondScore: 100,
    });
    expect(round(result.uncertainty)).toBe(round(0.0875));
    expect(result.route).toBe("auto-proceed");
  });

  it("C3: worst inputs (opposing votes + all zeroes + redTeam) produce uncertainty > 0.9", () => {
    const opposingVotes: ModelVote[] = [
      { provider: "groq",       answer: "yes", confidence: 0   },
      { provider: "openrouter", answer: "no",  confidence: 100 },
    ];
    const result = sampleUncertainty({
      objective: "risky refactor", category: "refactor",
      confidenceScore: 0,
      historicalReliability: 0,
      modelVotes: opposingVotes,
      redTeamHighSeverity: true,
      trustBondScore: 0,
    });
    // Expected: 0.30 + 0.25 + 0.1625 + 0.15 + 0.05 = 0.9125
    expect(result.uncertainty).toBeGreaterThanOrEqual(0.9);
    expect(result.route).toBe("mentor-mode");
  });

  it("C4: uncertainty is always in [0, 1] — never outside the valid range", () => {
    const extremes: UncertaintyInput[] = [
      { objective: "x", category: "feature", confidenceScore: 0,   historicalReliability: 0, redTeamHighSeverity: true,  trustBondScore: 0 },
      { objective: "x", category: "feature", confidenceScore: 100, historicalReliability: 1, redTeamHighSeverity: false, trustBondScore: 100 },
      { objective: "x", category: "feature", confidenceScore: 9999, historicalReliability: 999, redTeamHighSeverity: false, trustBondScore: 9999 },
      { objective: "x", category: "feature", confidenceScore: -999, historicalReliability: -1, redTeamHighSeverity: true,  trustBondScore: -999 },
    ];
    for (const input of extremes) {
      const { uncertainty } = sampleUncertainty(input);
      expect(uncertainty).toBeGreaterThanOrEqual(0);
      expect(uncertainty).toBeLessThanOrEqual(1);
    }
  });

  it("C5: pure confidence score of 100 alone does not guarantee auto-proceed (DB-4)", () => {
    // Worst historical reliability, neutral trust, no votes
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 100,
      historicalReliability: 0,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    });
    // 0.30 + 0 + 0.0875 + 0 + 0.025 = 0.4125 → mentor-mode
    expect(round(result.uncertainty)).toBe(round(0.4125));
    expect(result.route).toBe("mentor-mode");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite D — Monotonicity: each factor drives uncertainty independently
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite D — Monotonicity", () => {
  const base: UncertaintyInput = {
    objective: "test", category: "feature",
    confidenceScore: 60,
    historicalReliability: 0.6,
    redTeamHighSeverity: false,
    trustBondScore: 60,
  };

  it("D1: increasing confidenceScore monotonically decreases uncertainty", () => {
    const levels = [0, 20, 40, 60, 80, 100];
    const uncertainties = levels.map((c) =>
      sampleUncertainty({ ...base, confidenceScore: c }).uncertainty,
    );
    for (let i = 1; i < uncertainties.length; i++) {
      expect(uncertainties[i]).toBeLessThan(uncertainties[i - 1]);
    }
  });

  it("D2: increasing historicalReliability monotonically decreases uncertainty", () => {
    const levels = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const uncertainties = levels.map((h) =>
      sampleUncertainty({ ...base, historicalReliability: h }).uncertainty,
    );
    for (let i = 1; i < uncertainties.length; i++) {
      expect(uncertainties[i]).toBeLessThan(uncertainties[i - 1]);
    }
  });

  it("D3: increasing trustBondScore monotonically decreases uncertainty", () => {
    const levels = [0, 20, 40, 60, 80, 100];
    const uncertainties = levels.map((t) =>
      sampleUncertainty({ ...base, trustBondScore: t }).uncertainty,
    );
    for (let i = 1; i < uncertainties.length; i++) {
      expect(uncertainties[i]).toBeLessThan(uncertainties[i - 1]);
    }
  });

  it("D4: redTeamHighSeverity=true increases uncertainty by exactly RED_TEAM_WEIGHT", () => {
    const without = sampleUncertainty({ ...base, redTeamHighSeverity: false });
    const withRedTeam = sampleUncertainty({ ...base, redTeamHighSeverity: true });
    expect(round(withRedTeam.uncertainty - without.uncertainty)).toBe(round(RED_TEAM_WEIGHT));
  });

  it("D5: each factor contributes independently — superposition holds", () => {
    // An improvement in confidence and historical together should reduce by the sum of
    // their individual reductions.
    const deltaConf = 20;
    const deltaHist = 0.2;

    const u0 = sampleUncertainty({ ...base }).uncertainty;
    const uConf = sampleUncertainty({ ...base, confidenceScore: base.confidenceScore! + deltaConf }).uncertainty;
    const uHist = sampleUncertainty({ ...base, historicalReliability: base.historicalReliability! + deltaHist }).uncertainty;
    const uBoth = sampleUncertainty({ ...base, confidenceScore: base.confidenceScore! + deltaConf, historicalReliability: base.historicalReliability! + deltaHist }).uncertainty;

    const reductionConf = u0 - uConf;
    const reductionHist = u0 - uHist;
    const reductionBoth = u0 - uBoth;

    // Because the formula is purely linear, the reductions must be additive.
    expect(round(reductionBoth)).toBe(round(reductionConf + reductionHist));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite E — Routing threshold mechanics at 0.30
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite E — Routing threshold mechanics", () => {
  it("E1: uncertainty exactly at 0.30 routes to mentor-mode (>= is inclusive)", () => {
    // historicalReliability=0.5, confidenceScore=85, no votes, no redTeam, trustBond=50
    // uncertainty = 0.5*0.30 + 0.15*0.25 + 0.35*0.25 + 0 + 0.5*0.05
    //             = 0.15 + 0.0375 + 0.0875 + 0 + 0.025 = 0.300
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 85,
      historicalReliability: 0.5,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    });
    expect(round(result.uncertainty)).toBe(round(ROUTE_THRESHOLD));
    expect(result.route).toBe("mentor-mode");
  });

  it("E2: uncertainty just below 0.30 routes to auto-proceed", () => {
    // confidenceScore=86 → confidenceUncertainty = 0.14
    // uncertainty = 0.15 + 0.14*0.25 + 0.0875 + 0 + 0.025
    //             = 0.15 + 0.035 + 0.0875 + 0 + 0.025 = 0.2975
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 86,
      historicalReliability: 0.5,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    });
    expect(round(result.uncertainty)).toBe(round(0.2975));
    expect(result.route).toBe("auto-proceed");
  });

  it("E3: one-step below threshold is consistently auto-proceed, one-step above is mentor-mode", () => {
    const sharedBase: Omit<UncertaintyInput, "confidenceScore"> = {
      objective: "test", category: "feature",
      historicalReliability: 0.5,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    };
    // confidenceScore=85 → exactly 0.30 → mentor-mode
    expect(sampleUncertainty({ ...sharedBase, confidenceScore: 85 }).route).toBe("mentor-mode");
    // confidenceScore=86 → 0.2975 → auto-proceed
    expect(sampleUncertainty({ ...sharedBase, confidenceScore: 86 }).route).toBe("auto-proceed");
  });

  it("E4: route is always one of the two valid values", () => {
    const results = [0, 25, 50, 75, 100].map((c) =>
      sampleUncertainty({ objective: "t", category: "feature", confidenceScore: c }),
    );
    for (const r of results) {
      expect(["auto-proceed", "mentor-mode"]).toContain(r.route);
    }
  });

  it("E5: reason string includes the uncertainty percentage value", () => {
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 50,
      historicalReliability: 0.5,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    });
    // Should contain a percentage number
    expect(result.reason).toMatch(/\d+%/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite F — Consensus sub-formula math
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite F — Consensus sub-formula math", () => {
  const baseNoVotes: UncertaintyInput = {
    objective: "test", category: "feature",
    confidenceScore: 100, historicalReliability: 1,
    redTeamHighSeverity: false, trustBondScore: 100,
  };

  it("F1: no votes (undefined) → consensus contributes 0.0875 (DB-3)", () => {
    // agreement=0.5, variance=0 → consensusU = 0.35 → × 0.25 = 0.0875
    const result = sampleUncertainty({ ...baseNoVotes });
    expect(round(result.uncertainty)).toBe(round(0.0875));
  });

  it("F2: single vote → same as no votes (not enough for agreement calc)", () => {
    const result = sampleUncertainty({
      ...baseNoVotes,
      modelVotes: [{ provider: "groq", answer: "yes", confidence: 100 }],
    });
    expect(round(result.uncertainty)).toBe(round(0.0875));
  });

  it("F3: perfect agreement among 3 votes at same confidence → consensus = 0", () => {
    const votes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 90 },
      { provider: "b", answer: "yes", confidence: 90 },
      { provider: "c", answer: "yes", confidence: 90 },
    ];
    const result = sampleUncertainty({ ...baseNoVotes, modelVotes: votes });
    // agreement=1, variance=0 → consensusU = 0
    expect(result.uncertainty).toBe(0);
    expect(result.route).toBe("auto-proceed");
  });

  it("F4: perfect agreement with case-insensitive answer matching", () => {
    const votes: ModelVote[] = [
      { provider: "a", answer: "YES",  confidence: 80 },
      { provider: "b", answer: "yes ", confidence: 80 },
      { provider: "c", answer: "Yes",  confidence: 80 },
    ];
    const result = sampleUncertainty({ ...baseNoVotes, modelVotes: votes });
    // All map to "yes" after trim+lowercase → perfect agreement
    expect(result.uncertainty).toBe(0);
  });

  it("F5: 50/50 split (2 votes, opposing answers, same confidence) → consensus from answer disagreement only", () => {
    const votes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 70 },
      { provider: "b", answer: "no",  confidence: 70 },
    ];
    // agreement = 0.5, variance = 0 (same confidence) → consensusU = 0.35
    const result = sampleUncertainty({ ...baseNoVotes, modelVotes: votes });
    expect(round(result.uncertainty)).toBe(round(0.35 * CONSENSUS_WEIGHT));
    expect(result.route).toBe("auto-proceed"); // 0.0875 < 0.30
  });

  it("F6: same answer but maximally spread confidences → consensus from variance only", () => {
    const votes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 0   },
      { provider: "b", answer: "yes", confidence: 100 },
    ];
    // agreement = 1.0, mean=50, variance=2500, normVariance=1.0
    // consensusU = 0*0.7 + 1.0*0.3 = 0.3
    const result = sampleUncertainty({ ...baseNoVotes, modelVotes: votes });
    expect(round(result.uncertainty)).toBe(round(0.3 * CONSENSUS_WEIGHT));
  });

  it("F7: worst consensus (opposing answers + max confidence spread) produces max consensusU", () => {
    const votes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 0   },
      { provider: "b", answer: "no",  confidence: 100 },
    ];
    // agreement=0.5, mean=50, variance=2500, normVariance=1.0
    // consensusU = 0.5*0.7 + 1.0*0.3 = 0.35 + 0.30 = 0.65
    const result = sampleUncertainty({ ...baseNoVotes, modelVotes: votes });
    expect(round(result.uncertainty)).toBe(round(0.65 * CONSENSUS_WEIGHT));
  });

  it("F8: 3-to-1 majority reduces agreement uncertainty proportionally", () => {
    const votes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 90 },
      { provider: "b", answer: "yes", confidence: 90 },
      { provider: "c", answer: "yes", confidence: 90 },
      { provider: "d", answer: "no",  confidence: 90 },
    ];
    // agreement = 3/4 = 0.75, same confidence → variance=0
    // consensusU = (1-0.75)*0.7 + 0 = 0.175
    const result = sampleUncertainty({ ...baseNoVotes, modelVotes: votes });
    expect(round(result.uncertainty)).toBe(round(0.175 * CONSENSUS_WEIGHT));
  });

  it("F9: confidence variance above 50pt scale cap is clamped at 1.0 normVariance", () => {
    // variance of 2500 (50pt std dev) should produce normVariance=1.0 (max, not beyond)
    const votes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 0   },
      { provider: "b", answer: "yes", confidence: 100 },
    ];
    const expected = expectedConsensusUncertainty(votes);
    const result = sampleUncertainty({ ...baseNoVotes, modelVotes: votes });
    expect(round(result.uncertainty)).toBe(round(expected * CONSENSUS_WEIGHT));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite G — Calibration curve shape (synthetic decile sweep)
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite G — Calibration curve shape", () => {
  /**
   * Sweeps confidenceScore from 0 to 100 in steps of 10, with all other signals
   * held at their best values (historical=1, perfect votes, no redTeam, trust=100).
   * Under these conditions the only variable is confidence, so the uncertainty
   * curve must be perfectly linear with a slope of -0.0025 per point.
   */
  it("G1: confidence sweep (0–100) with all-best other signals is perfectly linear", () => {
    const perfectVotes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 100 },
      { provider: "b", answer: "yes", confidence: 100 },
    ];
    const uncertainties: number[] = [];
    for (let c = 0; c <= 100; c += 10) {
      const r = sampleUncertainty({
        objective: "t", category: "feature",
        confidenceScore: c,
        historicalReliability: 1,
        modelVotes: perfectVotes,
        redTeamHighSeverity: false,
        trustBondScore: 100,
      });
      uncertainties.push(r.uncertainty);
    }

    // Monotonically decreasing
    for (let i = 1; i < uncertainties.length; i++) {
      expect(uncertainties[i]).toBeLessThan(uncertainties[i - 1]);
    }

    // Each step reduces uncertainty by exactly CONFIDENCE_WEIGHT * 0.10 = 0.025
    const expectedStep = CONFIDENCE_WEIGHT * 0.10;
    for (let i = 1; i < uncertainties.length; i++) {
      expect(round(uncertainties[i - 1] - uncertainties[i])).toBe(round(expectedStep));
    }
  });

  it("G2: historical reliability sweep (0–1 in 0.1 steps) with all-best other signals is perfectly linear", () => {
    const perfectVotes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 100 },
      { provider: "b", answer: "yes", confidence: 100 },
    ];
    const uncertainties: number[] = [];
    for (let h = 0; h <= 1; h = Math.round((h + 0.1) * 10) / 10) {
      uncertainties.push(
        sampleUncertainty({
          objective: "t", category: "feature",
          confidenceScore: 100,
          historicalReliability: h,
          modelVotes: perfectVotes,
          redTeamHighSeverity: false,
          trustBondScore: 100,
        }).uncertainty,
      );
    }

    // Monotonically decreasing as history improves
    for (let i = 1; i < uncertainties.length; i++) {
      expect(uncertainties[i]).toBeLessThan(uncertainties[i - 1]);
    }

    // Each 0.1 step reduces uncertainty by exactly HISTORICAL_WEIGHT * 0.1 = 0.030
    const expectedStep = HISTORICAL_WEIGHT * 0.1;
    for (let i = 1; i < uncertainties.length; i++) {
      expect(round(uncertainties[i - 1] - uncertainties[i])).toBe(round(expectedStep));
    }
  });

  it("G3: the effective auto-proceed boundary with neutral other signals is at confidenceScore=86 (DB-2)", () => {
    // With historicalReliability=0.5, no votes, no redTeam, trustBond=50:
    // uncertainty = 0.15 + (1-c/100)*0.25 + 0.0875 + 0 + 0.025
    //             = 0.2625 + (1-c/100)*0.25
    // For auto-proceed: 0.2625 + (1-c/100)*0.25 < 0.30
    //   (1-c/100)*0.25 < 0.0375  →  c/100 > 0.85  →  c > 85
    const neutralBase: Omit<UncertaintyInput, "confidenceScore"> = {
      objective: "t", category: "feature",
      historicalReliability: 0.5,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    };
    expect(sampleUncertainty({ ...neutralBase, confidenceScore: 85 }).route).toBe("mentor-mode");
    expect(sampleUncertainty({ ...neutralBase, confidenceScore: 86 }).route).toBe("auto-proceed");
  });

  it("G4: all-perfect signals except confidence produce auto-proceed for any confidence >= 0", () => {
    // With historical=1, perfectVotes, no redTeam, trust=100:
    // uncertainty = 0 + (1-c/100)*0.25 + 0 + 0 + 0 = (1-c/100)*0.25
    // For auto-proceed: < 0.30 → (1-c/100)*0.25 < 0.30 → always (max is 0.25 < 0.30)
    const perfectVotes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 100 },
      { provider: "b", answer: "yes", confidence: 100 },
    ];
    for (let c = 0; c <= 100; c += 10) {
      const result = sampleUncertainty({
        objective: "t", category: "feature",
        confidenceScore: c,
        historicalReliability: 1,
        modelVotes: perfectVotes,
        redTeamHighSeverity: false,
        trustBondScore: 100,
      });
      expect(result.route).toBe("auto-proceed");
    }
  });

  it("G5: the full decile curve matches the closed-form formula for each point", () => {
    // No votes, no redTeam: expected = histU*0.30 + confU*0.25 + 0.0875 + 0 + trustU*0.05
    for (let c = 0; c <= 100; c += 10) {
      const historicalReliability = 0.7;
      const trustBondScore = 80;
      const result = sampleUncertainty({
        objective: "t", category: "feature",
        confidenceScore: c,
        historicalReliability,
        redTeamHighSeverity: false,
        trustBondScore,
      });
      const expected = expectedUncertainty({
        objective: "t", category: "feature",
        confidenceScore: c,
        historicalReliability,
        modelVotes: undefined,
        redTeamHighSeverity: false,
        trustBondScore,
      });
      expect(round(result.uncertainty)).toBe(round(Math.min(1, Math.max(0, expected))));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite H — Design boundary documentation
// ─────────────────────────────────────────────────────────────────────────────
describe("Suite H — Design boundary documentation", () => {
  it("H1 (DB-1): neutral inputs route to mentor-mode — safe default is caution", () => {
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 50,
      historicalReliability: 0.5,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    });
    // Exactly 0.3875 — above threshold
    expect(round(result.uncertainty)).toBe(round(0.3875));
    expect(result.route).toBe("mentor-mode");
  });

  it("H2 (DB-2): confidence label ≠ gate-pass probability — 85% confidence hits the routing boundary", () => {
    // A user who interprets confidenceScore=85 as "85% likely to pass" would expect auto-proceed.
    // The actual routing threshold at 85 is exactly 0.30 = mentor-mode.
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 85,
      historicalReliability: 0.5,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    });
    expect(result.route).toBe("mentor-mode");
    // The auto-proceed crossing requires confidenceScore > 85 in this configuration.
    const autoProceed = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 86,
      historicalReliability: 0.5,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    });
    expect(autoProceed.route).toBe("auto-proceed");
  });

  it("H3 (DB-3): absent votes contribute 0.0875 uncertainty — not zero — to the total", () => {
    const withNoVotes = sampleUncertainty({
      objective: "t", category: "feature",
      confidenceScore: 100, historicalReliability: 1,
      redTeamHighSeverity: false, trustBondScore: 100,
    });
    const withPerfectVotes = sampleUncertainty({
      objective: "t", category: "feature",
      confidenceScore: 100, historicalReliability: 1,
      modelVotes: [
        { provider: "a", answer: "yes", confidence: 100 },
        { provider: "b", answer: "yes", confidence: 100 },
      ],
      redTeamHighSeverity: false, trustBondScore: 100,
    });
    // Without votes: 0.0875; with perfect votes: 0
    expect(round(withNoVotes.uncertainty)).toBe(round(0.0875));
    expect(withPerfectVotes.uncertainty).toBe(0);
    expect(withNoVotes.uncertainty).toBeGreaterThan(withPerfectVotes.uncertainty);
  });

  it("H4 (DB-4): maximum confidence does not overcome zero historical reliability", () => {
    // confidence=100, historical=0, neutral trust, no votes
    const result = sampleUncertainty({
      objective: "test", category: "feature",
      confidenceScore: 100,
      historicalReliability: 0,
      redTeamHighSeverity: false,
      trustBondScore: 50,
    });
    // 0.30 + 0 + 0.0875 + 0 + 0.025 = 0.4125 → mentor-mode
    expect(round(result.uncertainty)).toBe(round(0.4125));
    expect(result.route).toBe("mentor-mode");
  });

  it("H5: redTeam flag alone (all else perfect with votes) raises uncertainty but does NOT cross the 0.30 threshold", () => {
    // DESIGN BOUNDARY: RED_TEAM_WEIGHT = 0.15 < 0.30 threshold.
    // Even with redTeamHighSeverity=true, all-perfect-plus-votes uncertainty is
    // 0 + 0.15 = 0.15, which is below 0.30 → auto-proceed.
    // Red-team alone is insufficient to trigger mentor-mode; it requires additional
    // uncertainty from other signals (e.g. low confidence or poor historical reliability)
    // to push the composite score above the threshold.
    const perfectVotes: ModelVote[] = [
      { provider: "a", answer: "yes", confidence: 100 },
      { provider: "b", answer: "yes", confidence: 100 },
    ];
    const without = sampleUncertainty({
      objective: "t", category: "security-fix",
      confidenceScore: 100, historicalReliability: 1,
      modelVotes: perfectVotes, redTeamHighSeverity: false, trustBondScore: 100,
    });
    expect(without.uncertainty).toBe(0);
    expect(without.route).toBe("auto-proceed");

    // With redTeam: adds RED_TEAM_WEIGHT (0.15) → uncertainty = 0.15 → still auto-proceed
    const withRedTeam = sampleUncertainty({
      objective: "t", category: "security-fix",
      confidenceScore: 100, historicalReliability: 1,
      modelVotes: perfectVotes, redTeamHighSeverity: true, trustBondScore: 100,
    });
    expect(round(withRedTeam.uncertainty)).toBe(round(RED_TEAM_WEIGHT)); // 0.15
    expect(withRedTeam.route).toBe("auto-proceed"); // 0.15 < 0.30

    // To trigger mentor-mode via redTeam, at least one other signal must contribute:
    // e.g. neutral history (historical=0.5 → +0.15) pushes 0.15+0.15=0.30 → mentor-mode
    const withRedTeamAndNeutralHistory = sampleUncertainty({
      objective: "t", category: "security-fix",
      confidenceScore: 100, historicalReliability: 0.5,
      modelVotes: perfectVotes, redTeamHighSeverity: true, trustBondScore: 100,
    });
    // 0.5*0.30 + 0 + 0 + 0.15 + 0 = 0.15 + 0.15 = 0.30 → mentor-mode
    expect(round(withRedTeamAndNeutralHistory.uncertainty)).toBe(round(0.30));
    expect(withRedTeamAndNeutralHistory.route).toBe("mentor-mode");
  });

  it("H6: trust weight alone (0.05) cannot change routing when all other signals are neutral", () => {
    // With trust at 0 vs 100 when other signals are neutral, difference = 0.05.
    // Neither can swing the route across the 0.30 boundary by themselves.
    const neutralOthers: UncertaintyInput = {
      objective: "t", category: "feature",
      confidenceScore: 50, historicalReliability: 0.5,
      redTeamHighSeverity: false,
    };
    const withLowTrust = sampleUncertainty({ ...neutralOthers, trustBondScore: 0 });
    const withHighTrust = sampleUncertainty({ ...neutralOthers, trustBondScore: 100 });

    // Difference is exactly TRUST_WEIGHT
    expect(round(withLowTrust.uncertainty - withHighTrust.uncertainty))
      .toBe(round(TRUST_WEIGHT));
    // Both route to mentor-mode — trust alone cannot save a neutrally uncertain run
    expect(withLowTrust.route).toBe("mentor-mode");
    expect(withHighTrust.route).toBe("mentor-mode");
  });
});
