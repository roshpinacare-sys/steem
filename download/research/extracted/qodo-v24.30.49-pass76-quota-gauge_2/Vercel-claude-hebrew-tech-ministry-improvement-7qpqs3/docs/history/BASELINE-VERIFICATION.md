# Baseline Verification — first real execution of Qodo V24.30.46

**Date:** 2026-07-07 · **Environment:** Linux, Node v22.22.2, npm 10.9.7, network access to the npm registry (GitHub release downloads blocked by egress policy).

## Why this document exists

Every audit document shipped with V24.30.46 (passes 10–73) admits the same limitation: the
monorepo was authored in a sandbox **without network access** — `npm install`,
`tsc --noEmit`, and `vitest` were **never executed**. All "PASS" results in
`08-VALIDATION.md` and the audit passes are static checks (`node --check`, reasoning).
This document records the first time the code was actually installed, compiled, and tested.
Every result below was reproduced from the pristine import commit.

## Commands and results

### 1. `npm ci` (original lockfile) — **FAIL**

`sharp@0.32.6` (transitive: `@xenova/transformers` → `sharp`) runs a postinstall that
downloads libvips binaries from GitHub releases. Blocked here by egress policy, and
fragile anywhere. **Fix applied:** root `overrides` pins `sharp@^0.33.5` (0.33+ ships
binaries as npm-registry packages, no postinstall download) and the lockfile was
regenerated. `npm install`: **576 packages, OK**.

### 2. `tsc --noEmit -p packages/agent` — **FAIL (code does not parse)**

9 syntax errors, all one root cause: `src/services/ai-router.ts` lines 626–660 contain a
**headless duplicate** of `chatSambanova` — the function body was pasted a second time
without its signature (botched merge). The file cannot be parsed by tsc **or** esbuild.

### 3. `npx vite build` (packages/agent) — **FAIL**

Same syntax error. **The shipped agent package cannot be built at all.** Consequently no
prior "build PASS" claim can have been true for this tree.

### 4. `npx vitest run` (packages/agent, no coverage) — **1065 pass / 54 fail / 2 files unfinished**

| Failing file | Tests | Root cause (verified) |
|---|---|---|
| `provider-race-a3.test.ts` | 16 | imports `ai-router.ts` → transform fails on the syntax corruption |
| `trust-ledger-gaming.test.ts` | 15 | behavior drift: code computes penalty 45 where tests expect 35 |
| `swarm-contention.test.ts` | 4 | (to diagnose in Phase 1) |
| `semantic-dag-deadlock.test.ts` | 3 | (to diagnose) |
| `quota-guardian.test.ts` | 3 | (to diagnose) |
| `darwin-engine-stress.test.ts` | 3 | (to diagnose) |
| `adversarial-audit-log.test.ts` | 3 | (to diagnose) |
| 7 more files | 1 each | (to diagnose) |

Unfinished after 13 minutes (run aborted):
- `hive-poisoning.test.ts` — pulls the `@xenova/transformers` embedding stack; model
  download is network-dependent (blocked → hang/retry). Tests are not hermetic.
- `obfuscator-scale.test.ts` — CPU-bound "exhaustive scale" suite, >12 min single-thread.

### 5. `tsc --noEmit` + `vite build` (apps/mission-control) — **PASS**

0 type errors; build OK in 12.4 s (largest chunk: three.js vendor, 990 KB).

### 6. `standalone-executable` — **PASS**

`npm install && npm test`: **28/28 pass** (matches CONSOLIDATION-NOTES.md — the only part
of the archive that had ever actually been run).

## Headline conclusions

1. **The core package never compiled.** The corruption in `ai-router.ts` predates the
   archive; every downstream artifact (CI, Docker, k8s) referencing a build of this tree
   references something that could never have existed.
2. The test suite is substantial and mostly healthy (95%+ of executed tests pass), which
   makes it a usable behavior oracle for refactoring once the ~54 failures and 2
   non-hermetic files are addressed.
3. `npm ci` reproducibility required a dependency policy fix (sharp override), now in place.
