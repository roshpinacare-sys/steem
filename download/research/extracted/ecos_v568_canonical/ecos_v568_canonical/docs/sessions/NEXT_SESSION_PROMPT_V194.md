# NEXT_SESSION_PROMPT_V194.md — Start of V195 (Phase P84)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v194_canonical.zip` (root `ecos_v194_canonical/`). Read `CLAUDE.md` first.

## State at V194
- `ecos-api-server.js` parses clean; version 194.0.0; Phase P83 complete.
- New: `GET /workspaces/:id/events/digest/top-types` (V194-T01, top N event types with pct share), `GET /workspaces/:id/events/digest/sender-timeline/:senderId` (V194-T02, hourly/daily bucket timeline for one sender), admin summary V194-T03.
- Tests: `tests/v194.test.js` (41 tests). V193 + V192 suites still green.
- No new lib file — V194 reused `_eventDigest191` and `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v194.test.js    # must pass all
NODE_ENV=test node tests/v193.test.js    # must pass all
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…195` (BUG-L).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K); replace with `!!`.

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V195
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V194 added top-types view and sender-timeline view. No new stores introduced.
- New endpoints begin at V195-T01.

## Suggested P84 work (V195)
1. **V195-T01** Digest type heatmap: `GET /workspaces/:id/events/digest/heatmap?bucketSize=hour|day` — event counts bucketed by time, across ALL senders, for heatmap visualisation.
2. **V195-T02** Digest type-timeline: `GET /workspaces/:id/events/digest/type-timeline/:type?bucketSize=hour|day` — hourly or daily counts for a single event type (mirror of T02 but type-scoped instead of sender-scoped).
3. **V195-T03** Admin summary V195.
(Keep additive; no new stores.)

## Packaging
`ecos_v194_canonical.zip`, root `ecos_v194_canonical/`. See CLAUDE.md for the Python script.
