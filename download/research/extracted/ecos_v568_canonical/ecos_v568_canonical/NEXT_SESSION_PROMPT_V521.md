# NEXT_SESSION_PROMPT_V521.md — Start of V522

## State at V521
- Version 521.0.0. Vendored zero-dep vitest shim at node_modules/vitest/ → the ESM vitest suites
  now RUN offline. Full audit: 102 pass / 25 cannotRun / 11 realFail (was 66/72/0). Endpoint
  /api/v1/admin/test-audit/v521. The 11 failures are named in CHANGELOG_V521.md (none in sacred/money core).
- Sacred intact; node --check clean; tests/v521.test.js green.

## ⚠️ Pre-flight (do FIRST — run the FULL audit, the shim is in place)
```
node scripts/audit-tests.js            # 102 pass / 25 cannotRun / 11 realFail — the truth
node --check ecos-api-server.js
NODE_ENV=test node tests/v521.test.js
md5sum lib/fiatLedger.js lib/auditLog.js   # 563e9b1f... / e5a5c2c2...
```
- Sacred immutable; lib mirrors src/lib; suffix ids; R3/R6 no new npm deps; no nesting / no *-patch.js.
- HONESTY: report X pass / Y cannotRun / Z realFail. Never "all green".

## High-leverage next (V522 — pick ONE; now the audit GUIDES you)
1. **Fix the 25 cannotRun-by-globals:** extend the shim to also expose describe/it/expect as GLOBALS
   (some suites don't import them). A tiny `node_modules/vitest/globals` + or a setup that assigns
   globalThis.describe=... Re-run audit; watch cannotRun drop.
2. **Fix a GENUINE logic failure** (not infra): graduationEngine stage-1, or semanticDriftMonitor WARN,
   or agent findSimilarPatches. Pick one, read its test + module, fix, prove the suite goes green.
   Re-run EVERY touched suite.
3. **Quarantine the 2 missing-relative tests** (monitor, paymentRail) or restore the missing modules.
4. Consolidate systemStatus504/505 (fresh duplicate pair).

## What is NOT verified (carry forward)
25 cannotRun (vitest-globals / pg / commander / missing-relative). Shim is a compat layer, not full vitest.

## Packaging
`ecos_v522_canonical.zip`, root `ecos_v522_canonical/`.
