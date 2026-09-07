# Changelog — V206 (Phase P95)

## Version: 206.0.0 | Phase: P95 | Date: 2026-05-31

### New Endpoints

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V206-T01 | GET | `/api/v1/workspaces/:workspaceId/events/digest/type-gap` | Avg/min/max gap (ms) between consecutive events of a specific `?type=`; null fields when < 2 events of that type |
| V206-T02 | GET | `/api/v1/workspaces/:workspaceId/events/digest/hour-heatmap` | Full 24×7 heatmap matrix: `matrix[weekday 0=Sun][hour 0–23]` = count (UTC); includes `maxCell`, `maxWeekday`, `maxHour` |
| V206-T03 | GET | `/api/v1/admin/summary/v206` | V206 admin summary |

### Implementation Notes
- No new stores — reuses `_eventLog181` exclusively (per chain notes).
- All identifiers suffixed `206` to prevent BUG-L duplicate-const errors.
- `type-gap`: filters ring by `ev.type === queryParam`, collects valid sentAt timestamps, sorts ascending, computes consecutive diffs; returns null when < 2 matches.
- `hour-heatmap`: builds `matrix[7][24]`, bins each event by `getUTCDay()` and `getUTCHours()`; locates `maxCell` by full scan.
- Both endpoints return 400 if `workspaceId` missing; type-gap additionally 400 if `?type=` missing.

### Tests
- `tests/v206.test.js` — 38 tests ✓ (10 source guards, 12 type-gap units, 12 heatmap units, 4 doc guards)

### Constants Exported (NODE_ENV=test)
- `V206_DEFAULT_LIMIT = 10`
- `V206_MAX_LIMIT = 100`

### Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNCHANGED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNCHANGED
