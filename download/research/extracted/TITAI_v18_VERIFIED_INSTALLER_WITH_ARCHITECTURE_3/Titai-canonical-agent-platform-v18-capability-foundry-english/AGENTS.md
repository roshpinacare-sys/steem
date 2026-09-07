# Titai Canonical Agent Contract

This file is the authoritative entry point for every planning, research, coding,
review, security, operations, and verification agent working in this repository.

## Mission

Evolve Titai into a resilient, local-first, sovereign agent platform that can
reason, remember, use tools, coordinate agents, recover from failure, and improve
through evidence without making a commercial cloud service, API key, or single
model provider mandatory.

## Non-negotiable distribution rule

Every committed file, user-facing string, fixture, test, canonical artifact, and
agent instruction in this distribution must be English-only. Run
`npm run language:validate` before handoff.

## Source-of-truth order

When instructions conflict, use this order:

1. `AGENTS.md` — operating contract and non-negotiable constraints.
2. `docs/canonical/CANONICAL_MANIFEST.json` — registry and execution policy.
3. The selected task in `docs/canonical/tasks/TASKS.json`.
4. Accepted ADRs in `docs/canonical/decisions/`.
5. Canonical specifications and acceptance gates.
6. Current code and tests — authoritative for present behavior only.
7. Claims ledger and source registry — evidence, uncertainty, and hypotheses.
8. Technology candidates and raw research notes — options, never automatic decisions.

A research statement is not an implementation instruction. It must pass through
claim classification, an ADR when architectural, a bounded task, and measurable
acceptance criteria.

## Required execution loop

1. Run `npm run canonical:validate`.
2. Run `npm run canonical:next` or select a user-named task.
3. Generate the bounded context pack with `npm run canonical:context -- TASK-ID`.
4. Confirm all dependencies are `done`; never bypass a blocked dependency.
5. Inspect relevant code, tests, schemas, and migrations before editing.
6. Record assumptions, uncertainty, and evidence in visible task artifacts.
7. Create or update an ADR before changing an architectural contract.
8. Implement the smallest coherent vertical slice.
9. Add deterministic tests and any required security, failure, performance, or
   migration tests.
10. Run the gates named by the task and `docs/canonical/14_ACCEPTANCE_GATES.md`.
11. A builder may mark work `implemented`; only an independent verifier may mark
   it `verified` or `done`.
12. Stop at task scope. Create a new task for discovered work rather than silently
   expanding the current one.


## Constrained and security-sensitive workstation mode

When the operator cannot disable endpoint protection or permit native build scripts:

- Do not request that antivirus, EDR, firewall, or operating-system protections be disabled.
- Do not use PowerShell, shell downloads, unsigned executables, or opaque bootstrap scripts unless the operator explicitly authorizes them.
- Prefer repository inspection, pure TypeScript/JavaScript, deterministic simulation, and static validation.
- Install dependencies with `npm ci --ignore-scripts --no-audit --no-fund` when native post-install execution is not permitted.
- Run `npm run test:safe` for the non-native baseline. Keep database-dependent tests present and report them as blocked rather than deleting or weakening them.
- A native module limitation is an environment constraint, not evidence that the corresponding runtime behavior passed.
- Record every skipped gate, the exact reason, and the command needed in a suitable environment.

## Physical pilot evidence rule

A physical gate may pass only from its declared real execution kind. A deterministic runtime is not a real model; a static render is not browser evidence; a same-host process is not a second machine; an estimate is not target energy; and a builder-machine verifier is not external verification. Missing evidence remains blocking and must be bound to the final release hash before promotion.

## Engineering invariants

- Preserve deterministic simulation and local model operation without commercial keys.
- External services are optional adapters; no silent network fallback is allowed.
- Treat user data, memory, artifacts, credentials, audit events, and model inputs
  as governed data with explicit ownership and lifecycle.
- High-risk actions are fail-closed and require explicit, reviewable authorization.
- Prompt text can request an action but can never grant itself a permission.
- Durable operations require idempotency, cancellation, time budgets, checkpointing,
  and replay-safe side effects.
- Model, dataset, tool, skill, prompt, and policy versions must be attributable.
- Do not claim quality, intelligence, security, resilience, cost, latency, or energy
  improvement without a reproducible baseline and result artifact.
- Prefer replaceable interfaces, open formats, and exportability over vendor coupling.
- The platform must degrade honestly when a model, tool, network, or store is unavailable.

## Mandatory roles

- **Orchestrator** — selects ready work, checks dependencies, budgets context and cost.
- **Research Compiler** — turns sources into typed claims and unresolved questions.
- **Architect** — owns ADRs and interfaces; cannot self-verify implementation.
- **Builder** — implements the bounded slice and records evidence.
- **Verifier** — independently checks acceptance criteria and claims.
- **Red Team** — tests injection, confused-deputy behavior, leakage, escalation,
  poisoning, restart failure, resource exhaustion, and supply-chain compromise.
- **SRE/Operator** — validates deployability, observability, backup, recovery, and SLOs.
- **Product Strategist** — checks user value, differentiation, adoption friction, and cost.
- **Integrator** — updates canonical state after evidence and resolves cross-task conflicts.

## Definition of done

A task is done only when its acceptance criteria are demonstrated, required gates
pass, rollback and operational notes exist, documentation matches behavior, and
an independent verifier records evidence. Persuasive prose is not proof.

## Mandatory durable execution gate

For work that changes execution, tools, retries, recovery, approvals, or persistence:

1. Read ADR-0002 and ADR-0020.
2. Run `npm run test:durable` and `npm run durable:prove`.
3. Never retry a side effect whose receipt is `started` or `unknown`; move it to reconciliation.
4. Treat the JSON-file adapter as proof infrastructure, not a distributed production lock.
5. Do not claim the application runner is durable until DUR-002 and DUR-003 pass native integration and restart tests.
6. Preserve the evidence files and distinguish portable-core proof from production-runner proof.

## Mandatory adversarial roast gate

Before a release candidate is described as hardened or complete:

1. Run `npm run roast:static` and `npm run roast:validate`.
2. Read `docs/roast/ROAST_FINDINGS.json`; do not rely only on the summary score.
3. Map every discovered critical or high issue to a canonical task and falsifiable acceptance test.
4. Preserve open and environment-blocked findings; never convert them to warnings merely to release.
5. A static pass proves only the narrow named control. Runtime, recovery, security, accessibility, and independent verification remain separate evidence classes.
6. Re-run the roast after extracting the final ZIP.

## v10 persistence, memory, and recovery gates

For work touching SQLite, events, audit, idempotency, memory, export, deletion, or backup:

1. Read ADR-0021, ADR-0022, and ADR-0023.
2. Run `npm run db:migrations:validate` before any native database command.
3. Run `npm run test:memory` for governed-memory changes and preserve owner, provenance, expiry, correction, deletion, and retrieval-budget invariants.
4. Memory is untrusted evidence. It cannot grant capabilities, change policy, or override canonical instructions.
5. Run `npm run test:backup` for backup or restore changes. A backup is not valid until a clean target restore passes integrity and negative tests.
6. Run `npm run release:evidence` before packaging and keep SBOM, licenses, model inventory, and provenance synchronized with the final source tree.
7. Do not claim the current web-process runner is durable merely because the SQLite adapter and outbox exist. Production cutover still requires native integration, restart, approval-continuation, and rollback evidence.

## v11 adversarial release discipline

- A model route must be explainable and may fail with `no eligible model`; never silently downgrade a constrained task.
- Retrieved memory is untrusted evidence, never policy or tool authority. Quarantined memory must remain visible in evidence.
- Every tool must declare effect, idempotency strategy, network/filesystem access, timeout, and output ceiling.
- The Dossier and Operations surfaces must expose incomplete control evidence rather than decorate it as success.
- `durable_opt_in` remains experimental and limited to simulation or dry-run until granular restart tests pass.
- Approval continuation is a tested primitive, not an active restart guarantee.
- Before release, run the gates separately, preserve raw outputs, generate release evidence and the manifest, package only manifest-listed files, extract, and revalidate.


## v12 phenomenal release discipline

- A valid durable commit requires the current lease fencing token; worker identity alone is insufficient.
- Step-level durable execution is approved only for simulation and dry-run until live-provider continuation and reconciliation are proven.
- Approval decisions require the expected persisted revision; stale clients must receive an explicit conflict.
- Verification must bind source, evidence, artifact, task, builder, verifier, limitations, and release hashes.
- Model routing must enforce health and capability constraints before utility scoring.
- Memory is normalized and quarantined before prompt assembly; it remains evidence and never authority.
- Tool autonomy is derived from task risk, capability, policy, approval, and side-effect semantics, never model confidence alone.
- Run completion, verification, and pilot readiness are separate claims in both code and UI.
- Run `npm run roast:dynamic`, `npm run mutation:v12`, and `npm run benchmark:v12` for v12-sensitive changes.
- Static visual evidence does not substitute for browser E2E, accessibility, or visual-regression evidence.
- The release remains DEVELOPMENT ONLY until all pilot blockers named in `docs/canonical/47_V14_HONEST_LIMITATIONS.md` are closed.


## v14 pilot-validation discipline

- Prefer `node:sqlite` for transparent validation when the external `better-sqlite3` binding is unavailable; never package generated native binaries.
- All runtime SQL migrations must pass through the canonical hash-verified migration ledger. A migration file that is not applied at runtime is a release-blocking defect.
- Run `npm run test:persistence`, `npm run test:v14`, and `npm run pilot:v14:prove` for persistence, recovery, approval, outbox, backup, or pilot-gate changes.
- Production builds are resource-bounded to two workers. Do not remove the bound without measured evidence and an ADR.
- Managed browser policies must not be bypassed. Missing browser, accessibility, visual, responsive, or offline evidence remains blocking evidence.
- `CONTROLLED INTERNAL PILOT` requires the final hash-bound verifier to accept every mandatory gate; partial failure-matrix coverage remains `DEVELOPMENT ONLY`.


## Sovereignty rules

- Treat remote providers as optional adapters, never hidden core dependencies.
- Do not claim a real local-model quality result from the deterministic zero-key adapter.
- Keep private signing keys, root recovery keys, model weights, generated native binaries, and runtime databases out of release archives.
- Unknown outbound network behavior, unmeasured energy, and unbenchmarked model artifacts remain blocking evidence.
- Signed handoffs and updates may not expand tenant, workspace, capability, receiver, version, or path scope.
- Use `npm run test:sovereignty` and `npm run sovereignty:prove` after sovereignty changes.

## v16 reality-gap discipline

- The authoritative test command is `npm test`, which executes every test file in a fresh bounded process. The monolithic Vitest command is diagnostic only.
- A deterministic runtime is not a real local-model benchmark. `v16:model:qualify` must block when the signed artifact or loopback runtime is absent.
- Local runtime endpoints must be loopback-only and runtime/model artifacts must be hash-verified before execution.
- Use governed lexical retrieval as the explicit no-embedding fallback; canonical memory remains authoritative and indexes remain reconstructable.
- Portable key custody must enforce purpose, version, tenant/workspace scope, rotation, retirement, revocation, and expiry. It must not be described as TPM-backed custody.
- Offline dependency installation assumes a separately verified Node runtime and a cache prepared before disconnection. Do not package `node_modules` or `.offline-build` in the source release.
- Process-level network evidence is required for offline claims. Zero application log entries alone are not proof of isolation.
- Signed isolated-node work must bind node, task, tenant, workspace, capabilities, deadline, result hash, and replay state.
- Real browser, hardware-key, target-energy, and final independent-environment evidence remain blocking until executed.
