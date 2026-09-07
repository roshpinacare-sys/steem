# CHANGELOG — V197 (Phase P86)

## Version: 197.0.0 | Date: 2026-05-31

## Summary
V197 adds two digest analysis endpoints (sender-rank + type-cooccurrence) using the existing `_eventDigest191` / `_eventLog181` stores — no new stores introduced.

## New Endpoints (3) — V197-T01 … V197-T03

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V197-T01 | GET | `/api/v1/workspaces/:id/events/digest/sender-rank` | Rank all senders by event count; includes topType, firstSentAt, lastSentAt. Query: `?limit=N` (default 20, max 100) |
| V197-T02 | GET | `/api/v1/workspaces/:id/events/digest/type-cooccurrence` | For each (typeA, typeB) pair (typeA < typeB lex), count events occurring within `windowSec` seconds of each other. Query: `?windowSec=N` (default 60, min 1, max 3600) |
| V197-T03 | GET | `/api/v1/admin/summary/v197` | Admin summary |

## Implementation Notes
- **sender-rank**: aggregates per `senderId`; topType = most frequent type (lex tie-break); sorted by count desc, then senderId asc; capped at 100.
- **type-cooccurrence**: sliding window O(n²) scan on chronologically sorted events; same-type pairs excluded; canonical pair key `typeA|typeB` where `typeA < typeB`; results capped at 200 pairs.
- Both endpoints reuse `_eventLog181` (ring-buffer) — zero new stores.

## Tests
- `tests/v197.test.js` — 54 tests ✓ PASS
- `tests/v196.test.js` — 44 tests ✓ PASS (regression)
- `tests/v195.test.js` — 35 tests ✓ PASS (regression)

## Cumulative Metrics

| Metric | V196 | V197 |
|--------|------|------|
| Server lines | 17,876 | 18,058 |
| Endpoints added this version | 3 | 3 |

## Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNTOUCHED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNTOUCHED

## Protocol Compliance
- ✓ R1 — Sacred files untouched
- ✓ R4 — No endpoints removed
- ✓ R5 — All prior suites pass
- ✓ R6 — Zero new npm dependencies
- ✓ R8 — NODE_ENV=test export block; 197-suffixed identifiers
