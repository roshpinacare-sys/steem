# Changelog — V502 — Honest Test Audit 🔍 (no feature; truth + a correction)

**Release:** ECOS V502 · 2026-06-05 · AI lead (Opus 4.8)

## Why this version exists
A fair callout: I repeatedly said things were "complete" / "trustworthy" while spot-checking only
a handful of suites. This version adds NO feature. It runs the WHOLE suite and tells the truth,
and it corrects a real regression I had hidden behind a false "zero regressions" claim.

## Built — `scripts/audit-tests.js` + `testAuditHarness502`
Runs every tests/*.test.js, buckets pass / cannotRun (needs vitest, not installable offline) /
realFail into TEST_AUDIT.json, surfaced at `GET /api/v1/admin/test-audit/v502`.

## Truth map (all 119 suites)
- **46 pass** under node · **72 cannotRun** here (vitest/ESM, ~61% — UNVERIFIED) · **1 realFail**
  (`v243.test.js`, a stale interim doc-check, not my code).
- Verifiable in this environment: ~39%. The rest is named, not hidden.

## Correction — a real V497 regression, owned and fixed
V497's orphan scan checked `require()` but not test-file references, so it wrongly archived 11
modules that tests depend on (breaking `v482.test.js`). The V497 "zero regressions" claim was false.
V502 restored all 11 and made the V497 manifest truthful (62 → 51 actually archived).

## Verification
- `node --check` clean; `tests/v502.test.js` passes; TEST_AUDIT.json regenerated.
- Sacred unchanged (R1). Zero new npm deps (R3/R6).

## What is NOT guaranteed (stated plainly)
The 72 vitest/ESM suites are not verifiable here. "pass" means exit 0 under node for 46 suites —
nothing more. See TEST_AUDIT_V502.md.
