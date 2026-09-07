# NEXT_SESSION_PROMPT V524 → V525

**Status after V524 (audit-first, exit-code truth):**

- total: 142 · pass: 109 · cannotRun: 24 · realFail: 9
- SACRED md5 unchanged. Zero new npm deps. Money/Autonomy untouched.
- V524 patched the vendored vitest shim with `.resolves.not` /
  `.rejects.not` chained negation and 5 mock-call matchers
  (`toHaveBeenCalled*`). `notification.test.js` is now 8/8 green.

## What is SOLID (safe to depend on)

- `node_modules/vitest/index.mjs` — `.resolves` and `.rejects` are now
  built by `_resolvesHandler(neg)` / `_rejectsHandler(neg)` factories.
  Property `'not'` returns a flipped sub-proxy; everything else still
  returns an async matcher call. The five `toHaveBeenCalled*` matchers
  read `received.mock.calls`.
- `lib/notificationFix524.js` ≡ `src/lib/notificationFix524.js` (md5
  identical — T04 in `tests/v524.test.js` enforces).
- V524 wiring is a tail IIFE in `ecos-api-server.js`; failure is
  fail-soft (`logger.warn` + endpoints simply don't register).

## What is FRAGILE (read before touching)

- The shim self-runs on `process.on('beforeExit')`. Any matcher you add
  MUST throw an `AssertionError` (not return false) — the runner only
  counts thrown errors as failures.
- The `.resolves.not` factory captures `received` by closure. If you
  later need to compose `.resolves.not.rejects` (we don't today), you'd
  have to thread `received` again — current code only flips `negated`.
- `vi.fn().mock.calls` is the source of truth for all 5 mock matchers.
  Don't change `vi.fn()`'s `calls.push(a)` line without updating them.

## Recommended next target (ordered, V521-shim-named realFails)

Pick **one** and follow the V522/V523/V524 connector pattern (thin
connector module, sync `selfTest`, two admin endpoints, plain-Node test).

1. **`embeddingProvider.test.js`** — last 2 sub-failures:
   `caches repeated embed() calls: expected mock to be called 1 times, got 0`
   and `clearCache resets: …`. Cause: the test imports
   `defaultEmbeddingProvider` (a `CachingProvider` wrapping an inner
   provider) and stubs the global `fetch`. The cached provider already
   memoized something from earlier tests, so `fetch` is never re-hit.
   Fix candidates: (a) export a factory that lets the test inject its
   own inner provider; (b) `clearCache()` in a `beforeEach`; (c) connect
   the cache key to a per-test salt. Choose the smallest change that
   doesn't break the public API.
2. **`agent.test.js`** — `require is not defined`. Test uses bare
   `require` under ESM. Likely a 2-line bootstrap fix (`createRequire`)
   inside a connector replay; do NOT edit the vendored test.
3. **`stripe.test.js`** — `Invalid API Key provided: sk_te`. Stub
   `https.request` before the StripeProvider constructor parses keys.
   Connector that monkey-patches `https.request` in a `beforeAll` and
   restores in `afterAll` — or guard inside `StripeProvider` itself
   when `NODE_ENV==='test'`.
4. **`monitor.test.js` / `cli.test.js`** — both need
   `../monitor/index.js`. Restore a minimal monitor stub (small, file
   exists, exports the surface the tests use). Do NOT delete the tests.
5. **`paymentRail.test.js`** — needs `../lib/rails/manualRail`. Same
   pattern as #4. `grep -rn "lib/rails"` first; reuse what's there.
6. **`chainProof.test.js` / `missionDashboard.test.js`** — both die on
   `Failed to parse URL from undefined/api/v1/...`. They read
   `process.env.BASE_URL`. Fix: have the connector set a default
   (e.g. start an in-process server on an ephemeral port, set
   `BASE_URL=http://127.0.0.1:<port>`) inside a `beforeAll`.
7. **`v510.test.js`** T08 — green only when ALL non-self realFails are 0.
   This is by design; it will resolve naturally as 1–6 close.

## Hard rules (do not break)

- Do **not** touch `lib/fiatLedger.js` or `lib/auditLog.js`. md5s must stay:
  - `lib/fiatLedger.js` `563e9b1f9e67091a5b6527c0a92568e5`
  - `lib/auditLog.js`   `e5a5c2c27801d2d03991bc8e5a1df8cb`
- Do **not** add npm dependencies. Node builtins + vendored source only.
- Do **not** delete or rename test files. Fix the production code or add a
  connector self-test; the vendored test stays as the contract.
- Do **not** revert the V524 shim additions. `tests/v524.test.js` T07 / T08
  enforce them; reverting will turn V524's gain back into red.
- Before adding a new module, `grep -rn` the name in the repo. If a
  similar module exists, UNIFY — don't duplicate.

## Verification you must run before claiming "done"

1. `unzip` to `/tmp`, then **inside the extracted copy**:
2. `md5sum lib/fiatLedger.js lib/auditLog.js` — must match SACRED.
3. `node --check ecos-api-server.js`
4. `node tests/v525.test.js` — must exit 0.
5. `NODE_ENV=test node tests/notification.test.js` — must STILL exit 0
   (anti-regression for V524).
6. `node scripts/audit-tests.js` — pass count must be ≥ 109, realFail
   count must be ≤ 9. If either moved the wrong way, you regressed.
