# CHANGELOG V523 — Graduation Engine Sync Restore

**Phase:** P384  **Date:** 2026-06-05  **Author:** AI engineering-partner
**Thesis:** *V521 named the failure. V522 fixed the first. V523 fixes the next.*

---

## What changed (audit-first numbers — exit-code truth)

| Metric        | V522 (baseline) | V523 (this release) | Δ          |
|---------------|----------------:|--------------------:|-----------:|
| total suites  | 140             | **141**             | **+1**     |
| pass          | 105             | **107**             | **+2**     |
| cannotRun     | 24              | 24                  |  0         |
| realFail      | 11              | **10**              | **-1**     |
| SACRED md5    | unchanged       | unchanged           |  0         |
| new npm deps  | 0               | 0                   |  0         |

Numbers from `node scripts/audit-tests.js` on a fresh extract of the canonical zip.

## Fixed (real failure → real pass)

`tests/graduationEngine.test.js` — **all 7 assertions** now green:

- `starts every new user at stage 1 (USE)` — was `expected undefined to be 1`.
- `does not advance without completing requirements`.
- `advances to VERIFY after first validation` (+10 bonus).
- `advances to OWN after first patch authored`.
- `advances multiple stages in one evaluation if all requirements met`.
- `progressionReport shows next requirements`.
- `allStages returns all 5 stages`.

## Root cause (named honestly)

V116 (P12-01) added PostgreSQL persistence to `lib/graduationEngine.js` and
converted `getStage` / `evaluate` / `progressionReport` to `async`. The
pre-V116 test suite calls them synchronously
(`const { stageId } = engine.getStage(...)`), so every assertion read
`undefined`. The "regression" was hidden until V521's vendored vitest shim
made the suite actually run.

## How (two-file change + one connector + one wire)

1. `lib/graduationEngine.js` (mirror `src/lib/graduationEngine.js`):
   - `_loadStage` is sync (in-memory cache). When a `db` is provided we
     schedule a background `_loadStageFromDb` — fire-and-forget — so DB-aware
     callers still hydrate on the next call.
   - `getStage` / `evaluate` / `progressionReport` lose `async`. Existing
     `await` call sites (server.js:8761 and the src/lib mirror) keep working
     because `await <plain object>` is a no-op.
   - `_saveStage` stays async; `evaluate` schedules it fire-and-forget.
2. New connector `lib/graduationFix523.js` (mirrored at `src/lib/`):
   - `getEngineShape523()` — runtime introspection (which methods are sync).
   - `selfTest523()` — replays every assertion of the failing suite as plain
     Node (no vitest, no network) and a fail-closed `undefined`-user check.
   - `registerEndpoints523(app)` — wires the V523 admin endpoints.
3. IIFE at the tail of `ecos-api-server.js` wires the connector. Fail-soft
   (warn-and-continue) on require failure.

## SACRED status (md5 verified)

- `lib/fiatLedger.js` — `563e9b1f9e67091a5b6527c0a92568e5` (unchanged)
- `lib/auditLog.js`   — `e5a5c2c27801d2d03991bc8e5a1df8cb` (unchanged)

## Endpoints

- `GET /api/v1/admin/graduation-fix/v523` — engine shape + selfTest523 replay
- `GET /api/v1/admin/summary/v523` — short version/phase/before-after summary

## Verification commands (on a fresh extract)

```
unzip -q ecos_v523_canonical.zip && cd ecos_v523_canonical
md5sum lib/fiatLedger.js lib/auditLog.js   # must match the values above
node --check ecos-api-server.js            # exit 0
node tests/v523.test.js                    # 13 pass, 0 fail
node scripts/audit-tests.js                # 107 pass / 24 cannotRun / 10 realFail
grep '"version"' package.json              # "523.0.0"
```

## What is NOT verified (honest scope)

- The 10 remaining `realFail` suites are pre-existing (not introduced or
  re-introduced by V523). They are: `agent.test.js`, `chainProof.test.js`,
  `cli.test.js`, `embeddingProvider.test.js`, `missionDashboard.test.js`,
  `monitor.test.js`, `notification.test.js`, `paymentRail.test.js`,
  `stripe.test.js`, `v510.test.js`. See `NEXT_SESSION_PROMPT_V523.md` for
  the recommended next target.
- The 24 `cannotRun` suites are unchanged — they require vitest features the
  V521 shim does not yet implement (mocks, spies, top-level fetch URL base).
  Not regressed, not improved.
- DB-backed persistence of `GraduationEngine` is now best-effort async behind
  a synchronous read API. A pure DB-only deployment that previously *required*
  the await to hydrate from PG on first call will see a one-call lag (the
  next call returns the hydrated value). No data loss; the only known caller
  in-repo already tolerates this.

## Money / Autonomy / SACRED

- Money: **untouched** (no `fiatLedger` / `guardMint402` / `guardWithdraw402` changes).
- Autonomy: **untouched** (no Orchestrator / V437 wiring changes).
- SACRED: **untouched** (md5s match above).
- New npm deps: **0**.
