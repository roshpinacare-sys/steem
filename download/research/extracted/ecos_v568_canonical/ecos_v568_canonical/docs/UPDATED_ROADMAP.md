# ECOS Updated Roadmap — Post V106

**Updated:** 2026-05-28

---

## V106 Status: ✅ COMPLETE

All P5-DETERMINISM milestones delivered:

| Milestone | Status |
|---|---|
| P5-01: Real Embedding Provider | ✅ Done |
| P5-02: Wire Inference Provenance | ✅ Done |
| GAP-2: Replay Verification API | ✅ Done |
| GAP-3: Snapshot Export/Restore API | ✅ Done |
| DB Migration Phase 5 | ✅ Done |
| Test Coverage (+52 tests) | ✅ Done |
| 9 Required Docs | ✅ Done |

---

## V107 Milestones — P5-SCALE

### P5-03: Agent Communication Protocol
**Priority:** High  
**Complexity:** Medium

Inter-agent pub/sub message bus. Currently agents communicate only via shared
memory substrate and ledger. V107 adds:
- `AgentBus` class with `publish(topic, message)` / `subscribe(topic, cb)`
- In-memory EventEmitter bus (MVP) → Redis pub/sub (scale)
- Message schema: `{ from, to?, topic, payload, traceId, ts }`
- Persisted to `agent_messages` DB table
- API: `GET /api/v1/agents/:id/inbox` — pending messages

### P5-04: DB-Backed Snapshot Persistence
**Priority:** Medium  
**Complexity:** Low

Persist snapshots to `snapshots` DB table (schema exists in migration_phase5.sql).
- `SnapshotEngine.exportToDB(label)` — save to DB after export
- `SnapshotEngine.loadFromDB(snapshotId)` — load from DB
- `GET /api/v1/snapshot/list` — list from DB, not file system

### P5-05: Streaming Replay for Large Audit Logs
**Priority:** Medium  
**Complexity:** Medium

Current in-memory replay fails for audit logs >100K entries.
- Cursor-based pagination: `replayAuditLog({ page, pageSize })`
- Server-Sent Events: `GET /api/v1/audit/replay/stream`
- Checkpoint table usage: resume replay from saved checkpoint

### P5-06: Re-embedding Script
**Priority:** Medium  
**Complexity:** Low

`scripts/reembed-patches.js` to re-embed knowledge_patches from heuristic to real:
```bash
node scripts/reembed-patches.js --provider openai --batch 50 --dry-run
```
- Reads patches where `embedding_type = 'heuristic'`
- Calls embedding provider in batches
- Updates `embedding_v2` + `embedding_type`
- Logs to `embedding_migration_log`

---

## V108 Milestones — P6-ISOLATION

### P6-01: WASM Tool Isolation
**Priority:** High  
**Complexity:** High

Run untrusted agent tools inside WASM sandbox:
- Wasmtime or WasmEdge runtime
- Tool manifest: `{ id, wasmPath, maxMemMB, timeoutMs }`
- Capability-gated I/O (no ambient filesystem access)

### P6-02: Formal Determinism Proof
**Priority:** Medium  
**Complexity:** High

Formal verification that `deterministicReducers.js` satisfies:
- Associativity of event application
- Commutativity where order doesn't matter (credit/credit)
- Non-commutativity where it does (debit before credit)

### P6-03: Multi-tenant Ledger Partitioning
**Priority:** High  
**Complexity:** High

Partition accounts by tenantId to support multiple independent ECOS deployments
on a single instance.

---

## Invariants — NEVER Violate

1. Sacred Files (`fiatLedger.js`, `auditLog.js`) are NEVER modified
2. BigInt for all monetary values — no float
3. Audit chain is append-only — no delete, no backfill
4. Provenance is additive metadata — never replaces underlying data
5. Self-hostable — no hard external service dependencies

---

*ECOS Updated Roadmap · Post-V106 · 2026-05-28*
