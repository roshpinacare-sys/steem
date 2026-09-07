# TITAI v13 Controlled Internal Pilot Convergence - Engineering Report

**Release classification: DEVELOPMENT ONLY**

**Mission date:** July 11, 2026

## Executive Summary

v13 narrows TITAI to one Golden Pilot Workflow: a local artifact-generation task inside a personal tenant/workspace, with governed memory, measured model routing, risk-adjusted tool authority, persisted human approval, durable pause/resume, evidence, independent verification requirements, and encrypted backup. The package is materially closer to a controlled pilot, but seven mandatory gates remain blocked and the release is not promoted.

The most important completed improvement is a real build-boundary correction: SQLite is now opened lazily on the first database operation rather than during module import. The full Next.js production source build completes successfully in 47.814 seconds without a generated native binding. Runtime native persistence remains a separate mandatory gate.

## Golden Pilot Boundary

- One owner/operator in a deterministic personal tenant and primary workspace.
- Bounded local artifact generation only.
- Simulation by default; a local provider only after isolated validation.
- Bounded reads and `artifact.write`; writes require revisioned human approval.
- Governed evidence, semantic, preference, and decision memory; restricted or poisoned records are excluded.
- No shell, external autonomous writes, enterprise shared tenancy, unreviewed plugins, or restart-unsafe remote conversations.

## Reproduction of v12

The v12 archive hash and baseline claims were reproduced before implementation. The existing safe regression, 8/8 evaluation, one-side-effect crash proof, static/dynamic Roast, and curated mutations remained intact. v13 then expanded the safe suite to 44 files and 147 tests.

## Architecture Changes

### Tenant and Workspace Scope

Pilot resources now persist tenant, workspace, owner, and visibility. Scope applies to runs, steps, approvals, artifacts, memories, policies, templates, model profiles, durable jobs, receipts, and verification attestations. This is a bounded personal-workspace model, not a claim of enterprise multi-tenancy.

### Restart-Oriented Approval Continuation

Risky tool approval is identified by a deterministic continuation key. The durable worker can release the lease while approval is pending. A later decision uses revision compare-and-set, requeues the job, and resumes from the continuation checkpoint. Rejection, expiry, duplicate resolution, and stale-browser decisions fail closed.

### Build and Runtime Separation

The database module previously opened SQLite at import time. Next.js imports API modules while collecting build metadata, causing source builds to require a prebuilt native binding. v13 introduces lazy initialization and dynamic authenticated pages. A regression test verifies import without opening SQLite, and the production build now passes.

### Pilot Readiness Control Plane

Pilot readiness is computed from actual scope, durable job, receipt, approval, model, memory, capability, artifact, reconciliation, verification, and release evidence. Unknown evidence is blocking evidence. Runtime completion is not verification and verification is not pilot eligibility.

## Validation Results

| Gate | Result |
|---|---|
| Canonical validation | Passed - 72 tasks, 76 claims, 31 sources, 30 ADRs |
| English-only validation | Passed |
| Source lint and release audit | Passed |
| Migration validation | Passed - 8 migrations, 18 required tables |
| TypeScript | Passed |
| Safe tests | 44 files, 147 tests passed |
| Baseline evaluation | 8/8 passed |
| Durable crash proof | Passed; one side effect, two attempts |
| Static Roast | 43/44 passed |
| Dynamic Roast | 6/6 passed |
| Semantic mutations | 12/12 killed |
| Failure matrix | 10/25 passed; 15 blocked |
| Production source build | Passed in 47.814 seconds |
| Native persistence | Blocked before test collection |
| Browser E2E | 12 tests discovered; blocked before browser launch |
| Accessibility and visual regression | Blocked in local environment |
| Final independent verifier | Must reject until isolated gates pass |

## Failure Injection

Twenty-five named scenarios are recorded. Ten portable scenarios pass, including lease takeover, crash before and after checkpoints, completed-receipt replay prevention, explicit reconciliation, approval restart contract, stale browser revision, stale worker fencing, and unknown evidence blocking readiness. Fifteen scenarios remain blocked because they require native SQLite, real process replacement, browser execution, operating-system faults, or live-provider behavior.

## Mutation Program

Twelve curated semantic mutants were killed: tenant and owner predicate removal, memory-poisoning bypass, unavailable-model acceptance, dry-run side-effect weakening, DAG-cycle acceptance, approval revision removal, verifier identity collision, unknown-evidence promotion, attestation tampering, expired-approval resolution, and missing release-hash binding. This is meaningful targeted mutation evidence, not an exhaustive AST mutation score.

## Native and Browser Lane

The repository contains a least-privilege GitHub Actions workflow pinned to reviewed action commit SHAs. It installs from the lockfile in a disposable Ubuntu environment, runs native SQLite suites, migrations, audit verification, production build, Chromium and Firefox E2E, accessibility checks, and uploads evidence. It has not been executed in this environment. The source ZIP contains no generated native binary or browser package.

## Performance and Capacity

The deterministic microbenchmarks show low-microsecond decision costs for pilot readiness, tenant authorization, and approval compare-and-set logic. They exclude database, browser, provider, network, and production workload latency and must not be interpreted as production capacity evidence. The successful production build reports a 103 kB shared first-load JavaScript baseline and a 193 kB first load for the detailed run view.

## Security and Sovereignty

- No antivirus, EDR, firewall, or operating-system protection was disabled.
- No PowerShell was used.
- Dependency lifecycle scripts remained disabled locally.
- Native and browser binaries were not downloaded to the protected host.
- External autonomous side effects remain outside the pilot.
- Memory cannot grant authority.
- Unknown approval, lease, side-effect, tenant, verification, or release state fails closed.

## Release Decision

`DEVELOPMENT ONLY` remains the only evidence-supported classification. The successful production source build removes one previous blocker, but native persistence, browser E2E, accessibility, multi-process restart/race proof, clean native restore, and independent final verification remain mandatory.

## Next Exact Action

Run `.github/workflows/pilot-validation.yml` on the final candidate in a clean CI worker. Attach the generated evidence bundle, then freeze and repackage the exact source tree and run the separate hash-bound verifier. Promotion is allowed only if every mandatory gate is `pass`.

## Roast Finding Summary

- Total findings: 63
- Critical: 11
- High: 41
- Medium: 11

### Status Counts

- `accepted_risk`: 1
- `environment_blocked`: 4
- `fixed_in_v10`: 6
- `fixed_in_v11`: 3
- `fixed_in_v12`: 5
- `fixed_in_v13`: 2
- `fixed_in_v8`: 13
- `open`: 2
- `partially_mitigated`: 27

## Full Finding Register

| ID | Severity | Status | Category | Finding |
|---|---|---|---|---|
| F-001 | critical | partially_mitigated | durability | Detached in-memory execution cannot survive process loss |
| F-002 | critical | partially_mitigated | durability | Side effects lack persisted idempotency and atomic evidence |
| F-003 | critical | partially_mitigated | identity-tenancy | Deployment model conflicts with globally shared mutable data |
| F-004 | critical | fixed_in_v8 | security-egress | HTTP and provider endpoints allowed server-side request forgery |
| F-005 | critical | fixed_in_v8 | runtime-correctness | Invalid or cyclic plans could be reported as completed |
| F-006 | critical | fixed_in_v10 | recovery | No tested sovereign backup and restore path |
| F-007 | high | open | supply-chain | Drizzle ORM remains on a version with a high-severity advisory |
| F-008 | high | fixed_in_v8 | authorization | Any authenticated user could mutate global policy |
| F-009 | high | fixed_in_v8 | authorization | Skill identifiers enabled cross-user prompt access or attachment |
| F-010 | high | fixed_in_v8 | capability-security | New or empty agents inherited every tool |
| F-011 | high | fixed_in_v8 | human-oversight | Catch-all policy allowed medium-risk actions automatically |
| F-012 | high | partially_mitigated | reliability | Runs and approvals have no complete wall-clock deadline model |
| F-013 | high | partially_mitigated | integrity | Run event sequence allocation is race-prone |
| F-014 | high | partially_mitigated | audit-integrity | Audit hash-chain append is race-prone and not externally anchored |
| F-015 | high | fixed_in_v8 | provider-routing | Disabled provider configurations were still eligible |
| F-016 | high | fixed_in_v8 | startup-integrity | Database migration failure was tolerated |
| F-017 | high | partially_mitigated | agent-security | Fetched content remains a prompt-injection channel |
| F-018 | high | environment_blocked | verification | Native database integration tests cannot run in the constrained environment |
| F-019 | high | environment_blocked | release-verification | Production build did not complete end-to-end in the audit environment |
| F-020 | high | partially_mitigated | data-governance | User data export, correction, and deletion are not implemented end-to-end |
| F-021 | high | fixed_in_v10 | identity-tenancy | Custom templates are globally visible and mutable |
| F-022 | high | partially_mitigated | identity-tenancy | Audit access is restricted but audit data remains globally modeled |
| F-023 | high | fixed_in_v10 | authentication | Registration remains open with weak abuse controls |
| F-024 | high | partially_mitigated | cryptography | Secret encryption lacks documented rotation and context binding |
| F-025 | high | partially_mitigated | api-reliability | Run creation has no client idempotency contract |
| F-026 | high | partially_mitigated | human-oversight | Approval expiry is not owned by a durable timer |
| F-027 | high | partially_mitigated | recovery | Restart semantics for pending approvals are incomplete |
| F-028 | high | fixed_in_v8 | resource-governance | Configured maximum plan size was not enforced |
| F-029 | high | fixed_in_v8 | runtime-correctness | Tool iteration exhaustion could be treated as success |
| F-030 | medium | fixed_in_v8 | economics | Usage accounting could double-count tokens |
| F-031 | medium | fixed_in_v8 | evidence-integrity | Rejected approval did not close the tool evidence chain |
| F-032 | medium | partially_mitigated | privacy | Prompts and objectives are duplicated into persistent evidence without minimization |
| F-033 | medium | fixed_in_v8 | resource-governance | Artifact writes had no practical size ceiling |
| F-034 | medium | fixed_in_v10 | policy-engine | Policy regular expressions can create denial of service |
| F-035 | medium | partially_mitigated | abuse-control | Rate limiting is process-local and trusts client forwarding headers |
| F-036 | medium | partially_mitigated | browser-security | Security headers improved but CSP remains absent |
| F-037 | medium | partially_mitigated | code-quality | Source lint is intentionally shallow and build ignores ESLint |
| F-038 | high | fixed_in_v10 | supply-chain | No generated SBOM, model inventory, or build provenance |
| F-039 | high | partially_mitigated | observability | Observability lacks traces, SLOs, and capacity evidence |
| F-040 | high | fixed_in_v11 | memory | Governed memory architecture is documentation-only |
| F-041 | high | fixed_in_v11 | model-routing | Provider selection is not a measured capability router |
| F-042 | high | partially_mitigated | evaluation | Test portfolio is too narrow for the threat and failure model |
| F-043 | medium | partially_mitigated | evaluation | End-to-end tests are brittle smoke checks |
| F-044 | medium | fixed_in_v10 | operations | Seed workflow is destructive and includes known demo credentials |
| F-045 | medium | partially_mitigated | evidence-quality | Evidence percentage measures structure, not truth |
| F-046 | high | partially_mitigated | program-execution | Most canonical capabilities remain blocked or unimplemented |
| F-047 | high | partially_mitigated | infrastructure | SQLite and web-process topology limit safe scale and failover |
| F-048 | high | partially_mitigated | browser-security | No tested Content Security Policy |
| F-049 | high | fixed_in_v11 | capability-security | Tool arguments are not uniformly governed by explicit versioned schemas |
| F-050 | high | partially_mitigated | context-engineering | Context and output budgets are incomplete |
| F-051 | critical | fixed_in_v12 | recovery failure | Stale workers could commit after lease takeover when identity was reused |
| F-052 | high | fixed_in_v12 | agent-control failure | Approval resolution lacked a cross-process compare-and-set revision |
| F-053 | high | fixed_in_v12 | verification failure | Verification decisions were not immutably bound to tested source and release artifacts |
| F-054 | high | fixed_in_v12 | design deception | Runtime calm could be mistaken for release or pilot readiness |
| F-055 | high | fixed_in_v12 | agent-control failure | Model routing did not distinguish verification quality or unhealthy candidates |
| F-056 | critical | partially_mitigated | recovery failure | Active approval waits were process-local and could not resume after restart |
| F-057 | critical | partially_mitigated | tenant isolation failure | Pilot resources lacked a complete tenant and workspace boundary |
| F-058 | high | fixed_in_v13 | misleading success | Pilot readiness could be implied by static or missing evidence |
| F-059 | high | fixed_in_v13 | build reproducibility | Database initialization during module import broke production build discovery |
| F-060 | high | environment_blocked | release verification | Native persistence validation is unavailable on the protected host |
| F-061 | high | environment_blocked | accessibility blocker | Browser, accessibility, and visual regression gates are not executed locally |
| F-062 | critical | open | verification failure | Final verification is not yet independently bound to the released ZIP hash |
| F-063 | critical | accepted_risk | agent-control failure | Live remote model conversations remain outside restart-safe pilot execution |

## Honest Limitations

## Implemented and Tested in the Source-Safe Environment

- Minimal tenant/workspace scope and ownership filters for the bounded pilot.
- Restart-oriented approval continuation contract with deterministic continuation key, revision compare-and-set, expiry, and durable pause/requeue.
- Lease fencing, checkpoint progression, side-effect receipts, and explicit reconciliation.
- Fail-closed Pilot Readiness derived from real run evidence.
- Lazy SQLite initialization and a complete production source build without a generated native binding.
- Encrypted backup structure and required-table validation in source-safe tests.
- Forty-four safe test files and 147 passing tests.
- Twelve killed semantic mutants and ten portable failure scenarios.
- Commit-pinned, read-only isolated CI definition.

## Environment-Blocked Gates

- The three `better-sqlite3` suites fail before collecting tests because the generated native binding is intentionally absent.
- Chromium E2E discovers twelve tests but cannot launch because browser executables are intentionally not downloaded on the protected host.
- Browser accessibility, visual regression, clean native restore, multi-process races, and process-replacement approval proof await the isolated lane.
- An operationally separate verifier cannot accept the final candidate until those gates pass.

## Unsupported by the Pilot

- Restart-safe live remote-provider conversations.
- Autonomous external or irreversible side effects.
- Enterprise shared tenancy.
- Shell execution and unreviewed plugins.
- Automatic reconciliation of ambiguous external effects.

## Release Classification

`DEVELOPMENT ONLY` with seven blocking pilot gates. The successful source build is a material improvement, but it is not native runtime or browser evidence.

