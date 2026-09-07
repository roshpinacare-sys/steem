# CHANGELOG_V192.md — ECOS V192 (Phase P81)

**Date:** 2026-05-30 · **Version:** 192.0.0 · **Phase:** P81

---

## Summary

V192 extends the V191 event digest with two new read-only views and an admin
summary — all additive, zero new stores, zero new npm deps.

---

## New API Endpoints (3)

| Tag | Method | Path | Description |
|-----|--------|------|-------------|
| V192-T01 | GET | `/api/v1/workspaces/:id/events/digest/window` | Digest filtered by `?since=` / `?until=` ISO timestamps |
| V192-T02 | GET | `/api/v1/workspaces/:id/events/digest/by-sender/:senderId` | Digest restricted to a single sender |
| V192-T03 | GET | `/api/v1/admin/summary/v192` | Admin summary for V192 phase |

---

## Implementation Notes

- **Reuses** `_eventDigest191` (`WorkspaceEventDigestService191`) and `_eventLog181` — no new stores (per chain notes).
- All new identifiers suffixed `…192` / `…192b` / `…192c` (BUG-L guard).
- `since > until` → HTTP 400 guard on T01.
- Per-sender endpoint overrides the `topSenders` array to a single entry for cleaner API response.
- Sacred files **UNTOUCHED**: `lib/fiatLedger.js` MD5 `563e9b1f…` · `lib/auditLog.js` MD5 `e5a5c2c2…`.

---

## Tests

| File | Tests | Status |
|------|-------|--------|
| `tests/v192.test.js` | 21 | ✓ PASS |
| `tests/v191.test.js` | 14 | ✓ PASS (regression) |
| `tests/v190.test.js` | 61 | ✓ PASS (regression) |

---

## Metrics

| Metric | V191 | V192 |
|--------|------|------|
| `ecos-api-server.js` lines | 17,103 | 17,223 |
| New endpoints this version | 2 | **3** |
| New test file | v191 (14) | **v192 (21)** |
| New lib files | 1 | **0** (reuse) |
| New npm deps | 0 | **0** |
