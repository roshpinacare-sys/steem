# TFA Evolution Studio v32.0.0

**Final Production Release Candidate — Cross-ZIP Audited, Security-Hardened, Capability-Preserved, Soak-Validated**

TFA Evolution Studio is a self-contained platform that takes a project ZIP +
an engineering prompt and autonomously plans, executes, validates, and packages
a new software release — with full evidence, audit trail, and connected
integrations across the engineering lifecycle.

V30 brings the platform to production maturity. Where V29 added evidence-backed
intelligence, V30 validates that intelligence under sustained load through soak
testing, enforces architectural fitness continuously, upgrades multi-agent debate
to a 7-stage evidence-mandated protocol, builds a persistent engineering memory
graph, introduces platform runtime profiles, implements a full compiler intelligence
pipeline, and completes the self-evaluation loop with autonomous multi-pass critique.
Eight workstreams executed by a Global Systems Council.

---

## Quick Start

```bash
npm install
cp .env.example .env.local      # optional — only needed for LLM providers
npm run dev
open http://localhost:3000
```

Validate the platform:

```bash
npm run smoke-test               # full end-to-end smoke test
npm run coherence:check          # static coherence audit only (no server)
npm run self-audit               # repository self-audit (stale refs, broken imports)
npm run v32-tests                # final v32.0.0 certification suite (cross-zip audit + security + regression + soak + architecture + release-truth)
 npm run v31-tests                # v31.1.0 certification regression (preserved)
 npm run v30-tests                # v30 workstream regression (preserved)
npm run v29-tests                # exercises v29 workstream implementations (historical)
npm run v28-tests                # exercises v28 workstream implementations (historical)
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Only if OpenAI provider active | — | OpenAI API key |
| `ANTHROPIC_API_KEY` | Only if Anthropic provider active | — | Anthropic API key |
| `TFA_WORKSPACE_ROOT` | No | `/tmp/tfa-studio-data` | Workspace data directory |
| `RUN_REAL_BUILDS` | No | `true` | Set `false` to skip npm install/build/test |

---

## Platform Workflow

```
Upload ZIP  →  Upload Prompt  →  Run Cycle  →  Verified Release ZIP
     ↓               ↓               ↓                  ↓
  project         engineering    autonomous          versioned
  source          directives     mutation +          artifact +
  code                           validation          evidence chain
```

---

## V30 Architecture

### WS1 — Soak Testing Framework

New module: `src/lib/soak/soak-harness.ts`

8 deterministic soak scenarios: `endurance_cycle`, `restart_recovery`,
`replay_verification`, `timeout_pressure`, `provider_instability`,
`corrupted_zip_flood`, `large_project_soak`, `parallel_projects`.
P50/P95/P99 latency + recovery rate per scenario. Overall verdict:
`production_ready` · `needs_hardening` · `critical_failures`.

### WS2 — Architectural Fitness Functions

New module: `src/lib/fitness/fitness-functions.ts`

Continuous 5-dimension health gate: coupling, complexity, cycle freedom, debt
burden, function size. Composite 0–100 score (grade A–F). Blockers on score <60
or high-severity cycles. `runFitnessSuite(ir)` runs all dimensions in one call.

### WS3 — Multi-Agent Debate V2

`sovereign-orchestrator.ts` upgraded with 7-stage structured debate protocol:
Proposal → Critique → Counter-Proposal → Evidence → Consensus → Verification →
Distillation. Evidence-backed consensus required (≥50% quorum with evidence nodes).
`runDebateV2()` exported. All v29 loop contracts intact.

### WS4 — Engineering Memory Graph

New module: `src/lib/memory/memory-graph.ts`

File-backed knowledge graph: 8 node kinds, 7 edge kinds. `ingestCycleOutcome()`
auto-creates nodes/edges from outcomes. `findBestRecovery()` keyword-matches failure
descriptions. Confidence raises with each observation. Survives restarts.

### WS5 — Platform Runtime Profiles

New module: `src/lib/compiler/runtime-profiles.ts`

7 platform adapters: `wordpress`, `shopify`, `nextjs`, `static`, `node_service`,
`microservice`, `plugin_ecosystem`. Each implements `detect()`, `generateManifest()`,
`generateLayout()`, `validateArtifact()`. `detectRuntimeProfile(ir)` returns
sorted-by-confidence matches.

### WS6 — Software Compiler Intelligence

New module: `src/lib/compiler/compiler-intelligence.ts`

8-stage compiler pipeline: Lexical Scan → Parse → Architecture Graph → Dependency
Graph → Impact Analysis → Execution Plan → Evidence Synthesis → Release Artifact.
Each stage emits typed evidence. Release gated at Evidence Synthesis. No silent
completions.

### WS7 — Technical Debt Elimination & Release Truth

All version markers at 30.0.0. `v30-tests` script added. 10 new EvidenceNodeKind
entries in `types.ts`. Stale inline comments purged. `PLATFORM_VERSION` runtime-derived.

### WS8 — Self-Critique Engine

New module: `src/lib/self-critique/self-critique.ts`

7-dimension autonomous platform review: naming, boundaries, modularity,
maintainability, evidence, recovery, distillation. Converges at score ≥80 with
zero critical findings (max 3 passes). `SelfCritiqueReport` includes grade (A–F),
per-dimension scores, and actionable recommendations.

---

## Evolution Engine Phases (inherited from v28, unchanged)

| Phase | Function | Responsibility |
|-------|----------|----------------|
| 1 | `prepareEvolutionCycle` | Allocate runId, isolate workspace |
| 2 | `validateEvolutionInputs` | Assert projectId + prompt constraints |
| 3 | `loadProjectContext` | Scan project, detect adapter |
| 4 | `analyzeProjectState` | Architecture, drift, tech-debt |
| 5 | `planEvolutionSteps` | Derive ordered mutation plan |
| 6 | `executeEvolutionPlan` | Run steps with cancellation checks |
| 7 | `verifyEvolutionResults` | Assert build passes, evidence present |
| 8 | `emitEvolutionEvidence` | Stamp all evidence, record rationale |
| 9 | `persistEvolutionState` | Write state, outcomes, lessons |
| 10 | `finalizeEvolutionCycle` | Close chain, emit completion event |

---

## Version History

| Version | Theme | Date |
|---------|-------|------|
| v32.0.0 | Final Production Release Candidate — Cross-ZIP audited, security-hardened, capability-preserved (9 certification gates) | 2026-06-25 | ← **current**
| v31.1.0 | Production Certification Release (6 certification workstreams) | 2026-06-25 |
| v30.0.0 | Production Readiness & Autonomous Intelligence Maturity (8 workstreams) | 2026-06-25 |
| v29.0.0 | Deep Intelligence Release (9 workstreams) | 2026-06-25 |
| v28.0.0 | Engineering Maturity & Deep Refinement (9 workstreams) | 2026-06-25 |
| v25.0.0 | Engineering Excellence Pass (8 defects eliminated) | 2026-06-25 |
| v24.0.0 | Hardening Pass (6 correctness defects) | 2026-06-24 |
| v23.0.0 | Distillation & Batch Synthesis | 2026-06-23 |
| v22.0.0 | Durable Execution & Chaos Foundations | 2026-06-22 |
| v21.0.0 | Plugin Contract & Sandbox Isolation | 2026-06-21 |
| v20.0.0 | Compiler & Job Engine | 2026-06-20 |
