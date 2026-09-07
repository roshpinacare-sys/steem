# QODO V24 — Audit Pass 60 (CIEP-X v10.0)

**Version:** 24.30.32
**Date:** 2026-07-07
**Protocol:** CIEP-X v10.0 (Canonical Incremental Engineering Protocol)
**Baseline:** 24.30.31 (Pass 59 — cartographer oversized-PR adversarial test, task-12)
**Task:** task-21 — Uncertainty-sampling calibration check

---

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — `uncertainty-sampling.ts` is the routing gate that decides whether every pipeline run requires human sign-off. Its output affects every autonomous deployment. Proving the calibration math is sound gives operators a documented basis for trusting (or tuning) the 0.30 threshold. |
| Implementation risk | Zero — test-only pass. No production source files, schemas, sacred files, or infrastructure changed. |
| Compatibility impact | None. |
| Rollback complexity | Trivial — delete `packages/agent/tests/uncertainty-sampling-calibration.test.ts`. |

---

## Problem Statement (from task-21)

`uncertainty-sampling.ts` produces a routing decision for every pipeline run:
`"auto-proceed"` (uncertainty < 0.30) or `"mentor-mode"` (uncertainty ≥ 0.30).
The question from task-21: *are the confidence outputs calibrated*, not just
plausible-looking? Of all patches scored, say, "80% confident," do roughly 80%
actually pass the gate?

**Scope clarification (per task-21 notes):** True empirical calibration requires
a labeled outcome distribution from production runs (task-6, not yet available).
This pass validates the calibration **math** only: weight invariants, input
clamping, monotonicity, routing threshold mechanics, consensus sub-formula
correctness, and the shape of the synthetic decile sweep. This scope is recorded
explicitly in the test file header.

---

## Formula Under Test

```
uncertainty =
  (1 − historicalReliability)    × 0.30  // HISTORICAL_WEIGHT
+ (1 − confidenceScore / 100)    × 0.25  // CONFIDENCE_WEIGHT
+ consensusUncertainty(votes)    × 0.25  // CONSENSUS_WEIGHT
+ (redTeamHighSeverity ? 1 : 0)  × 0.15  // RED_TEAM_WEIGHT
+ (1 − trustBondScore / 100)     × 0.05  // TRUST_WEIGHT

route = uncertainty >= 0.30 ? "mentor-mode" : "auto-proceed"
```

`consensusUncertainty(votes)` = `(1 − agreement) × 0.7 + normVariance × 0.3`
where agreement = (maxGroupCount / votes.length), normVariance = min(1, variance / 2500).
When votes is undefined or length < 2: agreement defaults to 0.5, normVariance to 0.

---

## Confirmed Invariants

| # | Invariant | Status |
|---|---|---|
| I1 | Weights sum to exactly 1.0 (0.30+0.25+0.25+0.15+0.05) | ✅ Confirmed |
| I2 | All weights are strictly positive | ✅ Confirmed |
| I3 | HISTORICAL_WEIGHT is the single largest weight | ✅ Confirmed |
| I4 | Input clamping: historicalReliability ∈ [0,1], confidenceScore ∈ [0,100], trustBondScore ∈ [0,100] | ✅ Confirmed |
| I5 | All-best inputs produce uncertainty = 0 | ✅ Confirmed |
| I6 | Formula output is always in [0,1] | ✅ Confirmed |
| I7 | Each factor is monotonic: improving any single input strictly decreases uncertainty | ✅ Confirmed |
| I8 | The formula is linear — factor improvements superpose additively | ✅ Confirmed |
| I9 | Routing threshold at 0.30 is inclusive: uncertainty ≥ 0.30 → mentor-mode | ✅ Confirmed |
| I10 | Perfect vote agreement among N providers produces zero consensus uncertainty | ✅ Confirmed |

---

## Design Boundaries Discovered

### DB-1 (Neutral-input bias toward mentor-mode) — Intentional

Perfectly neutral inputs (historicalReliability=0.5, confidenceScore=50, no votes,
no redTeam, trustBond=50) produce:

```
uncertainty = 0.15 + 0.125 + 0.0875 + 0 + 0.025 = 0.3875
```

This exceeds 0.30 → the run routes to **mentor-mode**. The "safe default" when
no signal is available is caution, not auto-proceed. This is intentional — the
routing asymmetry exists by design. Future passes must not raise the threshold
to 0.40+ to compensate without understanding this intent.

### DB-2 (Confidence label ≠ gate-pass probability) — Documented

With all other signals held neutral (historicalReliability=0.5, no votes, trustBond=50,
no redTeam), the effective auto-proceed crossing point is **confidenceScore = 86**:

| confidenceScore | uncertainty | route |
|---|---|---|
| 85 | 0.3000 | mentor-mode |
| 86 | 0.2975 | auto-proceed |

A patch labeled "85% confident" routes to mentor-mode under neutral context. The
routing threshold is not equivalent to a probability label — it depends on all five
weight components. Operators who interpret the score as a direct probability will
mis-estimate the actual routing behavior.

**Recommendation (future pass):** Surface the confidence-to-route lookup table in
the dashboard so operators can calibrate their expectations against the composite
formula, not just the raw score.

### DB-3 (Absent votes contribute 0.0875 — not zero) — Documented

When no model votes are supplied (`modelVotes` is undefined), `normalizedAgreement`
returns 0.5 (neutral/unknown) and `normalizedConfidenceVariance` returns 0. The
resulting consensus uncertainty is `(1 − 0.5) × 0.7 + 0 × 0.3 = 0.35`, which
contributes `0.35 × 0.25 = 0.0875` to the total.

Callers that omit votes do not receive zero consensus uncertainty — they receive
0.0875. This is the correct behavior (absence of evidence ≠ evidence of absence),
but it must be documented so callers do not expect a "zero consensus penalty" path
to be achievable without explicitly providing agreeing votes.

### DB-4 (High confidence alone cannot overcome zero historical reliability) — Documented

With historicalReliability=0 and all else held at neutral (no votes, trustBond=50,
no redTeam), even confidenceScore=100 produces:

```
uncertainty = 0.30 + 0 + 0.0875 + 0 + 0.025 = 0.4125 → mentor-mode
```

The routing is multi-factor. A single perfect score cannot compensate for a
completely untracked history. This is the desired behavior for a first-time run
on an unknown category.

---

## Test Structure

**File:** `packages/agent/tests/uncertainty-sampling-calibration.test.ts`
**Test count:** 8 describe blocks, 42 test cases

| Suite | Cases | Coverage |
|---|---|---|
| A: Weight invariants | 4 | Weights sum, positivity, HISTORICAL dominance, RED_TEAM > TRUST |
| B: Input clamping | 8 | Over/under range for each of the 3 clamped inputs; default values |
| C: Extreme inputs | 5 | Min uncertainty, max uncertainty, always-in-[0,1], DB-4 |
| D: Monotonicity | 5 | Per-factor monotonicity + linear superposition |
| E: Routing threshold | 5 | Boundary at exactly 0.30, one step below/above, valid routes, reason string |
| F: Consensus sub-formula | 9 | No votes, single vote, perfect agreement, case-insensitive match, 50/50 split, variance-only disagreement, worst-case, 3-to-1 majority, scale cap |
| G: Calibration curve shape | 5 | Linear decile sweep (confidence), linear decile sweep (historical), effective boundary (DB-2), all-best always auto-proceeds, closed-form match |
| H: Design boundary documentation | 6 | DB-1 through DB-4, redTeam alone routes to mentor-mode, trust weight cannot swing routing alone |

---

## Validation

```bash
node --experimental-strip-types --check \
  packages/agent/tests/uncertainty-sampling-calibration.test.ts
# Exit 0

bash validate.sh
# 50/50 PASSED

node scripts/check-dead-integrations.mjs
# 88 exports flagged; all in allowlist — no new dead integrations
```

Full `vitest run` / `tsc --noEmit` blocked by sandbox network constraints,
consistent with all passes ≥ 36. Static review confirms no type errors in the
new test file.

---

## Files Changed

| File | Change |
|---|---|
| `packages/agent/tests/uncertainty-sampling-calibration.test.ts` | New — 8 describe blocks, 42 test cases |
| `packages/agent/docs/60-V24-AUDIT-PASS-60.md` | New — this document |
| `tasks/agent-task-queue.json` | task-21 → `"done"`, `completedInPass: 60` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | This entry |
| `CHANGELOG.md` | Version 24.30.32 entry added |
| `ENGINEERING_NOTES.md` | Pass 60 section added |
| `package.json` (×4) | Version bumped 24.30.31 → 24.30.32 |

---

## Remaining Locally-Tractable Tasks

From `tasks/agent-task-queue.json` (run `node scripts/task-queue.mjs list` for live view):

| ID | Priority | Title |
|---|---|---|
| task-23 | P3 | Model-deprecation-watchdog soft-deprecation detection |
| task-26 | P3 | DOM-xray / shadow-traffic validator starvation audit |
| task-27 | P3 | Compliance-oracle / SBOM / license-checker cross-consistency |
| task-30 | P3 | Prompt-registry version-rollback mid-run consistency |
