# ECOS Replay Architecture — V106

## Overview

The V106 Replay Substrate enables deterministic state reconstruction from the
audit log, forensic run-level replay from the execution journal, and provenance
chain traversal — all without modifying Sacred Files.

---

## Architecture

```
AuditLog (append-only SHA-256 chain)
    │
    ▼
auditEntryToLedgerEvent()       ← mapping layer (replayEngine.js)
    │
    ▼
deterministicReducers.replayEvents()  ← pure (state, event)[] → finalState
    │
    ▼
ReplayEngine.replayAuditLog()   ← result + replayProof + divergence detection
```

---

## Components

### lib/replayEngine.js (NEW — V106)

**ReplayEngine** class — wraps deterministicReducers for audit-log replay:

- `replayAuditLog({ fromIndex, toIndex, expectedStateHash })` — replays ledger events from audit log slice. Returns `{ ok, eventsApplied, finalStateHash, balances, replayProof, verification?, divergence? }`.
- `replayJournalRun(runId)` — replays ExecutionJournal entries for a run. Returns deterministic run summary + `replayProof`.
- `lookupProvenance(traceHash, { depth })` — traverses audit entry by hash, returns ancestor chain and attached `inferenceProvenance`.

### lib/deterministicReducers.js (V105 — unchanged)

Pure reducer functions used by ReplayEngine:
- `ledgerReducer(state, event) → newState`
- `replayEvents(events[], fromState?)` — batch replay
- `verifyReplay(events[], expectedHash)` — replay + hash comparison
- `journalReducer(state, entry) → newState`

### lib/executionJournal.js (V106 extension)

Added `replay(fromIndex)` method: returns deterministic state summary from journal entries slice.

---

## API Endpoints

```
GET  /api/v1/audit/replay
     ?from=0&to=N
     ?expectedHash=<sha256>

GET  /api/v1/audit/replay/:runId

GET  /api/v1/audit/provenance/:traceHash
     ?depth=5
```

### GET /api/v1/audit/replay

Replays the entire audit log (or a slice) through deterministic ledger reducers.

**Response:**
```json
{
  "ok": true,
  "fromIndex": 0,
  "toIndex": 42,
  "auditEntries": 43,
  "eventsApplied": 18,
  "finalStateHash": "<sha256>",
  "eventCount": 18,
  "balances": { "sys::platform": "40000", "client_a": "0" },
  "replayProof": "<sha256>",
  "verification": { "ok": true, "computedHash": "...", "expectedHash": "..." },
  "divergence": null
}
```

### GET /api/v1/audit/replay/:runId

Replays all ExecutionJournal entries for a given run.

**Response:**
```json
{
  "ok": true,
  "runId": "run::abc123",
  "status": "COMPLETED",
  "entriesReplayed": 5,
  "completedSteps": 2,
  "failedSteps": 0,
  "replayProof": "<sha256>",
  "timeline": [{ "id": "je::...", "type": "run_start", "ts": "..." }]
}
```

### GET /api/v1/audit/provenance/:traceHash

Retrieves an audit entry by its SHA-256 hash and its ancestor chain.

**Response:**
```json
{
  "ok": true,
  "target": { "index": 42, "ts": "...", "type": "TASK_AUTO_FLOW", "hash": "..." },
  "inferenceProvenance": { "traceId": "...", "bindingHash": "...", "model": "gpt-4" },
  "ancestorChain": [{ "index": 41, "hash": "..." }],
  "chainDepth": 2
}
```

---

## Replay Integrity Proof

Every replay operation produces a `replayProof`:

```
replayProof = SHA-256("replay|fromIndex|toIndex|finalStateHash|eventsApplied")
```

This proof can be stored (e.g., in `replay_checkpoints` DB table) and verified
later to confirm that the same events always produce the same final state.

---

## Divergence Detection

When `expectedStateHash` is provided:

1. Replay runs normally → `computedHash`
2. `computedHash` compared to `expectedStateHash`
3. If mismatch → `divergence` field is populated with details
4. Warning logged via structured logger

Divergence indicates either:
- Audit log was mutated after the expected hash was recorded
- Events were recorded out of order
- A bug in the reducer mapping

---

## Limitations

| Limitation | Reason | Mitigation |
|---|---|---|
| LLM outputs not replayable | Non-deterministic even at temp=0 | Sealed via inferenceProvenance (V106) |
| In-memory only | Journal and AuditLog are in-memory | DB persistence via audit_log table |
| Audit entry → event mapping gaps | Not all event types are mapped | Unknown types return null (safe skip) |
| Float-safe only for BigInt paths | Ledger uses BigInt; journal uses strings | No mitigation needed: design correct |

---

*ECOS Replay Architecture · V106 · 2026-05-28*
