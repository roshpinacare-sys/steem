# CHANGELOG V258 — Phase P154

## Version 258.0.0 — 2026-06-01

### Overview
Phase P154 closes the loop on the V257 scheduler: wires it into the server,
gives snapshotEngine real setExtra/getExtra persistence, and pushes live HITL
events over WebSocket so the automationDashboard257.jsx receives instant updates.

---

### P154-A — Wire `_wireAutomationScheduler257()` IIFE (`ecos-api-server.js`)

**File:** `ecos-api-server.js` (appended; sacred files untouched)

A new `(function _wireAutomationScheduler257() { … })()` IIFE is appended at
the end of `ecos-api-server.js`. It:

- Requires `ecos-api-server-v257-patch.js` and calls `registerV257Endpoints()`
  with the real `snapshotEngine` from `_v106` (graceful `null` if V106 not
  initialized).
- Passes `catalog255` and `toolCatalog237` instances (re-created by the same
  pattern as the V255 IIFE, so V258 stays self-contained).
- Reads `ECOS_SCHEDULER_AUTOSTART=true` env var: if set, instantiates
  `createAutomationScheduler257` and calls `start257()` immediately, so the
  scheduler is live on cold-start with no manual API call required.
- All failures are non-fatal (`try/catch` + `logger.warn`), so a missing patch
  file or unavailable catalog never crashes the server.

**New env var:** `ECOS_SCHEDULER_AUTOSTART=true`

---

### P154-B — Extend `SnapshotEngine` with `setExtra` / `getExtra`

**Files:** `src/lib/snapshotEngine.js`, `lib/snapshotEngine.js` (mirror)

Added to the `SnapshotEngine` class:

```js
engine.setExtra(key, value)   // store arbitrary JSON-serialisable value
engine.getExtra(key)          // retrieve it; returns null if never set
```

- Internal `this._extras = Object.create(null)` map initialised in constructor.
- `export()` now includes `extras` in the snapshot body (before the integrity
  hash is computed), so the data survives a `exportToDB` + `loadFromDB` cycle.
- `restore(snap)` copies `snap.extras` back into `this._extras` on successful
  restore.
- Used by `automationScheduler257` (key `scheduler257_config`) to persist
  scheduled-automation configurations across server reboots.
- Both `src/lib/` and `lib/` mirrors updated.

---

### P154-C — HITL WebSocket push via `notificationWsHub`

**Files:** `src/lib/automationRunner255.js`, `lib/automationRunner255.js` (mirror)

`runAutomation255(opts)` now accepts an optional `opts.notificationWsHub`
parameter. When a step reaches `hitl_paused` status:

```js
notificationWsHub.push(userId, {
  id:           'hitl_<runId>_step<N>',
  type:         'hitl_paused',
  runId,
  automationId,
  pausedAtStep: N,
  toolName:     '...',
  reasons:      [...],
  ts:           '<ISO>',
});
```

- `userId` is taken from `ctx.userId`; falls back to `'__system__'` if absent.
- The push is wrapped in `try/catch` — a WS failure is always non-fatal and
  never alters the `hitl_paused` return value.
- Fully backward-compatible: omitting `notificationWsHub` behaves identically
  to V255/256/257.

---

### Tests

`tests/v258.test.js` — 17 tests, all green:

- P154-B: 8 tests covering `setExtra`/`getExtra` contract, `export()` body
  inclusion, and `lib/` mirror.
- P154-C: 5 tests covering WS push payload, `__system__` fallback, non-fatal
  error path, no-hub backward compat, and `lib/` mirror.
- P154-A: 2 tests verifying IIFE presence + `node --check` syntax.
- Sacred: 2 MD5 guard tests (fiatLedger + auditLog).

### Regression
- v257.test.js — 43 passed, 0 failed ✓
- v255.test.js — 18 passed, 0 failed ✓
- v254.test.js — 19 passed, 0 failed ✓

### Iron rules
- R1 Sacred: `src/lib/fiatLedger.js` and `src/lib/auditLog.js` untouched
  (MD5 verified in CI).
- R2 Suffixes: all new V258 identifiers end in `258`.
- R3 No new npm deps.
- R4 No endpoints removed.
- R6 `lib/` mirrors synced manually.
