# NEXT_SESSION_PROMPT_V200.md — Start of V201 (Phase P90)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v200_canonical.zip` (root `ecos_v200_canonical/`). Read `CLAUDE.md` first.

## State at V200
- `ecos-api-server.js` parses clean; version 200.0.0; Phase P89 complete.
- New: `GET /workspaces/:id/events/digest/top-senders` (V200-T01, rank senders by count desc, limit up to 100, firstSeen/lastSeen), `GET /workspaces/:id/events/digest/type-distribution` (V200-T02, count by event type, pct included), admin summary V200-T03.
- Tests: `tests/v200.test.js` (36 tests). V199 suite 35/36 (SRC-14 version check expected).
- No new lib file — V200 reused `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v200.test.js    # must pass all 36
NODE_ENV=test node tests/v199.test.js    # must pass all logic tests (35/36)
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…201` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V201
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V200 added top-senders ranking and type distribution.
- New endpoints begin at V201-T01.

## Suggested P90 work (V201)
1. **V201-T01** Digest sender co-activity: `GET /workspaces/:id/events/digest/co-active?windowSec=N` — find pairs of senders that have events within `windowSec` of each other; return `[{senderA, senderB, overlapCount}]` sorted desc.
2. **V201-T02** Digest hourly heatmap: `GET /workspaces/:id/events/digest/heatmap` — count events per hour-of-day (0–23) regardless of date; return `[{hour, count}]` 24 entries.
3. **V201-T03** Admin summary V201.
(Keep additive; no new stores.)
