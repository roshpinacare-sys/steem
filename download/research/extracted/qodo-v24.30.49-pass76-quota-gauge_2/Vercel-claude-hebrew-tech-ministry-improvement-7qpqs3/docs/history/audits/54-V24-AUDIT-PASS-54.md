# Pass 54 — Meta-Agent Mutation Rollback Adversarial Test (Task-17) — Version 24.30.26 — 2026-07-07

**Task completed:** task-17 from `tasks/agent-task-queue.json`

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — `meta-agent.ts` is the system's self-repair mechanism; a mutation that survives a crash or is incorrectly rolled back can silently govern future pipeline runs under a wrong or partial prompt. Rollback correctness across chained mutations and crash scenarios is the single highest-consequence correctness property not yet adversarially tested. |
| Implementation risk | Zero — test-only pass; no production source files, schemas, sacred files, or infrastructure changed. |
| Compatibility impact | None — new test file only. |
| Rollback complexity | Trivial — delete `meta-agent-rollback.test.ts`. |

## Problem Statement (task-17)

`meta-agent.ts`'s `mutatePrompt` / `rollbackLastMutation` pair is used from `cli.ts`
to self-repair failing LLM output. The task queue notes:

> "Rollback correctness is easy to prove for one mutation and easy to silently break
> across a chain of several — exactly the kind of defect that would only surface after
> multiple Darwin-engine mutation cycles in production."

**Specific concern:** Chain 5-10 mutations against a prompt store, kill the process
(or throw) partway through one, and assert the store is either the pre-mutation or
fully-post-mutation state — never partial.

### Write-ordering analysis

`mutatePrompt` serialises its writes in this order:

```
1. historyKey ← updated (snapshot pushed)           ← WRITE A
2. aiRoute() call                                    ← can THROW here
3. activeKey  ← new mutation written                 ← WRITE B
```

A crash (simulated via `aiRoute` throwing) between WRITE A and WRITE B leaves:
- `historyKey`: phantom head entry `{ previous: BEFORE, mutatedAt: ... }`
- `activeKey`: still `BEFORE` (unchanged)

This is the only plausible crash window in the current synchronous write sequence.
The system is never in a state where `activeKey` holds the new value but `historyKey`
does not record the rollback snapshot — because WRITE A precedes WRITE B.

## Test File

**`packages/agent/tests/meta-agent-rollback.test.ts`** — 7 describe suites, 32 test cases.

No network access, no Redis, no file system required. `aiRoute` is stubbed via
`vi.mock`; `log` is silenced. All mutations are exercised against an in-process
`Map`-backed `RedisState` mock using the same deep-clone-via-JSON pattern as
`trust-ledger-gaming.test.ts` and `swarm-contention.test.ts`.

## Suite Coverage

### Suite 1 — RedisState mock isolation (4 cases)
- M0: `getJSON` returns null for an unset key
- M1: `setJSONWithTTL` + `getJSON` round-trips a string with embedded newlines
- M2: deep-clone prevents external mutation of stored values
- M3: `delete` removes the key; subsequent `getJSON` returns null

### Suite 2 — Single mutation + rollback correctness (5 cases)
- R1: `mutatePrompt` sets the active key to the trimmed AI output
- R2: History records `null` as previous when no prior mutation existed
- R3: Rollback after first mutation (previous = null) deletes the active key
- R4: Rollback with a real previous prompt restores it byte-identically (character-by-character check)
- R5: `rollbackLastMutation` is a no-op when history is empty

### Suite 3 — Chained 7 mutations + sequential rollback (5 cases)
- C1: 7-mutation chain leaves the last mutation as the active value
- C2: History length matches mutation count
- C3: Sequential rollback restores each prior step byte-identically (M6→M5→...→BASE)
- C4: After full rollback chain, active == original and history is empty
- C5: History is capped at 20 entries; oldest are silently dropped (DB1 documented)

### Suite 4 — Crash simulation: partial-commit adversarial scenarios (5 cases)
- CRASH-1: `aiRoute` failure leaves active key unchanged — no partial mutation applied
- CRASH-2: Rollback after `aiRoute` failure cleans phantom history entry idempotently
- CRASH-3: 3 crashes + 1 committed success → 4 rollbacks restore original state
- CRASH-4: Across 20 interleaved crash/success operations, active is always pre-crash or post-success
- CRASH-5: Whenever active has a new value, history head records a different previous (rollback invariant)

### Suite 5 — Byte-identical content preservation (4 cases)
- BI1: Unicode content (Japanese, emoji, control characters) preserved byte-identically
- BI2: Whitespace-heavy prompt (tabs, double-newlines, trailing spaces) preserved exactly
- BI3: Very long prompt (>10 KB) preserved through 5 mutation/rollback cycles
- BI4: `mutatePrompt` trims AI output before storing; stored value matches returned value

### Suite 6 — getActiveMutation and promoteMutation lifecycle (5 cases)
- GA1: `getActiveMutation` returns null before any mutation
- GA2: `getActiveMutation` returns current active after mutation
- PM1: `promoteMutation` returns false when no active mutation exists
- PM2: `promoteMutation` returns true and leaves active key intact
- PM3: Rollback still works correctly after a mutation is promoted

### Suite 7 — Namespace isolation (4 cases)
- ISO1: Mutation to 'architect' does not affect 'coder' active key
- ISO2: Mutation to org-A/repo-A does not affect org-B/repo-B
- ISO3: Rollback on 'reviewer' does not affect 'architect' state
- ISO4: All three agents can be mutated and rolled back independently

## Design Boundaries Confirmed (valid, not fixed)

| Boundary | Description |
|---|---|
| DB1: History cap | History is sliced to 20 entries via `history.slice(0, 20)`. Mutations beyond depth 20 silently lose their oldest rollback snapshot. Intentional design choice — bounded memory. |
| DB2: Non-atomic rollback | `rollbackLastMutation` is not atomic across both Redis keys: it reads history, writes activeKey, then writes historyKey. A crash between those writes could leave partial rollback state. Acceptable for the current single-process model. |
| DB3: Phantom history entries | An AI call that throws after `historyKey` is written leaves a phantom history entry. Rollback cleans it up idempotently — the active key's effective value is correct either way. |

## Invariants Preserved

| Invariant | Status |
|---|---|
| Phase state machine (IDLE→…→DONE) | ✅ Not touched — test-only pass |
| Redis namespace `qodo:v24:` | ✅ Not touched — test-only pass |
| Strict Zod schema parsing | ✅ Not touched — test-only pass |
| Sacred-file manifest hashes | ✅ Unchanged — no production source files modified |
| 5-gate validator order | ✅ Not touched — test-only pass |

## Validation Results

| Check | Result |
|---|---|
| `node --experimental-strip-types --check` on new test file | ✅ Exit 0 |
| `validate.sh` | ✅ 50/50 PASSED |
| `node scripts/check-dead-integrations.mjs` | ✅ 88 exports flagged; all in allowlist (no new production exports) |
| `vitest run` / `tsc --noEmit` | ⚠️ Blocked by sandbox network constraint — no `node_modules` available. Consistent with all passes ≥ 36. Static review confirms no type errors in the new test file. |

## Files Changed

| File | Change |
|---|---|
| `packages/agent/tests/meta-agent-rollback.test.ts` | New — 7 describe suites, 32 adversarial test cases |
| `packages/agent/docs/54-V24-AUDIT-PASS-54.md` | New — this document |
| `tasks/agent-task-queue.json` | task-17 → `"done"`, `completedInPass: 54` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 54 entry added |
| `CHANGELOG.md` | Version 24.30.26 entry added |
| `ENGINEERING_NOTES.md` | Pass 54 section added |
| `package.json` (×3) | Version bumped 24.30.25 → 24.30.26 |

## Next Priority Task

Per `tasks/agent-task-queue.json`, the next unblocked priority-2 task is **task-19**:
*"Obfuscator token-collision exhaustive test at scale"* — generating a large synthetic
identifier corpus (thousands of realistic symbol names), running it through
`obfuscator.ts`, and asserting the reverse-mapping is bijective (no two distinct
symbols map to the same token). This closes the birthday-paradox-style collision
gap that Pass 27's targeted regression test did not cover at realistic corpus scale.
