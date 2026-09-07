# CHANGELOG — V195 (Phase P84)

## Version: 195.0.0 | Date: 2026-05-31

## Summary
V195 adds two digest visualisation endpoints (heatmap + type-timeline) using the existing `_eventDigest191` / `_eventLog181` stores — no new stores introduced.

## New Endpoints (3) — V195-T01 … V195-T03

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V195-T01 | GET | `/api/v1/workspaces/:id/events/digest/heatmap` | All-sender event counts bucketed by hour\|day |
| V195-T02 | GET | `/api/v1/workspaces/:id/events/digest/type-timeline/:type` | Per-type event counts bucketed by hour\|day |
| V195-T03 | GET | `/api/v1/admin/summary/v195` | Admin summary |

## Tests
- `tests/v195.test.js` — 35 tests ✓ PASS
- `tests/v194.test.js` — 41 tests ✓ PASS (regression)
- `tests/v193.test.js` — 31 tests ✓ PASS (regression)

## Cumulative Metrics

| Metric | V194 | V195 |
|--------|------|------|
| Server lines | 17,548 | 17,688 |
| Endpoints added this version | 3 | 3 |

## Sacred Files
- `lib/fiatLedger.js` MD5: `563e9b1f9e67091a5b6527c0a92568e5` ✓ UNTOUCHED
- `lib/auditLog.js` MD5: `e5a5c2c27801d2d03991bc8e5a1df8cb` ✓ UNTOUCHED

## Protocol Compliance
- ✓ R1 — Sacred files untouched
- ✓ R4 — No endpoints removed
- ✓ R5 — All prior suites pass
- ✓ R6 — Zero new npm dependencies
- ✓ R8 — NODE_ENV=test export block; 195-suffixed identifiers
