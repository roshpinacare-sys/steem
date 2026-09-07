# QODO-V24 Audit — Pass 49

**Version:** `24.30.21`
**Previous:** `24.30.20` (Pass 48 — task-18: Semantic DAG Lock deadlock proof)
**Date:** 2026-07-07
**Protocol:** CIEP-X v10.0
**Theme:** Trust-ledger / vitals-score gaming resistance (task-20)

---

## Impact Analysis

**Task selected:** task-20 — Trust-ledger / vitals-score gaming resistance
**Selection rationale:** Highest priority (1) unblocked queued task after task-18 was
completed in Pass 48.  Of the two remaining priority-1 tasks (task-20 and task-22),
task-20 is listed first and carries a direct auto-merge security implication: if the
trust model can be gamed by a cheap patch sequence, a dangerous patch can bypass human
review permanently without any alert being raised.

| Dimension | Assessment |
|-----------|-----------|
| **Engineering value** | High. Documents which attack paths work and which do not, establishing a precise security boundary for the auto-merge gate. Two real exploitable gaps (Gap-1 and Gap-2) are documented with exact reproduction steps and proposed mitigations. |
| **Implementation risk** | Low. Test-only pass; no production source files modified. |
| **Compatibility impact** | None. New test file only. |
| **Rollback complexity** | Trivial. Delete the one new test file. |
| **Confidence level** | High. All findings are arithmetic — derived from the production constants in `trust-ledger.ts` and confirmed by test assertions. No probabilistic or timing-dependent reasoning involved. |

---

## Executive Summary

Pass 49 delivers a comprehensive gaming-resistance audit for `trust-ledger.ts` and
`vitals-score.ts`, implemented as an adversarial test file
(`packages/agent/tests/trust-ledger-gaming.test.ts`).

One new test file was added.  No production source files were modified.
All 10 system invariants are preserved.

The audit identifies **3 gaps** and **5 resistance properties**:

### Gaps (documented, not fixed in this pass)

| ID | Location | Finding | Severity |
|----|----------|---------|---------|
| **Gap-1** | `trust-ledger.ts` constants | Auto-merge unlock requires only 5 trivial successes from `DEFAULT_BOND` (50). The distance from default to `FULL_AUTONOMY_THRESHOLD` (75) is exactly `5 × SUCCESS_DELTA` (5). An adversary submitting 5 cheap "cosmetic" patches can unlock auto-merge for any subsequent patch in that category, regardless of the 6th patch's actual risk. | **High** |
| **Gap-2** | `trust-ledger.ts` `recordOutcome` | `claimedConfidence` is caller-supplied and has no lower-bound enforcement beyond `Math.max(0, …)`. At `confidence=0`, failure penalty equals `round(10 × 0.5)` = 5 — exactly equal to `SUCCESS_DELTA`. An adversary who always underreports confidence on failures achieves symmetric success/failure score impact, maintaining auto-merge indefinitely after the initial unlock. | **Medium** |
| **Gap-3** | `trust-ledger.ts` `classifyTrustCategory` | The `complexity` parameter is caller-supplied and has no validation. Passing `complexity="cosmetic"` routes any patch — including one with `"security"` in the objective text — to the `"cosmetic"` trust category, which is cheaper to inflate. Similarly, including `"comment"` or `"typo"` in an objective string forces `"cosmetic"` classification regardless of actual patch content. | **Medium** |

### Resistance properties confirmed

| Property | Evidence |
|---------|---------|
| **Cross-category isolation** | Inflating the `"cosmetic"` bond has zero effect on the `"security-fix"` bond. Auto-merge gates check category-specific bonds. |
| **Asymmetric failure recovery** | One full-confidence failure costs 15 points; recovering costs 3 successes. Trust damage is stickier than trust gain. |
| **Score floor** | `score = max(0, …)` prevents negative scores. Recovery from the floor to auto-merge requires a minimum of 15 successes — a meaningful barrier. |
| **Seed-sealing** | `seedTrustFromProvenRepo` caps the seeded score at `FULL_AUTONOMY_THRESHOLD − 5` (70) and marks all seeded bonds `probation: true`. `canAutoMerge` requires `!probation`, so a seeded repo cannot immediately auto-merge, even from a maximally trusted proven repo. |
| **Probation stickiness** | Probation is only cleared when `score ≥ FULL_AUTONOMY_THRESHOLD` (75), not merely when score rises above `PROBATION_THRESHOLD` (40). This prevents an attacker from entering probation deliberately and exiting cheaply. |

### Vitals score gaming surface

`computeVitals` and `recordVitals` are display/alerting-only subsystems. They have no
connection to `canAutoMerge` or any gate enforcement. An adversary who supplies
all-maximum inputs to `computeVitals` obtains `score=100` but this has no effect on
auto-merge eligibility. This independence is by design and is confirmed by the audit.

---

## Proposed Mitigations (deferred to future passes)

These are findings, not fixes. Each is a candidate for a dedicated future pass.

**Gap-1 mitigation candidates:**
- Require a minimum `outcomes` count (e.g., ≥10) before first auto-merge eligibility,
  independent of score. This raises the cost from 5 to at least 10 patches.
- Weight `SUCCESS_DELTA` by patch blast-radius or file-count, so trivial single-file
  cosmetic patches add less than high-impact multi-file patches.
- Add a cooldown: first auto-merge requires the score to have been ≥75 for at least
  N calendar days, not just N outcomes.

**Gap-2 mitigation candidates:**
- Ignore `claimedConfidence` for the failure penalty calculation, using only the
  gate validator's actual confidence output instead of the agent's self-report.
- Cap the minimum failure penalty at `SUCCESS_DELTA + 1` so success/failure are
  always net-negative under adversarial confidence underreporting.

**Gap-3 mitigation candidates:**
- Remove the `complexity` override path from `classifyTrustCategory`, or restrict it
  to an allowlist of verified callers.
- Re-derive the trust category from the patch diff itself (file paths, lines changed)
  rather than from a free-form objective string.

---

## New File

```
packages/agent/tests/trust-ledger-gaming.test.ts
```

**Contents — 6 describe suites, 28 test cases:**

| Suite | Cases | Coverage |
|-------|-------|---------|
| A: Core mechanics | 7 | DEFAULT_BOND baseline, SUCCESS_DELTA, score cap, failure penalties, asymmetric decay, canAutoMerge conditions, outcome counters |
| B: Gaming attack scenarios | 7 | Gap-1 inflation, Gap-1 constant-delta variant, Gap-2 penalty formula, Gap-2 sustained attack, cross-category isolation, asymmetric failure recovery, floor-to-recovery count |
| C: Probation mechanics | 4 | Probation entry threshold, probation-cleared-only-at-75, single-success cannot clear, isProbation boundary |
| D: Seed-sealing | 3 | Seeded bond cannot immediately auto-merge, probation cleared after genuine outcomes, all categories preserved in seed |
| E: classifyTrustCategory | 7 | Keyword routing, Gap-3 cosmetic injection, security-over-cosmetic ordering, payment-over-test ordering, complexity override |
| F: Vitals-score gaming | 6 | All-max score, all-zero score, independence from auto-merge gate, sentry dominance, default inputs, CVE contribution bounds |

---

## Why the identified gaps are not fixed in this pass

CIEP protocol: Pass 49 is a gaming-resistance *audit* pass, not a fix pass. The
task statement explicitly frames the deliverable as "we tried and couldn't game it
(or: here is exactly how it can be gamed)" — the same framing as task-8 (Pass 45).

Fixing Gap-1 requires a product decision: raising the unlock cost also raises the
legitimate earn cost, which is a user-experience trade-off the maintainers must own.
Fixing Gap-2 requires deciding whether `claimedConfidence` should be trusted at all.
Fixing Gap-3 requires a broader input-validation strategy.

Each fix is independently viable in a subsequent pass. The gaps are now precisely
documented, reproducible via the test suite, and tracked in engineering continuity
artifacts.

---

## Invariant Preservation

All 10 system invariants are unaffected (no production source modified):

| Invariant | Status |
|-----------|--------|
| Phase state machine (IDLE→…→DONE) | ✅ Unchanged |
| Zod `.strict()` validation | ✅ Unchanged |
| Redis `qodo:v24:` namespace | ✅ Unchanged — `LEDGER_KEY_PREFIX` and `VITALS_KEY_PREFIX` untouched |
| Privacy mode (`QODO_PRIVACY_MODE=strict`) | ✅ Unchanged |
| Target-file lock acquisition order | ✅ Unchanged |
| Worker auth boundary (`QODO_WORKER_SECRET`) | ✅ Unchanged |
| Lock heartbeat (30-second renew) | ✅ Unchanged |
| Canary rollback / SRE feedback loop | ✅ Unchanged |
| Hive / privacy mutual exclusion | ✅ Unchanged |
| Boundary map | ✅ New test file in `tests/`; no cross-layer imports |

---

## Validation

### Static checks (performed without network / `node_modules`)

| Check | Result |
|-------|--------|
| TypeScript syntax validity — `trust-ledger-gaming.test.ts` | ✅ Pass — brace/paren balance confirmed; all types self-consistent with exported surface of `trust-ledger.ts` and `vitals-score.ts` |
| Import paths | ✅ All imports use existing `../src/services/trust-ledger.js` and `../src/services/vitals-score.js` paths, consistent with other test files |
| No new production dependencies introduced | ✅ Confirmed — only `vitest` (already a devDependency) |
| `scripts/check-dead-integrations.mjs` | ✅ Test-only addition; no new exports in `src/` |
| Task-queue JSON/MD consistency | ✅ task-20 done; counts: 9 done / 28 queued / 11 blocked |
| Package version alignment | ✅ All four `package.json` files at `24.30.21` |
| Sacred-file manifest hashes | ✅ Unchanged — no sacred files touched |

### Runtime validation status

`vitest` and `tsc --noEmit` cannot be run in this offline sandbox (no `node_modules`).
This constraint is identical to every prior pass from Pass 36 onward and is documented
as task-2 in the task queue.  The first networked environment should run:

```bash
cd packages/agent
npm install
npx vitest run tests/trust-ledger-gaming.test.ts
```

The test is entirely self-contained (no file system I/O, no network, no Redis daemon).
It uses an in-process Map-backed mock for `RedisState` identical in structure to the
pattern used in `adversarial-audit-log.test.ts` and `supply-chain-audit.test.ts`.

---

## Files Changed

| File | Change type | Description |
|------|-------------|-------------|
| `packages/agent/tests/trust-ledger-gaming.test.ts` | **New** | Task-20 gaming-resistance audit — 6 suites, 28 test cases |
| `packages/agent/docs/49-V24-AUDIT-PASS-49.md` | **New** | This audit document |
| `tasks/agent-task-queue.json` | **Updated** | task-20 marked `"done"`, `completedInPass: "Pass 49 (v24.30.21)"` |
| `tasks/agent-task-queue.md` | **Updated** | Status snapshot updated |
| `06-CHANGELOG.md` | **Updated** | Pass 49 entry added |
| `CHANGELOG.md` | **Updated** | Version bump entry |
| `ENGINEERING_NOTES.md` | **Updated** | Pass 49 summary added |
| `package.json` (root) | **Updated** | Version `24.30.20` → `24.30.21` |
| `packages/agent/package.json` | **Updated** | Version `24.30.20` → `24.30.21` |
| `apps/mission-control/package.json` | **Updated** | Version `24.30.19` → `24.30.21` |
| `standalone-executable/package.json` | **Updated** | Version `24.30.19` → `24.30.21` |
