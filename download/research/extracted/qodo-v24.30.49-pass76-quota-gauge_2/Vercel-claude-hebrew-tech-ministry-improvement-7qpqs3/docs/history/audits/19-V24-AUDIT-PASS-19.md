# QODO V24 — Audit Pass 19 (CIEP v2.0)
**Version:** 24.20.0  
**Date:** 2026-07-06  
**Protocol:** Canonical Incremental Engineering Protocol v2.0  
**Baseline:** 24.19.0 (Pass 18 — 8 Tier-1 power-expansion integrations)

---

## Executive Summary

Pass 19 executed a full CIEP v2.0 audit against the 24.19.0 codebase. Five correctness bugs and wiring gaps were discovered in the integration layer added in Pass 18. All five were fixed in this pass. No new features were introduced. All 10 system invariants remain intact.

---

## PHASE 1: Repository Integrity Audit

### Orphan / Stale Files
- No orphan files detected. All 8 integration modules are imported by at least one caller.
- `packages/agent/dist/cli.js` is a build artifact (excluded from source analysis).

### Architectural Drift
- All 8 integration services remain within `src/services/integrations/` — boundary map preserved.
- No layer violations detected (no integration imports from `apps/` or `src/agents/`).
- `blast-radius.ts` imports from `integrations/` ✓ (within validators→services allowed path).

---

## PHASE 2: Issue Discovery & Triage

Five bugs found. Prioritized strictly per CIEP Decision Hierarchy (Correctness > Reliability).

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| 1 | **Critical — Correctness** | `cli.ts:389` | `blastRadius()` called with 2 args; `opts` never passed → git-blame risk amplifier was dead code despite being wired into `blast-radius.ts` |
| 2 | **Critical — Correctness** | `github-actions-flaky.ts` `buildFlakyTestIndex` | `failureCounts` map stored the test file path in its own `associatedFiles` Set. `matchFlakyTests` compares against *source* `targetFiles`, so matches were always empty — flaky gate logic never triggered |
| 3 | **High — Reliability** | `cli.ts` SRE feedback phase | `runSreFeedbackLoop` blocks the pipeline for 10 minutes (warmup sleep). `publishAsyncTask` was imported but never called → QStash offload was a no-op |
| 4 | **Medium — Reliability** | `cli.ts` gate phase | `buildFlakyTestIndex` / `matchFlakyTests` never called in gate → flaky-test index existed in Redis but was never consulted |
| 5 | **Medium — Observability** | `cli.ts` gate phase | Gate pass/fail decisions never broadcast to Slack despite `notifySlack` being imported |

---

## PHASE 3: Execution

### Fix 1 — `blastRadius` call site (`cli.ts`)
**Changed:** Added `opts` parameter with `{ targetFiles, owner, repo, telemetry }` to the `blastRadius()` call in the gate phase.  
**Impact:** Git-blame risk amplification is now active for every gate evaluation. Files with high churn or many authors correctly lower the gate threshold.  
**Risk:** Low. The `opts` parameter was already handled defensively in `blast-radius.ts` — no threshold or scoring logic changed.

### Fix 2 — `deriveSourceFile` helper + `buildFlakyTestIndex` (`github-actions-flaky.ts`)
**Changed:**  
- Added `deriveSourceFile(testPath)` pure function that strips `.test.ts`/`.spec.ts` suffix to derive the corresponding source file path.  
- `buildFlakyTestIndex` now calls `deriveSourceFile(f)` and stores the *source* path in `associatedFiles` instead of the raw test path.  
**Impact:** `matchFlakyTests(targetFiles, index)` now correctly identifies flaky tests when `targetFiles` contains source (not test) paths — which is always the case from `cli.ts`.  
**Risk:** Low. Purely additive helper; no schema or Redis key changes.

### Fix 3 — QStash SRE feedback offload (`cli.ts`)
**Changed:** Replaced the direct `runSreFeedbackLoop` call with a `resolveQStashConfig()` + `publishAsyncTask()` attempt. Falls back to inline synchronous execution when QStash is not configured or publish fails.  
**Impact:** When `QSTASH_TOKEN` and `QSTASH_CURRENT_SIGNING_KEY` are set, the 10-minute post-merge warmup sleep is offloaded to QStash. Pipeline completes immediately after merge.  
**Risk:** Low. Synchronous fallback preserves existing behavior for deployments without QStash.

### Fix 4 — Flaky-test index wired into gate phase (`cli.ts`)
**Changed:** Added flaky-test index load/build and `matchFlakyTests` call in the gate phase, before test execution. Flaky matches emit a telemetry warning but do not block the gate.  
**Impact:** Gate phase now consults the flaky-test memory. Known-flaky test failures produce a warning decision in telemetry instead of silently passing as unrecognized noise.  
**Risk:** Low. Flaky matches are warnings only — gate pass/fail logic unchanged.

### Fix 5 — Slack gate-failure / gate-pass notifications (`cli.ts`)
**Changed:** Added `resolveSlackConfig()` + conditional `notifySlack()` call immediately after gate evaluation: `gate_failure` event when `!gateOpen`, `phase_transition` event when gate passes.  
**Impact:** Teams configured with `SLACK_WEBHOOK_URL` now receive real-time gate decisions.  
**Risk:** Negligible. `notifySlack` is non-throwing and opt-in (no-op when `SLACK_WEBHOOK_URL` absent).

### Startup Integration Config Logging
**Changed:** Added integration status map logged at startup in `runPipeline()` covering all 8 Pass-18 integrations.  
**Impact:** Operators can immediately see which integrations are active from the first log line.

---

## PHASE 4: Verification

### `node --check` Results
| File | Result |
|------|--------|
| `src/cli.ts` | ✅ Pass |
| `src/services/integrations/github-actions-flaky.ts` | ✅ Pass |
| `src/validators/blast-radius.ts` | ✅ Pass |

### Invariant Re-verification
| Invariant | Status |
|-----------|--------|
| Phase state machine (IDLE→…→DONE) | ✅ Preserved — no phase order changes |
| Strict Zod validation (.strict() on all schemas) | ✅ Preserved — no schema loosening |
| Redis namespace `qodo:v24` | ✅ Preserved — flaky index key `qodo:v24:flaky-tests:index` already namespaced |
| Privacy mode (`QODO_PRIVACY_MODE=strict`) | ✅ All new code paths gate on privacy mode check |
| Target-file lockfile handling | ✅ Unchanged |
| Worker auth (`QODO_WORKER_SECRET`) | ✅ Unchanged |
| Lock heartbeat (30-second renew) | ✅ Unchanged |
| Canary rollback / SRE feedback loop | ✅ SRE logic unchanged; QStash is an optional fast-path |
| Hive/privacy mutual exclusion | ✅ Unchanged |
| Boundary map | ✅ No new cross-layer imports introduced |

### New Regression Tests Added (power-expansion.test.ts)
- `github-actions-flaky — Pass-19 regression: deriveSourceFile` (6 cases)
- `qstash-async — Pass-19 regression: publishAsyncTask` (6 cases)

Total test file: 380 → 474 lines (+94 lines, +12 test cases).

---

## Files Modified

| File | Change |
|------|--------|
| `packages/agent/src/cli.ts` | Fix 1 (blast opts), Fix 3 (QStash SRE), Fix 4 (flaky gate), Fix 5 (Slack gate), startup log |
| `packages/agent/src/services/integrations/github-actions-flaky.ts` | Fix 2 (deriveSourceFile, associatedFiles) |
| `packages/agent/tests/integrations/power-expansion.test.ts` | +12 Pass-19 regression test cases |
| `package.json` (root + packages + apps) | Version bump 24.19.0 → 24.20.0 |
| `06-CHANGELOG.md` | Pass 32 entry |

---

## Recommendations for Pass 20

1. **QStash callback endpoint**: Implement `/api/qstash/callback` in Mission Control to handle SRE feedback results and update Redis run state.
2. **Flaky gate escalation**: Consider promoting repeated flaky matches to `allowed: false` after N occurrences to prevent masking real regressions.
3. **Slack phase_transition for all phases**: Currently only the gate phase broadcasts to Slack; architect/commit/merge transitions are unbroadcast.
4. **Tier 2 integrations**: Notion/Confluence knowledge base context (Pass-18 wishlist item 13) is the highest-value remaining Tier 2 item.
