# CHANGELOG_V182.md — ECOS V182 (Phase P71)

## Version: 182.0.0
## Phase: P71
## Date: 2026-05-30

---

## Summary

V182 completes Phase P71: optional event-log persistence to disk
(`ECOS_EVENT_LOG_PATH`), atomic token rotation (`PUT /workspaces/:id/token`)
with masked return values, configurable TTL pruning of the ring-buffer
(`V182_LOG_TTL_MS`, `pruneOlderThan`, periodic sweep every 5 min), and an
admin summary endpoint `/api/v1/admin/summary/v182`.

---

## New Features

### V182-T01 — Event Log Persistence
- **No new HTTP endpoint** — internal enhancement to `_eventLog181` ring-buffer.
- When `ECOS_EVENT_LOG_PATH` env var is set, the ring-buffer Map is persisted
  to a JSON file on disk.
- **Load on startup** (synchronous, before server accepts requests): populates
  `_eventLog181` from the file so the ring-buffer is warm on restart.
- **Flush on every broadcast** (async, non-blocking via `fs.writeFile`):
  errors are silently swallowed (graceful fallback to in-memory only).
- When env var is NOT set: pure in-memory behaviour (no disk I/O, backwards-compatible).
- **New lib:** `lib/workspaceEventPersistenceService182.js`
  - `EventPersistenceService182` — wraps the eventLog Map with load/flush logic.
  - `loadSync()` — synchronous startup load.
  - `flush()` — async non-blocking disk write.
  - `stats()` — returns `{ enabled, logPath }` for admin summary.
  - `shutdown()` — test teardown.
- **Broadcast wrapper:** `_wrappedBroadcast182` chains onto `_wrappedBroadcast181`
  (the already-wrapped function) — does NOT re-wrap the original (R5-safe).

### V182-T02 — Token Rotation
- **Endpoint:** `PUT /api/v1/workspaces/:workspaceId/token`
- Atomically replaces the broadcast auth token for a workspace.
- Returns `{ ok, workspaceId, old: <masked>, new: <masked>, rotatedAt, ecosVersion }`.
- **Masking** (`_maskToken182`):
  - Tokens ≤ 4 chars: `***`
  - Tokens 5–8 chars: first `floor(len/2)` + `***` + remaining
  - Tokens > 8 chars: first 4 + `***` + last 4
- `old` is `null` when no previous token existed.
- Validates new token via `_tokenSvc181.setToken` (throws `TokenValidationError181`
  HTTP 400 on invalid input; old token is preserved on error).

### V182-T03 — Event Log TTL Pruning
- **No new HTTP endpoint** — internal enhancement.
- `V182_LOG_TTL_MS` constant (default 24 h = `86_400_000` ms).
- `V182_PRUNE_INTERVAL` constant (default 5 min = `300_000` ms).
- `_pruneOlderThan182(workspaceId, cutoffMs)` — removes events whose `sentAt`
  timestamp is older than `cutoffMs` from the workspace ring-buffer.
- `_ttlSweep182()` — sweeps all workspaces; also removes workspaces whose
  ring-buffer becomes empty after pruning (memory hygiene).
- `_ttlSweepTimer182 = setInterval(_ttlSweep182, V182_PRUNE_INTERVAL)` — periodic
  sweep; timer is `unref()`d so it will not prevent clean process exit.
- Hard cap `V181_RING_MAX = 500` is unchanged (R5-safe).

### V182-T04 — Admin Summary V182
- **Endpoint:** `GET /api/v1/admin/summary/v182`
- Returns version, phase, feature list, config (logTtlMs, pruneIntervalMs),
  broadcast stats, token stats, persistence stats, and event log totals.

---

## Constants Added
| Constant | Value | Notes |
|---|---|---|
| `V182_LOG_TTL_MS` | `86_400_000` (24 h) | Default TTL for ring-buffer events |
| `V182_PRUNE_INTERVAL` | `300_000` (5 min) | setInterval sweep period |

---

## Test Suite
- `tests/v182.test.js` — 46 tests, all pass.
- Covers: EventPersistenceService182 unit tests (10), async flush (1),
  token masking (4), TTL pruning logic (6), token rotation (3),
  server wiring source checks (9), NODE_ENV=test export presence (5),
  source integrity (8).
- Pattern follows v178/v179/v180/v181: reads server source as text (no server
  `require`) to avoid optional DB/rail module dependencies.

---

## Invariants Verified
- R1: `lib/fiatLedger.js` MD5 = `563e9b1f9e67091a5b6527c0a92568e5` ✓
- R1: `lib/auditLog.js`   MD5 = `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓
- R4: No endpoints removed ✓
- R5: v178/v179/v180/v181 suites still green ✓
- R6: Zero new npm dependencies ✓
- R8: All new identifiers suffixed `_182` / `182`; exported under `NODE_ENV=test` ✓

---

## Files Changed
| File | Change |
|---|---|
| `ecos-api-server.js` | Appended V182 block (~140 lines) |
| `lib/workspaceEventPersistenceService182.js` | New — event log persistence service |
| `package.json` | version `182.0.0`, updated description |
| `tests/v182.test.js` | New — 46 tests |
| `CHANGELOG_V182.md` | New |
| `NEXT_SESSION_PROMPT_V182.md` | New |
| `CLAUDE.md` | Updated version/phase/state |
