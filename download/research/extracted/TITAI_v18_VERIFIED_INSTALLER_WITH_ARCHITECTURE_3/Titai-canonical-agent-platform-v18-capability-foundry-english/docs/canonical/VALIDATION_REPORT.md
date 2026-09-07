# Validation Report

**Release candidate:** Titai Canonical Agent Platform v10 Hardening  
**Audit date:** 2026-07-10  
**Execution profile:** Security-sensitive workstation mode; no PowerShell, no disabled endpoint protection, no opaque executable, and no native post-install execution.

## Passed gates

- Canonical validation: **passed**.
- Task graph: **52 tasks**, unique IDs, valid dependencies, and no cycles.
- Evidence model: **58 typed claims**.
- Official source registry: **28 records**.
- Architecture decisions: **23 ADRs**.
- Coverage model: **28 domains**.
- Experiment portfolio: **15 experiments**.
- English-only validation: **passed**.
- Repository source lint: **passed**.
- TypeScript typecheck: **passed**.
- SQL migration validation: **3 migration files and 10 required tables passed**.
- Safe deterministic suite: **24 files and 85 tests passed**.
- Durable subset: **5 files and 12 tests passed**.
- Baseline evaluation: **8 of 8 passed**.
- Durable fault-injection proof: **passed** with one side-effect execution across two attempts.
- Static roast: **26 of 27 controls passed**.
- Roast registry: **50 findings and 20 project killers passed validation**.
- Release audit: **passed** before archive creation.

## Native database boundary

Three suites fail before collection because the `better-sqlite3` native binding is absent:

- `approval-expiry.test.ts`
- `audit.test.ts`
- `runner.integration.test.ts`

The failure is reproducible and captured in `docs/canonical/evidence/v10-native-tests.txt`. No native rebuild or endpoint-protection change was attempted.

## Build and browser boundary

`next build` compiled successfully in 30.7 seconds and completed its type-validity phase. Page-data collection then failed because the `better-sqlite3` native binding is absent. It is recorded as environment blocked, not passed. The build wrapper sets `NEXT_TELEMETRY_DISABLED=1` without requiring shell-specific syntax.

The Playwright source was hardened to remove hard-coded credentials and fixed waits, but the suite was not executed. Production build and E2E remain promotion blockers.

## Verification interpretation

The code and tests demonstrate meaningful implementation progress, but the same engineering session performed the changes and the validation. Canonical work items are not promoted to independently verified status. The active runner also remains process-local until feature-flagged durable cutover and native integration evidence exist.

Machine-readable detail is stored in `docs/canonical/evidence/v10-validation.json`.
