# ECOS AI Protocol — V307

**Version:** 307
**Date:** 2026-06-02
**Phase:** P195
**Status:** Canonical

---

## 1. Overview

V307 follows the four directions called out in `NEXT_SESSION_PROMPT_V306.md`,
each purely additive on top of the V306 observability layer. Nothing existing
changes; every new symbol ends in `307`.

1. **PersistentPruneHistory307** — extends `PruneHistoryScheduler306` with DB-backed
   persist/restore of the prune history ring.
   `flushHistory307(pool)` writes the in-memory ring to `ecos_prune_history`.
   `loadHistory307(pool)` reads rows back and restores the ring.

2. **VersionedAlertBridge307** — extends `PersistentAlertBridge306` with a
   `config_version` counter (incremented on each `persistConfig307` call) and
   an `updated_by` TEXT column for attribution.
   `getConfigVersion307()` returns version, updatedBy, and a bounded history ring.

3. **DiffSnapshotBuffer307** — extends `VersionedSnapshotBuffer306` with
   `diffSnapshots307(indexA, indexB)` that compares two snapshot history entries
   and returns added/removed/changed session tokens.

4. **RollingHistogramTracker307** — extends `ResettableHistogramTracker306`:
   overrides `query304` to timestamp each observation, then
   `rollingHistogram307(source, windowMs)` builds a histogram from only the
   observations within the last `windowMs` milliseconds.

---

## 2. HTTP endpoints

| Method | Path                                                                                  | Description                                          |
|--------|---------------------------------------------------------------------------------------|------------------------------------------------------|
| GET    | `/api/v1/market/treasury/hitl/webhook/deliveries/prune/history/v307/db`              | In-memory prune history ring + DB flush/load stats   |
| GET    | `/api/v1/market/alerts/suppress/config/v307/version`                                 | Config version, updatedBy, version history           |
| POST   | `/api/v1/market/alerts/suppress/config/v307/version`                                 | Persist with version bump; body `{ overrides?, updatedBy? }` |
| POST   | `/api/v1/market/backtest/sessions/v307/snapshot/diff`                                | Diff two snapshots; body `{ indexA, indexB }`        |
| GET    | `/api/v1/contracts/receipts/v307/histogram/rolling`                                  | Rolling histogram; query `?source=&windowMs=`        |
| GET    | `/api/v1/admin/summary/v307`                                                          | All V307 surfaces                                    |

All V287..V306 routes are preserved unchanged.

---

## 3. Iron-rule compliance

- **R1 — Sacred files untouched.** `lib/fiatLedger.js`
  `563e9b1f9e67091a5b6527c0a92568e5` / `lib/auditLog.js`
  `e5a5c2c27801d2d03991bc8e5a1df8cb` md5 unchanged.
- **R2 — Version-suffixed identifiers.** All new symbols end in `307`.
- **R3 — No new npm deps.** `crypto` builtin only.
- **R4 — Test env guard.** `tests/v307.test.js` runs only under `NODE_ENV === 'test'`.
- **R5 — `package.json` bumped** to `307.0.0`; `test:v307` script added.
- **R6 — No endpoints removed.** All V287..V306 routes preserved.
- **R7 — No duplicate stores.** Extends V306 classes without adding new global stores.

---

## 4. Tests

`tests/v307.test.js` — 36/36 passing under `NODE_ENV=test`
(persist prune history ×8, suppress config versioning ×8, snapshot diff ×6,
rolling histogram ×10, exports ×3).
