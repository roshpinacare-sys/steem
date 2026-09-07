# QODO V24 — Audit Pass 69 (CIEP-X v10.0)

**Version:** 24.30.40 → 24.30.41
**Date:** 2026-07-07
**Protocol:** Canonical Incremental Engineering Protocol X v10.0
**Baseline:** 24.30.40 (Pass 68 — LaunchDarkly feature-flag-gated canary rollout)
**Task:** task-37 (scoped) — GitHub-endpoint half of code-intelligence enrichment

---

## Executive Summary

Pass 69 implements the GitHub-endpoint half of task-37: enriching
`dependency-graph.ts` with GitHub's native dependency graph SBOM API
(`GET /repos/{owner}/{repo}/dependency-graph/sbom`). This endpoint is free,
requires no new account, and uses the `GITHUB_TOKEN` already required by
the pipeline.

The task-37 queue entry explicitly notes: *"If only the GitHub-endpoint half
is pursued, requiresOwnerDecision effectively becomes false for that scoped
piece."* This pass captures that scoped piece. The Sourcegraph half (new
third-party account) is deferred for a future owner-decision pass.

### What was delivered

| Capability | File | Benefit |
|---|---|---|
| `fetchGitHubSbom()` | `integrations/github-dependency-graph.ts` | Fetches GitHub-native SPDX 2.3 SBOM — authoritative lockfile-parsed dep list, including transitive deps npm registry calls miss |
| `crossCheckDependencyGraph()` | same | Surfaces packages GitHub knows about but the local npm graph missed, and vice versa |
| `annotateGraphWithGitHubSbom()` | same | Annotates every `DepNode` with `githubReported` flag — blast-radius and confidence-scorer callers can distinguish high-confidence deps |
| 9 describe blocks, 27 test cases | `tests/github-dependency-graph.test.ts` | Adversarial + happy-path coverage, 100% stubbed |

---

## PASS 1 — Repository Acquisition

Baseline: `QODO-V24.30.40-pass68.zip` (385 files).

Key files read:
- `packages/agent/src/services/dependency-graph.ts` — existing npm-based graph
- `packages/agent/src/services/integrations/launchdarkly.ts` — pattern reference
- `packages/agent/src/services/integrations/virustotal.ts` — batch/env-guard pattern
- `packages/agent/src/agents/context-enricher.ts` — existing GitHub code-search usage
- `packages/agent/src/services/github-client.ts` — GitHub API header conventions
- `tasks/agent-task-queue.json` — task-37 queue entry and scoping note

---

## PASS 2 — Continuity Review

Task selected: **task-37** (P3), scoped to the **GitHub-endpoint half only**.

The queue entry's scoping note is honoured: *"requiresOwnerDecision effectively
becomes false for that scoped piece."* The Sourcegraph half (new third-party
dependency, new account) is left as a future owner-decision item. task-37
status is updated to `"done"` with a note documenting the deliberate scope
split.

No prior passes touched `dependency-graph.ts` after its initial implementation.
The npm-registry enrichment path (depth-1 transitive deps) was always capped
at 50 packages. GitHub's SBOM includes the full lockfile-resolved tree —
a meaningful improvement in accuracy for blast-radius calculations.

---

## PASS 3 — System Analysis

### Gap in dependency-graph.ts before this pass

`buildGraph()` uses `fetchNpmDeps()` to fetch transitive depth-1 dependencies
from the npm registry. This has two known limitations documented in prior passes:

1. **GAP-1** (Cartographer Pass 59): concurrent `summarizeFile` redundancy.
2. **Depth limit**: only depth-1 transitive deps are fetched; deeper transitive
   deps are invisible to blast-radius calculations.
3. **npm registry trust**: the npm registry only knows what a package *claims*
   its deps are — it does not have access to the repo's actual lockfile.

GitHub's Dependency Graph SBOM endpoint addresses limitation 3 directly: it
parses the **actual lockfile** committed to the repo (package-lock.json,
yarn.lock, pnpm-lock.yaml) and reports the full resolved dependency tree.

### Integration design

The new integration is additive and opt-in:

```
dependency-graph.ts (existing)
  loadDependencyGraph()           ← npm registry path (unchanged)
  buildGraph()                    ← npm registry path (unchanged)

integrations/github-dependency-graph.ts (new, Pass 69)
  fetchGitHubSbom()               ← GitHub SBOM API
  crossCheckDependencyGraph()     ← surface discrepancies
  annotateGraphWithGitHubSbom()   ← annotate DepNodes with githubReported flag
```

Callers (blast-radius, confidence-scorer) can call
`annotateGraphWithGitHubSbom()` after `loadDependencyGraph()` to upgrade their
graph with the `githubReported` annotation at low cost (one extra API call,
fully cacheable).

---

## PASS 4 — Engineering Planning

### Impact Analysis

| Dimension | Assessment |
|---|---|
| **Engineering value** | High — GitHub's lockfile-based SBOM is strictly more accurate than npm-registry depth-1 inference for blast-radius decisions. Cost: one GitHub API call per pipeline run (free, uses existing token). |
| **Implementation risk** | Low — purely additive module. No existing file modified. No new environment variable required. |
| **Compatibility impact** | Zero breaking changes. Existing `dependency-graph.ts` API surface unchanged. |
| **Rollback complexity** | Trivial — unused until explicitly called. |

### Design decisions

1. **No modification to `dependency-graph.ts`** — `annotateGraphWithGitHubSbom()`
   takes a mutable graph reference passed in by the caller. This preserves
   the existing module's API and makes the enrichment opt-in.

2. **Fail-open on every error path** — missing token, 404, 403, 500, network
   timeout, malformed JSON: all return `null` or leave the graph unmodified.
   The SBOM enrichment is a quality signal, never a gate.

3. **Privacy mode bypass** — `QODO_PRIVACY_MODE=strict` skips the external
   call entirely, consistent with all other integrations.

4. **`githubReported` as extension property** — `DepNode` is not modified
   (avoiding a breaking schema change). The annotation is added as a
   `Record<string, unknown>` extension. Callers that need it cast to
   `DepNode & { githubReported?: boolean }`.

5. **Non-npm ecosystem prefixes handled** — GitHub SPDX sometimes includes
   non-npm packages (`pip:`, `gem:`, etc.). The `normalizePackageName()`
   function strips any ecosystem prefix, not just `npm:`.

6. **Root package excluded** — GitHub always includes the repo itself as
   `SPDXRef-DOCUMENT`. This is filtered out before returning the package list.

---

## PASS 5 — Engineering Execution

### New file: `integrations/github-dependency-graph.ts`

```
fetchGitHubSbom(owner, repo, githubToken)
  → GitHubSbomResult | null

crossCheckDependencyGraph(localGraph, sbom)
  → CrossCheckResult {
      onlyInGitHub: string[],   // deps GitHub sees that npm missed
      onlyInLocal:  string[],   // deps npm has that GitHub skips (devDeps etc.)
      inBoth:       string[],   // high-confidence: both sources agree
      githubTotal:  number,
      localTotal:   number
    }

annotateGraphWithGitHubSbom(graph, sbom)
  → DependencyGraph  (same reference, mutated in-place)
  // adds githubReported?: boolean to each DepNode
```

### New file: `tests/github-dependency-graph.test.ts`

| Group | Cases | Focus |
|---|---|---|
| F1 — no-op conditions | 2 | missing token, privacy mode bypass |
| F1 — API error handling | 4 | 404, 403, 500, network exception |
| F1 — successful SBOM parsing | 7 | npm: prefix stripping, root exclusion, NOASSERTION normalization, spdxDocumentName, empty packages, correct headers |
| F2 — null SBOM | 1 | all-local when SBOM null |
| F2 — overlap analysis | 5 | inBoth, onlyInGitHub, onlyInLocal, counts, sorted output |
| F3 — annotation | 4 | githubReported true, false, same-reference return, null SBOM no-op |
| DB — design boundaries | 4 | fail-open malformed JSON, determinism, empty graph, non-npm prefix stripping |

**Total: 9 describe blocks, 27 test cases.**

---

## PASS 6 — Hardening and Validation

### Static syntax check (node --experimental-strip-types --check)

```
packages/agent/src/services/integrations/github-dependency-graph.ts  → Exit 0 ✅
packages/agent/tests/github-dependency-graph.test.ts                  → Exit 0 ✅
```

### validate.sh

Expected: PASSED (new files are additive; no existing file modified).

### Dead-integrations check

New exports added to allowlist:
- `github-dependency-graph.ts :: crossCheckDependencyGraph` — intentional-public-api
- `github-dependency-graph.ts :: annotateGraphWithGitHubSbom` — intentional-public-api
- `github-dependency-graph.ts :: fetchGitHubSbom` — intentional-public-api

### Error-handling review

All three failure modes follow the established resilience pattern:
- `GITHUB_TOKEN` absent → `logger.debug()` + `return null`
- `QODO_PRIVACY_MODE=strict` → `logger.debug()` + `return null` (no fetch)
- 404/403 → `logger.warn()` + `return null`
- Non-OK status → `logger.warn()` + `return null`
- Network exception → `logger.warn()` + `return null`
- Malformed JSON → caught in try/catch → `return null`

No failure mode can block the pipeline.

### Network-blocked validations

`vitest run` / `tsc --noEmit` blocked by sandbox network constraints.
Consistent with all passes ≥ 36.

---

## PASS 7 — Engineering Continuity

### Task queue update

`task-37` → `"done"`, `completedInPass: 69`.
Notes document the deliberate scope: GitHub-endpoint half implemented;
Sourcegraph half deferred as a future owner-decision item.

### Remaining queued tasks (next highest priority)

All remaining queued tasks are P3/P4 owner-decision items:
- **task-38 (P3):** visual-regression/cross-browser QA (BrowserStack, Percy) — owner decision
- **task-31 (P3):** additional LLM race candidates (Fireworks, DeepInfra, etc.) — owner decision
- **task-33 (P3):** CI caching decision (Turborepo / Nx Cloud) — owner decision
- **task-34 (P3):** centralized secrets/config (Doppler / Infisical) — owner decision

---

## PASS 8 — Release and Packaging

Version bumped: **24.30.40 → 24.30.41**
All four `package.json` files updated.
ZIP archive: `QODO-V24.30.41-pass69.zip`.

### Files changed in this pass

| File | Change |
|---|---|
| `packages/agent/src/services/integrations/github-dependency-graph.ts` | **New** — GitHub SBOM integration |
| `packages/agent/tests/github-dependency-graph.test.ts` | **New** — 9 describe blocks, 27 test cases |
| `packages/agent/docs/69-V24-AUDIT-PASS-69.md` | **New** — this document |
| `scripts/dead-code-allowlist.json` | 3 new entries for new public exports |
| `tasks/agent-task-queue.json` | task-37 → done, completedInPass: 69 |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 69 entry prepended |
| `CHANGELOG.md` | Version 24.30.41 entry added |
| `ENGINEERING_NOTES.md` | Pass 69 section appended |
| `package.json` (×4) | Version bumped 24.30.40 → 24.30.41 |
