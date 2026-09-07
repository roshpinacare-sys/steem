# Changelog — V260 (Phase P156) — HITL Persistence via SnapshotEngine

**Release:** ECOS V260 · 2026-06-01 · AI lead

## Direction
V259 closed the operator loop with reject + queue listing, but rejected runs were lost on server restart.
V260 **persists HITL events across restarts** using the `snapshotEngine.setExtra` mechanism
introduced in V258, and adds `/hitl-history` — a unified query endpoint that returns rejected,
paused, and resumed events from any session.

---

### P156-A — `appendHitlEvent260` / `getHitlHistory260` [V260-T01 core]

**File:** `ecos-api-server-v260-patch.js`

New HITL persistence primitives:

- `appendHitlEvent260(snapshotEngine, event)` — appends a typed HITL event
  (`rejected` | `paused` | `resumed`) to `snapshotEngine.setExtra(HITL_HISTORY_KEY_260, [...])`.
  Ring-buffered at `HITL_MAX_HISTORY_260 = 5,000` entries.
  **Graceful degradation:** returns `null` (non-fatal) when `snapshotEngine` is absent.
- `getHitlHistory260(snapshotEngine, opts)` — reads history from `snapshotEngine.getExtra`,
  supports `type` / `runId` / `limit` filters, returns newest-first.
- `HITL_HISTORY_KEY_260 = 'hitl_history260'` — stable key used in snapshotEngine extras.

---

### P156-B — `GET /api/v1/automations/hitl-history` [V260-T01]

New endpoint returning the persisted HITL event log:

- Query params: `type` (filter by event type), `runId` (filter by run), `limit` (default 200, max 1000).
- Returns `{ ok, count, history, persisted, ecosVersion: 'V260' }`.
- `persisted: true` when snapshotEngine is wired; `false` in degraded mode.
- Survives server restart because the underlying storage is snapshotEngine extras (P154-B).

---

### P156-C — `rejectHitlRun260` [V260-T02]

Persistent overload of V259's `rejectHitlRun259`:

- Same contract as V259 but adds `opts.snapshotEngine` parameter.
- Calls `appendHitlEvent260` before the WS push, so the rejection is durable.
- Returns `persisted: true` when snapshotEngine available, `persisted: false` otherwise.
- Endpoint: `POST /api/v1/automations/:runId/reject260` (additive — V259 `/reject` untouched).
- WS push payload now includes `persisted` field.

---

### P156-D — `artifacts/automationDashboard259.jsx` — Dashboard V3

Upgraded from `automationDashboard258.jsx`:

- **`HitlHistoryPanel` component** — new section below HITL Queue showing persisted event history:
  - Type filter buttons (`all` | `rejected` | `paused` | `resumed`).
  - Each event: type pill, runId, optional reason, userId, relative timestamp, ecosVersion badge.
  - Count footer with `V260` label.
  - Refresh button (independent from main fetchAll).
- **`fetchHitlHistory`** — separate fetch callback calling `/api/v1/automations/hitl-history`.
- **`rejectRun`** — upgraded to call `/reject260` (persistent) with fallback to V259 `/reject`.
- Auto-refresh (30s) now refreshes both HITL queue and history.
- Footer updated: `V260 Dashboard V3 · P156 HITL Persistence`.

---

### Tests

`tests/v260.test.js` — 32 tests, all green:

- P156 core: 6 tests for `appendHitlEvent260` (store, accumulate, throws, null-safe, defaults).
- P156 history: 6 tests for `getHitlHistory260` (empty, sort, type filter, runId filter, limit, null se).
- P156 ring buffer: 2 tests (cap at HITL_MAX_HISTORY_260, key naming).
- P156 reject: 7 tests for `rejectHitlRun260` (persisted:true, stores event, persisted:false, throw, WS, non-fatal, mp).
- P156 endpoints: 6 tests (mount, summary, hitl-history ok, type+limit filter, 400, persisted:true).
- P156 artifact: 3 tests (dashboard258 backward compat, dashboard259 exists, HitlHistoryPanel).
- Sacred: 2 MD5 guard tests.

### Regression
- v259.test.js — 22 passed, 0 failed ✓
- v258.test.js — 17 passed, 0 failed ✓
- v257.test.js — 43 passed, 0 failed ✓

### Iron rules
- R1 Sacred: `src/lib/fiatLedger.js` and `src/lib/auditLog.js` untouched (MD5 verified).
- R2 Suffixes: all new V260 identifiers end in `260`.
- R3 No new npm deps.
- R4 No endpoints removed (`/reject` V259 still present; `/reject260` is additive).
- R6 `lib/` mirrors not applicable (patch file only; no new lib).

## Breaking changes
None. Additive only.
