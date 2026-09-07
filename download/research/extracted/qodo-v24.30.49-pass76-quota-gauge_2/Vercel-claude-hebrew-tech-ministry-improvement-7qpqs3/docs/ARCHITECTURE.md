# Qodo Architecture

## Component Ownership Map

| Component | File(s) | Boundary / responsibility |
|---|---|---|
| **App shell** | `apps/mission-control/src/App.tsx` | Owns mentor-mode state; wires all callbacks; hosts inline `MentorModeToggle` |
| **NeuralCore** | `src/components/NeuralCore.tsx` | 3D dependency-graph visualisation (R3F / Three.js). Self-contained; reads `useTelemetry`. |
| **CodeStream** | `src/components/CodeStream.tsx` | Live code-diff stream. Self-contained; reads `useTelemetry`. |
| **CommandPalette** | `src/components/CommandPalette.tsx` | Mission-dispatch form (⌘K). Stateless; calls `onSubmit`. |
| **ApprovalGate** | `src/components/ApprovalGate.tsx` | Mentor-mode pre-commit modal. Shown only when `mentorMode==="mentor"`. |
| **DecisionTimeline** | `src/components/DecisionTimeline.tsx` | Chronological audit trail grouped by pipeline phase. |
| **FailureRecoveryPanel** | `src/components/FailureRecoveryPanel.tsx` | Surfaces gate/warden/drift blockers; exposes Auto-Fix. |
| **TelemetryContext** | `src/context/TelemetryContext.tsx` | Single fetch + polling provider; components read telemetry only through `useTelemetryCtx` (shared types in `src/types/telemetry.ts`). |
| **Agent CLI** | `packages/agent/src/cli.ts` | Thin mode dispatcher (default pipeline / janitor / evolve / compliance / ticket discovery / --dry-run arming). |
| **Pipeline orchestrator** | `packages/agent/src/pipeline/run-pipeline.ts` | Owns the resumable phase state machine; one handler per phase in `src/pipeline/phases/`, shared services threaded via `PhaseContext` (`src/pipeline/context.ts`). |
| **AI router** | `packages/agent/src/services/ai-router.ts` | Tiered model routing; the ten OpenAI-compatible providers are one generic `chatOpenAiCompat()` + per-provider `OpenAiCompatSpec` entries (Gemini keeps a custom adapter). |
| **Telemetry proxy** | `worker/telemetry-proxy.js` | Public surface: auth + Redis reads + GitHub dispatch + prefetch SSE. |

## Service Boundaries

The former `src/ports/` interface layer was documentation-only (zero imports
outside its own directory) and was removed — see
`docs/adr/001-delete-ports-layer.md`. The concrete service seams are:

| Concern | Production module | Injection seam |
|---|---|---|
| Checkpoint, lock, telemetry queue | `services/redis-state.ts` | `PipelineDeps.state` / `PhaseContext.state` |
| PR lifecycle, commits, checks | `services/github-client.ts` | `PipelineDeps.gh` (the e2e simulator swaps in a fake this way) |
| Artifacts, semantic cache, skills | `services/r2-storage.ts` | `PipelineDeps.storage` |

Narrow, test-driven interfaces exist where consumers need them
(`TrustStateStore`, `PhaseLogger`/`PhaseTelemetry`) rather than as a
speculative layer.

## Data Flow Map

```
GitHub Webhook / workflow_dispatch
            │
            ▼
    ┌───────────────┐
    │  GitHubClient │── creates / resumes PR
    └───────────────┘
            │
            ▼
    ┌───────────────┐
    │   Architect   │── typed Plan with prefetch list
    └───────────────┘
            │
            ▼
    ┌───────────────┐      ┌──────────────────┐
    │   Prefetch    │─────▶│  Cartographer    │── summarizes non-target files >500 lines
    │   (GitHub)    │      └──────────────────┘
    └───────────────┘
            │
            ▼
    ┌───────────────┐      ┌──────────────────┐
    │     Coder     │◀────▶│  Semantic Cache  │── local cache + hive reference
    └───────────────┘      │  Privacy Mode    │── obfuscates before LLM calls
            │              └──────────────────┘
            ▼
    ┌───────────────┐
    │  5-Gate       │── lockfile, blast, dom, shadow, chaos
    └───────────────┘
            │
            ▼
    ┌───────────────┐      ┌──────────────────┐
    │ GitDB Commit  │──▶   │   AST Doc        │── Mermaid sequence diagram
    └───────────────┘      └──────────────────┘
            │
            ▼
    ┌───────────────┐      ┌──────────────────┐
    │    Canary     │──▶   │ Vercel Edge Config 5% ──▶ promote
    └───────────────┘      └──────────────────┘
            │
            ▼
    ┌───────────────┐      ┌──────────────────┐
    │     Merge     │──▶   │  Post-merge Validation ──▶ revert on failure
    └───────────────┘      └──────────────────┘
            │
            ▼
    ┌───────────────┐
    │    Reviewer   │── final check + GitHub check run
    └───────────────┘
```

## Dark Arts Registry

| Technique | File | Purpose |
|-----------|------|---------|
| Meta-Agent mutation retry | `agents/meta-agent.ts` | Mutates system prompts on `AIContractError` |
| Semantic cache with drift detection | `services/semantic-cache.ts` | Avoids regenerating patches; rejects stale cache |
| Cross-repo Hive Mind | `services/semantic-cache.ts` | Uses external patches only as few-shot examples |
| Privacy obfuscation | `services/obfuscator.ts` | Renames local identifiers before LLM calls |
| Reverse code distillation | `services/cartographer.ts` | Summarizes large non-target files to save tokens |
| Ghost commit rollback | `services/github-client.ts` | Reverts merged commit if post-merge validation fails |
| Chaos Monkey validator | `validators/chaos-monkey.ts` | 5th gate checking null guards and step validity |
| Zero-downtime canary | `services/canary.ts` | Edge Config 5% routing with auto-rollback |
| AST auto-documentation | `services/ast-doc.ts` | Self-commits Mermaid diagrams |

## Subsystem Audit (Pass 2 — 2026-07-05)

Each entry answers: **why it exists / what breaks if deleted / duplication status**.

| Subsystem | File(s) | Why it exists | What breaks if deleted | Duplication? |
|-----------|---------|---------------|------------------------|--------------|
| Meta-Agent mutation retry | `agents/meta-agent.ts` | Recovers from `AIContractError` (schema parse failure) by rewriting the system prompt with a fresh LLM call, then retries. One rollback level kept. | AI schema violations cause hard failures instead of automatic prompt healing. Retry budget in `runWithMutationRetry` would always throw. | No — nothing else does prompt self-repair. Keep. |
| Semantic cache | `services/semantic-cache.ts` | Stores successful patches in R2 keyed by (objective, plan-hash). On cache hit, coder phase is skipped. Also caches Hive references from other repos. | Every run re-calls the LLM for code generation regardless of identical objectives. | No. `findHiveReference` (cross-repo) and `findCachedPatch` (local) are two entry points into the **same file**. Not duplication — two distinct lookup scopes. Keep both. |
| Privacy obfuscator | `services/obfuscator.ts` | Renames all local identifiers to `VAR_N` / `FN_N` before the patch is sent to the LLM, then reconstitutes after. Prevents leaking proprietary symbol names. | `QODO_PRIVACY_MODE=strict` silently leaks real symbol names to Groq/external LLMs. The `Do Not Touch` rule in §4 of this file depends on it. | No — coder.ts is the only caller. Keep. |
| Cartographer | `services/cartographer.ts` | Summarizes non-target files >500 lines to AST skeletons before injecting into coder context. Keeps prompt under token limits. | Files >500 lines outside the change set inflate context 5–10×, routinely exceeding Groq's 8k context window. | No — only called via `buildFileMap` from cli.ts. Keep. |
| Ghost Commit / Necromancer | `services/github-client.ts` (`commitViaGitDB`, `autonomousRebase`) | Writes commits directly via GitHub's Git Database API, bypassing local checkout. Detects drift before write; `resolveIncident` re-inverts after failed post-merge. | Direct git push from CI is unavailable in this stateless GitHub Actions + Cloudflare Worker environment. | `resurrectBranch` was removed in pass 1 (dead duplicate). Current code has only `commitViaGitDB` + `autonomousRebase`. No remaining duplication. Keep. |
| Chaos Monkey | `validators/chaos-monkey.ts` | 5th gate: checks null guards, step count plausibility, and file-path validity in the generated patch. Acts as a cheap static sanity check before commit. | Malformed patches (e.g. empty steps, missing null guards) bypass the final static check. The Do Not Touch list mandates it runs last. | No. Other gates are runtime validators (DOM, shadow, lockfile). Chaos Monkey is the only structural patch validator. Keep. |
| Zero-downtime canary | `services/canary.ts` | Deploys commit to Vercel preview, routes 5% of traffic via Edge Config, validates with shadow traffic, then promotes or rolls back. | Without canary, every merge goes directly to production with no traffic-weighted validation step. Only activated when `VERCEL_TOKEN` is set, so skipped in standard CI. | No. Keep. |
| AST auto-documentation | `services/ast-doc.ts` | After each successful commit, self-commits a Mermaid sequence diagram + global architecture map to `docs/auto-diagrams/`. | Documentation diverges from code silently. The astdoc phase is a required step in the phase state machine (idle→…→astdoc→canary). Removing the phase entry would break Redis resume logic. | No. Keep. |
| Darwin Engine | `agents/darwin-engine.ts` | `--evolve` mode only. Records a pre-mutation baseline metric (test pass %, lint errors), runs a prompt mutation, measures delta, reverts if regression exceeds 10% threshold. | `--evolve` mode stops working. Main `runPipeline` is unaffected (darwin-engine is not called in the standard pipeline). | No. Keep (separate execution mode). |
| Vector Skill Exchange | `services/vector-skill-exchange.ts` | After a successful gate, embeds the patch diff into Upstash Vector + stores full text in R2. `findSimilarSkills` retrieves top-k matches for future architect phases. | The architect can no longer retrieve semantically similar past patches as few-shot examples. Degrades plan quality on repeated objective types. | Hive Mind in semantic-cache.ts also stores cross-repo patches, but as exact-hash R2 blobs, not vector embeddings. Different retrieval mechanism, different use case. No duplication. Keep. |
| Semantic DAG Lock | `services/semantic-dag.ts` | Acquires concept-level locks (file-path tokens → Redis keys) so concurrent swarm agents don't race on the same conceptual area, even if the literal file paths differ. | Multi-agent swarm runs on the same repo can produce conflicting patches for the same logical domain. `acquireConceptLock` + `releaseAll` bracket the coder phase in cli.ts. | No. `waitForFileLock` (also in cli.ts) handles per-file byte-level locks; SemanticDagLock handles higher-level concept locks. Distinct scopes, not duplicates. Keep. |
| Edge Fragment Swarm | `services/edge-fragment.ts` | Splits source files >50 KB into overlapping 256-line chunks, dispatches them to `EDGE_FRAGMENT_WORKER_URL` for parallel AST parsing, then reassembles import/export/envRef summaries. | Files >50 KB are injected into context verbatim, overflowing the LLM context window. Falls back gracefully if `EDGE_FRAGMENT_WORKER_URL` is unset (content injected directly). | No. Cartographer summarizes non-target files; edge-fragment handles oversized **target** files. Different input sets. Keep. |
| Incident Resolver | `services/incident-resolver.ts` | Called from post-merge phase when dom/shadow validators fail. Opens a revert PR via `commitViaGitDB` with the pre-merge SHA, posts a GitHub comment, and fires a check-run failure. | Post-merge regressions require manual revert. The auto-revert chain (`resolveIncident` → comment → checkRun) breaks. | No — this is the only place a post-merge revert PR is created. Keep. |
| SRE Feedback Loop | `services/sre-feedback.ts` | After post-merge validation, polls a configurable metrics endpoint (p95 latency, error rate) and fires Darwin Engine if metrics degrade. Provides a runtime signal beyond synthetic shadow traffic. | SRE metrics never feed back into prompt evolution. Skipped in test env (`VITEST`/`NODE_ENV=test` guard present). | No. Shadow traffic (`validators/shadow-traffic.ts`) replays requests against the canary; SRE feedback reads production metrics after merge. Different stages, different signals. Keep. |
| Style Aligner | `agents/style-aligner.ts` | Fetches `.eslintrc*` and `tsconfig.json` from the PR head ref and injects extracted rules into the coder's system prompt so generated code matches repo conventions. | Coder ignores repo lint/type settings; generated patches accumulate lint violations that block CI. | No. Keep. |
| UI Synthesizer | `agents/ui-synthesizer.ts` | After coder generates backend patch, extracts new API endpoints from the diff and auto-generates matching React component stubs, committed to the PR. | New endpoints get no corresponding UI scaffolding. The synthesizer is additive (commits new files only); deleting it drops one feature without breaking the pipeline. | No. Keep. |
| Infra Oracle | `agents/infra-oracle.ts` | Scans the patch for new env-var references (`process.env.*`). For each new var, generates a `.env.example` entry and a k8s/Vercel environment config patch. | New env vars are silently undocumented and unprovisioned in infrastructure config. | No. Keep. |
| Janitor | `agents/janitor.ts` | `--janitor-mode` only. Scans all repo files for dead exports, TODO comments, and oversized functions; opens a PR per finding. Not called in `runPipeline`. | `--janitor-mode` stops working. Main pipeline unaffected. | No. Keep (separate mode). |
| Compliance Oracle | `agents/compliance-oracle.ts` | `--compliance-mode` only. Checks each file against a set of SPDX/license, secret-pattern, and dependency-version rules; opens PRs for violations. | `--compliance-mode` stops working. Main pipeline unaffected. | No. Keep (separate mode). |
| Warden | `agents/warden.ts` | AST-based post-generation gate: blocks `console.log`, `any` types, and bare `await` outside try/catch in generated code. Lessons from past violations fed back into coder prompt via `loadWardenLessons`. | Generated code can introduce logging leaks and unhandled promise rejections that pass all five runtime gates. | No — warden is the only static AST linter applied to generated patches. Chaos Monkey checks patch structure; Warden checks code quality. Keep. |
| Telemetry | `services/telemetry.ts` | Appends structured decision events to `telemetry:events` Redis list (via `lpush`/`ltrim`). Mission Control polls this list via `worker/telemetry-proxy.js` `/telemetry`. | Live run dashboard goes dark. All `telemetry?.decision(...)` calls degrade gracefully (optional chaining), so pipeline continues without it. | No. Keep. |
| R2 Storage | `services/r2-storage.ts` | Wraps Cloudflare R2 REST API. Used by semantic-cache, vector-skill-exchange, cartographer (AST cache), and patch archiving. | Patch archive, skill vector backing store, and AST summary cache all fail. Falls back gracefully when R2 env vars are absent. | No. Keep. |
| Rate Limiter | `utils/rate-limiter.ts` | `throttledBatch` processes file arrays in concurrency-limited batches with per-request delay. Used for GitHub API calls (getFileAtRef × N files). | GitHub API rate-limit errors at 5000 req/hr for large PRs touching many files. | No. Keep. |
| Env Schema | `utils/env-schema.ts` | `validateEnv()` checks all required env vars at startup and throws with a clear message listing missing vars. | Silent failures deep in pipeline when env vars are absent (e.g. `acquireLock` proceeds lock-free, GitHub calls throw 401). | No. Keep. |
| Schema Validator | `utils/schema-validator.ts` | `parseWithRetry` wraps every LLM call: validates JSON output against a Zod schema, retries up to N times on parse failure, throws `AIContractError` on exhaustion. | LLM JSON schema violations crash the pipeline instead of being handled by meta-agent mutation retry. The `Do Not Touch` list item 1 (`.strict()`) depends on this. | No. Keep. |

### Test Execution Path (three-layer fallback — intentional, not duplicated)

The gate phase in `cli.ts` runs tests via a three-layer fallback chain. This was flagged in CHANGES.md as needing clarification. After reading all three implementations:

```
cli.ts gate phase:
  1. EdgeTestClient (edge-test-channel.ts)  — WebRTC DataChannel over Redis signaling
       └─ if WebRTC unavailable or no peer answers within 8s → null
  2. tryOffloadToClient (edge-test-offload.ts)  — Redis Pub/Sub + polling queue
       └─ if Redis unconfigured or no result within 90s → null
  3. runLocalNpmTest (edge-test-offload.ts)  — spawn("npm test") locally
       └─ always available; skipped in VITEST env to avoid recursion
```

**Why this chain is intentional:** Each layer requires progressively less infrastructure.
Layer 1 needs both Redis AND a live Mission Control browser peer with WebRTC.
Layer 2 needs Redis but no browser peer (any compute worker polling the queue suffices).
Layer 3 needs nothing — it runs on the agent host itself.

**Decision:** Keep all three layers. The chain is not duplication — it is graceful
degradation across deployment environments (full cloud stack → Redis-only → bare CI).
The fallback order is correct: most isolated first (WebRTC peer, zero agent-CPU cost),
most expensive last (local subprocess on the agent host).

**Action taken:** Behaviour unchanged. This section of ARCHITECTURE.md now documents
the intent explicitly so future contributors do not mistake the fallback chain for
accidental duplication.

**Correction (Pass 4 — 2026-07-07): Layer 1 is currently unreachable in the standard
deployment target, not merely peer-dependent.** The wording above ("needs... a live
peer") reads as if Layer 1 activates whenever a Mission Control browser tab happens to
be open. That is not the current behavior. `EdgeTestClient` (the CLI/runner side) is
the party that must originate the WebRTC offer via `createOffer()`, and
`createRTCPeerConnection()` in `services/edge-test-channel.ts` returns `null` before an
offer is ever attempted, because plain Node.js (including the GitHub Actions runner
this pipeline targets) has no native `RTCPeerConnection`, and no WebRTC binding
(e.g. `@roamhq/wrtc`, `werift`) is declared in any `package.json` in this repo. The
function already handles this correctly — it fails closed and falls through to Layer 2
with a `webrtc-unavailable` telemetry event, at negligible cost — so there is no bug to
fix. The gap is documentation, not code: until a real Node WebRTC dependency is added,
Layer 1 is best described as **browser-side / aspirational**, not a third tier that
"activates less often." Layer 2 (Redis Pub/Sub polling) is the actual best case in
every deployment that has shipped so far.

## Infrastructure Cost Tiers (Pass 4 — 2026-07-07)

Pass 3 flagged that the subsystems documented above have accumulated real
infrastructure cost and secret-exposure surface across ten-plus versions, with no
single place stating which parts are load-bearing versus optional. This table is
that place — it is a documentation addition only, no code or defaults changed.

| Tier | Requires | Subsystems that need it | If absent |
|------|----------|--------------------------|-----------|
| 0 — Minimum viable | `GITHUB_TOKEN`, `GROQ_API_KEY` only | Core pipeline: architect → coder → gate (Layer 3 local `npm test`) → commit → merge | Everything in Tiers 1–2 is skipped or falls back automatically; no crash. |
| 1 — Redis (Upstash) | `UPSTASH_REDIS_REST_URL`(S) + token | Locking (`redis-state.ts`), flaky-test index, Semantic DAG Lock, Layer 2 test offload, Slack/QStash config lookups, telemetry list | Falls back to unlocked/no-index/local-only behavior per subsystem; already required by `env-schema.ts` today, so in practice this is the real Tier 0 for any concurrent run. |
| 2 — Object storage (R2/S3-compatible) | R2 credentials | Semantic cache, Vector Skill Exchange, Cartographer AST cache, patch archiving | Falls back to local disk (`/tmp/qodo-fallback`) on the ephemeral CI runner — cross-run learning features silently stop persisting between runs (see Pass 3 finding on `isDegraded()`, now surfaced via PR comment + telemetry). |
| 3 — Optional paid add-ons | `VERCEL_TOKEN`, Cloudflare Workers, QStash | Zero-downtime canary, Edge Fragment Swarm worker, QStash-offloaded SRE feedback | Each is independently gated and no-ops cleanly when unset — confirmed in Pass 19 and Pass 3 reviews. |

**Not yet a real tier:** the WebRTC P2P test channel (Layer 1 of the gate-phase test
fallback) is not listed above because it cannot be enabled by configuration alone —
see the Layer 1 correction note above. Adding it would require a code change (a
Node WebRTC dependency), not just an env var, so it stays out of this cost table
until that dependency decision is made.

This table answers "works with just GitHub Actions + one LLM key" (Tier 0, with the
caveat that Tier 1 is a practical requirement for concurrent runs) vs. "requires paid
infra" (Tiers 2–3) so the next pass can pick a tier on purpose.

## Infrastructure Tier Decision (Pass 42 — 2026-07-07)

This section records the explicit keep/cut decision for every infrastructure
tier and add-on called out in task-3. The decision is documentation only; no
code paths or defaults were changed, because each subsystem already degrades
cleanly when its credentials are absent.

### Context

The cost-tier table above left Redis in an ambiguous "practical requirement"
state and treated R2, Vercel canary, the Cloudflare Worker, and QStash as
undifferentiated optional paid add-ons. Before more passes add further
integrations, the project needs an authoritative statement of which tiers are
load-bearing, which are valuable but optional, and whether any should be removed
to reduce operational surface area.

Key constraints:

- The core agent pipeline must remain runnable with only `GITHUB_TOKEN` and an
  LLM key (Tier 0).
- Concurrent swarm runs and cross-run learning are explicit product goals, but
  they may degrade gracefully rather than crash when their backing services are
  unavailable.
- Removing a subsystem that already no-ops cleanly does not reduce runtime
  complexity; it only removes future optionality.

### Decision

| Tier / Component | Verdict | Rationale |
|---|---|---|
| **Redis (Upstash)** | **KEEP — promote to formal required Tier 1** | Locking, flaky-test index, Layer 2 test offload, telemetry queue, and Semantic DAG Lock all assume Redis in any concurrent or resumable deployment. `env-schema.ts` already requires it. The only honest classification is "required for production." |
| **R2 / S3-compatible object storage** | **KEEP — optional Tier 2, recommended** | Semantic cache, Vector Skill Exchange, Cartographer AST cache, and patch archiving all benefit from cross-run persistence. The existing `/tmp/qodo-fallback` graceful degradation is acceptable for single-run CI but not for a learning agent. Keep, document, and recommend for production. |
| **Vercel canary** | **KEEP — optional Tier 3** | Zero-downtime promotion via Edge Config is valuable only when `VERCEL_TOKEN` is configured. It no-ops cleanly otherwise. No reason to cut a feature that costs nothing when idle. |
| **Cloudflare Worker** | **KEEP — optional Tier 3** | The telemetry proxy provides a public-facing dispatch surface. It is not required for the core pipeline, which can call GitHub/Redis directly. Keep because it is the documented production telemetry surface in `worker/`. |
| **QStash** | **KEEP — optional Tier 3** | Offloads the 10-minute SRE feedback warmup sleep. The inline synchronous fallback in `cli.ts` preserves correctness when QStash is absent. Cutting it would remove a scaling option without simplifying the code path. |

### Alternatives considered

- **Cut R2 and use local disk only.** Rejected. Local disk on an ephemeral CI
  runner cannot support cross-run learning, which is a stated design goal of the
  Vector Skill Exchange and semantic cache. The fallback is a safety net, not a
  production strategy.
- **Cut the Cloudflare Worker and route all telemetry through the agent.**
  Rejected. The Worker provides a controlled public surface with a single shared
  secret (`QODO_DISPATCH_SECRET`). Moving that surface into the agent would
  either expose GitHub tokens more broadly or require re-implementing the same
  proxy inside the agent CLI.
- **Cut Vercel canary to reduce vendor surface.** Rejected. The canary code path
  is already fully gated on `VERCEL_TOKEN`; it adds no operational burden when
  absent and is the only zero-downtime deployment mechanism in the pipeline.
- **Promote R2 to required Tier 1.** Rejected. A single-run agent that re-calls
  the LLM each time is still a valid minimum viable deployment. Requiring R2
  would raise the onboarding floor above the documented "GitHub + one LLM key"
  baseline.

### Consequences

- The next deployment target is **Tier 1 (Redis) as the production floor**.
  Single-node, non-concurrent demos may still run without Redis, but production
  and swarm configurations must provision it.
- **No subsystems are removed.** Every Tier 2 and Tier 3 component retains its
  existing no-op fallback, so this decision is backwards-compatible with all
  current `.env.example` configurations.
- Future integration passes must now classify new services against these three
  tiers: required (Tier 1), recommended-optional (Tier 2), or optional paid
  add-on (Tier 3). This prevents the previous "all optional" ambiguity from
  recurring.

| **A3** | Fireworks AI | `accounts/fireworks/models/llama-v3p1-8b-instruct` | Fast draft | `FIREWORKS_API_KEY` | Pass 71 |
| **A3** | DeepInfra | `meta-llama/Meta-Llama-3.1-8B-Instruct` | Fast draft | `DEEPINFRA_API_KEY` | Pass 71 |
| **A3** | Novita AI | `meta-llama/llama-3.1-8b-instruct` | Fast draft | `NOVITA_API_KEY` | Pass 71 |
| **A3** | CF Workers AI REST | `@cf/meta/llama-3.1-8b-instruct` | Fast draft | `CF_ACCOUNT_ID` + `CF_AI_API_TOKEN` | Pass 71 |

## CI Caching Decision (Pass 72 — 2026-07-07)

**Task:** task-33 from `tasks/agent-task-queue.json`

| Service | Decision | Rationale |
|---|---|---|
| **Turborepo remote cache (via Vercel)** | **CONDITIONAL-YES** | Three preconditions must be met before workflow mutation: (C1) CI wall-time measurably bounded by build/tsc (≥20% of job runtime); (C2) `TURBO_TOKEN` + `TURBO_TEAM` available as scoped Vercel secrets distinct from `VERCEL_TOKEN`; (C3) secrets added to GitHub repository Actions secrets prior to workflow edit. Config spec documented in `packages/agent/docs/72-V24-AUDIT-PASS-72.md` PASS 5. |
| **Nx Cloud** | **NO-GO** | Requires a full Nx build-system migration (nx.json, project.json per package, Nx executors) before Nx Cloud provides any caching benefit. No such migration is planned. |

**Turborepo adoption conditions** (all three required simultaneously):

1. **C1 — Build/tsc runtime is the CI bottleneck.** Measure with `time npm run build --workspaces`; adopt when build + tsc account for ≥ 20% of total job runtime.
2. **C2 — Dedicated `TURBO_TOKEN` + `TURBO_TEAM` secrets are available.** Scoped separately from `VERCEL_TOKEN` (canary). The remote cache endpoint is `https://vercel.com/api/remote-cache` — requires a Vercel account with Turborepo remote cache access enabled.
3. **C3 — Secrets added to GitHub Actions before workflow mutation.** Add `TURBO_TOKEN` and `TURBO_TEAM` to the repository's Actions secrets before editing `agent-pipeline.yml`.

**Nx Cloud reversal condition** (required before re-evaluating):
An explicit Nx migration decision is added to the task queue, approved, and completed as a prerequisite pass.

**Note on the existing `upload-artifact` / `download-artifact` pattern:**
The current approach (build job uploads `agent-dist`; downstream jobs download it) is a
within-run artifact share. Turborepo remote caching is a cross-run build output cache.
Both are complementary — Turborepo does not replace the artifact-passing pattern.

## Visual QA Integration Decision (Pass 70 — 2026-07-07)

**Task:** task-38 from `tasks/agent-task-queue.json`

| Service | Decision | Rationale |
|---|---|---|
| **BrowserStack Automate** | **NO-GO** | Three independent blockers: (B1) 100 min/month free tier is exhausted by ~2 days of CI use; (B2) pipeline has no rendering phase to serve a URL to a remote browser; (B3) no cross-browser compatibility requirement exists in 01-REQUIREMENTS.md. All three must be resolved before revisiting. |
| **Percy (screenshot diffing)** | **NO-GO now; CONDITIONAL-YES when rendering available** | Single blocker: dom-xray.ts operates on DOM AST diffs, not rendered screenshots — Percy receives zero snapshots per run until a rendering phase exists. Percy itself is low-friction (5,000 snapshots/month free, no session management). It becomes the **preferred** visual-diff tool (over BrowserStack Visual) once the pipeline gains a render-and-snapshot step. |

**BrowserStack reversal conditions** (all three required simultaneously):
1. A cross-browser compatibility requirement is documented in `01-REQUIREMENTS.md`.
2. The pipeline gains a rendering phase providing a live URL for remote browsers.
3. A paid BrowserStack plan (or self-hosted equivalent) is available.

**Percy reversal conditions** (either sufficient):
1. The pipeline gains a `render-and-snapshot` phase (e.g. dom-xray canary sub-step
   captures before/after HTML via a local Playwright instance), OR
2. dom-xray.ts is extended to produce rendered HTML output Percy can ingest directly.

## Secrets Management Decision (Pass 73 — 2026-07-07)

**Task:** task-34 from `tasks/agent-task-queue.json`

| Candidate | Decision | Primary rationale |
|---|---|---|
| **Doppler** | **NO-GO** | Three independent blockers: (B1) all pipeline secrets would transit Doppler's servers, expanding the attack surface of the `QODO_PRIVACY_MODE=strict` path; (B2) free Developer plan covers 1 user / 1 project only — no team use; (B3) `bootstrap.mjs` already solves the primary stated friction (env var management across dev + CI). All three must be resolved simultaneously before revisiting. |
| **Infisical (cloud)** | **NO-GO** | B1 same as Doppler: SaaS secrets transit. Additional reversal conditions identical to Doppler B1 and B3. |
| **Infisical (self-hosted)** | **NO-GO** | Self-hosting requires a dedicated always-on secrets-management service (PostgreSQL + Redis + TLS) not present in any infrastructure tier. Contradicts the minimal-infra posture established in Pass 42. Reversal condition: explicit Infisical self-host task added to queue, approved, provisioned, and placed in infrastructure tier table. |
| **Status quo: `bootstrap.mjs` + GitHub Secrets + `.env`** | **KEEP** | Covers both environments, vendor-free, zero additional cost, preserves privacy and security posture. Two targeted improvements identified for a future code pass (see below). |

**Doppler reversal conditions** (all three required simultaneously):
1. A team-size deployment is planned requiring independent secrets management per contributor (invalidates B2).
2. A formal risk assessment approves the Doppler SaaS trust boundary for the `PRIVACY_MODE=strict` secret transit path (invalidates B1).
3. `bootstrap.mjs` is identified as a persistent friction point not addressable by local improvement (invalidates B3).

**Future code-pass improvements to `bootstrap.mjs`** (not implemented here — documentation only):
- `--verify` flag: non-destructive audit of existing `.env` / GitHub Secrets, reporting present/absent keys without re-running the full wizard.
- Grouped summary output: after collecting all credentials, print a structured ✓/✗ table (Required, LLM providers, Optional infra) before writing `.env`, surfacing misconfiguration at setup time.

Both improvements are locally tractable (no network required, no new dependencies) and should be queued as task-47 or equivalent.

## Do Not Touch List

1. **Strict schemas in `schemas/*.ts`** — Every output from an LLM must pass `.strict()` Zod validation. Removing `.strict()` silently allows hallucinated keys.
2. **`validators/chaos-monkey.ts` gate order** — It runs after lockfile, blast, dom, and shadow. Do not reorder; it is the final safety gate before commit.
3. **`services/obfuscator.ts` check order** — `hasUnmappedTokens` must run **after** `reconstitutePatch`. Checking before leaks VAR_N tokens into production code.
4. **`services/semantic-cache.ts` privacy rule** — If `QODO_PRIVACY_MODE=strict`, `getHiveShareMode()` must return `"off"`. Sharing while obfuscating is undefined behavior.
5. **`services/cartographer.ts` target file exclusion** — Target files from `plan.steps[].files` must never be summarized. Summaries on target files cause hallucinated line numbers.
6. **Worker auth** — `worker/telemetry-proxy.js` (the single Worker; see CHANGES.md) must validate a signed, short-lived session token (HMAC'd with `env.QODO_DISPATCH_SECRET`, issued via `POST /session/issue`) against `env.QODO_DISPATCH_SECRET`, rather than comparing the raw secret directly on every request (Pass 43 T1 — the raw secret is now only ever compared inside `/session/issue`). Reading from `ENV` breaks Cloudflare Workers deployments.
7. **`env-schema.ts` required list** — `GITHUB_TOKEN`, `GROQ_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `REPO`, `OBJECTIVE` are non-negotiable at startup.
8. **Phase state machine in `cli.ts`** — Phases must remain linear: idle → architect → coder → gate → commit → astdoc → canary → merge → postmerge → review → done. Skipping phases breaks Redis resume logic.

## Environment Contract

| Variable | Required | Notes |
|----------|----------|-------|
| `GITHUB_TOKEN` | yes | `repo`, `contents`, `pull-requests`, `checks` |
| `GROQ_API_KEY` | yes | Primary LLM |
| `UPSTASH_REDIS_REST_URL` | yes | Checkpoint + locks |
| `UPSTASH_REDIS_REST_TOKEN` | yes | Write-capable |
| `OBJECTIVE` | yes | Mission description |
| `REPO` | yes | `owner/repo` |
| `QODO_PRIVACY_MODE` | no | `"strict"` disables hive sharing |
| `QODO_HIVE_SHARE` | no | `"off"` / `"public"` / `"org-private"` |
| `VERCEL_TOKEN` | no | Required for canary |
| `VERCEL_EDGE_CONFIG_ID` | no | Required for canary traffic split |
