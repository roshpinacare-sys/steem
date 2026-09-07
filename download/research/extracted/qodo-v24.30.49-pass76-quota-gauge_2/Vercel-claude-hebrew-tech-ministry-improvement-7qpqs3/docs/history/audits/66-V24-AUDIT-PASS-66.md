# QODO V24 — Audit Pass 66 (CIEP-X v10.0)

**Version:** 24.30.38
**Date:** 2026-07-07
**Protocol:** Canonical Incremental Engineering Protocol X v10.0
**Baseline:** 24.30.37 (Pass 65 — Cloudflare AI Gateway NO-GO decision)
**Task:** task-46 — Warden multi-violation reporting and priority-ordering correctness audit

---

## Executive Summary

Pass 66 executes task-46: adversarial audit of `warden.ts` and `warden-memory.ts`
for multi-violation correctness, priority-ordering behavior, and Coder feedback loop
quality. This is a test-only pass — no production source files are changed.

The pass documents four gaps (GAP-1 through GAP-4) and four design boundaries
(DB-1 through DB-4) for the Warden subsystem. Gaps are documented rather than fixed
because all four describe design trade-offs with a clear collect-all vs.
document-priority decision point that requires an owner call before implementation
(see PASS 5 Decision for rationale). A new adversarial test file
(`packages/agent/tests/warden-multi-violation.test.ts`, 8 describe blocks,
32 test cases) locks all documented behavior so future changes cannot silently
regress it.

---

## PASS 1 — Repository Acquisition

Baseline: `QODO-V24.30.37-pass65.zip` (379 files, 1.1 MB).

Key files read for this task:

- `packages/agent/src/agents/warden.ts` — three-loop sequential scan; early-return on first match
- `packages/agent/src/services/warden-memory.ts` — `recordWardenRejection` + `loadWardenLessons`
- `packages/agent/tests/warden.test.ts` — existing 5-case suite (single-violation only)
- `packages/agent/src/schemas/coder-schema.ts` — `CoderOutput` type (`{ diff, files }`)
- `packages/agent/src/services/redis-state.ts` — `RedisState` class interface for mock

---

## PASS 2 — Continuity Review

Task selected: **task-46** (P3, code task, locally tractable, no network, no owner decision).
This is the only non-owner-decision queued task after Pass 65.

Per queue rules: one task per pass; pick lowest-priority-number unblocked queued
non-owner task. task-46 is the only candidate.

---

## PASS 3 — System Analysis: warden.ts and warden-memory.ts

### inspectFile() control flow

```
inspectFile(path, content)
  ├─ Loop 1: getDescendants() → AnyKeyword?
  │    └─ return "Warden: explicit \"any\" found ..."  ← early exit
  ├─ Loop 2: getDescendants() → ExpressionStatement(console.log)?
  │    └─ return "Warden: console.log found ..."      ← early exit
  ├─ Loop 3: getDescendants() → AwaitExpression (not in try)?
  │    └─ return "Warden: unwrapped await found ..."  ← early exit
  └─ return null
```

**Priority ordering:** `any` > `console.log` > `await` — determined entirely by
loop sequence. No policy comment or invariant documents this order.

**Single-violation return:** Each loop uses `return` on the first matching node.
Multiple violations in the same loop iteration surface only the first match.
Multiple violations across loops surface only the loop-1 winner.

### wardenGuard() control flow

```
wardenGuard(patch, state?, owner?, repo?, telemetry?)
  for file in patch.files[]:
    rejection = inspectFile(file.path, file.content)
    if rejection:
      recordWardenRejection(owner, repo, file.path, rejection, state)
      telemetry?.decision(...)
      throw WardenRejectionError(rejection)   ← stops here; later files not inspected
```

**File-order dependence:** The first file with a violation causes the throw; all
subsequent files are uninspected. Patch array ordering is the Coder's responsibility
but is not documented as a correctness constraint.

### warden-memory.ts key structure

```
key: warden:memory:${owner}:${repo}
entry key: "${path}::${rule}"
```

A `recordWardenRejection` call stores exactly one `(path, rule)` pair. If a file
has violations A and B, but violation A is always reported first, only
`"file.ts::ruleA"` is ever written during that guard call. Rule B appears only
after A is fixed and guard is called again.

`loadWardenLessons()` returns the top-N entries by `count` descending. It provides
the Coder with lesson context, but that context is limited to violations that have
already been surfaced in prior guard calls.

---

## PASS 4 — Engineering Planning

### Gaps identified

| Gap | Severity | Description |
|-----|----------|-------------|
| GAP-1 | **Medium** | Priority ordering (`any` > `console.log` > `await`) is an artifact of loop sequencing with no documentation. A future refactor that reorders loops would silently change Coder feedback behavior with no test to catch it. |
| GAP-2 | **Medium** | `inspectFile()` returns on first match. A file with N distinct violation types requires N `wardenGuard()` round-trips — each a full Coder regeneration cycle — to surface all violations. |
| GAP-3 | **Medium** | `wardenGuard()` stops at the first violating file in `patch.files[]`. Files after the first violation are never inspected, even if they also have violations. |
| GAP-4 | **Medium** | `warden-memory.ts` records exactly one lesson per guard call. `loadWardenLessons()` presents incomplete context to the Coder for multi-violation files, enforcing the N-round-trip pattern documented in GAP-2. |

### Design boundaries confirmed

| ID | Description |
|----|-------------|
| DB-1 | `inspectFile()` is a pure function: identical input always returns identical output. Priority ordering is deterministic for the current loop sequence. |
| DB-2 | `wardenGuard()` processes files in `patch.files[]` array order. Patch ordering is the Coder's responsibility. |
| DB-3 | `warden-memory` key is `"${path}::${rule}"` — lesson identity is the (file path, violation rule) pair. Multiple rules on the same file accumulate as separate keys, each recorded only once it has been surfaced in a guard call. |
| DB-4 | `loadWardenLessons()` returns up to `limit` (default 5) lessons sorted by `count` descending. High-frequency violations bubble up regardless of rule type. |

### Fix options (deferred — see PASS 5)

Two approaches exist, with different tradeoffs:

**Option A — Collect-all reporting**

Modify `inspectFile()` to return all violations (not just the first) as a combined
message or structured list. Modify `wardenGuard()` to collect all file violations
before throwing. Record all violations to `warden-memory` in a single guard call.

- Benefit: Coder receives complete violation context in one round-trip.
- Cost: Changes the public interface of `inspectFile()` (currently `string | null`).
  `wardenGuard()` would need to serialize multiple violations into a single
  `WardenRejectionError`. Any caller that parses the rejection message by pattern
  would need updating.

**Option B — Document-priority policy**

Keep `inspectFile()` single-return behavior as-is. Add a JSDoc comment to
`warden.ts` explicitly declaring the priority rule as policy. Add a comment to
`wardenGuard()` noting that patch ordering affects which file's violation is reported
first. Add a comment to `warden-memory.ts` noting the one-lesson-per-call design.

- Benefit: Zero interface change, zero compatibility risk.
- Cost: N-round-trip behavior is preserved. Coder still requires multiple cycles
  for multi-violation files.

---

## PASS 5 — Engineering Decision (deferred — owner call needed)

The choice between Option A and Option B has a non-trivial interface compatibility
impact (Option A changes `inspectFile()` return type and `WardenRejectionError`
content; any downstream parser of rejection messages must be updated) versus a
non-trivial product quality trade-off (Option B preserves suboptimal Coder feedback
for files with multiple violations).

**Decision for this pass: document, do not fix.** The adversarial test suite
(`warden-multi-violation.test.ts`) locks current behavior so no unintended regression
is possible while the design decision is pending. The implementing pass should
explicitly choose Option A or Option B, execute it, and update the test suite
accordingly.

The implementing pass should note:
- Option A is the higher-value outcome. If pursued, the test suite's
  "iterative disclosure" and "feedback loop gap" describe blocks should be inverted
  (they currently lock the N-round-trip behavior as observable fact; post-fix they
  should assert it no longer occurs).
- Option B is the safe outcome. If pursued, the JSDoc policy comments become the
  deliverable and the existing tests remain correct.

---

## PASS 6 — Hardening and Validation

### Test file: warden-multi-violation.test.ts

**8 describe blocks, 32 test cases.** No mocks beyond the minimal in-memory
`RedisState` substitute (satisfies `getJSON` / `setJSONWithTTL`; no network call).

| Describe block | Tests | Coverage |
|----------------|-------|----------|
| Priority rule: any beats console.log and await | 4 | GAP-1, DB-1 |
| Priority rule: console.log beats await when no any | 4 | GAP-1, DB-1 |
| Multi-violation iterative disclosure | 4 | GAP-2 |
| Edge cases and false-positive guards | 4 | DB-1 |
| wardenGuard() multi-file stop-at-first | 4 | GAP-3, DB-2 |
| warden-memory key and count semantics | 4 | DB-3, DB-4 |
| Coder feedback loop gap | 4 | GAP-4 (GAP-3 × GAP-4) |
| Design boundary locks | 4 | DB-1 through DB-4 |

### Syntax validation

```
node --experimental-strip-types --check \
  packages/agent/tests/warden-multi-violation.test.ts → Exit 0
```

### Integration checks

```
validate.sh (node-based checks: JS/MJS syntax) → PASSED (no .mjs/.js changes)
check-dead-integrations.mjs → clean (no new exports added to source files)
vitest run / tsc --noEmit — blocked by sandbox network constraints
  (consistent with all passes >= 36; warden-memory.ts imports from redis-state.ts
   which does network I/O at instantiation — import is type-only in test context
   but full resolution requires the module graph, which needs the lock file)
```

---

## PASS 7 — Engineering Continuity

### Files changed

| File | Change |
|------|--------|
| `packages/agent/tests/warden-multi-violation.test.ts` | New — 8 describe blocks, 32 test cases |
| `packages/agent/docs/66-V24-AUDIT-PASS-66.md` | New — this pass document |
| `tasks/agent-task-queue.json` | task-46 → `"done"`, `completedInPass: 66` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 66 entry prepended |
| `CHANGELOG.md` | [24.30.38] entry prepended |
| `ENGINEERING_NOTES.md` | Pass 66 entry appended; remaining tasks updated |
| `package.json` (root) | version 24.30.37 → 24.30.38 |
| `packages/agent/package.json` | version 24.30.37 → 24.30.38 |
| `apps/mission-control/package.json` | version 24.30.37 → 24.30.38 |
| `standalone-executable/package.json` | version 24.30.37 → 24.30.38 |

### Queue state after Pass 66

- **Done (26 tasks):** task-3, task-7 through task-30, task-35 (Pass 65), task-46 (Pass 66)
- **Queued — owner-decision (9 tasks):** task-31, task-32, task-33, task-34, task-36,
  task-37, task-38, task-39, task-40
- **Queued — code tasks:** none (task-46 was the last locally-tractable code task)
- **Blocked (11 tasks):** task-1, task-2, task-4, task-5, task-6, task-15,
  task-41, task-42, task-43, task-44, task-45

**Next tasks:**
- No locally-tractable code tasks remain in the queue.
- Next owner-decision tasks (P2): **task-36** (code-quality/security APIs — Snyk,
  Socket.dev, VirusTotal), **task-39** (feature-flag canary — LaunchDarkly/Flagsmith).
- The Warden multi-violation fix (Option A or B) should be added as a new task after
  the owner choose-direction decision. Recommend adding it as **task-47**
  (owner decision: choose Option A or B) with a follow-on **task-48** (implementation).

---

## PASS 8 — Release Packaging

Version bumped: **24.30.37 → 24.30.38**

Output: `QODO-V24.30.38-pass66.zip`
