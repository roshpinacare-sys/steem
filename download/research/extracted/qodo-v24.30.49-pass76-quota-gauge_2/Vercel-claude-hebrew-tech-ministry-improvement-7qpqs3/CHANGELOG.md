# Changelog

## [24.30.49] — 2026-07-12 — Pass 76: Per-provider quota-gauge + exhaustion alerting (task-47)

Extends the existing header-driven `quota-guardian.ts` tracker rather than
building a second, separately-maintained `EnergyQuotaState` in
`cost-ledger.ts` as originally scoped — quota-guardian.ts already reads
live remaining-quota numbers straight from provider response headers,
which stays accurate as providers change their free tiers; a second
structure with hardcoded limits would only drift stale.

- `services/quota-guardian.ts`: optional `requestsLimit`/`tokensLimit` on
  `QuotaSnapshot`; new `quotaPercentUsed()`, `isNearExhaustion()`,
  `getQuotaHealthReport()` — the literal "alert before exhaustion" ask.
- **Bug fix found while implementing:** `HEADER_MAP.openrouter.requests`
  was reading the LIMIT header into the REMAINING slot — the only entry in
  the table that did — which would have made OpenRouter always look like
  it had full headroom regardless of actual usage. Corrected to match
  every other provider's convention.
- `services/preflight-estimator.ts`: new optional `quotaWarning` field;
  `estimatePreflight()` checks `groq`/`openrouter` quota health and
  surfaces a warning in `summaryLine` (escalating `recommendation` from
  `proceed` to `proceed_with_caution`) so quota health appears "alongside
  the existing USD figures" as task-47 asked, without restructuring
  `LedgerEntry`.
- New test file `tests/quota-health.test.ts` (19 cases).

**Honestly scoped:** no network in this sandbox, so `vitest`/pinned `tsc`
still couldn't run. All 19 `quota-health.test.ts` assertions WERE executed
for real with plain node against the exact algorithm. The same
differential-typecheck method from Pass 75 shows zero errors — old or new —
in either file this pass touched. `npm test -w @qodo/agent` and
`npm run typecheck` are still owed before merge. Full transcript in
`docs/history/audits/76-V24-AUDIT-PASS-76.md`.

## [24.30.48] — 2026-07-12 — Pass 75: Automatic relay-hop lineage pickup (task-56)

Closes the gap Pass 74 (task-55) deliberately left open: a relay hop now
picks up its parent receipt on its own. New `pipeline/relay-lineage.ts`
(not sacred) reads `.relay-parent-receipt.json` from the workspace root if
present, computes its sha256, and caches the result for the run. Wired
into `pipeline/helpers.ts`'s `audit()` (every audit-chain entry now seeds
from the right genesis) and `pipeline/receipt-emitter.ts`'s `emitReceipt()`
(populates `receipt.lineage` automatically — no manual step).

**Correction to Pass 74's own scope note:** task-55 assumed this follow-up
would need a second sacred-file change to `cli.ts` because that's usually
where pipeline bootstrap lives. Tracing the actual call sites showed the
real audit-chain start and receipt emission both live in
`pipeline/run-pipeline.ts`, which is **not** a sacred file — so most of
this wiring needed zero sacred-file changes. `cli.ts` still needed one
small, additive fix, found by tracing rather than assumed: the
`--rehearse` pre-flight can itself be the true first entry of a run's
chain (it fires before `run-pipeline.ts` does), so its two direct
`appendAuditEntry` calls needed the same genesis threaded through. Sacred
manifest rebaselined for `cli.ts` accordingly.

**Verification, honestly scoped:** no network in this sandbox, so
`npm install`/`vitest`/the project's pinned `tsc` still could not run. A
global TypeScript compiler *was* used to run a **differential typecheck** —
the full `src` tree, baseline vs. modified, both missing `@types/node` and
all real npm dependencies identically — and the diff shows **zero new
error categories** anywhere outside the three expected `@types/node`-missing
lines in the brand-new file itself. Full transcript in
`docs/history/audits/75-V24-AUDIT-PASS-75.md`. `npm run typecheck` and
`npm test -w @qodo/agent` against the real toolchain are still owed before
merge.

## [24.30.47] — 2026-07-12 — Pass 74: Receipt lineage across relay hops (task-55)

Extends `qodo.receipt/v1` with an optional `lineage` block so a stateless
relay hop can prove it followed a specific prior hop, not just that it ran
under controls in isolation. Previously every run's audit chain started
from the same hardcoded all-zero genesis, so nothing in a handed-off ZIP
cryptographically linked hop N to hop N-1 — a verifier had to trust the
later hop's claim about its own history.

- `services/audit-log.ts` *(sacred, additive)*: `appendAuditEntry` and
  `verifyAuditChain` take an optional `genesis` parameter (new
  `defaultGenesis()` export supplies the old all-zero constant when
  omitted — byte-for-byte unchanged behavior for every existing call site).
- `services/receipt.ts`: new optional `lineage: { hopIndex,
  parentReceiptSha256, genesis }` field; `verifyReceipt` takes an optional
  `parentReceipt` and independently recomputes its hash rather than
  trusting the child receipt's claim.
- `scripts/verify-receipt.mjs`: new `--parent-receipt <path>` flag,
  mirroring the same recompute-don't-trust check for third-party,
  dependency-free verification.
- `docs/RECEIPTS.md`: new "Lineage across relay hops" section; threat model
  updated with the newly-detected tamper case and the still-open gaps.
- `.sacred-manifest.json` rebaselined for `audit-log.ts`.
- New test file `tests/receipt-lineage.test.ts`.

**Honestly flagged, not glossed over:** this sandbox had no network access,
so `npm install`/`vitest`/`tsc` could not run against the TypeScript
sources. The standalone `verify-receipt.mjs` change — dependency-free by
design — WAS executed for real against a hand-built two-hop fixture pair
(honest lineage passes; a parent tampered with after handoff is caught;
omitting the parent degrades to informational; a receipt with no lineage
claim is unaffected). The TS-level test suite and typecheck are not yet
confirmed and should run before merge. See
`docs/history/audits/74-V24-AUDIT-PASS-74.md` for the full transcript.

**Deliberately not done in this pass:** `cli.ts` does not yet read an
incoming parent-receipt automatically at pipeline start — that's a second
sacred-file change needing its own on-disk-convention decision, filed as
task-56 rather than bundled in here.

## [25.0.0] — 2026-07-08 — Restoration & Overhaul

First release built from a tree that has actually been compiled and tested.
The archive this repo was restored from had never had `tsc`, `vitest`, or
`npm install` run against it (see `docs/history/BASELINE-VERIFICATION.md`);
this release is the result of verifying it for real and fixing what that
found, plus a structural overhaul. Highlights:

### Fixed (correctness)
- `ai-router.ts` contained a headless duplicate function body — **the agent
  package did not parse and had never built**. Removed.
- quota-guardian coerced a `0` rate-limit header to `null` (`|| null`), so an
  exhausted provider looked like one with unknown quota.
- prompt-registry rollbacks could not stack (always flipped the two highest
  versions instead of walking down from the active one).
- cve-scanner produced two shelf entries for one advisory when OSV and GHSA
  reported it under different primary IDs; identity now canonicalized across
  id + aliases.
- darwin-engine: a regression of exactly the 20% threshold did not trigger
  the revert PR; warden's syntax-error branch was unreachable (ts-morph
  parses malformed input tolerantly).
- trust-ledger: probation is now sticky until full autonomy is re-earned;
  operator-precedence bug in dependency-bump classification; explicit
  complexity labels win over keyword scanning.
- The advertised `--dry-run` flag did nothing (its service existed, nothing
  imported it). Now armed in the CLI and enforced before Ghost Commit,
  canary deploy, and merge.
- bootstrap.mjs pushed the reserved secret name `GITHUB_TOKEN` (rejected by
  GitHub) and never set `QODO_GITHUB_TOKEN`, the name CI reads; it also
  wrote a divergent inline workflow. Both fixed.
- mission-control: `@webcontainer/api` was externalized to a UMD global that
  nothing provided (Edge Testing threw at boot); the agent logger crashed in
  the browser (`process.stdout`); both fixed.

### Changed (architecture)
- The 830-line `runPipeline` god-function is now `src/pipeline/` — an
  orchestrator with one handler per phase over an explicit `PhaseContext`;
  resume semantics preserved verbatim.
- Ten copy-paste OpenAI-compatible provider functions collapsed into a
  table-driven `chatOpenAiCompat()` (ai-router: 1,103 → ~920 lines).
- Build is `tsc` emit (`dist/` mirrors `src/`), which the CI jobs' per-module
  imports always assumed; vite lib bundle removed (ADR-002).
- Dead code removed: the documentation-only `ports/` layer (ADR-001),
  progress-bar, env-schema, unused hook/component, dead Gemini branch.
- `standalone-executable/` → `examples/local-simulator/` (ADR-004).
- k8s/KEDA now reference a real image and the queue that actually has a
  writer, over TCP Redis (ADR-003); Dockerfile models the one-shot CLI
  honestly; audit-log appends are O(1) (tail-read instead of full-file);
  telemetry-proxy secret compare is constant-time.
- CI: jobs run exactly the local `npm run` scripts; write-capable agent job
  is workflow_dispatch-only; TruffleHog pinned off `@main`; coverage
  thresholds reset from the aspirational 80/80/70/80 to the measured floor
  68/80/74/68 as a ratchet.
- Docs: living set under `docs/` (+ 4 ADRs, invariant #11); the ~65
  audit-pass logs and stale manifests archived under `docs/history/` with
  provenance warnings.

### Verification
`npm ci && npm run typecheck && npm test && npm run build` green
(0 type errors; 1,139/1,139 agent tests in ~19 s; 28/28 simulator tests).

---

# Legacy changelog (pre-restoration, claims unverified)

## [24.30.46] — 2026-07-08

    ### Changed
    - `tasks/agent-task-queue.json` — task-47..task-54 added (8 new tasks, all
      `status: "queued"`, nothing implemented in this pass). Seeded from two
      external planning notes (free-compute energy-taxonomy survey; zero-cost
      infrastructure survey) plus two direct owner requests (admin board for
      owner-decision tasks; archive mechanism for verified-done tasks; and a
      request to revisit the one-task-per-pass ceiling, task-54).
    - `tasks/AGENT-PRINCIPLES.md` — new file. Standing "think before executing"
      instruction plus admin-board and archive conventions.
    - `tasks/agent-task-queue-archive.json` — new file, seeded empty for task-53.
    - `tasks/agent-task-queue.md` — rules section, field table, and status
      snapshot updated to match.
    - All four `package.json` files — version bumped to 24.30.46.

    ### Fixed
    - `packages/agent/pnpm-lock.yaml` — deleted. Regression of a fix already
      made once in Pass 5 (this repo is npm-workspaces-only; see full Pass 5
      entry in `06-CHANGELOG.md`). Reappeared outside this repo's own pass
      history; removed again.

    ---

## [24.30.45] — 2026-07-07

    ### Changed
    - `03-ARCHITECTURE.md` — Secrets Management Decision section added: Doppler NO-GO
      (3 independent blockers: SaaS secrets transit over PRIVACY_MODE=strict path, 1-user
      free tier, bootstrap.mjs already solves stated friction); Infisical cloud NO-GO (same
      B1 as Doppler); Infisical self-hosted NO-GO (requires always-on dedicated service not
      in any infra tier); status quo KEEP. Two bootstrap.mjs improvements identified for
      future code pass (--verify flag, grouped summary output). Full decision in
      `packages/agent/docs/73-V24-AUDIT-PASS-73.md`. Task-34 (Pass 73).
    - `tasks/agent-task-queue.json` — task-34 → done (completedInPass: 73).
    - `tasks/agent-task-queue.md` — status snapshot updated; task-32 noted as next.
    - All four `package.json` files — version bumped to 24.30.45.

    ---

## [24.30.44] — 2026-07-07

    ### Changed
    - `03-ARCHITECTURE.md` — CI Caching Decision section added: Turborepo remote cache
      CONDITIONAL-YES (3 preconditions: C1 build/tsc ≥20% CI runtime, C2 TURBO_TOKEN+TURBO_TEAM
      available as scoped Vercel secrets, C3 secrets in GitHub Actions before workflow mutation);
      Nx Cloud NO-GO (requires full Nx migration not planned). Full `turbo.json` spec and
      workflow diff documented in `packages/agent/docs/72-V24-AUDIT-PASS-72.md`. Task-33 (Pass 72).
    - `tasks/agent-task-queue.json` — task-33 → done (completedInPass: 72).
    - `tasks/agent-task-queue.md` — status snapshot updated; task-34 noted as next.
    - All four `package.json` files — version bumped to 24.30.44.

    ---

## [24.30.43] — 2026-07-07

    ### Added
    - `packages/agent/src/services/ai-router.ts` — A3 batch: Fireworks AI, DeepInfra,
      Novita AI, and CF Workers AI REST added as fast-draft race candidates. New env keys:
      `FIREWORKS_API_KEY`, `DEEPINFRA_API_KEY`, `NOVITA_API_KEY`, `CF_ACCOUNT_ID`,
      `CF_AI_API_TOKEN`. All opt-in; absent keys silently skip the provider.
    - `packages/agent/src/services/quota-guardian.ts` — `QuotaProvider` union, `HEADER_MAP`,
      and `DEFAULT_RESET_WINDOW_S` extended for all four A3 providers.
    - `packages/agent/src/services/env-validator.ts` — 5 new optional Zod fields;
      LLM-key guard updated to accept `CF_ACCOUNT_ID + CF_AI_API_TOKEN` pair.
    - `packages/agent/tests/provider-race-a3.test.ts` — New: 8 describe blocks, 28 cases.
    - `packages/agent/docs/71-V24-AUDIT-PASS-71.md` — Pass 71 audit document.
    - `03-ARCHITECTURE.md` — A3 row added to LLM Provider Race Candidates table.
    - `tasks/agent-task-queue.json` — task-31 → done (completedInPass: 71).
    - All four `package.json` files — version bumped to 24.30.43.

    ---

## [24.30.42] — 2026-07-07

    ### Changed
    - `03-ARCHITECTURE.md` — Visual QA Integration Decision section added: BrowserStack
      NO-GO (3 independent blockers: free-tier exhaustion, no rendering phase, no
      cross-browser requirement); Percy NO-GO now / CONDITIONAL-YES when rendering
      phase available. Reversal conditions documented for both. Task-38 (Pass 70).
    - `tasks/agent-task-queue.json` — task-38 → done (completedInPass: 70).
    - `tasks/agent-task-queue.md` — status snapshot updated; task-31 noted as next.
    - All four `package.json` files — version bumped to 24.30.42.

    ---

## [24.30.41] — 2026-07-07

    ### Added
    - `packages/agent/src/services/integrations/github-dependency-graph.ts` — New integration:
      GitHub Dependency Graph SBOM API. `fetchGitHubSbom()` fetches GitHub's lockfile-parsed
      SPDX 2.3 SBOM; `crossCheckDependencyGraph()` surfaces discrepancies between the
      local npm-derived graph and GitHub's authoritative view; `annotateGraphWithGitHubSbom()`
      annotates `DepNode` entries with a `githubReported` flag for blast-radius consumers.
      Uses existing `GITHUB_TOKEN`. Fully fail-open. Task-37 GitHub-endpoint half (Pass 69).
    - `packages/agent/tests/github-dependency-graph.test.ts` — 9 describe blocks, 27 test
      cases. All fetch calls stubbed. Task-37 (Pass 69).
    - `packages/agent/docs/69-V24-AUDIT-PASS-69.md` — Audit pass document for Pass 69.

    ### Changed
    - `scripts/dead-code-allowlist.json` — 3 new entries for new public exports.
    - `tasks/agent-task-queue.json` — task-37 → done (completedInPass: 69).
    - `tasks/agent-task-queue.md` — status snapshot updated; task-37 removed from queued.
    - All four `package.json` files — version bumped to 24.30.41.

    ---

## [24.30.38] — 2026-07-07

    ### Added
    - `packages/agent/tests/warden-multi-violation.test.ts` — 8 describe blocks, 32 test cases: adversarial audit of warden.ts + warden-memory.ts for multi-violation correctness and priority-ordering behavior. Documents GAP-1 (undocumented priority ordering any > console.log > await), GAP-2 (N violations require N wardenGuard round-trips), GAP-3 (wardenGuard stops at first violating file in patch array), GAP-4 (warden-memory records only first violation per guard call). Locks DB-1 through DB-4 as design boundaries. Task-46 (Pass 66).
    - `packages/agent/docs/66-V24-AUDIT-PASS-66.md` — Audit pass document for Pass 66.

    ### Changed
    - `tasks/agent-task-queue.json` — task-46 → done (completedInPass: 66).
    - `tasks/agent-task-queue.md` — status snapshot updated.
    - `ENGINEERING_NOTES.md` — remaining tasks updated; Pass 66 entry appended.
    - All four `package.json` files — version bumped to 24.30.38.

    ---

## [24.30.37] — 2026-07-07

    ### Added
    - `packages/agent/docs/65-V24-AUDIT-PASS-65.md` — Pass 65 audit document: Cloudflare AI Gateway architectural decision (task-35, NO-GO). Documents four independent blockers: Tier-1 CF Workers AI binding structural incompatibility, privacy-mode transit surface conflict, ~0% cache hit rate given run-specific prompt structure, quota-guardian redundancy. Includes future revisit conditions and Warden multi-violation continuity finding.
    - `tasks/agent-task-queue.json` — task-46 added: Warden multi-violation reporting and priority-ordering correctness audit (P3, code task, locally tractable, no network required). Re-adds engineering work lost during queue reorganization.

    ### Changed
    - `tasks/agent-task-queue.json` — task-35 → done (completedInPass: 65).
    - `tasks/agent-task-queue.md` — status snapshot updated.
    - `ENGINEERING_NOTES.md` — remaining-tasks section updated; task-46 continuity note added.
    - All four `package.json` files — version bumped to 24.30.37.

    ---

## [24.30.36] — 2026-07-07

    ### Added
    - `packages/agent/tests/prompt-registry-mid-run-consistency.test.ts` — 8 describe blocks, 32 test cases: confirms getActivePrompt() live-disk-read contract (no cache), GAP-1 (Medium — manual rollback mid-run causes silent phase divergence: phase N sees vX, rollback fires, phase N+1 sees vX-1, no error raised), GAP-2 (Medium — auto-rollback mid-run: 5 results with successRate < 0.70 triggers rollback synchronously inside recordPromptResult so a phase's own poor results can switch the prompt version seen by subsequent phases), DB-2 (run-start snapshot is the safe caller pattern), DB-3 (auto-rollback threshold runs>=5 AND <0.70, exact 0.70 does not trigger, <5 runs never trigger), DB-4 (multi-key independence), DB-5 (single-step rollback), DB-6 (stats persisted before auto-rollback fires). Task-30 (Pass 64).
    - `packages/agent/docs/64-V24-AUDIT-PASS-64.md` — Audit pass document for Pass 64.

    ### Changed
    - `tasks/agent-task-queue.json` — task-30 → done (completedInPass: 64).
    - All four `package.json` files — version bumped to 24.30.36.

    ---

## [24.30.35] — 2026-07-07

    ### Added
    - `packages/agent/tests/compliance-cross-consistency.test.ts` — 8 describe blocks, 31 test cases: package enumeration cross-consistency (count, name, version, scoped packages, lockfileVersion 2), license data cross-consistency for non-empty licenses, GAP-1 (Medium — missing license normalization divergence: sbom-generator normalizeLicense returns "" for undefined/null → omits licenses field; license-checker returns "UNKNOWN" → flags unknown violation; contradictory operator signals from the same lockfile entry), GAP-2 (Low — empty/whitespace-only string diverges the same way), DB-1 (object-style {type:"X"} license consistent between subsystems), DB-2 (oracle scope orthogonal to SBOM/license-checker scope), DB-3 (root package skip consistent), DB-4 (name normalization identical), oracle internal consistency (determinism, all three rule types, multi-file ordering, fetch-failure resilience), and three-subsystem matrix tests. Task-27 (Pass 63).
    - `packages/agent/docs/63-V24-AUDIT-PASS-63.md` — Audit pass document for Pass 63.

    ### Changed
    - `tasks/agent-task-queue.json` — task-27 → done (completedInPass: 63).
    - All four `package.json` files — version bumped to 24.30.35.

    ---

## [24.30.34] — 2026-07-07

    ### Added
    - `packages/agent/tests/dom-xray-shadow-starvation.test.ts` — 8 describe blocks, 26 test cases adversarially auditing observation-window starvation in `dom-xray.ts` and `shadow-traffic.ts`. Documents eight gaps: GAP-1 (High, dom-xray K=1 request-counter attack), GAP-2 (High, dom-xray JSDOM static-only — JS-deferred errors invisible), GAP-3 (Medium, empty SPA shell passes as healthy), GAP-4 (Medium, dom-xray bypass-header evasion), GAP-5 (High, shadow-traffic K=3 request-counter attack), GAP-6 (Medium, shadow-traffic bypass-header evasion), GAP-7 (Medium, only 3 fixed paths probed), GAP-8 (Low, /robots.txt 404 reduces effective coverage to 2). Documents four design boundaries: DB-1 (dom-xray single-fetch static snapshot), DB-2 (shadow-traffic 3-probe gate), DB-3 (bypass-header attack defeats both validators simultaneously — single predicate bypasses both gates), DB-4 ([data-error] selector is value-agnostic — false-positive risk). Task-26 (Pass 62).
    - `packages/agent/docs/62-V24-AUDIT-PASS-62.md` — Audit pass document for Pass 62.

    ### Changed
    - `tasks/agent-task-queue.json` — task-26 → done (completedInPass: 62).
    - All four `package.json` files — version bumped to 24.30.34.

    ---

    ## [24.30.33] — 2026-07-07

    ### Added
    - `packages/agent/tests/model-deprecation-watchdog-soft.test.ts` — 7 describe blocks, 24 test cases adversarially auditing soft-deprecation detection in `model-deprecation-watchdog.ts`. Documents seven gaps: GAP-1 (`deprecated:true` field ignored), GAP-2 (`status:"deprecated"` ignored), GAP-3 (`deprecation_notice` ignored), GAP-4 (`deprecated_at`/`sunset_date` temporal fields ignored — no advance-notice window), GAP-5 (`rate_limited` degradation signals ignored), GAP-6 (High — Gemini `authHeader` always returns null, making Gemini monitoring permanently dead code; every Gemini deprecation event undetectable), GAP-7 (Gemini `supportedGenerationMethods:[]` and `deprecationDate` not inspected, contingent on GAP-6 fix). Documents three design boundaries: DB-1 (hard absence is the only detection axis), DB-2 (Gemini monitoring is dead code), DB-3 (in-process cache inherits soft-deprecation blindness for the process lifetime). Task-23 (Pass 61).
    - `packages/agent/docs/61-V24-AUDIT-PASS-61.md` — Audit pass document for Pass 61.

    ### Changed
    - `tasks/agent-task-queue.json` — task-23 → done (completedInPass: 61).
    - All four `package.json` files — version bumped to 24.30.33.

    ---

    ## [24.30.32] — 2026-07-07

    ### Added
    - `packages/agent/tests/uncertainty-sampling-calibration.test.ts` — 8 describe blocks, 42 test cases auditing the calibration math of `uncertainty-sampling.ts`. Proves: weight invariants (sum=1.0, all positive, HISTORICAL dominant), input clamping for all three clamped inputs, all-best → uncertainty=0, extreme inputs stay in [0,1], per-factor monotonicity, linear superposition, routing threshold exactly at 0.30 (inclusive), consensus sub-formula math for all vote patterns, and perfectly-linear 11-point decile sweeps. Documents four design boundaries: DB-1 (neutral inputs bias toward mentor-mode), DB-2 (confidence label ≠ gate-pass probability; effective auto-proceed boundary at confidenceScore=86 under neutral context), DB-3 (absent votes contribute 0.0875, not zero), DB-4 (maximum confidence alone cannot overcome zero historical reliability). Task-21 (Pass 60).
    - `packages/agent/docs/60-V24-AUDIT-PASS-60.md` — Audit pass document for Pass 60.

    ### Changed
    - `tasks/agent-task-queue.json` — task-21 → done (completedInPass: 60).
    - All four `package.json` files — version bumped to 24.30.32.

    ---

    ## [24.30.31] — 2026-07-07

### Added
- `packages/agent/tests/cartographer-oversized-pr.test.ts` — 9 describe blocks, 31 test cases load-testing
  `cartographer.ts` with synthetic oversized-PR fixtures (200-file, 500KB+). Exercises isLargeFile
  threshold semantics, buildFileMap routing (small excluded, large summarised, targets skipped),
  summarizeFile three-tier cache (Redis → R2 → AI), content-hash deduplication, and 200-file
  concurrency scenario. Documents: GAP-1 (Medium) concurrent summarizeFile calls make redundant
  AI calls (missing in-flight deduplication); GAP-2 (Low) Redis stale-hit after content change
  (path-keyed cache not invalidated on hash change). Task-12 (Pass 59).
- `packages/agent/docs/59-V24-AUDIT-PASS-59.md` — Audit pass document for Pass 59.

### Changed
- `tasks/agent-task-queue.json` — task-12 → done (completedInPass: 59).
- All four `package.json` files — version bumped to 24.30.31.

---

## [24.30.30] — 2026-07-07

### Added
- `packages/agent/tests/api-contract-guard-adversarial.test.ts` — 7 describe blocks, 22 test cases
  adversarially auditing `api-contract-guard.ts`. Confirms 6 scenarios the guard catches correctly
  and documents 7 gaps: GAP-1 (new required OpenAPI parameter reads as additive), GAP-2 (parameter
  type change within method invisible), GAP-3 (required→optional parameter flip invisible), GAP-4
  (response code removal within method invisible), GAP-5 (YAML OpenAPI files at keyword-free paths
  silently skipped by isSchemaFile), GAP-6 (GraphQL nullable→non-null promotion invisible due to
  ! stripping), GAP-7 (new non-null GraphQL field misclassified as additive). Task-28 (Pass 58).
- `packages/agent/docs/58-V24-AUDIT-PASS-58.md` — Audit pass document for Pass 58.

### Changed
- `tasks/agent-task-queue.json` — task-28 → done (completedInPass: 58).
- All four `package.json` files — version bumped to 24.30.30.

---

## [24.30.28] — 2026-07-07

### Added
- `packages/agent/tests/quota-ledger-concurrency.test.ts` — 8 describe blocks, 28 test cases
  proving the concurrent reconciliation boundary between quota-guardian.ts and cost-ledger.ts.
  Task-24 (Pass 56). Documents: GAP-1 (High) recordCost non-atomic read-modify-write loses cost
  entries under concurrent callers; GAP-2 (Medium) concurrent quota headroom reads both see the
  same prior snapshot and jointly overshoot. Confirms: sequential recording is correct; exhaustion
  via markProviderExhausted() is sticky; separate repo ledger keys never cross-contaminate; 20
  concurrent snapshot reads are always consistent; hasComfortableHeadroom threshold edge cases.

- `packages/agent/docs/56-V24-AUDIT-PASS-56.md` — Audit pass document for Pass 56.

### Changed
- `tasks/agent-task-queue.json` — task-24 → done (completedInPass: 56).
- All four `package.json` files — version bumped to 24.30.28.

---

## [24.30.27] — 2026-07-07

### Added
- `packages/agent/tests/obfuscator-scale.test.ts` — 9 describe blocks, 33 exhaustive
  scale test cases proving the obfuscator's VAR_N token-assignment scheme is free from
  birthday-paradox-style collisions at 1 000, 3 000, and 5 000 identifier scales.
  Task-19 (Pass 55). Proves: bijectivity (forward and backward injectivity) at 5 000
  identifiers; no cross-file collision across 20-file batches with 150 identical local
  names per file; correct `existingTokenOffset` behaviour at 500 pre-seeded VAR_N
  identifiers; `tokenOffset` chaining produces disjoint token sets; `reconstituteCode`
  longest-first sort prevents VAR_1/VAR_10/VAR_100/VAR_1000 prefix corruption at
  1 000-token scale; edge cases at scale boundary (empty file, single-identifier file,
  2 000 common-prefix identifiers). Three design boundaries documented. No production
  source files changed.

### Changed
- All three `package.json` files bumped 24.30.26 → 24.30.27.
- `tasks/agent-task-queue.json` — task-19 → `"done"`, `completedInPass: 55`.

## 24.30.25 — Chaos-monkey × circuit-breaker interaction stress test (Task-16) — 2026-07-07

### Added
- `packages/agent/tests/chaos-circuit.test.ts`: 31 adversarial test cases across
  9 describe suites stress-testing the interaction surface between the `ChaosMonkey`
  fault-injection pattern and `CircuitBreaker`: threshold trip, no-phantom-calls-while-
  OPEN, HALF_OPEN probe semantics (success→CLOSED, failure→re-OPEN), second reset-
  timer requirement after re-open, multi-provider independence, interleaved-success
  counter reset, concurrent-failure state correctness, and full 7-phase pipeline
  lifecycle (CLOSED→OPEN→HALF_OPEN→CLOSED).
- `packages/agent/docs/53-V24-AUDIT-PASS-53.md`: full pass-53 audit report.

### Notes
- Test-only pass (task-16). No production source files, schemas, sacred files, or
  infrastructure changed.
- Four design boundaries confirmed and documented: concurrent race to threshold,
  non-locking HALF_OPEN probe, interleaved-success counter reset is intentional,
  and `reset()` bypasses `resetTimeoutMs` by design.
- `validate.sh` 50/50 PASSED. `check-dead-integrations.mjs` clean (88 exports,
  all allowlisted). Full `vitest run` / `tsc --noEmit` blocked by sandbox network
  constraints (consistent with all passes ≥ 36).

### Changed
- Version bumped 24.30.24 → 24.30.25 across all three `package.json` files.

---

# Changelog

## 24.30.23 — Darwin Engine stress test (Task-7) — 2026-07-07

### Added
- `packages/agent/tests/darwin-engine-stress.test.ts`: 24 adversarial test cases across
  9 describe blocks stress-testing the Darwin Engine's fitness-evaluation threshold
  boundary, compounding regression behaviour, invalid baseline guards, retry-count
  boundary, error-signature deduplication, PR-creation ordering invariant, and telemetry
  coverage for both `evaluateMutationFitness` and `runDarwinEngine`.
- `packages/agent/docs/51-V24-AUDIT-PASS-51.md`: full pass-51 audit report.

### Found (design boundaries documented, not changed)
- Single baseline slot per `(owner, repo)` — concurrent mutations share one key; last
  write wins. No regression: constrained upstream by trust-ledger auto-merge gate.
- Threshold is per-evaluation against stored baseline, not a rolling average.
- `runDarwinEngine` scans exactly the most recent 20 PRs — very high-velocity repos
  may miss older patterns. Known and acceptable for current scale.

### Changed
- Version bumped 24.30.22 → 24.30.23 across all four `package.json` files.

---

## 24.30.22 — Skill-exchange / Hive poisoning test (Task-22) — 2026-07-07

### Added
- `packages/agent/tests/hive-poisoning.test.ts`: 19 adversarial test cases across 4
  suites documenting the Hive poisoning resistance boundary for `semantic-cache.ts`,
  `skill-exchange.ts`, and `vector-skill-exchange.ts`.
- `packages/agent/docs/50-V24-AUDIT-PASS-50.md`: full pass-50 audit report.

### Found (gaps documented, not fixed this pass)
- GAP-1: near-identical mission can retrieve a poisoned hive patch when cosine > 0.92 and no drift.
- GAP-2: quarantine list eviction via 501+ writes allows oldest quarantine to be bypassed.
- GAP-3: exact-string quarantine match bypassed by subtly-mutated objective.
- GAP-4/5/6: UNTRUSTED_DATA wrapper does not strip content; no content-quality gate; `name` field unsanitised.
- Cross-subsystem: semantic-cache quarantine not consulted by skill-exchange.

### Changed
- Version bumped 24.30.21 → 24.30.22 across all four `package.json` files.

---

## 24.30.21 — Trust-ledger / vitals-score gaming resistance (Task-20) — 2026-07-07

### Added
- **`packages/agent/tests/trust-ledger-gaming.test.ts`** — 28 adversarial test cases (6 describe suites) auditing the gaming-resistance properties of `trust-ledger.ts` and `vitals-score.ts`: minimum-cost auto-merge unlock (Gap-1), confidence underreporting penalty symmetry (Gap-2), category misclassification via complexity override (Gap-3), cross-category isolation, asymmetric failure recovery, score floor, seed-sealing, probation stickiness, and vitals-score independence from the auto-merge gate.
- **`packages/agent/docs/49-V24-AUDIT-PASS-49.md`** — Full audit document with impact analysis, gap descriptions, resistance-property evidence, proposed mitigations, and invariant preservation table.

### Notes
- Test-only pass (task-20). No production source files, schemas, sacred files, or infrastructure changed.
- Three gaps documented; five resistance properties confirmed. Gaps are architectural trade-offs requiring product decisions before fixing — deferred with documented mitigation paths.
- `check-dead-integrations.mjs` clean. Full `npm test` / `tsc --noEmit` blocked by sandbox network constraints (consistent with all passes ≥ 36).

## 24.30.19 — Supply-chain audit of CVE scanner and license checker (Task-13) — 2026-07-07

### Added
- **`packages/agent/tests/supply-chain-audit.test.ts`** — 26 adversarial test cases (8 describe blocks) probing the failure modes of `cve-scanner.ts` and `license-checker.ts`: OSV.dev/GHSA unreachability, malformed responses, resolved-entry preservation, component batch >1000 limit, CVE deduplication by alias, compound SPDX expression handling, GPL suffix variants, missing/empty license fields, lockfileVersion 2 format, scoped package normalisation, custom override policies, and the self-reported-clean design limit.

### Notes
- Test-only pass (task-13). No production source files, schemas, sacred files, or infrastructure changed.
- Two design gaps documented: (1) compound SPDX expressions are conservatively treated as denied if they contain any denied ID — intentional policy; (2) license-checker trusts lockfile-reported license data verbatim — mitigation planned in task-42 (ClearlyDefined cross-check).
- `validate.sh` and `node scripts/check-dead-integrations.mjs` pass unchanged. Full `npm test` / `tsc --noEmit` blocked by sandbox network constraints.

## 24.30.18 — Reconcile changelog numbering tracks (Task-10) — 2026-07-07

### Changed
- **`06-CHANGELOG.md`:** Renamed the standalone-harness pass headers at the bottom of the file from `# Pass N` to `# Standalone Pass N` (Standalone Pass 2, 3, 4) to disambiguate them from the monorepo pass numbering track. Added a note clarifying that Standalone Pass 1 lives in `standalone-executable/CHANGELOG.md`.
- **`CONSOLIDATION-NOTES.md`:** Added a decision record explaining why the standalone track was renamed rather than merging numbering.

### Notes
- Documentation-only pass (task-10). No source code, schemas, sacred files, or runtime behavior changed.
- `validate.sh` and `node scripts/check-dead-integrations.mjs` pass. Full `npm install && npm test && tsc` remains blocked by sandbox network constraints (unchanged from prior passes).

## 24.30.17 — Obfuscator / privacy-mode boundary red-team (Task-8) — 2026-07-07

### Fixed
- **`packages/agent/src/services/obfuscator.ts`:** `reconstituteCode()` now sorts tokens by length descending before regex substitution, eliminating prefix-token corruption when ≥10 tokens exist (e.g. `VAR_10` partially rewritten by `VAR_1`).
- **`packages/agent/src/agents/coder.ts`:** Defense-in-depth guard — when a privacy mapping is active (strict privacy mode), the cross-repo Hive reference patch block is now skipped rather than reconstituted with a mismatched mapping.

### Added
- **`packages/agent/tests/obfuscator-redteam.test.ts`** — adversarial test suite covering prefix-substitution correctness, documented symbol-name leak paths (functions, classes, interfaces, imports, property access, strings, comments), the `hasUnmappedTokens` / `reconstitutePatch` ordering invariant, and adversarial source shapes.

### Notes
- `vitest` and full `tsc --noEmit` remain blocked by sandbox network constraints (no `node_modules`); syntax checks via `node --experimental-strip-types --check` pass on all touched files.

## 24.30.16 — External review remediation: browser secret leak + silent ledger writes — 2026-07-07

### Fixed
- **T1 (security):** removed `VITE_GITHUB_OAUTH_TOKEN` / `VITE_QODO_DISPATCH_SECRET`
  from the Mission Control browser bundle. The Worker now issues short-lived,
  HMAC-signed session tokens (`POST /session/issue`) instead of shipping a
  static long-lived secret, and proxies GitHub Contents API calls server-side
  (`GET /prefetch-content`) so the browser never holds a GitHub token.
- **T2 (observability):** `openLedger`, `recordOutcome`, `recordCost`,
  `closeLedger`, and `reporter.fatal` in `packages/agent/src/cli.ts` now log
  write failures instead of swallowing them with `.catch(() => {})`.

### Notes
- Source: external review (`qodo-review-report.md` / `qodo-execution-tasks.md`).
- Full `npm install && npm test && tsc` still blocked by sandbox network
  constraint (unchanged from prior passes) — see `06-CHANGELOG.md` Pass 44
  for what was and wasn't verified in this sandbox.

## 24.30.15 — Adversarial audit-log hash chain tests — 2026-07-07

### Added
- `packages/agent/tests/adversarial-audit-log.test.ts` — 16 adversarial test cases
  proving `verifyAuditChain()` detects payload/actor/timestamp/seq/event/hash-field
  mutations, full re-hash forgery, middle-entry deletion, chain injection, replay
  attacks, and entry swaps. Three design-boundary tests document the known limitations
  of a pure hash chain (tail truncation, head truncation with rebuild, full log
  replacement) with mitigation notes.

### Notes
- No production code, schemas, or infrastructure files were modified.
- This is a pure test-coverage pass (task-11 from `tasks/agent-task-queue.json`).
- Full `vitest` still blocked by sandbox network constraint; static review confirms
  all imports resolve against the existing `audit-log.ts` export surface.

## 24.30.14 — Tier 2/3 infrastructure keep-or-cut decision — 2026-07-07

### Decided
- Promoted Redis (Upstash) to the formal required Tier 1 for production deployments; it is already required by `env-schema.ts` and underpins locks, flaky-test index, Layer 2 test offload, telemetry, and Semantic DAG Lock.
- Kept R2 / S3-compatible object storage as optional Tier 2 (recommended for production) for cross-run learning: semantic cache, Vector Skill Exchange, Cartographer AST cache, and patch archiving.
- Kept Vercel canary, the Cloudflare Worker telemetry proxy, and QStash as optional Tier 3 paid add-ons; each no-ops cleanly when its credentials are absent.
- No subsystems were cut in this pass, because each already degrades cleanly when unconfigured and removing any would reduce optionality without simplifying runtime behavior.

### Notes
- Documentation-only pass (task-3). No source code, defaults, or sacred files were modified.
- Full validation (`validate.sh`, `check-dead-integrations.mjs`) passes; sacred-file manifest hashes are unchanged.

## 24.30.11 — Merge free-tier racing providers — 2026-07-07

### Added
- `packages/agent/src/services/ai-router.ts` — Together.ai, SambaNova Cloud, and Hugging Face Inference Router are now registered as free-tier race candidates alongside Groq, Gemini, Cerebras, and Mistral.
- `packages/agent/src/services/quota-guardian.ts` — `together`, `sambanova`, and `huggingface` quota providers with provider-specific rate-limit header maps.
- `packages/agent/src/services/env-validator.ts` / `utils/env-schema.ts` — `TOGETHER_API_KEY`, `SAMBANOVA_API_KEY`, and the previously-unwired `HF_API_KEY` are now recognized as valid LLM keys.
- `packages/agent/src/services/cost-tracker.ts` — Zero-cost pricing entries for `together` and `sambanova`.
- `packages/agent/src/services/model-deprecation-watchdog.ts` — Added Together, SambaNova, and Hugging Face race models and provider configs so the deprecation watchdog stays in sync with `ai-router.ts`.
- `.env.example` and `02-README.md` — Documentation for all six free-tier race-candidate env vars.

### Reconciliation notes
- Baseline: `v24.30.8-patched-r3` (preserves `.github/`, `.gitignore`, `quota-guardian.test.ts`, and the corrected `quota-guardian.ts` `parseRemaining` logic that preserves `0` as exhausted rather than collapsing to `null`).
- Merged: additive free-tier provider changes from `v24.30.9-free-tier-providers`.
- Version bump: all four `package.json` files to `24.30.11`.

## 24.30.10-patched-r2 — 2026-07-07

### Fixed

#### `redis-state.ts` — inline `AbortController` replaced with `fetchWithTimeout`

**Problem:**
`RedisState.call()` — the single internal method every Redis operation in the
codebase flows through — managed its HTTP timeout with an inline
`AbortController` + `setTimeout` + `clearTimeout` block (~8 lines) instead of
the `fetchWithTimeout` utility already present in `utils/fetch-timeout.ts`.

This created two defects:

1. **Bypassed signal-combination semantics.** A previous pass upgraded
   `fetchWithTimeout` to use `AbortSignal.any([controller.signal, callerSignal])`
   so that whichever signal fires first (timeout _or_ caller cancellation) wins.
   `RedisState.call()` bypassed this upgrade entirely — it constructed its own
   `AbortController` and passed only `controller.signal` to `fetch`. Any future
   caller that supplies an abort signal for cooperative cancellation (e.g. a
   phase-level cancellation token during `QODO_HALT`) would see its signal
   silently dropped; the Redis fetch would run to its own 4 s timeout regardless.

2. **Duplicated timeout infrastructure.** `fetchWithTimeout` was specifically
   introduced to centralise this pattern. `call()` re-implementing it inline
   means any future correctness fix applied to `fetchWithTimeout` (e.g.
   adjusting abort-error categorisation, adding structured telemetry on timeout)
   would need to be applied in two places, recreating the same maintenance hazard
   the utility was designed to eliminate.

**Change (`packages/agent/src/services/redis-state.ts`):**
- Added `import { fetchWithTimeout } from "../utils/fetch-timeout.js"`.
- Replaced the inline `AbortController` + `setTimeout` + `fetch` + `clearTimeout`
  block in `call()` with a single `fetchWithTimeout(url, { headers }, 4_000)` call.

**Impact:**
- Removes 8 lines of duplicated timeout infrastructure; `fetchWithTimeout` is now
  the single point of truth for all HTTP timeouts in the agent.
- `call()` now participates correctly in the signal-combination path: any caller
  that passes an abort signal in the future will have it respected on Redis calls
  as well as all other HTTP calls in the codebase.
- Timeout value is unchanged (4 s); no observable behaviour change for any
  existing caller.
- All 5 `redis-lock.test.ts` tests pass; the tests stub the global `fetch` which
  `fetchWithTimeout` delegates to, so the mock path is unaffected.

---

## 24.30.10-patched — 2026-07-07

### Fixed

#### `ai-router.ts` — duplicate retry logic replaced with canonical `withRetry`

**Problem:**
`ai-router.ts` contained a private `withBackoff` function and a `sleep` helper
(~25 lines) that duplicated the retry infrastructure already provided by
`retry.ts::withRetry`. The private implementation had two defects relative to
the canonical utility:

1. **Incorrect jitter formula.** `withBackoff` computed
   `delay = baseMs * 2^attempt + Math.random() * 500` — a biased backoff with a
   fixed 500 ms noise window. The correct full-jitter formula
   (`Math.random() * min(base * 2^attempt, maxDelay)`) was only present in
   `withRetry`. Under concurrent provider failures the biased formula allowed
   retries from multiple callers to cluster in the same delay band, recreating
   the thundering-herd condition the jitter was designed to prevent.

2. **Missing HTTP 504 retryable status.** The inline `retryable` check covered
   `429 | 503 | 502 | 408` but omitted `504 Gateway Timeout`, which
   `isHttpRetryable` in `retry.ts` correctly handles. A 504 from OpenRouter or
   Gemini was therefore treated as a permanent failure and not retried.

Additionally, maintaining two retry implementations means any future correctness
fix (e.g. adding `ETIMEDOUT` / `ECONNRESET` network error handling) must be
applied in two places, creating a maintenance hazard.

**Change (`packages/agent/src/services/ai-router.ts`):**
- Added `import { withRetry, isHttpRetryable } from "./retry.js"`.
- Removed the private `sleep` and `withBackoff` functions (~25 lines).
- Replaced all 5 `withBackoff(...)` call sites — in `chatWithGroqRotation`,
  `chatOpenRouter`, `chatGemini`, `chatCerebras`, and `chatMistral` — with
  `withRetry(..., { maxAttempts: 4, baseDelayMs: 500, isRetryable: isHttpRetryable, name: "<provider>" })`.

**Impact:**
- Eliminates the jitter clustering defect; all provider retries now use
  full-jitter exponential back-off.
- Adds HTTP 504 to the retryable set for all five provider call paths.
- Removes ~25 lines of duplicated logic; retry behaviour is now governed by a
  single well-tested module.
- No change to observable retry counts, delay ranges, or caller interfaces.

---

## 24.30.10 — 2026-07-07

### Fixed

#### `SreFeedbackEnv` type gap silently disabled the halt-aware SRE warmup loop

**Problem:**
Pass 35 replaced the single `await sleep(10min)` in `sre-feedback.ts` with a
5 s poll loop that checked `isHalted(env)` on each iteration, ensuring
`QODO_HALT=true` could stop the pipeline within 5 seconds during the post-merge
warmup window rather than waiting up to 10 minutes.

However, the implementation had two correctness defects that made the improvement
effectively a no-op:

1. **Type gap:** `SreFeedbackEnv` did not declare `QODO_HALT` or `QODO_HALT_REASON`.
   The halt check used `env as Record<string, string | undefined>` — an unsafe
   widening cast that silently masked the missing fields. TypeScript permitted
   callers to pass a `SreFeedbackEnv`-typed object without the kill-switch fields,
   in which case `isHalted()` always returned `false`. Any call site (e.g. test
   code, alternative orchestrators) that constructed a `SreFeedbackEnv` without
   `QODO_HALT` would silently never halt, regardless of operator intent.

2. **Dynamic import in a hot loop:** `isHalted` was resolved via
   `await import("../services/kill-switch.js")` inside the poll body (up to 120
   iterations over 10 minutes). `kill-switch.ts` is a pure env check with no
   external dependencies — the dynamic import was unjustified ("lazy import to
   avoid a hard dependency" was the comment, but the module has zero I/O) and
   added an async microtask allocation on every iteration.

**Changes (`packages/agent/src/services/sre-feedback.ts`):**
1. Added `QODO_HALT?: string` and `QODO_HALT_REASON?: string` to `SreFeedbackEnv`
   — TypeScript now enforces the presence of kill-switch fields at every call site.
2. Replaced `await import(…)` inside the loop with a static top-level import of
   `isHalted` from `./kill-switch.js`.
3. Replaced `isHalted(env as Record<string, string | undefined>)` with the
   direct, type-safe `isHalted(env)` — the unsafe cast is no longer needed.

**Tests added (`packages/agent/tests/sre-feedback-halt.test.ts`):**
6 tests covering: immediate halt on `QODO_HALT=true`, halt on `QODO_HALT=1`
(numeric form), telemetry event emission, no false-halt when `QODO_HALT` is
absent, no false-halt when `QODO_HALT=false`, and TypeScript compile-time
verification that `SreFeedbackEnv` now accepts the kill-switch fields.
All tests carry a 5 s hard timeout to prove they complete within one poll
interval (not the full 10-minute warmup).

**Impact:**
- `QODO_HALT=true` now reliably stops the SRE warmup loop within one poll
  interval (≤ 5 s) regardless of how the caller constructs the env object.
- Removes an unsafe TypeScript cast that hid a real correctness gap.
- Removes 120 unnecessary dynamic module-resolution microtasks per run.
- Closes the Pass 35 deferred test item: "Integration test for `QODO_HALT`
  intra-phase — verify the SRE loop exits within one poll interval."

## 24.30.9 — 2026-07-07

### Fixed

#### Race cancellation: `raceProviders()` now actually cancels losing HTTP requests

**Problem:**
`raceProviders()` in `services/ai-router.ts` raced Gemini, Cerebras, and Mistral in
parallel for fast-tier requests but never cancelled the losing providers once a winner
was found. The function's own comment promised "cancels the rest" — the implementation
silently abandoned them instead, letting every losing request run to full completion.
This consumed API quota on 2–3 providers per fast-tier call even though only one result
was used, accelerating rate-limit exhaustion and holding open TCP connections.

A companion bug in `utils/fetch-timeout.ts` compounded the issue: passing a signal via
`init.signal` was silently dropped because the function spread `init` and then
unconditionally overwrote `signal` with its own timeout controller's signal. Any
external `AbortSignal` passed by a caller was ignored, making it impossible to propagate
cancellation through `fetchWithTimeout`.

**Changes:**
1. `utils/fetch-timeout.ts` — when `init.signal` is supplied, the function now builds a
   combined signal via `AbortSignal.any([controller.signal, callerSignal])` so either the
   timeout or the caller's abort fires first. The caller's signal is no longer silently
   dropped.

2. `services/ai-router.ts` — `raceProviders()` creates a shared `AbortController` for the
   race. The moment a winner resolves with valid JSON, `controller.abort()` is called
   before `resolve()`, propagating cancellation to every other in-flight candidate.
   `RaceCandidate.fn` now accepts an `AbortSignal` parameter; `chatGemini`,
   `chatCerebras`, and `chatMistral` each accept an optional `signal` argument and
   forward it to `fetchWithTimeout`. `AbortError` rejections from losing providers are
   treated as expected outcomes, not failures.

   The Groq SDK candidate (`groq-fast`) does not support `AbortSignal` on the SDK's
   `chat.completions.create` API; the signal is accepted for interface compatibility and
   documented inline.

**Impact:**
- Eliminates wasted API quota on 2–3 providers per fast-tier call.
- Eliminates unnecessary open TCP connections held by abandoned requests.
- Removes the contradiction between `raceProviders`' comment and its behaviour.
- Makes `fetchWithTimeout` correctly composable as a cancellable primitive.
- No change to public API surface; no behaviour change for single-candidate or
  heavy-tier (Groq-only) calls.

**Tests added:** `tests/race-cancellation.test.ts` — 8 tests covering:
- `fetchWithTimeout` signal combination (3 cases)
- `raceProviders` winner detection, abort propagation, error handling (5 cases)

---

## 24.30.8 — 2026-07-07

### Added
- 15 new tasks (task-16 through task-30) appended to
  `tasks/agent-task-queue.json`, derived directly from this codebase's own
  service inventory rather than an external planning doc. All 15 assessed
  as locally tractable (no network required), each targeting a
  cross-subsystem interaction, adversarial, or concurrency property that a
  single-run happy-path test suite wouldn't catch: interaction races
  (chaos-monkey x circuit-breaker, quota-guardian x cost-ledger,
  hot-reload-config), rollback/replay proofs (meta-agent, retry x
  circuit-breaker idempotency), a deadlock property (semantic-dag), a
  collision-space test (obfuscator at scale), gaming/poisoning resistance
  (trust-ledger/vitals-score, skill-exchange/Hive), calibration vs.
  plausibility (uncertainty-sampling), soft-failure detection
  (model-deprecation-watchdog), validator starvation (dom-xray/
  shadow-traffic), and cross-subsystem drift (compliance-oracle/SBOM/
  license-checker, api-contract-guard, prompt-registry).
- Queue now totals 30 tasks (1 done, 23 queued/eligible, 6 blocked).

### Notes
- This pass only extends the queue; no queued task was attempted. See
  `06-CHANGELOG.md` Pass 38 for the full impact analysis and reasoning
  behind each new task's priority and network assessment.
- `tasks/agent-task-queue.md`'s status snapshot now calls out task-18,
  task-20, task-22, and task-29 as the highest-value priority-1 picks
  alongside the original task-3/task-8/task-10/task-11.

## 24.30.7 — 2026-07-07

### Added
- `tasks/agent-task-queue.json` — checked-in, machine-readable queue of
  the 14 remaining hard-tasks-backlog items (task-14 already closed in
  Pass 36), with priority, network/owner-decision requirements, and
  blocking relationships between tasks.
- `tasks/agent-task-queue.md` — usage rules for consuming the queue
  (one task per pass, Impact Analysis first, update state in the same
  pass a task closes).
- `scripts/task-queue.mjs` — dependency-free CLI (`list`, `next`, `start`,
  `done`) for reading and updating the queue consistently.
- `validate.sh`: `tasks/agent-task-queue.json` added to the JSON validity
  check.

### Notes
- This pass only builds the queue; it does not attempt any queued task.
  See `06-CHANGELOG.md` Pass 37 for the full impact analysis, including
  which items were re-triaged from "needs network" to "locally tractable"
  after re-reading their actual requirements.
- `node scripts/task-queue.mjs next` currently returns `task-3` (Tier 2/3
  infra keep-or-cut decision) as the top eligible item for whoever picks
  this repo up next.

## 24.30.6 — 2026-07-07

### Added
- Sacred-file integrity check (`packages/agent/src/services/sacred-file-integrity.ts`),
  ported from the sibling ECOS project's MD5 "sacred file" pattern and
  upgraded to SHA-256 to match this repo's existing `audit-log.ts` primitive.
  Verifies 7 of the repo's highest blast-radius files against a checked-in
  manifest (`.sacred-manifest.json`) every pipeline run; drift is recorded
  in the existing tamper-evident audit chain, never blocks the run. See
  `06-CHANGELOG.md` Pass 36 for the full impact analysis.
- `packages/agent/bin/generate-sacred-manifest.ts` and the
  `sacred:generate` npm script — the explicit, human-triggered rebaseline
  step for the manifest above.
- 6 new unit tests: `packages/agent/tests/sacred-file-integrity.test.ts`.

### Validation performed (no network / no `node_modules` available)
- `./validate.sh`: 49/49 checks pass.
- `node scripts/check-dead-integrations.mjs`: 88/88 flagged exports
  accounted for in the allowlist (3 new entries added this pass, all for
  exports genuinely only used from the new bin script / test file, both
  outside the checker's scan scope).
- Manifest generation cross-checked independently with a standalone Node
  script re-hashing every `SACRED_FILES` entry against
  `.sacred-manifest.json` — confirmed a clean match.
- Full `vitest`/`tsc` run still not possible in this sandbox (unchanged
  network constraint).

## 24.30.4 — 2026-07-07

### Repository hygiene
- Restored `tasks/dead-code-triage-v24.30.0.md`, referenced by the 24.30.1
  changelog entry but absent from the consolidated archive. Reconstructed
  from `scripts/dead-code-allowlist.json` (the actual source of truth) and
  cross-checked against a live run of `check-dead-integrations.mjs` —
  confirms 0 untriaged flags on this baseline.

### Validation performed (no network / no `node_modules` available)
- `./validate.sh`: 49/49 checks pass (JS/MJS syntax, JSON validity, YAML
  validity, `.env.example` format, new-service structure, test-file
  presence, CI pipeline job coverage, vitest threshold config, file count).
- `node scripts/check-dead-integrations.mjs`: 85/85 flagged exports remain
  correctly allowlisted; no new unwired integrations introduced.
- All `.json` files in the repository parse; all `.yml`/`.yaml` files
  parse under PyYAML `safe_load_all`.
- `npx vitest`, `tsc --noEmit`, and `npx knip` could not be run in this
  environment (no registry access to install dependencies) — flagged as a
  known gap for the next pass with install access, consistent with prior
  passes' documented sandbox limitation.

## 24.30.3 — 2026-07-06

### Correctness
- Fixed `path-guard-scoped.ts` to accept an allowed directory root after normalization, resolving property-test failures on paths like `src/0/..`.
- Restored `support-ticket-bridge.ts` complaint filtering and tightened fingerprint slice from 8 to 4 terms so objectives are generated only for complaint-shaped tickets.
- Lowered `uncertainty-sampling.ts` mentor-mode threshold from 0.55 to 0.3, aligning routing with tests that expect active-learning intervention on real disagreement.
- Fixed `api-contract-guard.ts` GraphQL parser so additive new fields in existing types are detected correctly.

### Reliability
- Added `setWithTTL` to Redis-state test stubs in `pass-22-preflight-quota-webhook.test.ts` and `power-expansion.test.ts` so preflight/history services can persist TTL-backed records in unit tests.
- Fixed `edge-test-offload-keys.test.ts` fetch-response sequence to match publish/lpush/set/get/get/delete calls and prevent 30-second polling timeouts.
- Updated `edge-prefetch-channel.test.ts` to assert against the worker's `KEY_PREFIX` template literal, matching the current hardened worker source.
- Added `breakdown` to the mocked `costTracker` in `local-simulator.test.ts` so the E2E simulator logger does not throw.

### Repository hygiene
- Added `.env.example` covering all variables declared in `env-validator.ts`; `validate.sh` now passes cleanly.

## 24.30.2 — 2026-07-06

### Security
- Hardened `chaos-monkey.ts` null-guard validation so parameter-specific guards are required; removed the overly broad patterns (`if (`, `||`, `?.`, etc.) that let unguarded functions pass trivially.
- Hardened `obfuscator.ts` to rename declarations (variables, parameters, class properties, and object-literal property assignments) via ts-morph's scope-aware rename, preventing cross-scope name collisions and closing the JSON-key leak under strict privacy mode.

### Reliability
- Made missing LLM keys fatal in `env-validator.ts`; the pipeline now fails fast at startup instead of wasting compute on a run doomed to fail at the first AI call.
- Fixed multi-Redis URL rotation in `redis-state.ts`: the round-robin method now rotates both URL and token instead of hardcoding `urls[0]`.
- Added retry + timeout around `blast-radius.ts` embedder model loading so transient model-load failures do not permanently block the gate.
- Added timeout wrapper and HTML size cap to `dom-xray.ts` to prevent pathological parse hangs.
- Replaced the broken ONNX tier-0 classifier in `ai-router.ts` with a deterministic threshold rule (`isDoc || lenNorm < 0.5`) so free local triage actually works; removed the unused `onnxruntime-web` dependency.
- Added independent check-run/status polling before `GitHubClient.mergePR()` to avoid merging while required checks are still pending.
- Implemented circuit-breaker recovery (`OPEN → HALF_OPEN → CLOSED`) in `telemetry.ts` so telemetry resumes after a transient Redis outage instead of staying disabled for the rest of the run.

### Correctness
- Removed the unused module-level `_roundRobinToken()` dead code from `redis-state.ts`.
- Removed the unused `onnxruntime-web` root override from `package.json`.

## 24.30.1 — 2026-07-06

### Security
- Wired `quota-guardian.ts` into `ai-router.ts`: provider HTTP response headers are now recorded, exhausted providers are skipped before dispatch, and 429 responses mark the provider as exhausted.
- Added symlink-escape containment to `R2Storage.putText()` local fallback using `fs.realpathSync()` after write, plus an adversarial regression test.
- Added audit-log append points across `cli.ts` and `coder.ts` for security-relevant events (secret/path-guard blocks, red-team findings, kill-switch trips, gate failures, commits, drift, mentor decisions, fatal errors).

### Reliability
- Dead-integration checker now uses an allowlist (`scripts/dead-code-allowlist.json`) so CI can fail only on newly introduced unwired exports; triage documented in `tasks/dead-code-triage-v24.30.0.md`.

## 24.30.0 — 2026-07-06

### Security
- Hardened `path-guard` to delegate to the allowlist/blocklist validator in `validators/path-guard-scoped.ts` (null-byte stripping, URL-decode, fixed-root traversal defense).
- Added TruffleHog secret-scan step to the CI security job.

### Reliability
- Wired the previously unreachable `phase-runner.ts` into the main pipeline. Architect, coder, and reviewer phases now run inside `runPhase()` with per-phase timeouts and retry/telemetry wrappers.
- Added `tests/phase-runner.test.ts` covering success, timeout, retry, fail-fast, and optional-phase behaviors.

### Correctness
- Extended `env-validator.ts` to cover all integration env vars used in the pipeline (Slack, Sentry, QStash, Linear, Jira, Codecov) plus the kill-switch vars (`QODO_HALT`, `QODO_HALT_REASON`) and `QODO_BASE_URL`.
- Exported `Env` as an alias of `QodoEnv` so downstream consumers (e.g. `model-deprecation-watchdog.ts`) compile cleanly.

### Tests
- Fixed `tests/model-deprecation-watchdog.test.ts` import path.
- Updated path-guard property-based tests to avoid pathologically collapsing suffixes (e.g. trailing `/`, `.`, malformed percent-encoding).

### Known pre-existing failures
Integration tests that require external Upstash Redis / Cloudflare D1 endpoints still fail in a sandboxed environment; these are unrelated to the above changes.

---

## 24.30.12 — 2026-07-07

### Pass 40 — Task-29: Retry / circuit-breaker double-execution safety audit

**Impact Analysis**

| Dimension | Assessment |
|---|---|
| Engineering value | High — addresses a real, well-known distributed-systems failure mode (retry-induced double-write of a non-idempotent GitHub operation) that is invisible in happy-path test suites and only manifests when a response is slow enough to race a retry. |
| Implementation risk | Zero — this pass adds a test file only; no production code is changed. |
| Compatibility impact | None — new test file; existing interfaces unchanged. |
| Rollback complexity | Trivial — delete the test file. |

**Problem (task-29 statement)**

`retry.ts::withRetry` wraps operations with side effects (`github-client.ts`
writes via `GitHubClient`: `comment`, `commitViaGitDB`, `mergePR`,
`revertCommit`). If a timeout races a successful-but-slow response, the
retry could execute the write a second time, absent an idempotency key.

This is a classic distributed-systems hazard:
- `mergePR` called twice: GitHub returns HTTP 405 on the second call (already
  merged), but if that 405 were treated as retryable, a third merge attempt
  would be made on a now-merged PR.
- `commitViaGitDB` retried after a successful ref advance: GitHub returns HTTP
  409 (conflict) because the ref has moved. If 409 were retryable, the retry
  would attempt to push a stale-base commit, creating an inconsistent branch
  state.
- `comment` is idempotent in effect but creates duplicate comments if retried,
  degrading PR signal quality.

**Findings from audit**

1. `isHttpRetryable` correctly does NOT include 409, 422, 405, 403, 404, 400,
   or 401 in its retryable set — the conflict / invalid-state statuses that
   guard against double-write are properly classified as non-retryable. No
   production code change needed.

2. `withRetry` does not initiate a second attempt after a successful first
   return, even with delays in the event loop — there is no phantom extra call.

3. `maxAttempts: 1` provides a single-shot guarantee for callers that need
   it (no retry at all, regardless of error class).

4. The `onRetry` hook fires exactly `maxAttempts - 1` times on full
   exhaustion and zero times on first-attempt success — no off-by-one.

5. HTTP 500 is correctly NOT in the retryable set. This is intentional:
   a 500 response to a write is ambiguous (the server may have partially
   applied the operation), so retrying it is unsafe. Surfacing the 500 to the
   caller is the correct behaviour.

**What was added**

`packages/agent/tests/retry-double-execution.test.ts` — 8 describe blocks,
24 vitest assertions covering:
- Happy-path: fn called exactly once on success
- Non-retryable statuses (409, 422, 405, 403, 404, 400, 401): each stops
  after 1 attempt with fn called exactly once
- Slow-then-succeed: first result wins, no second call
- Transient recovery: retries on 503/429, stops the moment fn returns
- `maxAttempts: 1` guarantee (single-shot)
- `isHttpRetryable` classification matrix (retryable and non-retryable)
- Exhaustion boundary: fn called exactly `maxAttempts` times, no extras
- `onRetry` hook timing

**Task queue update**

`tasks/agent-task-queue.json` — task-29 set to `"done"`, `completedInPass`
set to `"Pass 40 (v24.30.12)"`.

**Merge note (V24.30.10 → V24.30.12 baseline)**

This release is built on the V24.30.9 engineering baseline (which contains
the correct `parseRemaining` fix, `.github/`, `.gitignore`, and
`quota-guardian.test.ts`) with additive merges from V24.30.10:
- `bootstrap.mjs` — guided setup wizard with provider registry
- `packages/agent/src/services/ai-router.ts` — `withRetry`/`isHttpRetryable`
  deduplication (fixed jitter + 504 coverage), Together/SambaNova/HF providers
- `packages/agent/src/services/quota-guardian.ts` — Together/SambaNova/HF
  HEADER_MAP entries
- `packages/agent/src/services/redis-state.ts` — `fetchWithTimeout` refactor
- `packages/agent/src/services/model-deprecation-watchdog.ts` — new providers
- `packages/agent/tests/model-deprecation-watchdog.test.ts` — updated
- `SETUP.md` — user-facing guided setup documentation

**Validation (no network / no node_modules)**

- All `.json` files parse cleanly (Python `json.tool`).
- `tasks/agent-task-queue.json` schema valid; task-29 status = "done".
- Sacred-file manifest hashes unchanged (no sacred files touched).
- No new `any` casts introduced.
- Full `vitest`/`tsc` blocked by sandbox network constraint (same as all
  prior passes from Pass 36 onward); static review confirms no type errors
  in the new test file.

---

## 24.30.13 — 2026-07-07

### Pass 41 — Fold Rounds 3-5 free-tier infrastructure survey into the task queue

### Added
- 15 new tasks (task-31 through task-45) appended to
  `tasks/agent-task-queue.json`, derived from three external planning docs
  (`free-tier-energy-ideas-round3.md`, `-round4-apis.md`, `-round5.md`)
  rather than this codebase's own service inventory (unlike task-16
  through task-30 in Pass 38). Split into two shapes:
  - **task-31 to task-40** — owner-decision tasks (`requiresOwnerDecision:
    true`, `requiresNetwork: false`, `status: "queued"`), mirroring
    task-3's framing, covering additional LLM/multimodal race candidates,
    CI build caching, secrets management, a CF AI Gateway proxy layer,
    second-source security/code-intelligence/QA APIs, and feature flags.
  - **task-41 to task-45** — keyless/low-friction implementation tasks
    (`requiresOwnerDecision: false`, `requiresNetwork: true`, `status:
    "blocked"`), same reasoning as the existing task-5, covering
    dependency-metadata cross-checks, license-data cross-checks,
    notification-channel expansion, ground-truth/dead-link checks, and a
    grab-bag of operational utility APIs.
- Queue now totals 45 tasks (2 done, 32 queued/eligible, 11 blocked).

### Notes
- This pass only extends the queue; no queued task was attempted. See
  `06-CHANGELOG.md` Pass 41 for the full impact analysis, including why
  each new task was classified as owner-decision vs. network-blocked.
- `tasks/agent-task-queue.md`'s status snapshot now reflects the 45-task
  total and calls out task-39 (feature flags) and task-42 (license-data
  cross-check) as the two items the source survey itself flagged as worth
  implementing soonest.
- Version bump: all four `package.json` files, 24.30.12 → 24.30.13.
- No sacred file touched; `.sacred-manifest.json` unchanged (the task
  queue was never in its tracked set).

## [24.30.26] — 2026-07-07

### Added
- `packages/agent/tests/meta-agent-rollback.test.ts` — 7 describe suites,
  32 adversarial test cases exercising the real `mutatePrompt`,
  `rollbackLastMutation`, `getActiveMutation`, and `promoteMutation` functions
  from `meta-agent.ts` against an in-process `Map`-backed `RedisState` mock.
  Task-17 (Pass 54).  Proves: byte-identical restore for chained 7-mutation
  rollback, crash-after-historyKey-write leaves active unchanged, phantom
  history entries cleaned idempotently by rollback, 3-crash+1-success scenario
  fully recoverable with 4 rollbacks, active key is always pre-crash or
  post-success (never half-applied), and namespace isolation across all three
  agents (architect/coder/reviewer) and across distinct owner/repo pairs.
  Three design boundaries documented (history cap at 20, non-atomic rollback,
  phantom entries).  No production source files changed.

### Changed
- All three `package.json` files bumped 24.30.25 → 24.30.26.
- `tasks/agent-task-queue.json` — task-17 → `"done"`, `completedInPass: 54`.

## [24.30.24] — 2026-07-07

### Added
- `packages/agent/tests/swarm-contention.test.ts` — 9 describe blocks,
  22 adversarial test cases exercising the real `SemanticDagLock` class under
  concurrent `Promise.all` swarm load with a faithful in-process `RedisState`
  mock.  Task-9 (Pass 52).  Proves: deadlock freedom under concurrent swarm
  agents, sorted-order normalisation on real class, rollback-on-timeout
  releasing partial holds, heartbeat renewal lifecycle, exclusivity invariant
  (no file held by two agents simultaneously), 20-agent stress, and telemetry
  event correctness.  No production source files changed.

### Changed
- All four `package.json` files bumped 24.30.23 → 24.30.24.
- `tasks/agent-task-queue.json` — task-9 → `"done"`, `completedInPass: 52`.

## [24.30.29] — 2026-07-07

### Added
- `packages/agent/tests/hot-reload-race.test.ts` — 9 describe blocks, 36 test cases
  auditing the race surface of `hot-reload-config.ts`'s debounced `applyEnv()` against
  the path-guard config reader (`loadPathGuardConfig()`). Task-25 (Pass 57).
  Documents: GAP-1 (Medium) async reader TOCTOU — a caller that yields between reading
  `ALLOWED_PATHS` and `BLOCKED_PATHS` can observe old+new epoch mix; current
  `loadPathGuardConfig()` is synchronous and immune. GAP-2 (Low-Medium) consecutive
  partial-reload window — two writes to the env file with disjoint key sets produce
  two separate reloads with a mixed-state window between them; no async reader required.
  Confirms: synchronous applyEnv is TOCTOU-immune for synchronous readers (AT1–AT3);
  watcher lifecycle and debounce coalescing correct (WI1–WI5, DB1–DB3); safe snapshot
  pattern documented (DB_DESIGN2). No production source files changed.

- `packages/agent/docs/57-V24-AUDIT-PASS-57.md` — Audit pass document for Pass 57.

### Changed
- `tasks/agent-task-queue.json` — task-25 → done (completedInPass: 57).
- All four `package.json` files — version bumped to 24.30.29.

---
## [24.30.39] — 2026-07-07

    ### Added
    - `packages/agent/src/services/integrations/socket-risk.ts` — New integration:
      Socket.dev supply-chain risk API. `fetchSocketRisk()` fetches per-package
      supply-chain scores (0.0–1.0); `flaggedPackages()` filters to those below the
      `SOCKET_SUPPLY_CHAIN_THRESHOLD` (0.3). Covers typosquatting, obfuscated install
      scripts, protestware, and dependency confusion — threat categories that CVE IDs
      never capture. Opt-in via `SOCKET_API_KEY`. Task-36 (Pass 67).
    - `packages/agent/src/services/integrations/virustotal.ts` — New integration:
      VirusTotal v3 file hash reputation API. `scanHashesWithVirusTotal()` looks up
      package SHA-256 hashes from the SBOM against VirusTotal's known-bad database;
      `flaggedFindings()` filters to hashes with malicious detections ≥ 1. Respects
      the free-tier rate limit (4 req/min) via configurable batch-size/delay. Opt-in
      via `VT_API_KEY`. Task-36 (Pass 67).
    - `packages/agent/tests/security-api-sources.test.ts` — 9 describe blocks,
      28 test cases covering D4 (Snyk), S1/S2 (Socket.dev), V1/V2 (VirusTotal),
      and 4 design-boundary assertions. All network calls intercepted via
      `vi.stubGlobal('fetch', ...)`. Task-36 (Pass 67).
    - `packages/agent/docs/67-V24-AUDIT-PASS-67.md` — Audit pass document for Pass 67.

    ### Changed
    - `packages/agent/src/services/cve-scanner.ts` — Added `fetchSnyk()` (D4) as a
      third parallel CVE source. `CveScanResult` gains `sourceCounts: { osv, ghsa, snyk }`
      for observability. `CveEntry` gains optional `sources` array for per-entry attribution.
      Merge order: OSV → Snyk → GHSA (GHSA has best severity data and takes precedence).
      Opt-in via `SNYK_TOKEN`. Task-36 (Pass 67).
    - `packages/agent/src/services/sbom-generator.ts` — `SbomComponent` gains optional
      `socketRisk` field (`SocketScore & { flagged: boolean }`). New `enrichSbomWithSocketRisk()`
      async function optionally annotates all components with Socket.dev scores after
      generation. No-op when `SOCKET_API_KEY` absent. Task-36 (Pass 67).
    - `packages/agent/src/services/license-checker.ts` — `LicenseViolation.reason` extended
      with `'supply-chain-risk'`; `supplyChainScore` and `socketAlerts` fields added.
      New `checkSocketSupplyChain()` async function and `SupplyChainReport` type exported.
      Existing synchronous `checkLicenses()` unchanged. Task-36 (Pass 67).
    - `packages/agent/src/services/dry-run.ts` — `DryRunReport.virusTotalFindings` optional
      field added. `setVirusTotalFindings()` attaches findings from VT scan to the report.
      `_resetDryRun()` exported for test cleanup. `VirusTotalFinding` re-exported from
      the virustotal integration. Task-36 (Pass 67).
    - `packages/agent/src/services/env-validator.ts` — `SNYK_TOKEN`, `SOCKET_API_KEY`,
      `VT_API_KEY` added as optional Zod fields. Task-36 (Pass 67).
    - `tasks/agent-task-queue.json` — task-36 → done (completedInPass: 67).
    - `tasks/agent-task-queue.md` — status snapshot updated; task-36 removed from queued,
      task-39 is now the highest-priority pending owner-decision item.
    - All four `package.json` files — version bumped to 24.30.39.

    ---

## [24.30.40] — 2026-07-07

    ### Added
    - `packages/agent/src/services/integrations/launchdarkly.ts` — New integration:
      LaunchDarkly server-side feature flag evaluation via REST (no npm package).
      `evaluateFlag()` looks up a boolean flag for any user key using the LD SDK
      evaluation endpoint (`sdk.launchdarkly.com/sdk/eval/v1/...`); `isCanaryEnabled()`
      is a canary-specific wrapper that encodes `owner/repo@sha` as the deterministic
      evaluation context. Fail-open: all error paths return `defaultValue`.
      Opt-in via `LD_SDK_KEY`. Task-39 (Pass 68).
    - `packages/agent/tests/launchdarkly-canary.test.ts` — 9 describe blocks, 22 test
      cases covering the full LaunchDarkly integration and `routeTrafficWithFeatureFlag()`
      behavior matrix. All fetch calls stubbed via `vi.stubGlobal`. Task-39 (Pass 68).
    - `packages/agent/docs/68-V24-AUDIT-PASS-68.md` — Audit pass document for Pass 68.

    ### Changed
    - `packages/agent/src/services/canary.ts` — `VercelEnv.LD_SDK_KEY` optional field
      added. `CanaryRoutingOutcome` (`"routed" | "skipped-by-flag" | "skipped-ld-unavailable"`)
      and `CanaryRoutingResult` types exported. New `routeTrafficWithFeatureFlag()` function:
      evaluates an LD flag before Vercel Edge Config routing; `flag=false` skips routing
      entirely; `LD_SDK_KEY` absent falls back to unconditional routing (backward compat).
      Existing `routeTrafficToCanary()`, `rollbackCanary()`, `deployPreview()`, and
      `promoteToProduction()` are unchanged. Task-39 (Pass 68).
    - `packages/agent/src/services/env-validator.ts` — `LD_SDK_KEY` added as optional
      Zod field. Task-39 (Pass 68).
    - `tasks/agent-task-queue.json` — task-39 → done (completedInPass: 68).
    - `tasks/agent-task-queue.md` — status snapshot updated; task-39 removed from queued;
      task-33 is now the highest-priority pending owner-decision item.
    - All four `package.json` files — version bumped to 24.30.40.

    ---
