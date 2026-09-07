# NEXT_SESSION_PROMPT_V193.md — Start of V194 (Phase P83)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v193_canonical.zip` (root `ecos_v193_canonical/`). Read `CLAUDE.md` first.

## State at V193
- `ecos-api-server.js` parses clean; version 193.0.0; Phase P82 complete.
- New: `GET /events/digest/daily` (V193-T01, single UTC day filter), `GET /events/digest/diff` (V193-T02, two-window delta), admin summary V193-T03.
- Tests: `tests/v193.test.js` (31 tests). V192 + V191 suites still green.
- No new lib file — V193 reused `_eventDigest191` and `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v193.test.js    # must pass all
NODE_ENV=test node tests/v192.test.js    # must pass all
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…194` (BUG-L).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K); replace with `!!`.
- If a prior suite fails ONLY on a hardcoded `package.json === '1xx.0.0'` self-check, relax to `major >= 1xx`.

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V194
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V193 added daily view and diff view. No new stores introduced.
- New endpoints begin at V194-T01.

## Suggested P83 work (V194)
1. **V194-T01** Digest top-types: `GET /workspaces/:id/events/digest/top-types?limit=N` — return the N most frequent event types across the entire log with percentage share.
2. **V194-T02** Digest sender timeline: `GET /workspaces/:id/events/digest/sender-timeline/:senderId?bucketSize=hour|day` — hourly or daily event counts for a single sender.
3. **V194-T03** Admin summary V194.
(Keep additive; no new stores.)

## Packaging
`ecos_v193_canonical.zip`, root `ecos_v193_canonical/`. See CLAUDE.md for the Python script.
