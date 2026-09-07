# ECOS Changelog — V106

**Release Date:** 2026-05-28
**Version:** 106.0.0
**Tag:** P5-DETERMINISM — Close the Gaps

---

## Summary

V106 closes the four architectural gaps identified in the V105 Deterministic
Substrate Analysis. All changes are additive — no Sacred Files were modified.

---

## New Modules

### `lib/embeddingProvider.js` (NEW)

Real embedding provider abstraction replacing `heuristicEmbed()` as the default.

- `EmbeddingProvider` — base class interface
- `HeuristicEmbeddingProvider` — 64-dim SHA-256 fallback (isReal=false)
- `OllamaEmbeddingProvider` — 768-dim Ollama nomic-embed-text (isReal=true)
- `OpenAIEmbeddingProvider` — 1536-dim text-embedding-3-small (isReal=true)
- `EmbeddingProviderWithCache` — LRU cache wrapper (default 2000 entries)
- `FallbackEmbeddingProvider` — tries chain, warns + falls back to heuristic
- `buildDefaultProvider(opts)` — factory, resolves from environment
- `defaultEmbeddingProvider` — singleton for server-wide use

**Environment config:** `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `LOCAL_LLM_URL`, `OPENAI_API_KEY`

### `lib/replayEngine.js` (NEW)

Deterministic replay verification and provenance traversal.

- `ReplayEngine` class:
  - `replayAuditLog({ fromIndex, toIndex, expectedStateHash })` — ledger replay from audit log
  - `replayJournalRun(runId)` — execution journal replay for a specific run
  - `lookupProvenance(traceHash, { depth })` — audit entry + ancestor chain + inferenceProvenance
- `auditEntryToLedgerEvent(entry)` — maps audit entries to ledger reducer events
- Produces `replayProof` (SHA-256) for every replay operation
- Detects divergence when `expectedStateHash` is supplied

### `lib/snapshotEngine.js` (NEW)

Runtime snapshot export/import for disaster recovery and cold-start.

- `SnapshotEngine` class:
  - `export({ label, extraMeta })` — serializes accounts, audit tail, approvals
  - `verify(snapshot)` — integrity hash verification without applying
  - `restore(snapshot, { dryRun })` — verify + apply with hash pre-check
  - `saveToFile(snapshot, filename)` — persist to disk
  - `loadFromFile(filePath)` — load + verify from disk
  - `listSnapshots()` — list all snapshots in snapshotDir (newest first)
- `SNAPSHOT_VERSION = 1`
- Integrity hash: SHA-256 over canonical JSON body

---

## New API Endpoints

### Replay

```
GET /api/v1/audit/replay
    ?from=0&to=N&expectedHash=<sha256>
    → deterministic ledger state reconstruction from audit log

GET /api/v1/audit/replay/:runId
    → execution journal replay for a specific run ID

GET /api/v1/audit/provenance/:traceHash
    ?depth=5
    → audit entry + inferenceProvenance + ancestor chain
```

### Snapshot

```
GET  /api/v1/snapshot
     → export current runtime state as verified snapshot

POST /api/v1/snapshot/restore
     body: { snapshot, dryRun? }
     → verify + apply snapshot (requires ADMIN auth or DEV mode)

GET  /api/v1/snapshot/verify
     body: { snapshot }
     → verify integrity hash without applying
```

### DAG

```
GET /api/v1/audit/dag
    ?limit=50
    → causal DAG of recent audit entries with provenance edges
```

---

## Database Migration

### `db/migration_phase5.sql` (NEW)

- pgvector extension (if available) + `knowledge_patches.embedding_v2` column
- `embedding_type` column on `knowledge_patches` (heuristic|ollama|openai|...)
- `snapshots` table — persistent snapshot storage with integrity hash
- `replay_checkpoints` table — labeled replay verification records
- Partial index on `audit_log` for `inferenceProvenance` field
- `embedding_migration_log` table — re-embedding migration tracking
- `ecos_reembed_patches()` helper function

---

## Tests

- `tests/embeddingProvider.test.js` — 18 new tests
- `tests/snapshotEngine.test.js` — 14 new tests
- `tests/replayEngine.test.js` — 20 new tests

Total new tests: 52 (added to V105 baseline of 402+ → ~454+ total)

---

## Wire-up in ecos-api-server.js

- `defaultEmbeddingProvider` injected into `defaultMemory.setEmbedFn()`
- `ReplayEngine` instantiated and wired to `auditLog` + `defaultJournal`
- `SnapshotEngine` instantiated and wired to `ledger` + `auditLog` + `hitlGate`
- `inferenceProvenance` sealed and attached on every `infer()` call in live pipeline
- All new routes registered under `/api/v1/`

---

## Breaking Changes

None. All changes are additive. Sacred Files unchanged:
- `lib/fiatLedger.js` — NOT modified ✅
- `lib/auditLog.js` — NOT modified ✅

---

## Fixed Warnings

- `[MemorySubstrate] WARNING: heuristicEmbed active` — now logged when no real provider
- `[EmbeddingProvider] Provider resolved` — logs which provider is active at startup

---

## Removed / Deprecated

- `heuristicEmbed` is no longer the silent default. It is now an explicit fallback
  with a structured warning. The function itself is exported from `embeddingProvider.js`
  for backward compatibility and tests.

---

## Version Bump

`package.json` version: `105.0.0` → `106.0.0`
