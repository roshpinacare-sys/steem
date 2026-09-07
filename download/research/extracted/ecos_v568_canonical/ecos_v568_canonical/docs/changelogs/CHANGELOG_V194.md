# CHANGELOG_V194.md — ECOS V194 (Phase P83)

**Date:** 2026-05-31 · **Version:** 194.0.0 · **Phase:** P83

---

## Summary

V194 extends the V191/V192/V193 event digest with two new analytical views —
all additive, zero new stores, zero new npm deps (R6), reusing `_eventDigest191`
and `_eventLog181` throughout.

1. **Digest Top-Types** — returns the N most-frequent event types across the
   entire workspace event log, with count and percentage share of total events.
2. **Digest Sender Timeline** — returns hourly or daily event-count buckets
   for a single sender, enabling activity-over-time analysis.

---

## New API Endpoints (3)

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V194-T01 | GET | `/api/v1/workspaces/:id/events/digest/top-types` | Top N event types by frequency (`?limit=1–50`, default 10) |
| V194-T02 | GET | `/api/v1/workspaces/:id/events/digest/sender-timeline/:senderId` | Hourly or daily bucket counts for one sender (`?bucketSize=hour\|day`) |
| V194-T03 | GET | `/api/v1/admin/summary/v194` | Admin summary for V194 phase |

---

## Implementation Notes

- **Reuses** `_eventDigest191` (`WorkspaceEventDigestService191`) and `_eventLog181` — no new stores.
- All new identifiers suffixed `…194` / `…194b` / `…194c` (BUG-L guard).
- `limit` on T01: clamped to [1, 50], default 10.
- `bucketSize` on T02: `hour` → `YYYY-MM-DDTHH:00`, `day` → `YYYY-MM-DD`; invalid value defaults to `hour`.
- Events without `sentAt` or with invalid timestamps are skipped in timeline.
- `pct` field on T01 rounded to 2 decimal places (`Math.round(x * 10000) / 100`).
- Tie-breaking on T01: same count → alphabetical by type name.
- Sacred files **UNTOUCHED**: `lib/fiatLedger.js` MD5 `563e9b1f…` · `lib/auditLog.js` MD5 `e5a5c2c2…`.

---

## Tests

| File | Tests | Status |
|------|-------|--------|
| `tests/v194.test.js` | 41 | ✓ PASS |
| `tests/v193.test.js` | 31 | ✓ PASS (regression) |
| `tests/v192.test.js` | 21 | ✓ PASS (regression) |

---

## Metrics

| Metric | V193 | V194 |
|--------|------|------|
| `ecos-api-server.js` lines | 17,414 | **17,548** |
| New endpoints this version | 3 | **3** |
| New test file | v193 (31) | **v194 (41)** |
| New lib files | 0 | **0** (reuse) |
| New npm deps | 0 | **0** |
