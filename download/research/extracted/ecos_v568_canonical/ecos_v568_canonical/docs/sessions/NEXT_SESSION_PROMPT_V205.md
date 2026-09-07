# NEXT_SESSION_PROMPT_V205.md - Start of V206 (Phase P95)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v205_canonical.zip` (root `ecos_v205_canonical/`). Read `CLAUDE.md` first.

## State at V205
- `ecos-api-server.js` parses clean; version 205.0.0; Phase P94 complete.
- New: `GET /workspaces/:id/events/digest/peak-hour` (V205-T01, hour-of-day 0–23 UTC with most events, full hourBreakdown[24]), `GET /workspaces/:id/events/digest/event-gap` (V205-T02, avg/min/max gap between consecutive events in ms), admin summary V205-T03.
- Tests: `tests/v205.test.js` (32 tests PASS). V204 suite 39/39.
- No new lib file — V205 reused `_eventLog181`.

## Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v205.test.js    # must pass all 32
NODE_ENV=test node tests/v204.test.js    # 38/39 pass (SRC-xx version check expected)
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f... / e5a5c2c2...
```
- `Identifier '...' has already been declared` → suffix new identifiers `...206` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V206
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V205 added peak-hour (hour bucket analysis) and event-gap (consecutive gap stats).
- New endpoints begin at V206-T01.

## Suggested P95 work (V206)
1. **V206-T01** Digest type-gap: `GET /workspaces/:id/events/digest/type-gap?type=` — avg/min/max gap between consecutive events of a specific type (filtered subset of event-gap logic).
2. **V206-T02** Digest hour-heatmap: `GET /workspaces/:id/events/digest/hour-heatmap` — full 24×7 heatmap (hour × weekday); return `matrix[7][24]` with counts. (weekday 0=Sun UTC)
3. **V206-T03** Admin summary V206.
(Keep additive; no new stores.)
