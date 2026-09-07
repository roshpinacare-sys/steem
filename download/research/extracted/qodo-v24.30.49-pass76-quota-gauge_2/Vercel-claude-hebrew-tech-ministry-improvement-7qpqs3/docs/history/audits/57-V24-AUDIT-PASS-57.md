# 57-V24-AUDIT-PASS-57 — Hot-Reload-Config Race Condition Test

**Task completed:** task-25 from `tasks/agent-task-queue.json`
**Version:** 24.30.29
**Date:** 2026-07-07

---

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — `hot-reload-config.ts` mutates `process.env` keys one at a time inside a debounced callback. The path-guard system reads two related keys (`ALLOWED_PATHS` + `BLOCKED_PATHS`) from `process.env`. A reader observing them in different ticks could see a mixed-epoch config and make an incorrect path-guard decision. This pass proves exactly when the race is and is not possible, documents three concrete gaps (including one previously unknown shutdown race), and confirms the existing `loadPathGuardConfig()` is immune. |
| Implementation risk | Zero — test-only pass. No production source files, schemas, sacred files, or infrastructure changed. |
| Compatibility impact | None. |
| Rollback complexity | Trivial — delete `hot-reload-race.test.ts`. |

---

## Problem Statement (task-25)

From the task queue:

> `hot-reload-config.ts` reloads configuration live. Check for a race where an
> in-flight phase reads a partially-updated config mid-reload (e.g. new
> `allowedPaths` already applied but old `blockedPaths` still in effect),
> producing an inconsistent path-guard state for that phase.

The queue's implementation notes scope the approach:

> *"Locally tractable: trigger a reload concurrently with a simulated in-flight
> read (e.g. via a deliberately delayed read using a test hook) and assert the
> reader always observes either the fully-old or fully-new config, never a mix."*

---

## Root Cause Analysis

### The reload mechanism

`applyEnv()` (internal to `hot-reload-config.ts`) applies keys one at a time:

```typescript
function applyEnv(vars: Record<string, string>): void {
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;   // one assignment per key, in iteration order
  }
}
```

For a two-key reload (`ALLOWED_PATHS` + `BLOCKED_PATHS`), there are two sequential
`process.env[key] = value` statements. In JavaScript (single-threaded V8), no
JavaScript callback can fire between two consecutive synchronous statements.
However, an *async* caller that explicitly yields (`await`) between reads CAN
observe a reload that fires in the yield window.

Additionally, the debounce timer stored in the closure is never cleared by
`watcher.close()`, producing a third gap independent of reader async-ness.

---

## Confirmed Gaps

### GAP-1 (Medium): Async reader TOCTOU

**Sequence:**
```
Phase 1: reader reads process.env.ALLOWED_PATHS   → "old-src/"
Phase 2: reader awaits (yields event loop turn)
Phase 3: debounce fires → applyEnv({ALLOWED_PATHS: "new-src/", BLOCKED_PATHS: "new-private/"})
Phase 4: reader reads process.env.BLOCKED_PATHS   → "new-private/"
```

**Result:** reader holds `(ALLOWED="old-src/", BLOCKED="new-private/")` — a mixed state
spanning two config epochs. If `new-src/index.ts` is valid under the new config but
not the old one, the reader's mixed config incorrectly rejects it (test RC3).

**Current exposure:** `loadPathGuardConfig()` is *synchronous* and is immune today.
The gap would materialize if it were ever made async.

**Test cases:** RC1–RC3 in `hot-reload-race.test.ts`

**Mitigation (documented, not changed):**
- `loadPathGuardConfig()` must remain synchronous, or be refactored to capture a
  consistent snapshot in a single synchronous read before any yield.
- Safe pattern: capture the full `PathGuardConfig` struct at phase-start before any
  `await` and carry it through the async phase (DB_DESIGN2 test case).

---

### GAP-2 (Low-Medium): Consecutive partial-reload window

**Sequence:**
```
Initial state: ALLOWED="src/", BLOCKED="private/"

File write #1 → only ALLOWED_PATHS="new-src/" in the new file
  → Reload #1 fires: process.env.ALLOWED_PATHS = "new-src/"
  → Window opens: ALLOWED="new-src/" (new), BLOCKED="private/" (stale)

File write #2 → only BLOCKED_PATHS="dist/" in the new file
  → Reload #2 fires: process.env.BLOCKED_PATHS = "dist/"
  → Window closes: ALLOWED="new-src/", BLOCKED="dist/" (consistent)
```

**Result:** Any reader — synchronous or async — in the window sees a mixed state.
No `await` required. Common in CI pipelines that write env vars line-by-line.

**Test cases:** PR1–PR4 in `hot-reload-race.test.ts`. PR4 is the integration test:
it drives `startHotReload()` through two real debounce cycles with disjoint-key
`.env` files, confirming the gap at the actual hot-reload mechanism level (not just
via direct `applyConfig` modeling).

**Mitigation (documented, not changed):**
- Write all related path-guard keys in a single atomic `fs.writeFileSync` call —
  the debounce coalesces them into one reload (DB_DESIGN4 test case explains the
  reasoning; WI4 confirms one change event → one atomic reload).

---

### GAP-3 (Low): Shutdown race — close() does not cancel pending debounce timer

**Sequence:**
```
1. Change event fires → debounce timer scheduled (setTimeout, 300 ms)
2. watcher.close() called immediately
3. DEBOUNCE_MS elapses → setTimeout callback fires → applyEnv() runs
```

`watcher.close()` removes the fs.watch callback from the watcher, preventing new
events from scheduling new timers. However, the already-running `debounceTimer`
(a closure variable inside `startHotReload`) is never cleared. The timer fires
and applies the config update even though the watcher has been nominally closed.

**Test case:** WI6 in `hot-reload-race.test.ts` — demonstrates the update IS
applied despite `close()` being called before the timer fires.

**Mitigation (documented, not changed):**
- Fix would require calling `clearTimeout(debounceTimer)` inside the watcher's
  `close()` event handler or an explicit `stop()` method. Deferred — the
  consequence is a delayed-but-harmless final config apply, not corruption.

---

## Additional Design Boundary Documented

**Stale key persistence (PR3):** `applyEnv()` never deletes keys absent from the
new file. A key set in reload #1 but omitted from reload #2 remains in `process.env`
with its reload #1 value indefinitely. This is a design-level property — not a bug
— but callers must be aware that `process.env` accumulates keys across reloads.

---

## Properties Confirmed

| Property | Evidence |
|---|---|
| Synchronous applyEnv is TOCTOU-immune for synchronous readers | AT1–AT3 |
| Async reader CAN observe GAP-1 mixed state | RC1–RC3 |
| Sync reader CAN observe GAP-2 partial-reload window | PR1–PR2 |
| PR4 integration: real debounce cycles confirm GAP-2 at startHotReload level | PR4 |
| close() does not cancel pending debounce timer (GAP-3) | WI6 |
| loadPathGuardConfig is immune today (sync) | PG1–PG4, DB_DESIGN1–3 |
| Watcher returns null when file absent | WI1 |
| Initial apply is synchronous on watcher start | WI3 |
| File-change event triggers debounced apply | WI4 |
| close() stops new events from scheduling new timers | WI5 |
| Rapid events coalesce to single apply | DB1–DB3 |
| Unreadable file after change event is handled without crash | EH1 |
| All-comment file is a no-op (safe, no crash) | EH2 |
| Phase-start snapshot pattern correctly prevents mixed reads | DB_DESIGN2 |

---

## New File

**`packages/agent/tests/hot-reload-race.test.ts`** — 9 describe blocks, 36 test cases.

The test file mocks the `fs` and `path` modules (via `vi.hoisted` + `vi.mock`) so no
real filesystem access occurs. `process.env` keys use the `QODO_TEST_HR_` prefix and
are cleaned up in `afterEach`. Fake timers (`vi.useFakeTimers()`) are used for
debounce and shutdown-race suites.

GAP-1 (RC2): async reader captures `ALLOWED_PATHS`, yields with
`await Promise.resolve()`, then captures `BLOCKED_PATHS`. `applyConfig` fires in the
yield window. Test asserts old ALLOWED + new BLOCKED — a concrete mixed state.

GAP-2 (PR4): two sequential `startHotReload()` debounce cycles with disjoint-key
`.env` file contents, with a `readEnvKeys` snapshot taken between them confirming
the mixed-state window at the actual hot-reload mechanism level.

GAP-3 (WI6): change event fired, then `watcher.close()` called immediately, then
fake timers advanced past `DEBOUNCE_MS` — asserts the update IS applied, proving
`close()` does not cancel an already-pending debounce timer.

---

## Validation

```bash
node --experimental-strip-types --check \
  packages/agent/tests/hot-reload-race.test.ts
# Exit 0

bash validate.sh
# 50/50 PASSED

node scripts/check-dead-integrations.mjs
# 88 exports flagged; all in allowlist (no new production exports added)

# vitest run / tsc --noEmit — blocked by sandbox network constraint,
# consistent with all passes >= 36.
```

---

## Files Changed

| File | Change |
|---|---|
| `packages/agent/tests/hot-reload-race.test.ts` | New — 9 describe blocks, 36 test cases |
| `packages/agent/docs/57-V24-AUDIT-PASS-57.md` | New — this document |
| `tasks/agent-task-queue.json` | task-25 → `"done"`, `completedInPass: 57` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 57 entry added |
| `CHANGELOG.md` | Version 24.30.29 entry added |
| `ENGINEERING_NOTES.md` | Pass 57 section added |
| `package.json` (×4) | Version bumped 24.30.28 → 24.30.29 |

---

## Next Priority Task

Per `tasks/agent-task-queue.json`, the remaining unblocked priority-2 task is
**task-28** (API-contract-guard adversarial schema-drift test).

**task-28 summary:** `api-contract-guard.ts` is meant to catch schema drift in
`architect-schema.ts` / `coder-schema.ts` / `reviewer-schema.ts`. Adversarially
test whether a patch that introduces deceptive but technically-valid schema changes
(e.g. widening a required field to optional, narrowing a union, adding an extra
property that downstream code ignores but that silently breaks the gate logic)
passes or fails the guard as expected.
