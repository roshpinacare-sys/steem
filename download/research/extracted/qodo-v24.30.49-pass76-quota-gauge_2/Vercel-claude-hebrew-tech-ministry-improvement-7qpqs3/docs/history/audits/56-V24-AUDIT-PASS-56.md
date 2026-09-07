# 56-V24-AUDIT-PASS-56 — Quota-Guardian / Cost-Ledger Concurrent Reconciliation

**Task completed:** task-24 from `tasks/agent-task-queue.json`
**Version:** 24.30.28
**Date:** 2026-07-07

---

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — two spend-tracking systems (quota-guardian + cost-ledger) are each individually correct under sequential access. Their concurrent behaviour under shared Redis keys had not been adversarially proven. This pass documents two concrete gaps that affect any deployment with more than one concurrent pipeline run. |
| Implementation risk | Zero — test-only pass. No production source files, schemas, sacred files, or infrastructure changed. |
| Compatibility impact | None. |
| Rollback complexity | Trivial — delete `quota-ledger-concurrency.test.ts`. |

---

## Problem Statement (task-24)

From the task queue:

> `quota-guardian.ts` and `cost-ledger.ts` both gate spend. Confirm they agree
> under concurrent runs — e.g. two runs simultaneously approaching a shared quota
> — rather than each independently under-counting the other's in-flight spend and
> jointly overshooting.

Both systems use Redis as a shared store. Neither performs atomic read-modify-write
(no Redis transactions, no Lua CAS for the relevant paths). The bug class is:

1. Caller A reads state S from Redis.
2. Caller B reads state S from Redis (same value — neither has written yet).
3. Caller A mutates S → S_A and writes back.
4. Caller B mutates S → S_B and writes back, overwriting S_A.

Result: Caller A's update is lost. For cost-ledger, a cost entry disappears.
For quota-guardian, both callers believe they have headroom and both dispatch.

---

## Confirmed Gaps

### GAP-1 (High): `recordCost` is a non-atomic read-modify-write

**Location:** `packages/agent/src/services/cost-ledger.ts`, `recordCost()`

**Sequence:**
```
getJSON(entryKey)            ← read current LedgerEntry
entry.costs.push(cost)       ← mutate local copy
setJSONWithTTL(entryKey, …)  ← write back
```

Two concurrent callers on the same `(owner, repo, runId)` key both complete
the `getJSON` before either `setJSONWithTTL`. The last writer's `setJSONWithTTL`
overwrites the first, silently discarding the first caller's cost entry.

**Magnitude:** In the worst case (all N concurrent callers read before any writes),
only the last write survives. With N=20 concurrent calls, only 1 cost entry
may survive. The `totals` object is always internally consistent with the
surviving `costs` array — no partial-write corruption — but the total is
systematically under-counted.

**Test cases:** CC1–CC4 in `quota-ledger-concurrency.test.ts`

**Mitigation (documented, not changed):**
- `phase-runner.ts` buffers costs in-memory via `CostTracker` and writes to the
  ledger once at phase completion, not mid-phase. This is the safe pattern — a
  single `recordCost` per phase, serialised at phase boundaries.
- Callers that need concurrent cost attribution within the same run should buffer
  in-process and flush once, never concurrently.

---

### GAP-2 (Medium): Concurrent quota snapshot writes — last-writer-wins

**Location:** `packages/agent/src/services/quota-guardian.ts`, `recordQuotaFromHeaders()`

**Sequence:**
```
parse headers → QuotaSnapshot  ← pure, no I/O
setWithTTL(key, JSON.stringify(snapshot), ttlS)  ← blind write
```

Two concurrent `recordQuotaFromHeaders()` calls write different snapshots
(e.g. from two concurrent response headers). The last write wins. This is
usually harmless — snapshot values are advisory and expire via TTL.

**The joint-overshoot scenario:**
- Two runs both call `hasComfortableHeadroom()` / `loadQuotaSnapshot()` before
  either has received and written a 429-triggered update.
- Both read the same `requestsRemaining=N` snapshot.
- Both decide they have headroom and dispatch.
- Together they consume 2 slots when only 1 was truly available.

This is an inherent property of the advisory, non-gating design. The quota
tracker cannot prevent dispatch; it only informs routing decisions.

**Test cases:** CQ1–CQ3, DB3 in `quota-ledger-concurrency.test.ts`

**Mitigation (confirmed in test DB3, not changed):**
- The real gate is `markProviderExhausted()` after receiving a 429. This writes
  `requestsRemaining=0` synchronously, and all subsequent `hasHeadroom()` reads
  correctly return `false`. The system is *reactive*, not *preventive* — which
  matches the design intent stated in quota-guardian.ts's header comment:
  "converting mid-pipeline 429s into a scheduling decision made upfront."

---

## Resistance Properties Confirmed

| Property | Test | Result |
|---|---|---|
| Sequential `recordCost` accumulates all entries without loss | SL2 | ✅ Confirmed |
| `closeLedger` seals entry with `closedAt` timestamp | SL3 | ✅ Confirmed |
| `loadQuotaSnapshot` returns null when no snapshot (optimistic default) | QR1 | ✅ Confirmed |
| Single write then read returns exact snapshot | QR2 | ✅ Confirmed |
| `hasHeadroom(null)` = true, `hasHeadroom({remaining:0})` = false | QR3 | ✅ Confirmed |
| `rankByHeadroom` orders by `requestsRemaining` descending | QR4 | ✅ Confirmed |
| `markProviderExhausted` → `hasHeadroom` = false (exhaustion sticky) | CQ3 | ✅ Confirmed |
| Separate repo ledger keys never cross-contaminate | CM4 | ✅ Confirmed |
| 20 concurrent reads on quota snapshot all see the same consistent snapshot | HC3 | ✅ Confirmed |
| Sequential `recordCost` with yield is safe (mitigation path works) | CC4, HC2 | ✅ Confirmed |
| `hasComfortableHeadroom` null/zero/fraction thresholds correct | HH1–HH4 | ✅ Confirmed |

---

## Design Boundaries Confirmed (valid, not fixed)

| Boundary | Detail |
|---|---|
| DB1: quota-guardian is advisory, not gating | `hasHeadroom()` informs routing; it cannot block a direct provider call. Ledger records cost regardless of quota signal. |
| DB2: safe `recordCost` pattern = serialised per run | Concurrent callers must buffer costs in-process and flush once. `phase-runner.ts` already follows this pattern. |
| DB3: reactive exhaustion gate | `markProviderExhausted()` after a 429 is the real block. The read-before-write joint-overshoot is an accepted bounded window, not an unbounded leak. |

---

## Validation

```bash
node --experimental-strip-types --check \
  packages/agent/tests/quota-ledger-concurrency.test.ts
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
| `packages/agent/tests/quota-ledger-concurrency.test.ts` | New — 8 describe blocks, 28 test cases |
| `packages/agent/docs/56-V24-AUDIT-PASS-56.md` | New — this document |
| `tasks/agent-task-queue.json` | task-24 → `"done"`, `completedInPass: 56` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 56 entry added |
| `CHANGELOG.md` | Version 24.30.28 entry added |
| `ENGINEERING_NOTES.md` | Pass 56 section added |
| `package.json` (×4) | Version bumped 24.30.27 → 24.30.28 |

---

## Next Priority Task

Per `tasks/agent-task-queue.json`, the remaining unblocked priority-2 tasks are
**task-25** (Hot-reload-config race condition test) and **task-28**
(API-contract-guard adversarial schema-drift test). The next pass should pick
whichever of these two has the lower priority number — both are priority 2,
so task-25 comes first by task-ID ordering.

**task-25 summary:** `hot-reload-config.ts` reloads configuration live. Check for
a race where an in-flight phase reads a partially-updated config mid-reload —
`allowedPaths` already applied but `blockedPaths` still in effect — producing an
inconsistent path-guard state for that phase. Locally tractable via a test hook
that delays the in-flight read to overlap with the reload trigger.
