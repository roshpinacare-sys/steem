# NEXT_SESSION_PROMPT_V197.md — Start of V198 (Phase P87)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v197_canonical.zip` (root `ecos_v197_canonical/`). Read `CLAUDE.md` first.

## State at V197
- `ecos-api-server.js` parses clean; version 197.0.0; Phase P86 complete.
- New: `GET /workspaces/:id/events/digest/sender-rank` (V197-T01, rank senders by event count with topType/firstSentAt/lastSentAt), `GET /workspaces/:id/events/digest/type-cooccurrence` (V197-T02, sliding-window pair counting), admin summary V197-T03.
- Tests: `tests/v197.test.js` (54 tests). V196 + V195 suites still green.
- No new lib file — V197 reused `_eventDigest191` and `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v197.test.js    # must pass all
NODE_ENV=test node tests/v196.test.js    # must pass all
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…198` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V198
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V197 added sender-rank (per-sender aggregation + topType) and type-cooccurrence (sliding-window pair counting).
- New endpoints begin at V198-T01.

## Suggested P87 work (V198)
1. **V198-T01** Digest sender-timeline: `GET /workspaces/:id/events/digest/sender-timeline/:senderId?granularity=hour|day` — event counts bucketed by hour or day for a single sender.
2. **V198-T02** Digest burst detection: `GET /workspaces/:id/events/digest/bursts?windowSec=N&threshold=K` — find all time windows of `windowSec` seconds with ≥ K events; return list of `{ windowStart, count, topType }` sorted by count desc.
3. **V198-T03** Admin summary V198.
(Keep additive; no new stores.)
