# QODO V24 — Audit Pass 14

**Version:** 24.14.0 → 24.15.0
**Date:** 2026-07-06
**Bugs fixed this pass:** 5 (IDs 15-A through 15-E)
**Cumulative bugs fixed (all passes):** 33

---

## Scope

Full-codebase audit of all TypeScript source files not deeply reviewed in
passes 1–13.  Files examined this pass include: `canary.ts`,
`slo-tracker.ts`, `prompt-registry.ts`, `confidence-scorer.ts`,
`darwin-engine.ts`, `ai-router.ts`, `circuit-breaker.ts`, `cost-tracker.ts`,
`phase-runner.ts`, `secret-guard.ts`, `warden.ts`, `github-client.ts`,
`hot-reload-config.ts`, `semantic-cache.ts`, `alerting-rules.ts`,
`reviewer.ts`, `blast-radius.ts`, all UI components, and all test files.

---

## Bugs Fixed

### Bug 15-A — `canary.ts`: Missing VERCEL_TOKEN guard in `routeTrafficToCanary` and `rollbackCanary` (Medium)

**File:** `packages/agent/src/services/canary.ts`
**Lines affected:** 74–104 (before fix)

**Root cause:**
`routeTrafficToCanary` and `rollbackCanary` both checked for the presence of
`VERCEL_EDGE_CONFIG_ID` but not `VERCEL_TOKEN`.  When `VERCEL_TOKEN` was
absent, `token ?? ""` passed an empty string to `vercelFetch`, which
constructed `Authorization: Bearer ` (empty Bearer) and dispatched a real
HTTP PATCH to the Vercel Edge Config API.  The Vercel API returned
`401 Unauthorized` with a generic message — no indication that the env var
was not configured.

`deployPreview` and `promoteToProduction` in the same file both correctly
throw early if either credential is absent.  The two canary routing
functions were inconsistent.

**Impact:** Canary traffic management would silently fail every time
`VERCEL_TOKEN` was absent from the environment.  The error surfaced as a
cryptic 401 deep inside the call stack with no actionable guidance.

**Fix:**
Added `if (!token) throw new Error("VERCEL_TOKEN is required for canary traffic routing")` before the API call in `routeTrafficToCanary`.  In `rollbackCanary` (best-effort semantics), replaced `if (!edgeConfigId) return` with `if (!token || !edgeConfigId) return`, then removed the `?? ""` fallback so the compiler enforces the now-non-nullable type.

**Verification:**
```
grep -n "VERCEL_TOKEN is required" packages/agent/src/services/canary.ts
# → line 84
grep -n "!token || !edgeConfigId" packages/agent/src/services/canary.ts
# → line 104
```

**Regression tests:** 3 tests in `packages/agent/tests/canary.test.ts`
- `routeTrafficToCanary throws a clear error when VERCEL_TOKEN is missing`
- `routeTrafficToCanary throws a clear error when VERCEL_EDGE_CONFIG_ID is missing`
- `rollbackCanary returns without throwing when both credentials are absent`

---

### Bug 15-B — `slo-tracker.ts`: Unguarded `JSON.parse` in `loadSamples()` crashes on corrupt data file (Medium)

**File:** `packages/agent/src/services/slo-tracker.ts`
**Line affected:** 34 (before fix)

**Root cause:**
```ts
// BEFORE (buggy)
return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as RunSample[]) : [];
```
`JSON.parse` was called without a `try/catch`.  A partial write during
`saveSamples()` — caused by an OOM kill, `SIGKILL` signal, or power loss
mid-write — leaves `.slo-data.json` with a truncated JSON array.  The next
call to either `recordRunSample` or `computeSloReport` would throw
`SyntaxError: Unexpected end of JSON input`, permanently disabling SLO
tracking for that workspace until a human manually deleted the file.

This is the same class of bug as Bug 14-C (audit-log, Pass 25), which was
fixed in `audit-log.ts`.  `slo-tracker.ts` was not addressed at that time.

**Impact:** A single instance of process termination during an SLO write
permanently breaks `recordRunSample` (called at the end of every pipeline
run) and `computeSloReport` (called in the CI `slo-report` job).  The SLO
dashboard goes dark and no alerts fire.

**Fix:**
Split the one-liner into a guarded block:
```ts
// AFTER (fixed)
if (!existsSync(p)) return [];
try {
  return JSON.parse(readFileSync(p, 'utf8')) as RunSample[];
} catch {
  logger.warn('SLO tracker: data file is malformed JSON; resetting window', { path: p });
  return [];
}
```
Returns an empty window on corruption so recording and reporting continue
cleanly from a fresh baseline.

**Verification:**
```
grep -n "malformed JSON" packages/agent/src/services/slo-tracker.ts
# → line 40
```

**Regression test:** 1 test added to
`packages/agent/tests/stress/slo-tracker.stress.test.ts`
- `recovers gracefully from corrupt SLO data file without throwing (Bug 15-B regression)`

---

### Bug 15-C — `prompt-registry.ts`: Unguarded `JSON.parse` in `load()` crashes all registry operations on a corrupt file (Medium)

**File:** `packages/agent/src/services/prompt-registry.ts`
**Line affected:** 31 (before fix)

**Root cause:**
```ts
// BEFORE (buggy)
return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as PromptRegistry) : {};
```
`load()` is called by every public function in the module: `registerPrompt`,
`getActivePrompt`, `rollbackPrompt`, and `recordPromptResult`.  A corrupt
`.prompt-registry.json` caused all four to throw `SyntaxError`.

`recordPromptResult` is called after every LLM invocation to update
running-average stats.  A single corrupt file therefore permanently breaks
all prompt-stats tracking for the run.  Auto-rollback (triggered when success
rate drops below 70%) also becomes impossible, leaving a poorly performing
prompt active indefinitely.

**Impact:** Entire prompt versioning subsystem becomes non-functional after
any partial write to `.prompt-registry.json`.

**Fix:**
Same pattern as Bug 15-B:
```ts
// AFTER (fixed)
if (!existsSync(p)) return {};
try {
  return JSON.parse(readFileSync(p, 'utf8')) as PromptRegistry;
} catch {
  logger.warn('Prompt registry: file is malformed JSON; starting fresh', { path: p });
  return {};
}
```
Returns an empty registry so callers rebuild a clean state from the next write.

**Verification:**
```
grep -n "malformed JSON" packages/agent/src/services/prompt-registry.ts
# → line 38
```

**Regression test:** 1 test added to
`packages/agent/tests/stress/prompt-registry.stress.test.ts`
- `recovers gracefully from corrupt registry file without throwing (Bug 15-C regression)`

---

### Bug 15-D — `confidence-scorer.ts`: `blastScore` exceeds `1.0` when `filesChanged = 0`, causing `score` to exceed 100 (Medium)

**File:** `packages/agent/src/services/confidence-scorer.ts`
**Line affected:** 55 (before fix)

**Root cause:**
```ts
// BEFORE (buggy)
const blastScore = Math.max(0, 1 - (patch.filesChanged - 1) / 20);
```
When `filesChanged = 0`:
```
1 - (0 - 1) / 20  =  1 - (-0.05)  =  1.05
Math.max(0, 1.05) =  1.05          ← exceeds 1.0
```
`blastScore * WEIGHTS.blastRadius = 1.05 * 15 = 15.75` instead of `≤ 15`.

With all other factors at maximum:
```
syntax:         30.00
coverage:       20.00
blastRadius:    15.75   ← overflow
modelCertainty: 20.00
validators:     15.00
───────────────────
total:         100.75  → Math.round → 101
```
A confidence score of `101` breaks the semantic contract of the `[0, 100]`
range.  `gradeFromScore` still returns `'A'` (≥ 90), so the grade is
unaffected, but downstream consumers that assert `score <= 100` would fail.

**Impact:** Any caller asserting `result.score <= 100` receives a value of
`101` for zero-file patches (e.g. config-only changes, empty no-op patches
used in dry-run mode).

**Fix:**
Added upper clamp:
```ts
// AFTER (fixed)
const blastScore = Math.max(0, Math.min(1, 1 - (patch.filesChanged - 1) / 20));
```
`Math.min(1, ...)` ensures the score never exceeds `1.0` regardless of
`filesChanged`.  The `Math.max(0, ...)` still guards against negative values
for very large patches.

**Verification:**
```
grep -n "Math.min(1, 1 -" packages/agent/src/services/confidence-scorer.ts
# → line 57
```

**Regression tests:** 2 tests added to
`packages/agent/tests/snapshots/confidence-scorer.snapshot.test.ts`
- `score never exceeds 100 when filesChanged is 0`
- `score stays within [0, 100] across all edge-case filesChanged values`

---

### Bug 15-E — `darwin-engine.ts`: Division by zero when `baselineLatencyMs = 0` opens a spurious revert PR (Low)

**File:** `packages/agent/src/agents/darwin-engine.ts`
**Line affected:** 70 (before fix)

**Root cause:**
```ts
// BEFORE (buggy)
const delta = (currentLatencyMs - baseline.baselineLatencyMs) / baseline.baselineLatencyMs;
```
When `baselineLatencyMs = 0` (e.g. a first-run latency rounded to zero, or a
clock anomaly on the CI host):

| `currentLatencyMs` | `delta`    | `delta <= 0.2` | Outcome |
|--------------------|------------|----------------|---------|
| > 0                | `Infinity` | `false`        | spurious revert PR opened |
| = 0                | `NaN`      | `false`        | spurious revert PR opened |

`NaN <= 0.2` evaluates to `false` in JavaScript.  The early-return `if (delta <= REGRESSION_THRESHOLD) return false` was therefore always skipped when the baseline was zero, and the "Regression detected — open a Revert PR" path executed unconditionally.

**Impact:** An automated revert PR is opened against a healthy mutation
whose only fault was being benchmarked against a zero-latency baseline.  The
revert PR reverts a good change, introducing a regression.

**Fix:**
```ts
// AFTER (fixed) — guard before division
if (baseline.baselineLatencyMs <= 0) {
  log.warn("darwin-engine: invalid baseline latency (<=0); skipping fitness evaluation", {
    mutationId: baseline.mutationId,
    baselineLatencyMs: baseline.baselineLatencyMs,
  });
  await telemetry?.decision("darwin-engine", "fitness-skipped-invalid-baseline", { ... });
  return false;
}
const delta = (currentLatencyMs - baseline.baselineLatencyMs) / baseline.baselineLatencyMs;
```

**Verification:**
```
grep -n "baselineLatencyMs <= 0" packages/agent/src/agents/darwin-engine.ts
# → line 75
```

**Regression test:** 1 test added to
`packages/agent/tests/security.test.ts`
- `returns false without opening a revert PR when baselineLatencyMs is 0 (Bug 15-E)`

---

## Files Modified

### Source files (5)
| File | Change |
|------|--------|
| `packages/agent/src/services/canary.ts` | Added VERCEL_TOKEN guard in `routeTrafficToCanary`; fixed `rollbackCanary` guard |
| `packages/agent/src/services/slo-tracker.ts` | Wrapped `JSON.parse` in `loadSamples()` with try/catch |
| `packages/agent/src/services/prompt-registry.ts` | Wrapped `JSON.parse` in `load()` with try/catch |
| `packages/agent/src/services/confidence-scorer.ts` | Added `Math.min(1, ...)` upper clamp to `blastScore` |
| `packages/agent/src/agents/darwin-engine.ts` | Added `baselineLatencyMs <= 0` guard before division |

### Test files (5)
| File | Change |
|------|--------|
| `packages/agent/tests/canary.test.ts` | **New file** — 3 regression tests for Bug 15-A |
| `packages/agent/tests/stress/slo-tracker.stress.test.ts` | +1 regression test for Bug 15-B |
| `packages/agent/tests/stress/prompt-registry.stress.test.ts` | +1 regression test for Bug 15-C |
| `packages/agent/tests/snapshots/confidence-scorer.snapshot.test.ts` | +2 regression tests for Bug 15-D |
| `packages/agent/tests/security.test.ts` | +1 regression test for Bug 15-E |

### Documentation / release files (4)
| File | Change |
|------|--------|
| `package.json` | `24.14.0` → `24.15.0` |
| `packages/agent/package.json` | `24.14.0` → `24.15.0` |
| `apps/mission-control/package.json` | `24.14.0` → `24.15.0` |
| `06-CHANGELOG.md` | Added Pass 26 entry |
| `07-MANIFEST.md` | Added A15 entry for this document |
| `14-V24-AUDIT-PASS-14.md` | **This document** |

---

## Validation

```
bash validate.sh
# → PASSED: 49 / FAILED: 0
```

All 49 checks pass on the updated codebase.

---

## Cumulative Bug Count

| Pass range | Bugs fixed |
|------------|-----------|
| Passes 1–9 (V24.10.0–V24.10.9) | 9 |
| Passes 10–11 (V24.11.0–V24.12.0) | 9 |
| Pass 12 (V24.12.0→V24.13.0) | 4 |
| Pass 13 (V24.13.0→V24.14.0) | 5 |
| Pass 14 (V24.14.0→V24.15.0) | 5 |
| **Total** | **33** |
