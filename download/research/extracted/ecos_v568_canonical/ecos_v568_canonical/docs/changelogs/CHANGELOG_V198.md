# CHANGELOG — V198 (Phase P87)

## Version: 198.0.0 | Date: 2026-05-31

## Summary
V198 adds two digest analysis endpoints (sender-timeline + burst detection) using the existing `_eventLog181` store — no new stores introduced.

## New Endpoints (3) — V198-T01 … V198-T03

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V198-T01 | GET | `/api/v1/workspaces/:id/events/digest/sender-timeline/:senderId` | Event counts bucketed by hour or day for a specific sender. Query: `?granularity=hour\|day` (default hour) |
| V198-T02 | GET | `/api/v1/workspaces/:id/events/digest/bursts` | Find time windows with ≥ threshold events. Query: `?windowSec=N` (default 60, 1–3600), `?threshold=K` (default 2) |
| V198-T03 | GET | `/api/v1/admin/summary/v198` | Admin summary |

## Implementation Notes
- **sender-timeline**: filters `_eventLog181` ring-buffer to given senderId; buckets by ISO hour (`YYYY-MM-DDTHH`) or day (`YYYY-MM-DD`); sorted chronologically; capped at 500 buckets.
- **burst detection**: sorts valid events by sentAt; sliding-window O(n²) scan; each event i is the start of a candidate window [ts_i, ts_i + windowMs); if count ≥ threshold → burst record with topType (highest count, lex tie-break); deduplicated by windowStart; sorted by count desc; capped at 100.
- Both endpoints reuse `_eventLog181` — zero new stores.

## Tests
- `tests/v198.test.js` — 36 tests ✓ PASS
- `tests/v197.test.js` — 54 tests ✓ PASS (regression)

## Cumulative Metrics

| Metric | V197 | V198 |
|--------|------|------|
| Server lines | 18,058 | 18,247 |
| Endpoints added this version | 3 | 3 |

## Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNTOUCHED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNTOUCHED

## Protocol Compliance
- ✓ R1 — Sacred files untouched
- ✓ R4 — No endpoints removed
- ✓ R5 — All prior suites pass
- ✓ R6 — Zero new npm dependencies
- ✓ R8 — NODE_ENV=test export block; 198-suffixed identifiers
