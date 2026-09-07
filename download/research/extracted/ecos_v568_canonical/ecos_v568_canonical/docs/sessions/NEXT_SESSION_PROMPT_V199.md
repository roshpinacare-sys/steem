# NEXT_SESSION_PROMPT_V199.md — Start of V200 (Phase P89)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v199_canonical.zip` (root `ecos_v199_canonical/`). Read `CLAUDE.md` first.

## State at V199
- `ecos-api-server.js` parses clean; version 199.0.0; Phase P88 complete.
- New: `GET /workspaces/:id/events/digest/gaps` (V199-T01, find consecutive-event intervals >= minGapSec, sorted by gapSec desc), `GET /workspaces/:id/events/digest/velocity` (V199-T02, workspace-wide events-per-time-unit by hour/day), admin summary V199-T03.
- Tests: `tests/v199.test.js` (36 tests). V198 suite still green (logic tests).
- No new lib file — V199 reused `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v199.test.js    # must pass all 36
NODE_ENV=test node tests/v198.test.js    # must pass all logic tests
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…200` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V200
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V199 added gap detection (consecutive-event interval analysis) and velocity (workspace-wide time-bucketed counts).
- New endpoints begin at V200-T01.

## Suggested P89 work (V200)
1. **V200-T01** Digest top senders: `GET /workspaces/:id/events/digest/top-senders?limit=N` — rank senders by total event count, return `[{senderId, count, firstSeen, lastSeen}]` desc.
2. **V200-T02** Digest event type distribution: `GET /workspaces/:id/events/digest/type-distribution` — count events by type across all senders; return `[{type, count, pct}]` sorted by count desc.
3. **V200-T03** Admin summary V200.
(Keep additive; no new stores.)
