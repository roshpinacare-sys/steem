# Changelog — V259 (Phase P155) — HITL Reject + Dashboard V2

**Release:** ECOS V259 · 2026-06-01 · AI lead

## Direction
V258 delivered live HITL push over WebSocket. V259 **closes the operator loop**:
humans can now **reject** (cancel) paused runs, a dedicated `/hitl-queue` endpoint
surfaces all pending approvals, and `automationDashboard258.jsx` ships a HITL action
panel with both Resume and Reject buttons.

---

### P155-A — `POST /api/v1/automations/:runId/reject` [V259-T01]

**File:** `ecos-api-server-v259-patch.js`

New `rejectHitlRun259(opts)` function and endpoint:

- Validates `runId`; returns `400 MISSING_RUN_ID` if absent.
- Looks up run in `missionPersistence241`; returns `404 RUN_NOT_FOUND` or
  `409 NOT_PAUSED` if run is not in `hitl_paused` state.
- Stores rejection in in-memory `_rejectedRuns259` map (survives within the process).
- Best-effort: appends a `rejected` step via `appendMissionStep241`.
- Best-effort WS push: `notificationWsHub.push(userId, { type: 'hitl_rejected', … })` — non-fatal.
- Returns `{ ok: true, runId, status: 'rejected', rejectedAt, reason, ecosVersion: 'V259' }`.

---

### P155-B — `GET /api/v1/automations/hitl-queue` [V259-T02]

New `listHitlQueue259(missionPersistence)` function and endpoint:

- Calls `listMissions241()` and filters for runs with any step in `hitl_paused` status.
- Excludes runs already in the `_rejectedRuns259` map.
- Returns `{ ok: true, count: N, queue: [...], ecosVersion: 'V259' }`.
- Gracefully returns empty queue if `missionPersistence` unavailable.

---

### P155-C — `artifacts/automationDashboard258.jsx` — Dashboard V2

Upgraded from `automationDashboard257.jsx`:

- **`HitlActionPanel` component** — renders each paused run with:
  - `▶ Resume` button (calls V256 resume endpoint).
  - `✕ Reject` button → expands inline reason input → `Confirm` sends V259 reject.
  - Reject reason field with optional free-text.
  - Optimistic UI: removes rejected run from queue immediately.
- **HITL queue fetched from `/api/v1/automations/hitl-queue`** (V259-T02) instead of
  per-automation run-history polling — more accurate and faster.
- Event log shows `✓`/`✗` prefixed lines for resume and reject actions.

---

### Tests

`tests/v259.test.js` — 22 tests, all green:

- P155 core: 8 tests for `rejectHitlRun259` (happy path, validation, WS push, missionPersistence).
- P155 list: 4 tests for `listHitlQueue259` (empty, paused runs, rejected exclusion, null mp).
- P155 endpoints: 5 tests for HTTP routes (mount, summary, 400, 404, hitl-queue).
- P155 artifact: 3 tests (file exists, HitlActionPanel, hitl-queue call).
- Sacred: 2 MD5 guard tests.

### Regression
- v258.test.js — 17 passed, 0 failed ✓
- v257.test.js — 43 passed, 0 failed ✓
- v255.test.js — 18 passed, 0 failed ✓

### Iron rules
- R1 Sacred: `src/lib/fiatLedger.js` and `src/lib/auditLog.js` untouched (MD5 verified).
- R2 Suffixes: all new V259 identifiers end in `259`.
- R3 No new npm deps.
- R4 No endpoints removed.
- R6 `lib/` mirrors not applicable (patch file only; no new lib).

## Breaking changes
None. Additive only.
