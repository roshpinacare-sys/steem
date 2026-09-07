# NEXT_SESSION_PROMPT_V192.md — Start of V193 (Phase P82)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v192_canonical.zip` (root `ecos_v192_canonical/`). Read `CLAUDE.md` first.

## State at V192
- `ecos-api-server.js` parses clean; version 192.0.0; Phase P81 complete.
- New: `GET /events/digest/window` (V192-T01, time-window filter), `GET /events/digest/by-sender/:senderId` (V192-T02), admin summary V192-T03.
- Tests: `tests/v192.test.js` (21 tests). V191 + V190 suites still green.
- No new lib file — V192 reused `_eventDigest191` and `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v192.test.js    # must pass all
NODE_ENV=test node tests/v191.test.js    # must pass all
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…193` (BUG-L).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K); replace with `!!`.
- If a prior suite fails ONLY on a hardcoded `package.json === '1xx.0.0'` self-check, relax to `major >= 1xx`.

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V193
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- New endpoints begin at V193-T01.

## Suggested P82 work (V193)
1. **V193-T01** Daily digest: `GET /workspaces/:id/events/digest/daily?date=YYYY-MM-DD` — filter events for a single calendar day (UTC), reuse `_eventDigest191`.
2. **V193-T02** Digest diff: `GET /workspaces/:id/events/digest/diff?since=&until=&compare=` — compare two time windows (previous vs current), return added/removed types and sender deltas.
3. **V193-T03** Admin summary V193.
(Keep additive; no new stores.)

## Packaging
`ecos_v192_canonical.zip`, root `ecos_v192_canonical/`. See CLAUDE.md for the Python script.
