# TFA Evolution Studio v23.0.0 — Distillation, Refinement & System Coherence Pass

V23 is a refinement pass — no new dashboards, no superficial additions. Every
change is tied to a named workstream and provably improves an identified gap in
V22's distillation depth, orchestration resilience, evidence chain quality, or
release truth. Claims are backed by the modules that implement them.

## Workstreams Delivered

### 1. Distillation Engine — `src/lib/distillation/pattern-promoter.ts`

**V22 gap**: Promoted patterns lived only in memory; a process restart erased
all accumulated knowledge. Failures were unstructured lesson strings. The
recipe-store and pattern-promoter were disconnected silos.

**V23 fixes**:
- File-backed persistence — `promoted-patterns.json` and `failure-taxonomy.json`
  survive restarts. Knowledge is durable.
- `conditions` field on every `PromotedPattern` — records the context under
  which a pattern succeeded or failed (project type, batch size, retry state,
  etc.), making future reuse evidence-backed not heuristic.
- `FailureTaxonomy` — formalises recurring failure modes with `inferredCause`,
  `count`, `recoveryHint`, and `conditions`. Replaces opaque lesson strings.
- `bridgeToRecipeStore()` — recipe-kind patterns are written into the shared
  recipe-store so the compiler pipeline and sovereign orchestrator consume them.
- `bridgeFailuresToRecipeStore()` — failure taxonomy entries flow into the
  recipe-store failure pattern index.
- `buildPrioritizationHints()` — computes per-topic confidence scores from the
  accumulated recipe/playbook counts and evidence weights.
- `retirePattern()` — marks ineffective patterns as retired; retired patterns
  are excluded from hints and recipe bridges.
- `findMatchingPatterns()` — condition-based lookup for pattern reuse.

### 2. Playbook Engine — `src/lib/distillation/playbook-engine.ts`

- `fromPromotedPattern()` — converts a playbook-kind `PromotedPattern` directly
  into an executable `Playbook`, bridging the distillation layer to execution.
- `mergePlaybooks()` — combines two playbooks for the same topic (deduplicates
  steps, merges triggers). Enables evolutionary playbook consolidation.
- Two new default playbooks: **Distillation Cycle** and **Evidence Gap Recovery**.

### 3. Sovereign Synthesis Loop — `src/lib/agents/sovereign-orchestrator.ts`

**V22 gap**: Unresolved objections were logged but not converted into actionable
requirements. The loop could only operate on a single topic at a time.
`evidenceFloor` default of 2 was permissive.

**V23 fixes**:
- `requiredEvidenceFromObjections` — each unresolved objection is converted to
  an explicit evidence requirement that the next round must satisfy. Disagreement
  is now actionable, not discarded.
- `evidenceFloor` default raised **2 → 3** for stricter convergence.
- `runSovereignBatch()` — runs the sovereign loop over a batch of topics,
  returns a per-topic result plus a cross-topic `batchSynthesis` paragraph.
  Emits a `batch_reconciled` evidence node for the whole batch.
- `selectWork()` — uses `PrioritizationHints` from the distillation layer to
  rank candidate work items by confidence score. Orchestration now chooses
  *what* to work on using proven knowledge, not arbitrary ordering.
- `makeDeterministicVoice()` helper for testing and playback.

### 4. Large-Batch Coordinator — `src/lib/batch/batch-coordinator.ts`

**V22 gap**: `defaultReconcile()` used a shallow field diff that treated any
differing value as a conflict, reported no resolution hints, and had no concept
of cross-group dependencies.

**V23 fixes**:
- `semanticReconcile()` — same-value updates are not reported as conflicts.
  Genuine conflicts carry a `ConflictResolutionHint` with a machine-readable
  recommendation derived from the field name and value types.
- `stopOnFirstGroupFailure` option — aborts remaining groups on first failed
  evidence node, preventing wasted work on a broken base.
- `BatchGroup.dependsOn` — groups can declare upstream group ids; the coordinator
  respects this ordering using topological resolution.
- `BatchSynthesisSummary` — structured result with totals, conflict count,
  `earlyAbort` flag, and all group results. Feeds cleanly into the pattern promoter.
- `shallowReconcile()` retained for backward compatibility.

### 5. Durable Execution — `src/lib/workflow/workflow-engine.ts`

**V22 gap**: `recoverInterruptedWorkflows` used a dynamic import which broke
tree-shaking. Jobs whose process crashed without an explicit interrupt call
(stuck in `"running"` state) were invisible to the recovery scanner.

**V23 fixes**:
- Static import of `durableGetInterruptedJobs` — dynamic import removed.
- `findStuckJobs()` — detects jobs stuck in `"running"` state beyond a
  configurable threshold (default: 10 min), covering process-crash scenarios.
- `markStuckJobsAsInterrupted()` — promotes stuck jobs to `"interrupted"` so
  the existing recovery scanner picks them up.
- `recoverInterruptedWorkflows()` now calls `markStuckJobsAsInterrupted()`
  before scanning, closing the crash-without-recovery gap.
- `WorkflowResult.stepTimings` — per-step wall-clock durations included in the
  result for diagnostics without requiring log parsing.

### 6. Reusable Platform Knowledge — `src/lib/control-plane/backlog-engine.ts`

**V22 gap**: Promoted patterns had no path into backlog prioritization. Recurring
failure modes were not auto-surfaced as tracked work items.

**V23 fixes**:
- `applyPromotedPatternsToPrioritization()` — reads `PrioritizationHints` and
  uplifts open backlog items whose topics match high-confidence areas (≥ 0.5
  score). Tags items whose topics appear in the failure taxonomy.
- `backlogFromTaxonomy()` — auto-generates backlog items from the top recurring
  failure taxonomy entries. Idempotent: skips already-tracked entries.

### 7. Release Truth & Coherence

- **`release-gate.ts` critical bug fixed**: Evidence status comparison used
  `"pass"` (typo) instead of `"passed"` (canonical). This caused `passedNodes`
  to always be empty and the gate to always report blockers even when all
  evidence was genuinely passing. Fixed to use `"passed"`.
- `buildGateEvidence()` added — emits a `release_gate_passed` evidence node so
  the cycle's evidence chain records the gate result as structured evidence.
- **`RELEASE_NOTES.md` metadata drift fixed**: `**Version:** 21.0.0` corrected
  to `23.0.0`; heading updated from v22.0.0 to v23.0.0.
- `V23-RELEASE-NOTES.md` added (this file).
- README heading and subtitle updated.
- Sidebar version label updated to `Studio v23.0`.

### 8. Self-Audit — `src/lib/audit/self-audit.ts`

**V22 gap**: The recurring `package-lock.json` version drift (observed in v18
and v19) was not caught by the self-audit scanner.

**V23 fix**:
- `lockfile_version_mismatch` finding kind added — checks that
  `package-lock.json` root `version` matches `package.json`. Severity: high.
- Emits a `lockfile_version_verified` evidence node (via release gate) when
  the lockfile is coherent.

## New Evidence Nodes (V23)

| Node | Source |
|------|--------|
| `pattern_promoted` | Pattern Promoter — successful promote() call |
| `failure_taxonomy_updated` | Pattern Promoter — failure taxonomy upsert |
| `prioritization_updated` | Backlog Engine — applyPromotedPatternsToPrioritization |
| `distillation_cycle_complete` | Pattern Promoter — bridgeToRecipeStore completes |
| `batch_synthesis_complete` | Sovereign Orchestrator — runSovereignBatch |
| `sovereign_batch_converged` | Sovereign Orchestrator — all batch topics synthesised |
| `release_gate_passed` | Release Gate — buildGateEvidence() on passing gate |
| `lockfile_version_verified` | Self-Audit — lockfile matches package.json |

## Verification

```
npm run self-audit           # repository self-audit (now includes lockfile check)
npm run v23-tests            # exercises all V23 workstreams
npm run coherence:check      # static coherence (release truth)
npm run smoke-test           # full V23 smoke suite
```

## Release Identity

| Field | Value |
|-------|-------|
| package.json version | 23.0.0 |
| ZIP filename | tfa-evolution-studio-v23.0.0.zip |
| ZIP root folder | tfa-evolution-studio-v23.0.0/ |
| README heading | TFA Evolution Studio v23.0.0 |
| RELEASE_NOTES heading | TFA Evolution Studio v23.0.0 |
| Sidebar label | Studio v23.0 |
| Hard release gate | self_audit_clean + workflow_replayable + synthesis_loop_converged + batch_reconciled + version_coherence_verified + zip_integrity_verified + artifact_hash_verified + manifest_version_consistent + release_gate_passed + lockfile_version_verified |

No claims outrun proof. No release if versions disagree. No single-agent shortcut.
