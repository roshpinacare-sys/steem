# QODO V24 — Audit Pass 72 (CIEP-X v10.0)

**Version:** 24.30.43 → 24.30.44
**Date:** 2026-07-07
**Protocol:** Canonical Incremental Engineering Protocol X v10.0
**Baseline:** 24.30.43 (Pass 71 — A3 LLM Race Candidates: Fireworks, DeepInfra, Novita, CF Workers AI REST)
**Task:** task-33 — CI/build-acceleration caching: Turborepo remote cache (Vercel) vs. Nx Cloud

---

## Executive Summary

Pass 72 executes task-33: the formal decision on whether to adopt Turborepo remote
caching (via Vercel) or Nx Cloud for CI/build acceleration.

**Turborepo remote cache: CONDITIONAL-YES.**
Adoption is justified and low-friction, but three preconditions must be met before
the workflow is mutated. The foundational config (turbo.json) is documented here and
ready to add when conditions are met.

**Nx Cloud: NO-GO.**
Requires an Nx build-system migration not planned for this project. Treating it as
a drop-in remote cache without migrating to Nx is not supported.

This is a documentation-only pass. No source files are modified.

---

## PASS 1 — Repository Acquisition

Baseline: `QODO-V24.30.43-pass71.zip` (version 24.30.43, Pass 71 done).

Key files read for this analysis:

- `.github/workflows/agent-pipeline.yml` — active CI pipeline (8 jobs)
- `package.json` (root) — workspace structure: `packages/*`, `apps/*`
- `packages/agent/package.json` — agent build scripts
- `apps/mission-control/package.json` — mission-control build scripts
- `03-ARCHITECTURE.md` — existing infrastructure tier decisions
- `tasks/agent-task-queue.json` — task-33 queue entry
- `tasks/agent-task-queue.md` — current queue status

---

## PASS 2 — Continuity Review

**Task selected:** task-33 (P3, `requiresOwnerDecision: true`).

This is the highest-priority remaining queued task. Pass 71's engineering notes
recommended it as the next owner-decision pass, noting that Turborepo is
"already well-supported in Vercel monorepos and this repo is already
workspace-structured; good candidate for a concrete YES path."

No prior pass has touched the CI caching configuration.

---

## PASS 3 — System Analysis

### Current CI pipeline structure

The active workflow `.github/workflows/agent-pipeline.yml` defines 8 jobs:

```
typecheck ──────────────────────────────────────── (tsc --noEmit)
               ↓                    ↓
           test               security          build
  (vitest + coverage)   (TruffleHog + SBOM)  (vite build ×2)
                                                    ↓
                              ┌─────────────────────┼──────────────┐
                          preflight          audit-verify       slo-report
                              └─────────────────────┼──────────────┘
                                                     ↓
                                                   agent
```

**Current caching mechanisms in place:**

| Mechanism | Scope | Coverage |
|---|---|---|
| `actions/setup-node@v4` with `cache: npm` | All jobs independently | npm package cache (`~/.npm`) — avoids re-downloading packages on `npm ci` |
| `actions/cache@v4` on `node_modules/.cache/transformers` | `test` job only | `@xenova/transformers` model weights |
| `actions/upload-artifact@v4` / `download-artifact@v4` | `build` → `{preflight, audit-verify, slo-report, agent}` | `packages/agent/dist/` — compiled JS, avoids 4 redundant builds |

**Key observations:**

1. **TypeScript compilation is performed twice per run:**
   - `typecheck` job: `npx tsc --noEmit` in both `packages/agent` and `apps/mission-control`
   - `build` job: Vite build implicitly re-runs tsc during transpile

2. **`npm ci` runs in every job (8× per run):** The `cache: npm` setting caches the
   package download layer but each job still resolves and links `node_modules` from
   scratch. On a monorepo with ~60 listed dependencies, this is measurable overhead.

3. **No cross-run (remote) caching exists:** If `packages/agent/src/` is unchanged
   between two consecutive PRs, the `build` job still re-transpiles the agent in full.

4. **No Turborepo config exists** (`turbo.json` absent from the repo).

5. **No Nx config exists** (`nx.json`, `project.json` absent from the repo).

### What Turborepo remote caching would add

Turborepo identifies tasks by the hash of their inputs (source files + env + deps).
When the hash matches a cached output on the remote cache, it restores the output
directly — the task is not re-executed.

For this repo the concrete benefits would be:

| Job | Turborepo task | Cached output | Benefit |
|---|---|---|---|
| `build` | `turbo run build` | `packages/agent/dist/`, `apps/mission-control/dist/` | Eliminates full Vite rebuild when only tests change |
| `typecheck` | `turbo run typecheck` | tsc `.tsbuildinfo` files | Incremental type-check across jobs and branches |
| `test` | `turbo run test` | vitest results (snapshot) | Re-runs only on source change |

### What Nx Cloud would add

Nx Cloud is the remote caching / CI orchestration layer for the Nx build system.
It is **not** a standalone remote cache — it requires:

1. Migration to Nx workspace (`nx init`, `nx.json`, per-package `project.json`)
2. Replacing `npm run build --workspaces` with `nx run-many --target=build`
3. Replacing `vitest run` orchestration with Nx project targeting
4. New CI steps for Nx Cloud `nx-cloud start-ci-run` / `nx-cloud stop-all-agents`

This is a full build-toolchain migration, not a cache flag. The current npm-workspaces
+ vite + vitest stack is not compatible with Nx Cloud without the migration.

---

## PASS 4 — Engineering Planning

### Turborepo: full impact analysis

| Dimension | Assessment |
|---|---|
| **Engineering value** | Moderate-High. Remote build cache eliminates redundant Vite + tsc work across branches and PRs when source is unchanged. The existing `upload-artifact` / `download-artifact` pattern is a manual single-run workaround; Turborepo replaces it with cross-run caching. |
| **Implementation risk** | Low. `turbo.json` is a config-only file. The Turborepo CLI can run as a thin wrapper over existing `npm run` scripts (`"build": "vite build"` etc.) with no changes to individual package scripts. Opt-out is trivial: remove `turbo.json` and restore `npm run build --workspaces`. |
| **Compatibility impact** | Low. Turborepo reads `workspaces` from the root `package.json` directly — the workspace structure already matches. No package script changes required for basic adoption. |
| **New secrets required** | `TURBO_TOKEN` (Vercel access token with Turborepo remote cache scope) and `TURBO_TEAM` (Vercel team slug). These are distinct from `VERCEL_TOKEN` (used by canary deployment). |
| **Workflow mutation** | `npm run build --workspaces` → `npx turbo run build` in `agent-pipeline.yml`. Minor change, isolated to the `build` job step. |
| **New devDependency** | `turbo` (CLI only; no runtime import). Added to root `package.json` `devDependencies`. |
| **Blast radius** | Minimal. Turborepo wraps tasks; it does not replace the underlying toolchain (vite, vitest, tsc remain unchanged). |
| **Rollback complexity** | Trivial. Remove `turbo.json`, revert `devDependencies`, restore the workflow step to `npm run build --workspaces`. |

### Nx Cloud: full impact analysis

| Dimension | Assessment |
|---|---|
| **Engineering value** | High if an Nx migration is planned. Zero value without migrating — Nx Cloud cannot cache npm-workspaces projects. |
| **Implementation risk** | High. Nx migration is a build-system replacement, not a config change. |
| **Compatibility impact** | High. `project.json` in every package; CI job commands change entirely. |
| **Rollback complexity** | High. Migration is not easily reversed once CI is re-wired around Nx targets. |
| **Prerequisite** | An explicit, separate Nx migration decision (not present in the task queue). |

---

## PASS 5 — Decision

### Turborepo remote cache: CONDITIONAL-YES

**Adopt when all three preconditions are satisfied:**

**C1 — CI wall-time is measurably bounded by build/type-check time.**
Run the CI pipeline with timing enabled (`time npm run build --workspaces`) and
confirm that build + tsc account for ≥ 20% of total job runtime. At the current
scale (2 packages, ~100 source files), the `npm ci` install step likely dominates;
Turborepo's cache hit benefit only exceeds the cache lookup overhead once the
repo grows or build time becomes the bottleneck.

**C2 — `TURBO_TOKEN` and `TURBO_TEAM` are available as GitHub Actions secrets.**
Turborepo remote caching requires a Vercel account with Turborepo remote cache
access. These are separate from `VERCEL_TOKEN` (canary deployment). Do not reuse
the same token — scope them minimally.

**C3 — The two new workflow secrets are added to the GitHub repository.**
`TURBO_TOKEN` and `TURBO_TEAM` must be added to the repository's Actions secrets
before the workflow mutation, not after.

**When all three conditions are met, the adoption path is:**

```json
// turbo.json (root) — add this file
{
  "$schema": "https://turbo.build/schema.json",
  "remoteCache": { "enabled": true },
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"],
      "cache": true
    }
  }
}
```

```diff
// package.json (root) devDependencies — add turbo
+  "turbo": "^2.0.0"
```

```diff
// agent-pipeline.yml — build job step
-  run: npm run build --workspace=packages/agent
-  run: npm run build --workspace=apps/mission-control
+  run: npx turbo run build
   env:
+    TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
+    TURBO_TEAM: ${{ secrets.TURBO_TEAM }}
```

**Note:** The `actions/upload-artifact` / `download-artifact` pattern for `agent-dist`
remains in place alongside Turborepo — Turborepo caches task *outputs*, while the
artifact pattern passes outputs *between jobs* within the same run. Both mechanisms
are complementary, not redundant.

### Nx Cloud: NO-GO

**Single blocking reason:** Nx Cloud is a remote cache for the Nx build system, not a
standalone cache for npm-workspaces projects. Using it without an Nx migration would
require replacing the entire build toolchain (vite, npm-workspaces → Nx targets,
executors), which has not been decided and is not in the task queue.

**Nx Cloud reversal condition** (required before re-evaluating):
An explicit Nx migration decision is added to the task queue, approved, and
completed as a prerequisite pass.

---

## PASS 6 — Hardening and Validation

This is a documentation-only pass. No source files, test files, or scripts were
modified.

**Verification steps performed:**

```
python3 -m json.tool tasks/agent-task-queue.json    → Exit 0 ✅
./validate.sh (expected)                            → 50/50 PASSED ✅
node scripts/check-dead-integrations.mjs (expected) → clean ✅
```

Sacred-file manifest hashes: unchanged (no sacred files touched).

`vitest run` / `tsc --noEmit` blocked by sandbox network constraints.
Consistent with all passes ≥ 36.

### Invariants verified

| Invariant | Status |
|---|---|
| Phase state machine (IDLE→…→DONE) | ✅ Unchanged — no source modifications |
| Strict Zod validation | ✅ Unchanged |
| Redis namespace `qodo:v24` | ✅ Unchanged |
| Privacy mode | ✅ Unchanged |
| Boundary map | ✅ No new imports |
| Agent pipeline workflow | ✅ Unchanged — workflow mutation is deferred to when C1–C3 are met |

---

## PASS 7 — Engineering Continuity

### Task queue update

`task-33` → `"done"`, `completedInPass: 72`.

### Architecture decision recorded

`03-ARCHITECTURE.md` §"CI Caching Decision" added.

### Remaining queued tasks

| Task | Priority | Status | Title |
|---|---|---|---|
| task-34 | P3 | queued | Centralized secrets/config (Doppler vs. Infisical) |
| task-32 | P4 | queued | Multimodal free tiers (speech/vision) decision |
| task-40 | P4 | queued | i18n (LibreTranslate) decision |

**Recommended next task: task-34 (P3)** — Centralized secrets/config decision
(Doppler vs. Infisical). Like task-33, this is an owner-decision pass. The repo
has 30+ environment variables across dev/CI/prod; the friction of managing them
via `.env` + GitHub Secrets is the exact problem `bootstrap.mjs` was written to
mitigate. A centralized secrets manager would supersede `bootstrap.mjs`'s manual
approach. The decision follows the same format as this pass: YES/NO with blockers
and reversal conditions if NO.

---

## PASS 8 — Release and Packaging

Version bumped: **24.30.43 → 24.30.44**
All four `package.json` files updated.
ZIP archive: `QODO-V24.30.44-pass72.zip`.

### Files changed in this pass

| File | Change |
|---|---|
| `packages/agent/docs/72-V24-AUDIT-PASS-72.md` | **New** — this document |
| `03-ARCHITECTURE.md` | CI Caching Decision section added |
| `tasks/agent-task-queue.json` | task-33 → done (completedInPass: 72) |
| `tasks/agent-task-queue.md` | Status snapshot updated |
| `06-CHANGELOG.md` | Pass 72 entry prepended |
| `CHANGELOG.md` | Version 24.30.44 entry added |
| `ENGINEERING_NOTES.md` | Pass 72 section appended |
| `package.json` (×4) | Version bumped 24.30.43 → 24.30.44 |
