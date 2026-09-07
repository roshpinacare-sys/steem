# CHANGELOG V524 — Vitest-Shim Matcher Extensions

**Phase:** P385  **Date:** 2026-06-05  **Author:** AI engineering-partner
**Thesis:** *Fix the test harness once, unlock a family of suites.*

---

## What changed (audit-first numbers — exit-code truth)

| Metric        | V523 (baseline) | V524 (this release) | Δ          |
|---------------|----------------:|--------------------:|-----------:|
| total suites  | 141             | **142**             | **+1**     |
| pass          | 107             | **109**             | **+2**     |
| cannotRun     | 24              | 24                  |  0         |
| realFail      | 10              | **9**               | **-1**     |
| SACRED md5    | unchanged       | unchanged           |  0         |
| new npm deps  | 0               | 0                   |  0         |

Numbers from `node scripts/audit-tests.js` on a fresh extract of the
canonical zip.

## Fixed (real failure → real pass)

`tests/notification.test.js` — **all 8 assertions** now green:

- `notify does not throw on unreachable URL` — was
  `expect(...).resolves.not.toThrow is not a function`.
- 7 sibling assertions kept passing.

## Partially unblocked

`tests/embeddingProvider.test.js` — **2 of 4 sub-failures resolved** by
the shim extensions (`toHaveBeenCalledOnce`). The remaining 2
(`toHaveBeenCalledTimes` reporting 0 calls) are a **production-cache
behaviour** issue in `lib/embeddingProvider.js` (the mocked `fetch` is
not seen by the cached provider). Deferred to V525 — that is engine code,
not test-harness code.

## Root cause (named honestly)

V521's vendored vitest shim implemented `expect(p).resolves` as a single
Proxy that returned an async matcher for *every* property access —
including `.not`. Reading `.resolves.not.toThrow` resolved `.not` to a
function and then read `.toThrow` off a function (undefined), then tried
to call it.

Same family: the shim never defined `vi.fn()` call-count matchers
(`toHaveBeenCalled`, `toHaveBeenCalledOnce`, `toHaveBeenCalledTimes`,
`toHaveBeenCalledWith`, `toHaveBeenLastCalledWith`), so any suite that
used them died with `… is not a function`.

## The fix (two surgical changes)

1. `node_modules/vitest/index.mjs` — `.resolves` / `.rejects` now use a
   factory `_resolvesHandler(negated)` / `_rejectsHandler(negated)` that
   intercepts the property `'not'` and returns a flipped sub-proxy. All
   other property accesses continue to behave as before (async matcher
   call).
2. Same file — added the five mock-call matchers, each backed by
   `received.mock.calls` from `vi.fn()`.

## Connector & wiring

- `lib/notificationFix524.js` (mirrored byte-identical at
  `src/lib/notificationFix524.js`):
  - `getShimSurface524()` — read-only introspection of the shim source.
  - `selfTest524()` — 10-check replay, plain Node, no network.
  - `registerEndpoints524(app)` — admin endpoints.
- IIFE in `ecos-api-server.js` (fail-soft `try/catch`):
  - `GET /api/v1/admin/notification-fix/v524`
  - `GET /api/v1/admin/summary/v524`

## Verification (re-extract zip → fresh run, exit-code only)

- `node --check ecos-api-server.js` → exit 0.
- `node tests/v524.test.js` → exit 0 (12/12 ok).
- `node tests/notification.test.js` → exit 0 (was 1 / shim TypeError).
- `node scripts/audit-tests.js` → 109 pass / 24 cannotRun / 9 realFail.
- SACRED md5: `lib/fiatLedger.js`=`563e9b1f9e67091a5b6527c0a92568e5`,
  `lib/auditLog.js`=`e5a5c2c27801d2d03991bc8e5a1df8cb` — unchanged.

## What is NOT verified (honest gaps)

- The 24 `cannotRun` suites remain `cannotRun` — neither pass nor fail.
- `embeddingProvider.test.js` still has 2 sub-failures rooted in
  `lib/embeddingProvider.js`'s cache wrapper not exposing the inner
  provider's `fetch` to the test's mock. Untouched here; engine fix.
- `v510.test.js` T08 still asserts "non-self realFail must be 0" and
  therefore reports the remaining 9 realFails as red. This is by design
  of V510; it will green only when the system is fully clean.

## SACRED, money, autonomy

- SACRED: untouched (md5 verified before and after).
- Money: no `guardMint402` / `guardWithdraw402` call paths touched.
- Autonomy: Orchestrator (V437) → V402 → Audit chain untouched.

## File manifest (added / changed)

| Path                                | Action  |
|-------------------------------------|---------|
| `node_modules/vitest/index.mjs`     | patched (matcher additions, .not chain) |
| `lib/notificationFix524.js`         | added (connector)                       |
| `src/lib/notificationFix524.js`     | added (byte-identical mirror)           |
| `ecos-api-server.js`                | appended V524 IIFE (no edits in body)   |
| `tests/v524.test.js`                | added                                   |
| `package.json` `version`            | 523.0.0 → 524.0.0                       |
| `CHANGELOG_V524.md`                 | added                                   |
| `NEXT_SESSION_PROMPT_V524.md`       | added                                   |
| `TEST_AUDIT.json`                   | regenerated                             |
