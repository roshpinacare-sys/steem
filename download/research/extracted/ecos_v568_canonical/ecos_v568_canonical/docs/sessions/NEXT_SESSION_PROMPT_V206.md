# NEXT_SESSION_PROMPT_V206.md - Start of V207 (Phase P96)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v206_canonical.zip` (root `ecos_v206_canonical/`). Read `CLAUDE.md` first.

## State at V206
- `ecos-api-server.js` parses clean; version 206.0.0; Phase P95 complete.
- New: `GET /workspaces/:id/events/digest/type-gap?type=` (V206-T01, avg/min/max gap between consecutive events of a specific type), `GET /workspaces/:id/events/digest/hour-heatmap` (V206-T02, full 24×7 matrix[weekday][hour] with counts + maxCell), admin summary V206-T03.
- Tests: `tests/v206.test.js` (38 tests PASS). V205 suite 32/32.
- No new lib file — V206 reused `_eventLog181`.

## Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v206.test.js    # must pass all 38
NODE_ENV=test node tests/v205.test.js    # must pass all 32
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f... / e5a5c2c2...
```
- `Identifier '...' has already been declared` → suffix new identifiers `...207` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V207
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V206 added type-gap (per-type consecutive gap analysis) and hour-heatmap (24×7 matrix).
- New endpoints begin at V207-T01.

## Suggested P96 work (V207)
1. **V207-T01** Digest burst-detector: `GET /workspaces/:id/events/digest/burst?windowMs=&threshold=` — detect time windows where event rate exceeds threshold events/windowMs; return list of bursts with start/end/count.
2. **V207-T02** Digest type-heatmap: `GET /workspaces/:id/events/digest/type-heatmap` — for each distinct type, return its hourBreakdown[24] (per-type hour distribution, reusing hour bucket logic).
3. **V207-T03** Admin summary V207.
(Keep additive; no new stores.)
