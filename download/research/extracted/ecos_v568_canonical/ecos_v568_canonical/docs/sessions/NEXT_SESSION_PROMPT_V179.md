# NEXT_SESSION_PROMPT_V179.md — Start of V180 (Phase P69)

## Context
Continuing ECOS. Canonical ZIP: `ecos_v179_canonical.zip` (root `ecos_v179_canonical/`).
Read `CLAUDE.md` first.

## State at V179
- `ecos-api-server.js` parses clean; version 179.0.0; Phase P68 complete.
- New: `lib/workspaceBroadcastService.js` + `POST /workspaces/:id/broadcast` (V179-T01), admin summary (V179-T04).
- Tests: `tests/v179.test.js` (15). V178 suite still green.

## ⚠️ Pre-flight (do FIRST, every session)
```
node --check ecos-api-server.js        # must print nothing
NODE_ENV=test node tests/v179.test.js  # must pass
```
- `Identifier '...' has already been declared` → a session re-required a module and
  re-declared a const; suffix the new instance (e.g. `_xxx<ver>`). (This was BUG-L in V169–V171.)
- `__manus_ec` / `trap '' PIPE` anywhere in source → shell corruption; replace with `!!`. (BUG-K, V157.)

## Invariants
- R1 sacred files immutable (verify MD5) · R4 no endpoint removal · R5 prior suites pass ·
  R6 zero new npm deps · R8 NODE_ENV=test exports + version-suffixed identifiers.

## Suggested P69 work
1. **V180-T01** SSE stream `GET /workspaces/:id/events/stream` (text/event-stream) — wire the
   V179 broadcast registry as the source; register the SSE writer as a `send()` client.
2. **V180-T02** Bulk task status — first audit existing bulk task service(s), pick one canonical, then add.
3. **V180-T03** Wire a real WS client into `_broadcast179.register` so POST /broadcast reaches live clients.
4. **V180-T04** Admin summary V180.

## Packaging
`ecos_v180_canonical.zip`, root `ecos_v180_canonical/`. See CLAUDE.md for the Python script.
