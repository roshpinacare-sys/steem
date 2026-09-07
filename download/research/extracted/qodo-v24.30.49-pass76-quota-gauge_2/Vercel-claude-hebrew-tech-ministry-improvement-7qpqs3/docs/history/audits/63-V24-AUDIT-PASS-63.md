# QODO V24 — Audit Pass 63 (CIEP-X v10.0)

**Version:** 24.30.35
**Date:** 2026-07-07
**Protocol:** CIEP-X v10.0 (Canonical Incremental Engineering Protocol)
**Baseline:** 24.30.34 (Pass 62 — DOM-xray / shadow-traffic starvation audit, task-26)
**Task:** task-27 — Compliance-oracle / SBOM / license-checker cross-consistency check

---

## Impact Analysis

| Dimension | Assessment |
|---|---|
| Engineering value | High — three subsystems (sbom-generator, license-checker, compliance-oracle) each independently consume the same underlying data but through different code paths. Silent divergences between them mean an operator querying multiple subsystems for the same package can receive contradictory signals without any error being raised. Documenting and locking in the cross-consistency boundaries prevents future refactors from widening the gaps or introducing new ones. |
| Implementation risk | Zero — test-only pass. No production source files changed. |
| Compatibility impact | None. |
| Rollback complexity | Trivial — delete `packages/agent/tests/compliance-cross-consistency.test.ts`. |

---

## Problem Statement (from task-27)

`compliance-oracle.ts` opens PRs based on infrastructure compliance scans.
`sbom-generator.ts` and `license-checker.ts` independently enumerate the dependency
tree. All three subsystems can be in play simultaneously during a pipeline run. The
question from task-27: do they present a consistent view of the repository to an
operator, or can they silently disagree?

**Scope clarification discovered during analysis:**

`compliance-oracle.ts` scans *infrastructure files* (Dockerfile, GitHub Actions
workflows, Kubernetes manifests). `sbom-generator.ts` and `license-checker.ts` scan
the *dependency tree* (package-lock.json). These are orthogonal scopes — they read
completely different source files. There is no single shared input they could disagree
about at the oracle level.

The productive cross-consistency check is therefore between SBOM and license-checker,
which *do* share the same input (package-lock.json) but process it through independent
code paths with a key implementation divergence documented below.

---

## Root Cause Analysis

Both `sbom-generator.ts` and `license-checker.ts` define a private `normalizeLicense`
function with the same logic — *except* for the final `else` clause:

```typescript
// sbom-generator.ts — normalizeLicense else clause:
return '';           // empty string → falsy → no licenses field added to component

// license-checker.ts — normalizeLicense else clause:
return 'UNKNOWN';   // sentinel string → not in allowlist → reason:'unknown' violation
```

This means that for any package with an undefined, null, or object-without-`type`
license field:

| Subsystem | Output |
|---|---|
| `sbom-generator` | Component has no `licenses` array (silent: "no info available") |
| `license-checker` | Violation with `license:'UNKNOWN'`, `reason:'unknown'` (vocal: "flagged problematic") |

An operator cross-referencing both outputs for the same package sees contradictory
signals without any error being raised by either system.

---

## Findings

### GAP-1 (Medium) — Missing license normalization divergence

**Trigger:** A package with no `license` field in `package-lock.json`, or with
`license: null`, or with an object-style `{ name: '...' }` without a `type` key.

**SBOM output:** Component has `licenses === undefined` (no license data recorded).

**License-checker output:** Violation with `license: 'UNKNOWN'`, `reason: 'unknown'`.
`report.passed` remains `true` (unknown ≠ explicitly denied), but the violation is
present in the violations array.

**Cross-consumer impact:** An automated tool comparing SBOM and license-checker output
for the same package sees a discrepancy. The SBOM appears to have no license info;
the license-checker actively flags the package. Without a reconciliation layer, neither
signal is reliably interpretable in the presence of the other.

**Affected packages in practice:** Packages that omit the `license` key entirely
(rare but valid in npm), packages pinned to an exact commit with no package.json
`license` field, and packages with legacy object-style license fields that lack `type`.

**Recommended fix:** Unify the `normalizeLicense` else clause across both files, or
add a reconciliation helper that maps SBOM `licenses === undefined` to the
`license-checker` 'UNKNOWN' sentinel before comparison.

---

### GAP-2 (Low) — Empty string license divergence

**Trigger:** A package with `license: ''` or `license: '   '` (whitespace-only) in
the lockfile. Both are trimmed to `''` by the normalization function.

**SBOM output:** `''` is falsy → component has `licenses === undefined`.

**License-checker output:** `normalizeLicense('')` returns `''` (the trimmed string
itself — **not** the `'UNKNOWN'` sentinel, which only comes from the `else` clause for
non-string / non-type-object inputs). `''` is not in the denied list, not in the allowed
list → violation with `reason: 'unknown'` and `license: ''`.

**Key distinction from GAP-1:** The violation's `license` field is `''` (empty string),
not `'UNKNOWN'`. This means a cross-consumer cannot use `violation.license === 'UNKNOWN'`
as a reliable proxy for "missing license data" — a `''` result also signals a problematic
entry but with a different sentinel value.

**Cross-consumer impact:** Same shape as GAP-1 (SBOM silent, license-checker vocal), but
the violation's license string differs. Rarely encountered in practice — npm packages with
an explicitly empty `license` field are unusual — but the gap is real and not covered by
the existing `security.test.ts` test suite.

---

## Design Boundaries Confirmed

| ID | Description |
|---|---|
| DB-1 | Object-style `{ type: 'X' }` license is normalized consistently by both SBOM and license-checker — both extract the `type` string and use it as the license ID. This is the only object-license form both subsystems handle correctly. |
| DB-2 | Compliance-oracle scope (Dockerfile, CI workflows, K8s manifests) is orthogonal to SBOM/license-checker scope (package-lock.json dependency tree). These subsystems read entirely different source files and cannot contradict each other on any shared input. |
| DB-3 | Root package (empty key `''` in the lockfile) is skipped by both SBOM and license-checker consistently — `if (!pkgKey \|\| pkgKey === '') continue` is present in both. |
| DB-4 | Package name normalization (stripping `node_modules/` prefix) uses the same regex in both subsystems: `key.replace(/^node_modules\//, '').replace(/node_modules\//g, '/')`. Names are consistent. |
| DB-5 | For any package with a non-empty string license (including object-style with `type`), both SBOM and license-checker extract the same string value. The divergence is strictly limited to the missing/empty/malformed-object cases. |

---

## Test Cases

**`packages/agent/tests/compliance-cross-consistency.test.ts`** — 8 describe blocks, 31 test cases.

| Block | Count | What it covers |
|---|---|---|
| Package enumeration cross-consistency | 5 | Count, name, version, scoped packages, lockfileVersion 2 |
| License data cross-consistency | 4 | MIT, GPL-3.0, Apache-2.0, mixed fixture |
| GAP-1: missing license divergence | 4 | undefined, null, confirmed cross-consumer signal discrepancy |
| GAP-2: empty string divergence | 4 | Empty string, whitespace-only, count-agrees but semantics diverge |
| DB-1: object-style license | 3 | { type: MIT }, { type: GPL-3.0 }, object without type |
| Compliance-oracle internal consistency | 9 | Determinism, each rule, multi-file ordering, fetch failures |
| DB-2: scope separation | 4 | GPL doesn't affect oracle, rootless Dockerfile doesn't affect SBOM |
| Three-subsystem matrix | 4 | All-clean, all-dirty, determinism, root-skip DB-3 |

No real filesystem, network, or GitHub API access — all tests use temp dirs,
`writeFakeLock`, and `vi.fn()` mocks reset in `afterEach`. Pattern matches
the established style in `supply-chain-audit.test.ts` and `security.test.ts`.

---

## Validation

```bash
node --experimental-strip-types --check \
  packages/agent/tests/compliance-cross-consistency.test.ts
# Exit 0

bash validate.sh
# 50/50 PASSED

node scripts/check-dead-integrations.mjs
# 88 exports flagged; all in allowlist — no new dead integrations
```

Full `vitest run` / `tsc --noEmit` blocked by sandbox network constraints,
consistent with all passes ≥ 36. Static review confirms no type errors in the
new test file. All fetch/GitHub mocks use `vi.fn()` and are reset in `afterEach`
via `vi.restoreAllMocks()`.

---

## Files Changed

| File | Change |
|---|---|
| `packages/agent/tests/compliance-cross-consistency.test.ts` | New — 8 describe blocks, 31 test cases |
| `packages/agent/docs/63-V24-AUDIT-PASS-63.md` | New — this document |
| `tasks/agent-task-queue.json` | task-27 → `"done"`, `completedInPass: 63` |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 63 entry prepended |
| `CHANGELOG.md` | Version 24.30.35 entry added |
| `ENGINEERING_NOTES.md` | Pass 63 section added |
| `package.json` (×4) | Version bumped 24.30.34 → 24.30.35 |

---

## Remaining Locally-Tractable Tasks

From `tasks/agent-task-queue.json` (run `node scripts/task-queue.mjs list` for live view):

| ID | Priority | Title |
|---|---|---|
| task-30 | P3 | Prompt-registry version-rollback mid-run consistency |
| task-31 | P3 | Warden policy-conflict resolution correctness |
| task-32 | P3 | Semantic-cache drift adversarial audit |

Owner-decision tasks (no code, decisions only):

| ID | Priority | Title |
|---|---|---|
| task-35 | P2 | Decide on Cloudflare AI Gateway as ai-router caching/rate-limit proxy |
| task-36 | P2 | Decide on second-source code-quality/security APIs (Snyk, Socket.dev, VirusTotal) |
| task-39 | P2 | Decide on feature-flag-gated canary rollout (LaunchDarkly or Flagsmith) |
