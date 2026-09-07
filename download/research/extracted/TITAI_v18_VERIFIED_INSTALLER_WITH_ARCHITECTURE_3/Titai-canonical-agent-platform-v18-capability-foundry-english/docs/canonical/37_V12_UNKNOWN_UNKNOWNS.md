# TITAI v12 Unknown Unknowns Ledger

Each entry began as a testable hypothesis rather than a documentation assumption.

## UU-001 — CRITICAL / verified_gap
- **Hypothesis:** The active durable runner is step-recoverable only for simulation or dry-run execution.
- **Experiment:** Inspect the startRun durable cutover guard and run-mode tests.
- **Result:** Non-simulation, non-dry-run durable execution is rejected.
- **Evidence:** src/lib/engine/runner.ts, tests/runner-mode.test.ts
- **Next action:** Prove live-provider tool continuation and side-effect reconciliation before removing the guard.

## UU-002 — HIGH / verified_gap
- **Hypothesis:** Durable recovery scheduling depends on an HTTP list request rather than a dedicated worker loop.
- **Experiment:** Trace all recoverDurableRuns call sites.
- **Result:** Recovery is opportunistically triggered from the runs API.
- **Evidence:** src/app/api/runs/route.ts, src/lib/engine/runner.ts
- **Next action:** Add a bounded worker entrypoint with heartbeat, shutdown, backpressure, and deployment ownership.

## UU-003 — CRITICAL / verified_gap
- **Hypothesis:** Approval state is durable but the active model conversation is not restart-continuable.
- **Experiment:** Resolve an approval after the active process entry is absent.
- **Result:** The run is intentionally marked interrupted because conversation continuation is not serialized.
- **Evidence:** src/lib/engine/runner.ts, src/lib/durable/approval-continuation.ts
- **Next action:** Persist conversation, tool intent, iteration, and step checkpoint or redesign execution around message-driven turns.

## UU-004 — HIGH / verified_gap
- **Hypothesis:** Model capability values can be self-entered without signed benchmark provenance.
- **Experiment:** Inspect the model-profile API and routing evidence model.
- **Result:** Profiles accept bounded scores but do not require benchmark artifact hashes or signed evaluators.
- **Evidence:** src/app/api/models/route.ts, src/lib/models/router.ts
- **Next action:** Bind promotion-eligible scores to immutable evaluation runs and evaluator identity.

## UU-005 — HIGH / verified_gap
- **Hypothesis:** Verification attestations prove integrity of supplied evidence references but do not execute or independently acquire the tests.
- **Experiment:** Inspect attestation creation and API behavior.
- **Result:** The verifier supplies hashes and a command; integrity is checked, execution provenance is not automatically acquired.
- **Evidence:** src/lib/verification/attestation.ts, src/app/api/runs/[runId]/verify/route.ts
- **Next action:** Create a verifier worker that checks out the source hash, executes the command, and signs the result.

## UU-006 — HIGH / verified_gap
- **Hypothesis:** Owner scoping is not a complete tenant and workspace authorization model.
- **Experiment:** Compare the authorization contract with persisted resource columns.
- **Result:** Most resources have owner scope; tenant and workspace identity are not persisted end-to-end.
- **Evidence:** src/lib/auth/authorization.ts, src/lib/db/schema.ts
- **Next action:** Define deployment mode explicitly or add tenant/workspace columns, centralized policy, migrations, and cross-tenant tests.

## UU-007 — MEDIUM / verified_gap
- **Hypothesis:** The CSP still permits inline scripts and styles.
- **Experiment:** Inspect the generated Content-Security-Policy.
- **Result:** Both script-src and style-src include unsafe-inline for framework compatibility.
- **Evidence:** next.config.ts
- **Next action:** Evaluate nonce or hash-based CSP during a real production build and browser E2E run.

## UU-008 — HIGH / verified_gap
- **Hypothesis:** The tool broker is policy-rich but tools still execute inside the application process.
- **Experiment:** Trace executeBoundedTool and tool implementations.
- **Result:** Timeout and output bounds exist, but there is no OS-level isolation boundary.
- **Evidence:** src/lib/engine/tool-runtime.ts, src/lib/engine/tools
- **Next action:** Introduce replaceable WASI, container, or microVM executors for high-risk tools.

## UU-009 — HIGH / environment_blocked
- **Hypothesis:** SQLite transactional behavior and API integration remain unproven in this package without the native binding.
- **Experiment:** Collect native-dependent test suites.
- **Result:** The suites cannot load better_sqlite3.node after lifecycle scripts were intentionally disabled.
- **Evidence:** tests/runner.integration.test.ts, tests/audit.test.ts, tests/approval-expiry.test.ts
- **Next action:** Run preserved suites on an approved development or CI machine without weakening endpoint protection.

## UU-010 — MEDIUM / verified_gap
- **Hypothesis:** Feature flags and compatibility modes may remain indefinitely and diverge.
- **Experiment:** Inspect runner mode definitions and canonical tasks for removal criteria.
- **Result:** Modes are explicit but do not yet have measured promotion and retirement dates.
- **Evidence:** src/lib/engine/runner-mode.ts, docs/canonical/tasks/TASKS.json
- **Next action:** Attach shadow-divergence thresholds and removal criteria to the durable cutover task.

## UU-011 — MEDIUM / verified_gap
- **Hypothesis:** Local metrics cannot prove external availability or production load behavior.
- **Experiment:** Inspect the operations metrics data sources.
- **Result:** Metrics are derived from local persisted observations without external probes or distributed traces.
- **Evidence:** src/lib/observability/metrics.ts, src/components/operations/control-room.tsx
- **Next action:** Add privacy-controlled external probes or OpenTelemetry-compatible export as an optional adapter.

## UU-012 — HIGH / verified_gap
- **Hypothesis:** Audit integrity is local and not externally anchored.
- **Experiment:** Inspect audit append and release provenance.
- **Result:** The chain is transactionally appended but has no external transparency-log or signed checkpoint.
- **Evidence:** src/lib/engine/audit.ts, docs/canonical/evidence/release/BUILD_PROVENANCE.json
- **Next action:** Add optional signed audit checkpoints and offline-verifiable export.
