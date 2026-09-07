# CHANGELOG_V193.md — ECOS V193 (Phase P82)

**Date:** 2026-05-31 · **Version:** 193.0.0 · **Phase:** P82

---

## Summary

V193 extends the V191/V192 event digest with two new read-only analytical views
and an admin summary — all additive, zero new stores, zero new npm deps.

1. **Daily Digest** — filter the workspace event log to a single UTC calendar day,
   then produce the standard digest (counts, senders, time range, hourly histogram).
2. **Digest Diff** — compare two arbitrary time windows (baseline vs current) and
   return a structured delta: which event types were added/removed and how sender
   volumes shifted between the windows.

---

## New API Endpoints (3)

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V193-T01 | GET | `/api/v1/workspaces/:id/events/digest/daily` | Digest for a single UTC calendar day (`?date=YYYY-MM-DD`) |
| V193-T02 | GET | `/api/v1/workspaces/:id/events/digest/diff` | Delta between two time windows (`?since=`, `?until=`, `?compareSince=`, `?compareUntil=`) |
| V193-T03 | GET | `/api/v1/admin/summary/v193` | Admin summary for V193 phase |

---

## Implementation Notes

- **Reuses** `_eventDigest191` (`WorkspaceEventDigestService191`) and `_eventLog181` — no new stores.
- All new identifiers suffixed `…193` / `…193b` / `…193c` (BUG-L guard).
- `date` param validated as `YYYY-MM-DD`; day window is `[T00:00:00Z, T00:00:00Z +24h)` (exclusive end).
- `since > until` and `compareSince > compareUntil` → HTTP 400 guard on T02.
- `typeDiff` array sorted by `|delta|` descending (largest changes first).
- `senderDiff` covers top senders across both windows.
- Sacred files **UNTOUCHED**: `lib/fiatLedger.js` MD5 `563e9b1f…` · `lib/auditLog.js` MD5 `e5a5c2c2…`.

---

## Tests

| File | Tests | Status |
|------|-------|--------|
| `tests/v193.test.js` | 31 | ✓ PASS |
| `tests/v192.test.js` | 21 | ✓ PASS (regression) |
| `tests/v191.test.js` | 14 | ✓ PASS (regression) |

---

## Metrics

| Metric | V192 | V193 |
|--------|------|------|
| `ecos-api-server.js` lines | 17,223 | **17,414** |
| New endpoints this version | 3 | **3** |
| New test file | v192 (21) | **v193 (31)** |
| New lib files | 0 | **0** (reuse) |
| New npm deps | 0 | **0** |
