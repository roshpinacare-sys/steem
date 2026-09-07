# NEXT SESSION PROMPT — ECOS V270

## Context

You are continuing development on ECOS V270, the canonical consolidation release.

**State:** V270 is complete. 1,600+ files, all lib/ mirrors intact, 48 previously-missing
mirrors restored, V258 patch file added, full test suite passing.

## Immediate State

```
version: 270.0.0
tests: v254–v270 all passing
lib_mirror_parity: 100% (48 gaps fixed)
patch_chain: v216–v270 complete (no gaps)
```

## What V270 Fixed

1. 48 missing `lib/` mirrors for the 266-series and 268-series modules
2. Missing `ecos-api-server-v258-patch.js` (Phase P154 scheduler wiring)
3. Missing `NEXT_SESSION_PROMPT_V268.md`
4. Version stamps bumped to 270.0.0 everywhere
5. `docs/` structure now includes V255–V270 changelogs, protocols, sessions

## For V271

Following the V254 naming convention:
- New module `consolidatedProviderRegistry271.js` in both `src/lib/` and `lib/`
- `ecos-api-server-v271-patch.js` — unified health + provider registry endpoint
- `tests/v271.test.cjs`
- `CHANGELOG_V271.md`
- `AI_PROTOCOL_V271.md`
- `NEXT_SESSION_PROMPT_V271.md`

## Sacred Files (DO NOT TOUCH)
- `src/lib/fiatLedger.js` — hash `563e9b1f…`
- `src/lib/auditLog.js` — hash `e5a5c2c2…`

## Rules Recap
- R1: Sacred files untouched  
- R2: All prior test suites continue to pass  
- R3: New versioned modules go in BOTH `src/lib/` and `lib/`  
- R6: Zero new npm deps  
