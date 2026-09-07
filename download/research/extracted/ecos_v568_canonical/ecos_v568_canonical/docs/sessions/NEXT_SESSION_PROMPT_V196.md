# NEXT_SESSION_PROMPT_V196.md — Start of V197 (Phase P86)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v196_canonical.zip` (root `ecos_v196_canonical/`). Read `CLAUDE.md` first.

## State at V196
- `ecos-api-server.js` parses clean; version 196.0.0; Phase P85 complete.
- New: `GET /workspaces/:id/events/digest/cross` (V196-T01, pivot table rowBy=type|sender × colBy=day|hour), `GET /workspaces/:id/events/digest/peak` (V196-T02, peak bucket + top-3 types), admin summary V196-T03.
- Tests: `tests/v196.test.js` (44 tests). V195 + V194 suites still green.
- No new lib file — V196 reused `_eventDigest191` and `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v196.test.js    # must pass all
NODE_ENV=test node tests/v195.test.js    # must pass all
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…197` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V197
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V196 added cross-tab view (rowBy×colBy pivot) and peak-hour view (highest bucket + top-3 types).
- New endpoints begin at V197-T01.

## Suggested P86 work (V197)
1. **V197-T01** Digest sender-rank: `GET /workspaces/:id/events/digest/sender-rank?limit=N` — ranks all senders by event count, with their top event type and first/last sentAt.
2. **V197-T02** Digest type-cooccurrence: `GET /workspaces/:id/events/digest/type-cooccurrence?windowSec=N` — for each pair of event types, count how many times they occur within N seconds of each other (default 60).
3. **V197-T03** Admin summary V197.
(Keep additive; no new stores.)
