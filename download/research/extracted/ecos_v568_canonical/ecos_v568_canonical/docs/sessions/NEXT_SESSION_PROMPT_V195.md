# NEXT_SESSION_PROMPT_V195.md — Start of V196 (Phase P85)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v195_canonical.zip` (root `ecos_v195_canonical/`). Read `CLAUDE.md` first.

## State at V195
- `ecos-api-server.js` parses clean; version 195.0.0; Phase P84 complete.
- New: `GET /workspaces/:id/events/digest/heatmap` (V195-T01, all-sender time-bucketed counts), `GET /workspaces/:id/events/digest/type-timeline/:type` (V195-T02, per-type bucketed counts), admin summary V195-T03.
- Tests: `tests/v195.test.js` (35 tests). V194 + V193 suites still green.
- No new lib file — V195 reused `_eventDigest191` and `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v195.test.js    # must pass all
NODE_ENV=test node tests/v194.test.js    # must pass all
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…196` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V196
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V195 added heatmap view (all senders × time) and type-timeline view (one type × time).
- New endpoints begin at V196-T01.

## Suggested P85 work (V196)
1. **V196-T01** Digest cross-tab: `GET /workspaces/:id/events/digest/cross?rowBy=type|sender&colBy=day|hour` — pivot table counting events by two dimensions simultaneously.
2. **V196-T02** Digest peak-hour: `GET /workspaces/:id/events/digest/peak?granularity=hour|day` — returns the single bucket with the highest event count + the top-3 event types within that bucket.
3. **V196-T03** Admin summary V196.
(Keep additive; no new stores.)
