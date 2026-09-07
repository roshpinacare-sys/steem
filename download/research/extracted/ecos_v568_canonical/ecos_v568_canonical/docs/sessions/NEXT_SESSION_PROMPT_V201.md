# NEXT_SESSION_PROMPT_V201.md — Start of V202 (Phase P91)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v201_canonical.zip` (root `ecos_v201_canonical/`). Read `CLAUDE.md` first.

## State at V201
- `ecos-api-server.js` parses clean; version 201.0.0; Phase P90 complete.
- New: `GET /workspaces/:id/events/digest/co-active` (V201-T01, sender pair co-activity within windowSec), `GET /workspaces/:id/events/digest/heatmap` (V201-T02, 24-bucket UTC hour distribution), admin summary V201-T03.
- Tests: `tests/v201.test.js` (36 tests ✓ PASS). V200 suite 36/36.
- No new lib file — V201 reused `_eventLog181`.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v201.test.js    # must pass all 36
NODE_ENV=test node tests/v200.test.js    # must pass all 36
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → suffix new identifiers `…202` (BUG-L).

## Invariants
- R1 sacred files immutable · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V202
- Event digest service: `_eventDigest191`. Event log: `_eventLog181`. Do NOT create parallel stores.
- Broadcast: `_broadcast179`. Bookmarks: `_bookmarks184`. Snapshots: `_statsSnapshots185`. Tokens: `_tokenSvc181`.
- V201 added co-active pairs and hourly heatmap.
- New endpoints begin at V202-T01.

## Suggested P91 work (V202)
1. **V202-T01** Digest burst detection: `GET /workspaces/:id/events/digest/bursts?windowSec=N&minCount=M` — find time windows of N seconds with at least M events; return `[{windowStart, windowEnd, count, senders}]`.
2. **V202-T02** Digest sender gap analysis: `GET /workspaces/:id/events/digest/sender-gaps?senderId=X` — for a specific sender, compute gaps between consecutive events; return `{senderId, gapCount, avgGapSec, maxGapSec, minGapSec}`.
3. **V202-T03** Admin summary V202.
(Keep additive; no new stores.)
