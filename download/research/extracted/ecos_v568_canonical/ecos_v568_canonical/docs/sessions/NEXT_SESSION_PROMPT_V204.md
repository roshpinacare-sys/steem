# NEXT_SESSION_PROMPT_V204.md - Start of V205 (Phase P94)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v204_canonical.zip` (root `ecos_v204_canonical/`). Read `CLAUDE.md` first.

## State at V204
- `ecos-api-server.js` parses clean; version 204.0.0; Phase P93 complete.
- New: `GET /workspaces/:id/events/digest/top-types` (V204-T01, rank event types by frequency with pct), `GET /workspaces/:id/events/digest/sender-rank` (V204-T02, rank senders by event count with pct), admin summary V204-T03.
- Tests: `tests/v204.test.js` (39 tests PASS). V203 suite 36/37 (SRC-13 version check expected after bump).
- No new lib file — V204 reused `_eventLog181`.

## Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v204.test.js    # must pass all 39
NODE_ENV=test node tests/v203.test.js    # 36/37 pass (SRC-13 version check skippable)
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f... / e5a5c2c2...
```
- `Identifier '...' has already been declared` -> suffix new identifiers `...205` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V205
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V204 added top-types and sender-rank digest analysis (both with limit + pct).
- New endpoints begin at V205-T01.

## Suggested P94 work (V205)
1. **V205-T01** Digest peak-hour: `GET /workspaces/:id/events/digest/peak-hour` — find the hour-of-day (0–23 UTC) with the most events; return `{peakHour, count, pct}`.
2. **V205-T02** Digest event-gap: `GET /workspaces/:id/events/digest/event-gap` — compute average time gap between consecutive events (sorted by sentAt); return `{eventCount, avgGapMs, minGapMs, maxGapMs}`.
3. **V205-T03** Admin summary V205.
(Keep additive; no new stores.)
