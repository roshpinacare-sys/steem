# CHANGELOG — V199 (Phase P88)

## Version: 199.0.0 | Date: 2026-05-31

## Summary
V199 adds two digest analysis endpoints (gap detection + event velocity) using the existing `_eventLog181` store — no new stores introduced.

## New Endpoints (3) — V199-T01 … V199-T03

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V199-T01 | GET | `/api/v1/workspaces/:id/events/digest/gaps` | Find intervals between consecutive events where gap ≥ minGapSec. Query: `?minGapSec=N` (default 60, min 1). Returns list of `{gapStart, gapEnd, gapSec}` sorted by gapSec desc |
| V199-T02 | GET | `/api/v1/workspaces/:id/events/digest/velocity` | Events-per-time-unit across all senders workspace-wide. Query: `?granularity=hour|day` (default hour). Returns `{bucket, count}` sorted chronologically |
| V199-T03 | GET | `/api/v1/admin/summary/v199` | Admin summary |

## Implementation Notes
- **gap detection**: sorts valid events by sentAt; scans consecutive pairs; gap = nextTs - curTs; includes pairs where gapMs ≥ minGapMs; sorts result by gapSec desc; capped at 200.
- **event velocity**: buckets ALL events (all senders) by hour (`YYYY-MM-DDTHH`) or day (`YYYY-MM-DD`); sorted chronologically; capped at 500 buckets.
- Both endpoints reuse `_eventLog181` — zero new stores.

## Tests
- `tests/v199.test.js` — 36 tests ✓ PASS
- `tests/v198.test.js` — 35/36 pass (SRC-14 version check expected; all logic tests pass)

## Cumulative Metrics

| Metric | V198 | V199 |
|--------|------|------|
| Server lines | 18,247 | 18,397 |
| Endpoints added this version | 3 | 3 |

## Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNTOUCHED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNTOUCHED

## Protocol Compliance
- ✓ R1 — Sacred files untouched
- ✓ R4 — No endpoints removed
- ✓ R5 — All prior logic tests pass
- ✓ R6 — Zero new npm dependencies
- ✓ R8 — NODE_ENV=test export block; 199-suffixed identifiers
