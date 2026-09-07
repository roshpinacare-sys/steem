# QODO V24 — Audit Pass 64 (CIEP-X v10.0)

**Version:** 24.30.36
**Date:** 2026-07-07
**Protocol:** CIEP-X v10.0 (Canonical Incremental Engineering Protocol)
**Baseline:** 24.30.35 (Pass 63 — compliance-oracle / SBOM / license-checker cross-consistency, task-27)
**Task:** task-30 — Prompt-registry version-rollback mid-run consistency check

---

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — `getActivePrompt()` is a live file-system read on every invocation. This means a rollback (manual or auto-triggered) mid-run immediately changes the prompt version seen by subsequent phases, with no error raised by either call. A multi-phase pipeline (architect → coder → gate → reviewer) can silently have different phases using semantically incompatible prompt versions in the same run. Documenting the exact contract — and the safe caller pattern to avoid it — closes the knowledge gap task-30 identified. |
| Implementation risk | Zero — test-only pass. No production source files changed. |
| Compatibility impact | None. |
| Rollback complexity | Trivial — delete `packages/agent/tests/prompt-registry-mid-run-consistency.test.ts`. |

---

## Problem Statement (from task-30)

`prompt-registry.ts` versions prompts and supports A/B testing, manual rollback,
and auto-rollback triggered by low success rates. The question:

> "Does rolling back to a previous prompt version mid-run leave one phase on the new
> prompt semantics while another phase is still on the old version, producing an
> internally inconsistent interpretation of the same objective?"

---

## Root Cause Analysis

`getActivePrompt(root, promptKey)` is implemented as:

```typescript
export function getActivePrompt(root: string, promptKey: string): PromptVersion | null {
  const registry = load(root);           // readFileSync on every call — no cache
  const versions = registry[promptKey] ?? [];
  return versions.find((v) => v.isActive) ?? null;
}
```

`load()` calls `readFileSync` every time. There is **no in-process cache**. Every call
to `getActivePrompt` reads `.prompt-registry.json` from disk and returns whatever version
is currently marked `isActive: true`.

A rollback — whether via `rollbackPrompt()` or the auto-rollback path inside
`recordPromptResult()` — writes a new `isActive` state to disk immediately. Every
`getActivePrompt` call after that point returns the rolled-back version.

The result: phases in a multi-phase pipeline that call `getActivePrompt` at their own
start (rather than receiving a pre-resolved template) can see different prompt versions
within the same logical run.

---

## Findings

### GAP-1 (Medium) — Manual rollback mid-run causes silent phase divergence

**Scenario:** operator or orchestrator calls `rollbackPrompt()` while a multi-phase
pipeline is in-flight.

**Phase 1 (architect) calls `getActivePrompt('task-prompt')` → gets v2.**

Operator calls `rollbackPrompt('task-prompt')` → v1 becomes active on disk.

**Phase 2 (reviewer) calls `getActivePrompt('task-prompt')` → gets v1.**

The architect was instructed by v2 semantics; the reviewer evaluated output using v1
semantics. No error was raised by either `getActivePrompt` call. The only way to detect
this is to compare the `version` field from each phase's resolved prompt.

---

### GAP-2 (Medium) — Auto-rollback mid-run causes silent phase divergence

**Scenario:** phase 1 records poor results that cross the auto-rollback threshold.

`recordPromptResult()` triggers auto-rollback when `newRuns >= 5 && successRate < 0.70`.
The rollback fires synchronously before `recordPromptResult` returns.

**A phase's own recorded results can trigger the rollback that harms subsequent phases:**

Phase 1 (architect) uses v2. Phase 1 records 5 results with ≤3 successes (≤60%).
Auto-rollback fires → v1 becomes active. Phase 2 (reviewer) calls `getActivePrompt`
→ gets v1. The architect's output — generated with v2 prompting — is now reviewed
by a phase operating under v1 semantics. No error is raised.

---

## Design Contract (Confirmed)

**`getActivePrompt` is a live file-system read.** There is no in-process cache,
no per-run isolation, and no "begin run / end run" API. This is the confirmed contract:

| Property | Confirmed behavior |
|---|---|
| Each `getActivePrompt` call | Reads `.prompt-registry.json` from disk — always live |
| Rollback timing | Immediate — the next `getActivePrompt` call after any rollback returns the rolled-back version |
| Auto-rollback timing | Synchronous within `recordPromptResult` — fired before the function returns |
| Per-run isolation | **None** — the registry has no concept of a "run"; callers must implement isolation |
| Multi-key independence | Complete — rollback/auto-rollback on one key has zero effect on any other key |

---

## Safe Caller Pattern (DB-2)

To prevent mid-run divergence, callers must resolve all prompts **once at run start**
and pass the resolved `PromptVersion` objects (or their `template` strings) to each
phase, rather than calling `getActivePrompt` per phase.

```typescript
// Safe pattern: snapshot at run start
const runPrompts = {
  architect: getActivePrompt(workspaceRoot, 'arch-prompt')!,
  reviewer:  getActivePrompt(workspaceRoot, 'reviewer-prompt')!,
  // ...
};
// Each phase receives runPrompts.architect.template — not a live lookup.
```

This is entirely the caller's responsibility. The registry provides no built-in
run-level isolation.

---

## Design Boundaries Confirmed

| ID | Description |
|---|---|
| DB-1 | `getActivePrompt` is a live disk read — no in-process state. |
| DB-2 | Run-start snapshot is the caller-level mitigation; the registry has no built-in run concept. |
| DB-3 | Auto-rollback threshold: `runs >= 5 AND successRate < 0.70`. Exactly 0.70 does NOT trigger. Fewer than 5 runs never trigger regardless of success rate. |
| DB-4 | Multiple prompt keys are fully independent. Rollback/auto-rollback on key A has no effect on key B's active version or stats. |
| DB-5 | Rollback is single-step. Each call reverts exactly one version. Multiple rollbacks stack (v3→v2→v1). |
| DB-6 | Auto-rollback stats are saved to disk before the rollback fires (`save(); rollbackPrompt()`), so the triggering version's final stats are not lost. |

---

## Test Cases

**`packages/agent/tests/prompt-registry-mid-run-consistency.test.ts`** — 8 describe blocks, 32 test cases.

| Block | Count | What it covers |
|---|---|---|
| DB-1: live-lookup contract | 4 | No cache, immediate visibility of rollback, null for unknown key |
| GAP-1: manual rollback divergence | 4 | 2-phase divergence, silent (no error), 3-phase, cross-key independence |
| GAP-2: auto-rollback divergence | 4 | 5 failures trigger, own results trigger, immediate effect, 4 runs don't trigger |
| DB-2: run-start snapshot mitigation | 3 | Snapshot vs live, caller responsibility, post-snapshot register |
| DB-3: auto-rollback threshold | 6 | 0%, 60%, 80%, 4-run guard, exactly 70%, single-version guard |
| DB-4: multi-key independence | 4 | Rollback, auto-rollback, stats, version number independence |
| DB-5: rollback is single-step | 5 | v3→v2, v3→v2→v1, single-version null, new register after rollback, return value |
| DB-6: stats persistence | 4 | Survive reload, persisted before auto-rollback, rolling-average math, not reset on new version |

All tests use `mkdtempSync` temp dirs cleaned in `afterEach`. No network, no mocks —
tests exercise the live file-system code path (`readFileSync`/`writeFileSync`) against
real temp files, matching the pattern established in `ai-strategy.test.ts`.

---

## Validation

```bash
node --experimental-strip-types --check \
  packages/agent/tests/prompt-registry-mid-run-consistency.test.ts
# Exit 0

bash validate.sh (node-based checks)
# 50/50 PASSED

node scripts/check-dead-integrations.mjs
# 88 exports flagged; all in allowlist — no new dead integrations

# vitest run / tsc --noEmit — blocked by sandbox network constraints
# (consistent with all passes >= 36).
```

---

## Files Changed

| File | Change |
|---|---|
| `packages/agent/tests/prompt-registry-mid-run-consistency.test.ts` | New — 8 describe blocks, 32 test cases |
| `packages/agent/docs/64-V24-AUDIT-PASS-64.md` | New — this document |
| `tasks/agent-task-queue.json` | task-30 → `"done"`, `completedInPass: 64` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 64 entry prepended |
| `CHANGELOG.md` | Version 24.30.36 entry added |
| `ENGINEERING_NOTES.md` | Pass 64 section added |
| `package.json` (×4) | Version bumped 24.30.35 → 24.30.36 |

---

## Remaining Locally-Tractable Tasks

From `tasks/agent-task-queue.json`:

| ID | Priority | Title |
|---|---|---|
| task-31 | P3 | Warden policy-conflict resolution correctness |
| task-32 | P3 | Semantic-cache drift adversarial audit |
| task-33 | P3 | Decide on free CI/build-acceleration caching *(requiresOwnerDecision)* |
| task-34 | P3 | Decide on centralized secrets/config management *(requiresOwnerDecision)* |

Next locally-tractable non-owner task: **task-31** — Warden policy-conflict resolution correctness.
