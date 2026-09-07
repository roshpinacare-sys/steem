# CHANGELOG — V201 (Phase P90)

## Version: 201.0.0 | Date: 2026-05-31

## Summary
V201 adds two digest analysis endpoints (co-active sender pairs + hourly heatmap) using the existing `_eventLog181` store — no new stores introduced.

## New Endpoints (3) — V201-T01 … V201-T03

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V201-T01 | GET | `/api/v1/workspaces/:id/events/digest/co-active` | Find sender pairs whose events overlap within `?windowSec=N` (default 60, max 3600). Returns `[{senderA, senderB, overlapCount}]` desc |
| V201-T02 | GET | `/api/v1/workspaces/:id/events/digest/heatmap` | Count events per UTC hour-of-day (0–23). Always returns 24 entries `[{hour, count}]` |
| V201-T03 | GET | `/api/v1/admin/summary/v201` | Admin summary |

## Implementation Notes
- **co-active**: sorts events by `sentAt`, O(n²) sweep within the window; canonical pair key (senderA < senderB alphabetically); capped at 200 pairs.
- **heatmap**: groups all events by `d.getUTCHours()`; always emits 24 buckets (zero-filled); events missing/invalid `sentAt` are skipped.
- Both endpoints reuse `_eventLog181` — zero new stores.

## Tests
- `tests/v201.test.js` — 36 tests ✓ PASS

## Cumulative Metrics

| Metric | V200 | V201 |
|--------|------|------|
| Server lines | 18,544 | 18,696 |
| Endpoints added this version | 3 | 3 |

## Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNTOUCHED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNTOUCHED

## Protocol Compliance
- ✓ R1 — Sacred files untouched
- ✓ R4 — No endpoints removed
- ✓ R5 — All prior logic tests pass
- ✓ R6 — Zero new npm dependencies
- ✓ R8 — NODE_ENV=test export block; 201-suffixed identifiers
