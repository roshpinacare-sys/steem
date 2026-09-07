# TFA Evolution Studio v25.0.0 — Engineering Excellence Pass

**Release Date:** 2026-06-25
**Version:** 25.0.0
**Previous Version:** 24.0.0
**Type:** Correctness hardening — 8 new defect classes eliminated, 0 features added

---

## Overview

V25 is a full-spectrum engineering excellence pass across all 7 workstreams.
Every change removes a false-success path, a data hazard, or an identity drift
discovered during adversarial review of v24. No new features. No API changes.

---

## Defect Inventory

### WS1 — Failure Injection Hardening

#### B1-V25-1 · `durableRecordEvidence` skipped `updatedAt` stamp *(critical)*

**File:** `src/lib/job-engine/durable-job-store.ts`

**Problem:** `durableRecordEvidence` constructed its updated job object manually,
assigning only `evidence: [...existing.evidence, node]` without touching `updatedAt`.
The `durableUpdateJob` path — used by every other mutation — always stamps `updatedAt`.
Because `findStuckJobs` uses `updatedAt` to determine whether a job has made progress,
any job that was actively appending evidence (but not transitioning status) would never
advance its timestamp. After the stuck threshold (10 min default), the job scheduler
would classify it as stuck, mark it `interrupted`, and potentially re-queue it — even
though the job was making genuine progress recording evidence nodes.

**Fix:** `durableRecordEvidence` now stamps `updatedAt: new Date().toISOString()` in the
constructed record and calls `compactIfNeeded` after appending, consistent with
`durableUpdateJob`. Evidence-recording jobs are now invisible to the stuck-job detector
while active.

---

### WS4 — Compiler / Adapter Robustness

#### B4-V25-1 · `ingestZipIntoSandbox` missing path traversal validation *(high)*

**File:** `src/lib/compiler/sandbox-runtime.ts`

**Problem:** `ingestZipIntoSandbox` called `zip.extractAllTo(ctx.projectRoot, true)`
without first iterating ZIP entries to check for path traversal sequences. The v24 pass
fixed the identical vulnerability in `project-ir.ts` (defect B4-3) but left
`sandbox-runtime.ts` unpatched. A crafted ZIP containing entries like `../../etc/passwd`
or `../../../app/src/...` could escape the sandbox directory and overwrite host
filesystem files — same CVE class as the v24 project-ir fix.

**Fix:** Pre-extraction loop resolves every entry path against `ctx.projectRoot` and
throws `Error` with an actionable message if any entry escapes the sandbox root.
Extraction is aborted entirely on the first violation. Logic mirrors the v24
`project-ir.ts` fix exactly.

#### B4-V25-2 · `buildManifest` orphaned string literal corrupted output *(medium)*

**File:** `src/lib/release/release.ts`

**Problem:** The `lines` array in `buildManifest` contained a bare `","` string as its
second element (line 27 in v24). This stray literal was emitted verbatim into every
generated release manifest, producing a corrupt `",` line between the header and the
version field. The defect was introduced in v20 and silently survived v21–v24.

**Fix:** Orphaned `","` line removed. Manifest output is now clean.

#### B4-V25-3 · `validation-gate.ts` used CJS `require()` inside ESM module *(medium)*

**File:** `src/lib/engine/validation-gate.ts`

**Problem:** `runValidationGate` called `const fs = require("fs")` and
`const path = require("path")` inside the function body. All other platform modules use
top-level ESM `import` declarations. Next.js's bundler with `"moduleResolution": "bundler"`
does not guarantee `require()` availability in server-side TypeScript modules, risking
`require is not defined` at runtime in certain deployment configurations.

**Fix:** Converted to top-level `import fs from "fs"` and `import path from "path"`,
consistent with every other module in the codebase.

---

### WS5 — Release Identity Coherence

#### B5-V25-1 · Sidebar footer displayed `v21.0.0` *(high)*

**File:** `src/components/layout/Sidebar.tsx`

**Problem:** The footer `<div>` hardcoded `v21.0.0`. The header correctly showed
`Studio v24.0`, but the footer was last updated in v21 and missed the v22, v23, and
v24 bumps. This presented a three-version identity contradiction to users on every page.

**Fix:** Footer updated to `v25.0.0`. Header updated to `Studio v25.0`.

#### B5-V25-2 · `package.json` description referenced `v23.0.0` *(medium)*

**File:** `package.json`

**Problem:** The `"description"` field read `"TFA Evolution Studio v23.0.0 — Distillation..."`.
It was not updated during the v24 bump. Package description is visible in `npm info`,
audit dashboards, and CI tooling — presenting a stale identity to all external consumers.

**Fix:** Updated to `"TFA Evolution Studio v25.0.0 — Engineering Excellence Pass..."`.

#### B5-V25-3 · README version history table omitted v24 row *(medium)*

**File:** `README.md`

**Problem:** The version history table topped out at v23.0.0 — the v24.0.0 row was absent.
The README heading was updated to v24.0.0 during the v24 bump but the table body was not.
Cross-reference links still pointed to `V23-RELEASE-NOTES.md` as "current release".

**Fix:** Table now leads with `25.0.0 ← current`, followed by `24.0.0`, then the
full historical sequence. Cross-references updated to V25-RELEASE-NOTES.md and
V24-RELEASE-NOTES.md. Quick-start command updated from `v22-tests` to `v25-tests`.

---

### WS7 — Distillation / Learning

#### B7-V25-1 · `analyzePatterns()` pattern IDs non-deterministic *(high)*

**File:** `src/lib/intelligence/cross-project-engine.ts`

**Problem:** Every pattern ID was generated as `pat_success_${Date.now()}`,
`pat_failure_${Date.now()}`, etc. This produced two categories of failure:

1. **ID collision:** Two patterns computed in the same millisecond received identical IDs,
   making the second silently shadow the first in any ID-keyed store.
2. **ID drift:** The same logical pattern (e.g. "High-success projects share consistent
   build tooling") received a different ID on every invocation, making deduplication
   impossible. A portfolio dashboard calling `analyzePatterns()` twice showed doubled
   entries with no way to merge them.

**Fix:** Introduced `stablePatternId(category, patternText)` — a djb2 hash over
`category + "\0" + pattern_text` producing a stable, content-addressed 32-bit unsigned
integer rendered as base-36. Example: `pat_success_2kx9q`. The same insight always maps
to the same ID regardless of when or how many times `analyzePatterns()` is called.
The hash seed text for `optimization` patterns excludes the dynamic `medianDuration`
value so the ID remains stable as the portfolio grows.

---

## File Headers Updated

All stale `TFA Evolution Studio vN` header comments updated to v25 in:

| File | Was | Now |
|------|-----|-----|
| `src/lib/engine/evidence-chain.ts` | v20 | v25 |
| `src/lib/engine/strategy-engine.ts` | v20 | v25 |
| `src/lib/engine/validation-gate.ts` | v20 | v25 |
| `src/lib/version-coherence.ts` | v20 | v25 |
| `src/lib/release/release.ts` | v20 | v25 |
| `src/lib/release/release-gate.ts` | v23 | v25 |
| `src/lib/release/release-governor.ts` | v21 | v25 |
| `src/lib/job-engine/durable-job-store.ts` | v21 | v25 |
| `src/lib/compiler/sandbox-runtime.ts` | v21 | v25 |
| `src/lib/batch/batch-coordinator.ts` | v23 | v25 |
| `src/lib/audit/self-audit.ts` | v23 | v25 |
| `src/lib/agents/sovereign-orchestrator.ts` | v23 | v25 |
| `src/lib/workflow/workflow-engine.ts` | v23 | v25 |

---

## New Script

```bash
npm run v25-tests    # exercises all 8 B-V25 defect-class assertions
```

Added to `package.json` scripts alongside existing `v24-tests`, `v23-tests`, `v22-tests`.

---

## Non-negotiable Release Gates

| Gate | Status |
|------|--------|
| `package.json` is single version source | ✅ PLATFORM_VERSION derived from package.json at load time |
| No hardcoded version literals in routes | ✅ all download routes import PLATFORM_VERSION |
| ZIP filename matches version | ✅ `tfa-evolution-studio-v25.0.0.zip` |
| ZIP root folder matches version | ✅ `tfa-evolution-studio-v25.0.0/` |
| `package-lock.json` version matches | ✅ `25.0.0` |
| Smoke test coherence check | ✅ passes static-only against this artifact |
| v25-tests | ✅ all 8 B-V25 assertions green |
| v24-tests | ✅ all 12 B-V24 assertions still green (no regressions) |

---

## Version History

| Version | Summary |
|---------|---------|
| **25.0.0** | ← **current** — Engineering excellence: 8 defects (B1-V25-1, B4-V25-1/2/3, B5-V25-1/2/3, B7-V25-1) |
| 24.0.0 | Red-team hardening: 12 defects across WS1–WS7 |
| 23.0.0 | Distillation & Refinement Pass |
| 22.0.0 | Sovereign Synthesis Kernel |
| 21.0.0 | Platform Maturity Pass |
| 20.0.0 | Compiler E2E Certainty Pass |
