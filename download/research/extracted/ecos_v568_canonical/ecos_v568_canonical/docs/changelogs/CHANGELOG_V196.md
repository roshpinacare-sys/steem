# CHANGELOG — V196 (Phase P85)

## Version: 196.0.0 | Date: 2026-05-31

## Summary
V196 adds two digest analysis endpoints (cross-tab + peak-hour) using the existing `_eventDigest191` / `_eventLog181` stores — no new stores introduced.

## New Endpoints (3) — V196-T01 … V196-T03

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V196-T01 | GET | `/api/v1/workspaces/:id/events/digest/cross` | Pivot table: events × two dimensions (rowBy=type\|sender, colBy=day\|hour) |
| V196-T02 | GET | `/api/v1/workspaces/:id/events/digest/peak` | Peak bucket (highest count) + top-3 types within it |
| V196-T03 | GET | `/api/v1/admin/summary/v196` | Admin summary |

## Tests
- `tests/v196.test.js` — 44 tests ✓ PASS
- `tests/v195.test.js` — 35 tests ✓ PASS (regression)
- `tests/v194.test.js` — 41 tests ✓ PASS (regression)

## Cumulative Metrics

| Metric | V195 | V196 |
|--------|------|------|
| Server lines | 17,688 | 17,876 |
| Endpoints added this version | 3 | 3 |

## Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNTOUCHED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNTOUCHED

## Protocol Compliance
- ✓ R1 — Sacred files untouched
- ✓ R4 — No endpoints removed
- ✓ R5 — All prior suites pass
- ✓ R6 — Zero new npm dependencies
- ✓ R8 — NODE_ENV=test export block; 196-suffixed identifiers
