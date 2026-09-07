# Changelog — V205 (Phase P94)

## Version: 205.0.0

### New Endpoints

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V205-T01 | GET | `/api/v1/workspaces/:id/events/digest/peak-hour` | Hour-of-day (0–23 UTC) with most events; returns `peakHour`, `count`, `pct`, full `hourBreakdown[24]` |
| V205-T02 | GET | `/api/v1/workspaces/:id/events/digest/event-gap` | Avg/min/max gap between consecutive events (ms); returns `null` fields when < 2 valid events |
| V205-T03 | GET | `/api/v1/admin/summary/v205` | V205 admin summary |

### Implementation Notes
- No new stores — reuses `_eventLog181` exclusively (per chain notes).
- All identifiers suffixed `205` to prevent BUG-L duplicate-const errors.
- `peak-hour`: iterates ring, bins by `getUTCHours()`, skips missing/invalid `sentAt`.
- `event-gap`: collects valid timestamps, sorts ascending, computes consecutive diffs; `gapCount = eventCount - 1`.
- `avgGapMs` rounded via `Math.round`; `pct` rounded to 2 decimal places.

### Tests
- `tests/v205.test.js` — 32 tests ✓ (10 source guards, 10 peak-hour units, 9 event-gap units, 3 doc guards)

### Constants Exported (NODE_ENV=test)
- `V205_DEFAULT_LIMIT = 10`
- `V205_MAX_LIMIT = 100`

### Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNCHANGED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNCHANGED
