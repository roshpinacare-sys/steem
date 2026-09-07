# NEXT_SESSION_PROMPT_V191.md — Start of V192 (Phase P81)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v191_canonical.zip` (root `ecos_v191_canonical/`). Read `CLAUDE.md` first.

## State at V191
- `ecos-api-server.js` parses clean; version 191.0.0; Phase P80 complete.
- New: `lib/workspaceEventDigestService191.js` + `GET /workspaces/:id/events/digest` (V191-T01), admin summary (V191-T02).
- Tests: `tests/v191.test.js` (14). V178–V190 suites still green.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js          # must print nothing
NODE_ENV=test node tests/v191.test.js    # must pass all
NODE_ENV=test node tests/v190.test.js    # must pass all
md5sum lib/fiatLedger.js lib/auditLog.js # 563e9b1f… / e5a5c2c2…
```
- `Identifier '...' has already been declared` → duplicate require/const; suffix new identifiers `…192` (BUG-L).
- `__manus_ec` / `trap '' PIPE` in source → shell corruption (BUG-K, V157); replace artifact with `!!`.
- If a prior suite fails ONLY on a hardcoded `package.json === '1xx.0.0'` self-check, relax it to `major >= 1xx` (forward-compat maintenance, not a logic change).

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 all prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Chain notes for V192
- Event digest reads `_eventLog181`. Any V192 digest extension MUST read the same store; do not add a parallel events store.
- Broadcast registry `_broadcast179`; events log `_eventLog181`; bookmarks `_bookmarks184`; snapshots `_statsSnapshots185`; tokens `_tokenSvc181`.

## Suggested P81 work (V192)
1. **V192-T01** Digest over a time window: `GET /events/digest?since=&until=` (filter by sentAt range, reuse the V191 service).
2. **V192-T02** Per-sender digest: `GET /workspaces/:id/events/digest/by-sender/:senderId`.
3. **V192-T03** Admin summary V192.
(Keep additive; reuse `_eventLog181` + `_eventDigest191`.)

## Packaging
`ecos_v192_canonical.zip`, root `ecos_v192_canonical/`. See CLAUDE.md for the Python script.

## Judgment rule
In doubt about schema / dependency / Sacred Files / duplication → stop, choose the safe additive
version-suffixed option, report in the summary. A small stable ZIP beats a large broken one.
