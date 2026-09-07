# Next Session Prompt — V272

**Baseline:** ECOS V271 canonical  
**Version target:** V272  
**Date:** 2026-06-01

## Context

V271 added:
- Canonical server wiring for V263-V270 patches
- `consolidatedProviderRegistry271.js` — 22 DI contracts with runtime validation
- Unified health dashboard (GET /api/v271/health/unified aggregates all getPerf268())
- Bloom-Firewall cross-reference bridge
- PostgreSQL persistence foundation (12 tables, db/migration_phase46.sql)
- `CreditReserveRepo` and `ReputationRepo` — PostgreSQL-backed repository classes

## V272 Objectives

### P172 — Repository Injection (Primary)

The V271 DB tables exist and the repository classes are ready. V272 injects them:

1. **`CreditReserve272`** — extends/wraps `CreditReserve268`, replacing its in-memory balance with `CreditReserveRepo`. Accepts an optional `repo` in its constructor; falls back to in-memory if no pool.
2. **`ReputationLedger272`** — extends/wraps `ReputationLedger268`, replacing its in-memory attestation store with `ReputationRepo`.
3. Both modules go in `src/lib/creditReserve272.js` + `lib/creditReserve272.js` (R3).
4. Wire into `ecos-api-server-v272-patch.js` — a stateful patch that creates state via `createV272State({dbPool, logger})` and calls `registerEcosV272Routes(app, state)`.

### P173 — V272 Patch File

- `ecos-api-server-v272-patch.js` at project root
- Exports: `createV272State`, `registerEcosV272Routes`
- Routes: `GET /api/v272/credits/balance`, `POST /api/v272/credits/topup`, `GET /api/v272/reputation/:userId`
- Graceful fallback if DB pool unavailable (use in-memory modules)

### P174 — Test

- `tests/v272.test.cjs` — structural test verifying: new module files exist (both src/lib and lib), patch file exports correct shape, version stamp is 272.0.0

## Naming Rules (reminder)

- New modules: `src/lib/creditReserve272.js` AND `lib/creditReserve272.js`
- Patch file: `ecos-api-server-v272-patch.js` at root
- Test: `tests/v272.test.cjs`
- No new npm deps (R6)
- Sacred files UNTOUCHED (R1)
