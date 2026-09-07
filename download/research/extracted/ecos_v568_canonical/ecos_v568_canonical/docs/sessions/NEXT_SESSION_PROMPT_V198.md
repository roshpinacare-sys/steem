# NEXT_SESSION_PROMPT_V198.md — Start of V199 (Phase P88)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v198_canonical.zip` (root `ecos_v198_canonical/`). Read `CLAUDE.md` first.

## State at V198
- `ecos-api-server.js` parses clean; version 198.0.0; Phase P87 complete.
- New: `GET /workspaces/:id/events/digest/sender-timeline/:senderId` (V198-T01, event counts bucketed by hour/day per sender), `GET /workspaces/:id/events/digest/bursts` (V198-T02, sliding-window burst detection with threshold), admin summary V198-T03.
- Tests: `tests/v198.test.js` (36 tests). V197 + V196 suites still green.
- No new lib file — V198 reused `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v198.test.js    # must pass all
NODE_ENV=test node tests/v197.test.js    # must pass all
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…199` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V199
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V198 added sender-timeline (hour/day bucketing per sender) and burst detection (sliding-window ≥K threshold).
- New endpoints begin at V199-T01.

## Suggested P88 work (V199)
1. **V199-T01** Digest gap detection: `GET /workspaces/:id/events/digest/gaps?minGapSec=N` — find intervals between consecutive events where the gap exceeds minGapSec; return list of `{ gapStart, gapEnd, gapSec }` sorted by gapSec desc.
2. **V199-T02** Digest event velocity: `GET /workspaces/:id/events/digest/velocity?granularity=hour|day` — events-per-time-unit across all senders combined (like timeline but workspace-wide).
3. **V199-T03** Admin summary V199.
(Keep additive; no new stores.)
