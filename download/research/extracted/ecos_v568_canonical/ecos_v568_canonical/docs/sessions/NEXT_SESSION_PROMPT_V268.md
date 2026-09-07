# NEXT SESSION PROMPT — ECOS V268

## Context

You are continuing development on ECOS V268.

**State:** V268 is complete. 83 V267 regression tests pass. 15 new telemetry-instrumented
base modules added (`getPerf268()` / `checkXHealth268()` on every core module).

## For V269

- Add `providerAdapters269.js` — extends the 21 V268 DI contracts with `eventBus`
- `ecos-api-server-v269-patch.js` — `/api/v269/*` endpoints
- `tests/v269.test.cjs`
- `CHANGELOG_V269.md`

## Sacred Files
- `src/lib/fiatLedger.js` — hash `563e9b1f…`
- `src/lib/auditLog.js` — hash `e5a5c2c2…`
