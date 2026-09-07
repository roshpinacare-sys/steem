# ECOS V108 Changelog
## P6 — Production Hardening: AgentBus × AgentRuntime + Persistent Bus + Health Enhancement + Validator×Bus

_Released: 2026-05-28_

> See `docs/CHANGELOG_V108.md` (canonical) for full release notes.
> This file is the V108 quick-reference summary.

---

---

## Summary

V108 completes the **P6 Production Hardening** phase. The inter-agent communication
layer (introduced in V107 as in-memory only) is now deeply integrated with the
execution runtime and can persist messages across server restarts. The health
endpoint now exposes full V106/V107 subsystem telemetry, and every validator
approval resolution is broadcast on the `audit` channel for pipeline automation.

---

## P6-01 — AgentBus × AgentRuntime Integration

**File:** `lib/agentRuntime.js`

`AgentRuntime` now accepts an `AgentBus` via `setBus(bus)` (or constructor option
`opts.bus`). When a bus is wired:

- **Before each DAG step executes**, the runtime publishes a `context` message
  to the bus with the step's ID, input, and dependency list. This lets subscriber
  agents observe the execution intent before the step runs.

- **After a step completes successfully**, the runtime publishes a `result`
  message (with `parentId` linking back to the context message for causality).

- **After a step fails**, the runtime publishes an `error` message (same
  parentId linkage).

- `invoke()` follows the same pattern for single-step executions.

All bus calls are wrapped in `try/catch` — a bus failure never aborts a DAG run.
Delivery is non-blocking (handlers called via `setImmediate`).

```js
const runtime = new AgentRuntime({ bus: myBus });
// — or —
runtime.setBus(myBus);
```

---

## P6-03 — Persistent AgentBus (Cross-Restart Replay)

**Files:** `lib/agentBus.js`, `db/migration_phase6.sql`

`AgentBus` now supports optional DB-backed persistence via two new methods:

### `async bus.persistToDB(pool, opts)`

Flushes the in-memory ring buffers to `agent_bus_messages`. Idempotent —
duplicate `message_id` rows are skipped (`ON CONFLICT DO NOTHING`).

```js
const persisted = await bus.persistToDB(pool, { channel: 'audit' });
// → { persisted: 12, skipped: 0, errors: 0 }
```

Options:
- `channel` — persist a single channel (default: all channels)
- `limit` — max messages to persist (default: all)
- `since` — ISO timestamp: only persist messages newer than this

### `async bus.loadFromDB(pool, opts)`

Replays messages from DB into the ring buffer. Safe to call on cold start.

```js
await bus.loadFromDB(pool, { channel: 'audit', limit: 200 });
```

### `async bus.persistDeadLettersToDB(pool, opts)`

Flushes dead-letter queue to `agent_bus_dead_letters` table.

### Handler delivery is non-blocking

All subscriber handlers are now called via `setImmediate`, preventing a slow
handler from blocking the HTTP response thread. This is a **breaking change**
from V107's synchronous delivery — handlers are still called in the same
process tick but after the current call stack unwinds.

---

## P5-04 — DB-Backed Snapshot Persistence

**File:** `lib/snapshotEngine.js`

`SnapshotEngine` now has two new DB methods that round-trip snapshots via the
`snapshots` table (created in V106 migration_phase5.sql):

### `async engine.exportToDB(pool, opts)`

Exports the current runtime state and writes it to the `snapshots` table.
Returns the full snapshot object with the DB row's `id`.

```js
const snap = await engine.exportToDB(pool, { label: 'pre-deploy', savedBy: 'ci' });
```

### `async engine.loadFromDB(pool, opts)`

Loads the most recent (or a labelled) snapshot from `snapshots` and restores it.

```js
const result = await engine.loadFromDB(pool, { label: 'pre-deploy', dryRun: true });
```

Options:
- `label` — filter by snapshot label (default: latest)
- `id` — load a specific snapshot by `id`
- `dryRun` — verify only, do not apply state (default: false)

### New API endpoints (V108)

```
POST /api/v1/snapshot/db/save         — exportToDB() → 201
GET  /api/v1/snapshot/db/list         — list snapshots from DB → 200
POST /api/v1/snapshot/db/restore      — loadFromDB() with optional dryRun → 200
```

---

## P6-04 — Production Health Endpoint Enhancement

**File:** `ecos-api-server.js` (health detailed endpoint)

`GET /api/v1/health/detailed` now includes V106/V107 subsystem checks:

| Subsystem | Check |
|-----------|-------|
| `embeddingProvider` | `providerId`, `isReal`, whether real embeddings are active |
| `agentBus` | `published`, `delivered`, `deadLettered` counters + active channels |
| `inferenceSealedLast24h` | Count of `INFERENCE_SEALED` audit entries in the past 24 hours |
| `replayEngine` | Journal run/entry counts |
| `snapshotEngine` | File-backed snapshot count |

The `version` field is updated to `V108` and the overall status algorithm now
degrades to `degraded` (not `unhealthy`) when embedding is in heuristic mode.

---

## P6-05 — Validator × AgentBus Integration

**File:** `ecos-api-server.js` (approval resolve endpoint)

After a validator resolves an approval via `POST /api/v1/approvals/:id/resolve`,
the runtime now publishes an `audit` channel event on the AgentBus:

```json
{
  "channel": "audit",
  "from": "validator::<validatorAccountId>",
  "payload": {
    "approvalId": "...",
    "decision": "approve|reject",
    "missionId": "...",
    "receiptId": "...",
    "resolvedAt": "2026-05-28T..."
  }
}
```

Orchestrator agents subscribed to `audit` can react immediately — triggering
next pipeline steps, surfacing results to clients, or escalating rejects.

---

## P6-02 — OpenAPI Spec Update

**File:** `docs/openapi.json`

Added V107 + V108 endpoints to the spec:
- `POST /api/v1/memory/reembed`
- `GET  /api/v1/agent/bus/status`
- `POST /api/v1/agent/bus/send`
- `GET  /api/v1/agent/bus/replay`
- `GET  /api/v1/agent/bus/chain/{messageId}`
- `POST /api/v1/snapshot/db/save`
- `GET  /api/v1/snapshot/db/list`
- `POST /api/v1/snapshot/db/restore`

Also documented the `INFERENCE_SEALED` audit entry type and the
`inferenceProvenance` object schema.

---

## DB Migration

Run `migration_phase6.sql` after `migration_phase5.sql`:

```bash
psql $DATABASE_URL < db/migration_phase6.sql
```

New tables:
- `agent_bus_messages`
- `agent_bus_dead_letters`
- `health_check_log`

New columns on existing tables:
- `snapshots.source_version`
- `snapshots.saved_by`

New helper functions:
- `ecos_prune_bus_messages(p_retain_days)` — retention cleanup
- `ecos_drain_bus_dead_letters(p_retain_days)` — dead-letter cleanup

---

## Tests

New test files:
- `tests/agentBusIntegration.test.js` — 25+ tests for P6-01 bus wiring in runtime
- `tests/snapshotEngineDB.test.js` — 15+ tests for P5-04 DB persistence methods

---

## Breaking Changes

1. **AgentBus handler delivery is now asynchronous** (via `setImmediate`).
   Handlers will fire after the current call stack unwinds. If you relied on
   synchronous delivery for ordering guarantees in tests, wrap assertions in
   `await new Promise(setImmediate)`.

2. **Health detailed response** now includes additional fields (`agentBus`,
   `embeddingProvider`, `inferenceSealedLast24h`, `replayEngine`,
   `snapshotEngine`). Clients parsing the response must tolerate extra keys.

---

## Sacred Files (unchanged)

```
lib/fiatLedger.js   MD5: 563e9b1f9e67091a5b6527c0a92568e5  ✅ unchanged
lib/auditLog.js     MD5: e5a5c2c27801d2d03991bc8e5a1df8cb  ✅ unchanged
```
