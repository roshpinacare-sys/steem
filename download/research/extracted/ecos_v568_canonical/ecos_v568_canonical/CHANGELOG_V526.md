# ECOS V526 — vitest-shim global beforeAll restored

**Phase:** P387  **Date:** 2026-06-05  **Author:** AI engineering-partner

## What changed (truth, exit-code verified)

- Patched `node_modules/vitest/index.mjs` (the V521 zero-dep shim):
  - `_runAll()` now invokes `_globalBeforeAll` once before iterating suites, and
    `_globalAfterAll` once after. Previously they were collected and dropped.
  - `_runNode()` wraps `node.beforeAll` in try/catch and surfaces the error as a
    per-test failure (`"beforeAll: <message>"`) instead of swallowing it. The
    error is also propagated into child describes so they fail with the same
    root cause rather than misleading "undefined" downstream errors.
  - `afterAll` is wrapped so a teardown error cannot mask the primary result.
- New connector `lib/vitestShimGlobalsFix526.js`, mirrored byte-identical at
  `src/lib/vitestShimGlobalsFix526.js`. Read-only introspection only.
- New IIFE `_wireVitestShimGlobalsFix526()` appended to `ecos-api-server.js`
  exposing `GET /api/v1/admin/vitest-shim-globals-fix/v526` and
  `GET /api/v1/admin/summary/v526`.
- New test suite `tests/v526.test.js` — 12 checks, exit 0.

## Numbers (before → after)

`node scripts/audit-tests.js`, two runs (so v510 sentinel sees fresh JSON):

| metric    | V525  | V526  |
|-----------|-------|-------|
| total     | 143   | 143   |
| pass      | 110   | 110   |
| cannotRun | 25    | 27    |
| realFail  | **8** | **6** |

Reclassified `realFail → cannotRun`:
- `tests/chainProof.test.js` (was: `Failed to parse URL from undefined/...`,
  now: `Cannot find module 'pg'`).
- `tests/missionDashboard.test.js` (same).

Remaining realFail (all pre-existed V525, none introduced by V526):
- `cli.test.js`, `monitor.test.js` — `Cannot find module '../monitor/index.js'`
  (relative path; audit's CANNOT_RUN_RX requires `[A-Za-z@]` first char).
- `paymentRail.test.js` — `Cannot find module '../lib/rails/manualRail'` (same).
- `embeddingProvider.test.js` — `expected mock to be called 1 times, got 0`
  (shim `vi.spyOn` returns a fresh fn rather than wrapping the existing method).
- `stripe.test.js` — `StripeProvider: Invalid API Key provided: sk_te`
  (test expects an outbound HTTPS attempt; provider validates the dummy key
  before constructing the request).
- `v510.test.js` — sentinel (passes iff non-self realFail = 0).

## Invariants verified

- SACRED md5 unchanged:
  - `lib/fiatLedger.js` = `563e9b1f9e67091a5b6527c0a92568e5`
  - `lib/auditLog.js`   = `e5a5c2c27801d2d03991bc8e5a1df8cb`
- `node --check ecos-api-server.js` → 0.
- `NODE_ENV=test node tests/v526.test.js` → 12/12 pass, exit 0.
- `NODE_ENV=test node tests/v525.test.js` → still exits 0.
- `NODE_ENV=test node tests/v524.test.js` → still exits 0.
- `lib/vitestShimGlobalsFix526.js` ≡ `src/lib/vitestShimGlobalsFix526.js`
  (md5 identical).

## What is NOT verified

- HTTP endpoints registered by the V526 IIFE were not hit against a live server
  (the server require chain pulls in `pg`, which is not installed in this
  sandbox). Verified only via `node --check` + `selfTest526()`.
- The 6 remaining realFails are unchanged from V525 — V526 did not attempt them.
- `v510.test.js` will keep failing until non-self realFail = 0.

## Rule reminders honored

- SACRED untouched.
- Zero new npm dependencies; only Node builtins + relative requires.
- No file deleted or renamed; the only mutation outside new files is the IIFE
  appended to `ecos-api-server.js` and a surgical patch to the in-repo vendored
  vitest shim (vendored source is allowed).
- Connector mirrored byte-identical at `src/lib/` per the NNN convention.
