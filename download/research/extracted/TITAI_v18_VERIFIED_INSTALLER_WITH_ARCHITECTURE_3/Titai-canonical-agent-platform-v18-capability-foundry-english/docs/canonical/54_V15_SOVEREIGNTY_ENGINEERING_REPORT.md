# TITAI v15 - Sovereign Intelligence Engineering Report

**Release:** v15 Sovereignty  
**Engineering date:** 2026-07-11  
**Input:** TITAI v14 validation release  
**Input SHA-256:** `d725fa1dbc2ab026bbb03affda3b8ddd086195e8a9ff22e1a2c9c64a302cbb64`  
**Sovereignty classification:** **SOVEREIGN DEVELOPMENT MODE**  
**Standard release classification:** **DEVELOPMENT ONLY**

## Executive decision

v15 materially advances TITAI from local-compatible software toward a controlled sovereign platform. It proves three mandatory vertical slices without commercial API keys or mandatory remote services: a zero-key local workflow, a signed air-gap handoff, and a signed offline update with rollback. It also adds hardware feasibility, energy-aware placement contracts, portable governed memory, context-separated keys, local trust and revocation, durable replay rejection, a protocol-independent local tool boundary, and an operator-facing Sovereignty Control Plane.

The release is not promoted to `SOVEREIGN CONTROLLED PILOT`. The decisive blockers are a missing real local generative-model benchmark, incomplete full-process outbound network observation, estimated rather than measured energy evidence, no disconnected clean-install bundle, incomplete database-migration rehearsal inside offline updates, and no external verifier operating on separate hardware. These are explicit gates, not footnotes.

## Verified starting state

- The v14 archive hash was reproduced exactly.
- Canonical validation, English-only validation, source lint, migrations, TypeScript, release audit, baseline evaluation, durable crash proof, Roast validation, and the production build were rerun.
- The final production build exited successfully in 92 seconds with two workers; shared first-load JavaScript remained 103 kB.
- Regression evidence covers 59 test files and 180 passing tests. A monolithic Vitest invocation reports all suites but retains an open handle; release evidence therefore uses deterministic split execution and records the orchestration defect as F-076.

## Sovereignty model

Sovereignty is evaluated as a vector rather than a marketing label. Fatal dependencies are evaluated before aggregate interpretation.

| Dimension | Score | Interpretation |
|---|---:|---|
| Compute | 82 | Local persistence and execution available |
| Model | 63 | Runtime abstraction exists; real model unproven |
| Data | 91 | Authoritative local storage and export |
| Memory | 86 | Portable governed local memory |
| Identity | 78 | Local identities and revocation contracts |
| Tools | 88 | Local capability-controlled tool pack |
| Network | 80 | Air-gap guard exists; full observation missing |
| Updates | 82 | Signed offline apply and rollback |
| Supplychain | 72 | SBOM and manifests; clean bundle missing |
| Recovery | 91 | Encrypted backup and clean restore |
| Operations | 78 | Control plane and evidence gates |
| Energy | 55 | Scheduling contracts; measurements absent |
| Governance | 88 | Canonical tasks, claims, ADRs, verification |

No fatal weakness or mandatory external runtime dependency exists in the declared sovereign core. Three evidence dimensions remain unknown in the formal assessment: measured energy, full outbound network audit, and real local-model quality.

## Architecture changes

### Sovereign runtime boundary
The canonical runner can select a local-authoritative runtime profile without importing a vendor-specific SDK. Hardware feasibility is evaluated before utility: RAM, CPU architecture, network requirement, structured output, tool support, privacy, context, and energy constraints can make a model ineligible before scoring.

### Data and memory plane
Governed memory remains authoritative locally. The portable format preserves content hash, type, provenance, authority, confidence, scope, sensitivity, expiry, correction and contradiction data. Import performs scope, integrity, duplicate and conflict checks. Confidence decay prevents old procedural memory from retaining permanent authority.

### Key hierarchy and local trust
HKDF derives purpose- and context-separated material for installation, tenant, workspace, data, backup and signing purposes. Ed25519 identities sign canonical envelopes. A local trust store enforces key purpose, tenant, workspace, validity and revocation. A durable replay ledger records consumed task and result identifiers; a copied bundle is rejected after restart.

### Tool and protocol independence
Local hashing, bounded file inspection, structured transformation, repository analysis and backup verification use a canonical capability contract. MCP, A2A, OpenAI-compatible APIs and vendor tool schemas remain adapters rather than internal authority.

### Sovereignty Control Plane
The interface exposes where intelligence runs, which dependencies are local or optional remote, network attempts, key separation, backup and restore evidence, node placement, energy confidence, vertical-slice status and blockers. Unknown evidence is blocking evidence.

## Mandatory vertical slices

### A. Zero-key local workflow - PASSED

Flow: local identity -> local model eligibility -> governed memory -> local tool -> artifact -> local verification -> encrypted backup -> clean restore.

- Selected runtime: `deterministic-local-v1`
- Artifact SHA-256: `c94002c08ec7b70669d5ecad75e2d949a7d00c4ecf143293b12080933dd62f21`
- Workflow evidence SHA-256: `2a8d5a20e50f42bc3ddf5cd0fb67390a84aad0e4bb6a08c25e88c6eefc634fb7`
- Network attempts: 0
- Restored: true

This is a deterministic local runtime proving orchestration, authority, memory, tool, evidence and recovery contracts. It is not a substitute for a useful generative local model benchmark.

### B. Signed air-gap handoff - PASSED

The task envelope binds tenant, workspace, sender, receiver, task, causation, objective, context, memory hashes, evidence, capabilities, maximum use counts, expiry and return schema. The result is separately signed and bound to the exact input payload hash.

- Task payload SHA-256: `2f27e5fb8b3ee3846c56ce0d16a0f92af476af775e802054f673cbba6249c4f7`
- Result payload SHA-256: `7ee0f1136fcbb0738bfd9a8d9650fd801fd810c59694f33f71e1e8f710b28215`
- Durable replay rejected: true
- Trust store enforced: true

Invalid signature, expiry, memory hash, receiver, tenant, workspace, capability use, revoked key, wrong key purpose and replay fail closed.

### C. Signed offline update and rollback - PASSED WITH LIMITATION

The update envelope binds source and target versions, files, hashes, modes, deletions, declared migrations, compatibility, validation commands and release-evidence hashes. It rejects downgrade, source-version mismatch, invalid signature, path traversal and altered file bytes. Apply is staged through a backup directory and rolls back after injected failure.

- Update payload SHA-256: `8159112a4d401196c1f572004525353b2b5293cbc5d06cf2ca491a18527d976a`
- Applied version: `1.15.0`
- Rolled back version: `1.14.0`

Database migrations are declared but not yet automatically rehearsed and reversed by the update engine; this keeps the feature below sovereign-pilot status.

## Opportunity portfolio and breakthrough lab

- Sovereign opportunities catalogued: **30**
- Breakthrough hypotheses catalogued: **15**
- Implemented portfolio: zero-key local workflow, signed air-gap handoff, signed offline update, portable memory, key hierarchy, hardware-aware placement, local network guard and control plane.
- Difficult experiment: signed disconnected execution with scope-bound result import, durable replay rejection and revocable trust.

The remaining highest-value experiments are a real local model on target-class hardware, a disconnected clean-install bundle, and measured energy-aware routing.

## Dependency and network posture

- Dependency ledger records: **526**
- Local-authoritative records: **524**
- Remote-optional records: **2**
- Mandatory external runtime dependencies in the declared core: **0**

The application-level guard records and denies external requests in air-gap mode. A complete packet- or syscall-level observation of startup, build, workflow execution and shutdown could not be performed because network namespaces and tracing are unavailable in the current container. This remains finding F-069.

## Hardware, placement and energy

- Reference node: `local-mini-pc`
- RAM profile: 16 GiB
- Maximum power profile: 65 W
- Placement selected node: `local-mini-pc`

Feasibility and energy policies are implemented, but the wattage and throughput figures are estimates. No automatic energy-driven action should be enabled until target-hardware measurements provide confidence intervals.

## Testing and adversarial evidence

| Gate | Result |
|---|---|
| Canonical validation | Passed: 88 tasks, 95 claims, 38 ADRs |
| English-only validation | Passed |
| TypeScript | Passed |
| Migrations | Passed |
| Regression | 59 files, 180/180 tests |
| Sovereignty focused | 10 files, 21/21 tests |
| Baseline evaluation | 8/8 |
| Durable crash proof | Passed; exactly one side effect |
| Mutation probes | 12/12 killed |
| Dynamic Roast | 6/6 functional |
| Static Roast | 43/44; dependency-upgrade control remains open |
| Production build | Passed in 92 seconds |
| Release audit | Passed |

The monolithic Vitest command retains an open handle after all test files report. Split release validation terminates and proves every test. The orchestration leak is not hidden and remains a medium finding.

## Roast summary

- Total historical and current findings: **76**
- Critical: **13**, High: **50**, Medium: **13**

| Status | Count |
|---|---:|
| accepted_risk | 1 |
| environment_blocked | 4 |
| fixed_in_v10 | 6 |
| fixed_in_v11 | 3 |
| fixed_in_v12 | 5 |
| fixed_in_v13 | 2 |
| fixed_in_v14 | 4 |
| fixed_in_v15 | 1 |
| fixed_in_v8 | 13 |
| open | 6 |
| partially_mitigated | 31 |

### New sovereignty findings

#### F-069 - Full-process outbound network behavior is not independently audited

**Severity:** high  
**Status:** open  
**Impact:** An undeclared dependency or library call could escape the application-level guard and invalidate air-gap claims.

**Required correction:** Run the extracted release in an isolated network namespace with deny-by-default egress and capture all connection attempts.

#### F-070 - No real local generative model artifact has been benchmarked

**Severity:** critical  
**Status:** open  
**Impact:** Model sovereignty, task quality, tool reliability, memory behavior, latency, and hardware feasibility remain unproven for a useful generative workload.

**Required correction:** Benchmark at least one license-reviewed local model artifact in a disposable environment and bind its hash, runtime, quality, memory, latency, and energy evidence to the registry.

#### F-071 - Energy-aware scheduling uses estimates rather than measured hardware data

**Severity:** high  
**Status:** open  
**Impact:** Energy-saving, thermal-protection, and local-versus-remote break-even decisions may be materially wrong on target hardware.

**Required correction:** Collect repeated wall-power or trusted telemetry measurements for idle, model load, inference, retrieval, backup, and restore.

#### F-072 - Clean offline installation still depends on an unbuilt dependency bundle

**Severity:** high  
**Status:** open  
**Impact:** Loss of public registries or model hubs prevents clean installation and disaster recovery onto replacement hardware.

**Required correction:** Create a license-compliant signed installation bundle with package, system, browser, and model manifests plus integrity verification.

#### F-073 - Signed air-gap bundles were replayable and ignored local key revocation

**Severity:** high  
**Status:** fixed_in_v15  
**Impact:** An attacker or operator error could repeat bounded work, duplicate local writes, or accept evidence from a revoked offline node.

**Required correction:** Retain purpose-scoped trust checks and a durable replay ledger at the acceptance boundary.

#### F-074 - Offline update migration execution is declared but not automatically rehearsed

**Severity:** high  
**Status:** partially_mitigated  
**Impact:** A source update may apply successfully while its schema change fails or cannot be rolled back.

**Required correction:** Add a staged database-copy rehearsal, migration ledger verification, application validation, and explicit schema rollback policy before committing the update.

#### F-075 - Root and signing keys lack protected hardware custody and rotation proof

**Severity:** medium  
**Status:** partially_mitigated  
**Impact:** Host compromise could expose all software-protected sovereign identities and backup keys.

**Required correction:** Implement optional OS keychain or TPM-backed adapters, rotation ceremonies, recovery-key separation, and secret-access audit.

#### F-076 - Monolithic test orchestration retains an open handle after all suites report

**Severity:** medium  
**Status:** partially_mitigated  
**Impact:** CI can hang after successful tests, wasting capacity and obscuring real timeouts.

**Required correction:** Identify the leaked timer, database handle, worker, or server and add an open-handle regression gate.

## Product and interface

The Sovereignty Control Plane is intentionally not a generic green-status dashboard. It communicates locality, authority, network posture, recovery, key separation, evidence confidence and degraded capability. It distinguishes fully local, local preferred, hybrid optional, remote optional, air-gapped, missing evidence and blocked states without relying on color alone.

Browser accessibility and visual regression remain constrained by the managed browser policy inherited from v14; source-level accessibility contracts and the production build pass, but no browser pass is claimed.

## Honest classifications

### Sovereignty: SOVEREIGN DEVELOPMENT MODE
The three mandatory sovereign vertical slices pass and the declared core has no mandatory external runtime dependency. The platform is suitable for continued local-first development and controlled laboratory evaluation.

### Standard release: DEVELOPMENT ONLY
A controlled pilot is not issued because useful local model quality, full outbound observation, target-hardware energy, offline clean installation, database migration rehearsal, browser validation and external independent verification are incomplete.

## Next highest-value cycle

A narrow v16 should avoid broad feature growth and target four proof gaps:

1. Run a license-reviewed real local model on the user's mini-PC or an isolated equivalent; measure RAM, load time, tokens per second, structured output, tool reliability and task quality.
2. Build a signed, license-compliant offline installation bundle for JavaScript packages, system requirements, browser artifacts and the selected model; prove clean disconnected installation.
3. Observe the complete extracted application in a deny-by-default network environment and bind the capture to the final release hash.
4. Rehearse a real database migration inside the signed update, validate, roll back, and independently verify the frozen archive.

## Appendix A - Complete finding register

### F-001: Detached in-memory execution cannot survive process loss

- Severity: **critical**
- Status: **partially_mitigated**
- Category: durability
- Confidence: high
- Description: A feature-flagged durable envelope and SQLite durable primitives now exist, but granular step resume and active restart recovery remain incomplete.
- Impact: Long-running or side-effecting jobs can disappear, duplicate, or remain permanently inconsistent after deployment, crash, or upgrade.
- Recommendation: Complete native multi-process crash tests and replace the single-step envelope with granular checkpoints and fencing.
- Acceptance test: Kill the worker at every checkpoint boundary and prove the run resumes exactly once with preserved ownership and evidence.
- Evidence: src/lib/engine/start.ts, src/lib/engine/runner.ts, src/lib/db/schema.ts

### F-002: Side effects lack persisted idempotency and atomic evidence

- Severity: **critical**
- Status: **partially_mitigated**
- Category: durability
- Confidence: high
- Description: The v9 portable core now persists deterministic side-effect receipts and proves crash replay without duplication. The production runner still lacks the SQLite transactional receipt, event, and audit integration.
- Impact: A crash after a side effect but before acknowledgement can repeat irreversible work or create evidence that disagrees with reality.
- Recommendation: Migrate the production runner to the portable contract with a SQLite compare-and-set lease and transactional outbox.
- Acceptance test: Inject a crash after external success but before event commit and prove the retry does not repeat the effect.
- Evidence: src/lib/engine/runner.ts, src/lib/engine/events.ts, src/lib/engine/audit.ts, src/lib/db/schema.ts, src/lib/durable/engine.ts, docs/canonical/evidence/durable-vertical-slice.json

### F-003: Deployment model conflicts with globally shared mutable data

- Severity: **critical**
- Status: **partially_mitigated**
- Category: identity-tenancy
- Confidence: high
- Description: Authentication is multi-user, but policies, templates, and parts of audit/configuration are global rather than tenant-owned. Administrative restrictions reduce some exposure but do not establish a complete tenancy model.
- Impact: One user can be affected by another user's global configuration or data; future multi-user deployment risks cross-tenant leakage and confused authority.
- Recommendation: Choose and enforce either explicit single-owner mode or workspace/tenant ownership across every mutable record and query.
- Acceptance test: Create two tenants and prove every read, write, audit, template, skill, run, and artifact is isolated under adversarial identifiers.
- Evidence: src/lib/db/schema.ts, src/app/api/policies/route.ts, src/app/api/templates/route.ts, src/app/api/audit/verify/route.ts

### F-004: HTTP and provider endpoints allowed server-side request forgery

- Severity: **critical**
- Status: **fixed_in_v8**
- Category: security-egress
- Confidence: high
- Description: User-influenced HTTP and provider base URLs previously had no private-network, loopback, metadata, DNS-rebinding, or redirect boundary.
- Impact: An agent could probe internal services, cloud metadata, or local control planes.
- Recommendation: Keep destination and redirect validation, DNS resolution checks, and explicit local-model exceptions under policy.
- Acceptance test: Run the egress suite against loopback, RFC1918, link-local, metadata, IPv6, encoded addresses, mixed DNS answers, and redirect chains.
- Evidence: src/lib/security/egress.ts, src/lib/engine/tools/httpFetch.ts, src/lib/engine/gateway.ts, tests/egress.test.ts

### F-005: Invalid or cyclic plans could be reported as completed

- Severity: **critical**
- Status: **fixed_in_v8**
- Category: runtime-correctness
- Confidence: high
- Description: The original scheduler could reach no-ready-step state while unfinished nodes remained and still finish the run successfully.
- Impact: A structurally impossible plan could produce a false success signal and misleading evidence.
- Recommendation: Retain preflight plan validation and fail closed when unfinished work has no executable node.
- Acceptance test: Test duplicate nodes, unknown edges, self-dependencies, cycles, excessive steps, and runtime deadlock.
- Evidence: src/lib/engine/plan.ts, src/lib/engine/runner.ts, tests/plan.test.ts

### F-006: No tested sovereign backup and restore path

- Severity: **critical**
- Status: **fixed_in_v10**
- Category: recovery
- Confidence: high
- Description: The v10 package creates a consistent SQLite snapshot, encrypts it with scrypt and AES-256-GCM, verifies integrity and required tables, restores atomically, preserves an overwritten database, and includes positive and negative restore tests.
- Impact: Loss or corruption of the SQLite database, keys, artifacts, or model configuration can be unrecoverable.
- Recommendation: Run periodic clean-deployment RTO/RPO drills and store the passphrase separately from the backup.
- Acceptance test: Restore the encrypted backup into a clean target, verify the sentinel data and database checks, then prove wrong-key, tamper, and unauthorized-overwrite attempts fail closed.
- Evidence: docs/canonical/20_DATA_LIFECYCLE_CONTRACT.md, docs/canonical/24_HONEST_LIMITATIONS.md, src/lib/durable/backup.ts, docs/canonical/evidence/durable-vertical-slice.json, src/lib/backup/application-backup.ts, scripts/backup-application.mjs, scripts/restore-application.mjs, tests/application-backup.test.ts, docs/canonical/decisions/ADR-0023-encrypted-application-database-backup.md

### F-007: Drizzle ORM remains on a version with a high-severity advisory

- Severity: **high**
- Status: **open**
- Category: supply-chain
- Confidence: high
- Description: The current dependency range resolves below the audited fixed line identified by npm audit for identifier-related SQL injection.
- Impact: Unsafe identifier construction in affected paths can turn application input into SQL structure rather than data.
- Recommendation: Upgrade Drizzle ORM to a supported non-vulnerable release, regenerate/migrate safely, and execute database integration tests.
- Acceptance test: npm audit contains no high advisory for Drizzle and all migration/query/integration tests pass on a clean install.
- Evidence: package.json, docs/roast/evidence/npm-audit.json

### F-008: Any authenticated user could mutate global policy

- Severity: **high**
- Status: **fixed_in_v8**
- Category: authorization
- Confidence: high
- Description: The policy update path previously had an ineffective administrative check while changing system-wide policy.
- Impact: A normal user could weaken approval requirements for all users.
- Recommendation: Retain explicit administrative authorization and later tenant-scope policy records.
- Acceptance test: A non-admin receives a denial and cannot change persisted policy; an authorized admin creates an attributable audit event.
- Evidence: src/app/api/policies/route.ts

### F-009: Skill identifiers enabled cross-user prompt access or attachment

- Severity: **high**
- Status: **fixed_in_v8**
- Category: authorization
- Confidence: high
- Description: Direct skill fetch and agent skill replacement did not consistently verify ownership.
- Impact: A user who guessed an identifier could read or attach another user's procedural prompt material.
- Recommendation: Keep owner/built-in checks on both reads and relationship writes.
- Acceptance test: Attempt direct reads and attachment with another user's skill identifier and prove denial without existence leakage.
- Evidence: src/app/api/skills/[skillId]/route.ts, src/app/api/agents/[agentId]/route.ts

### F-010: New or empty agents inherited every tool

- Severity: **high**
- Status: **fixed_in_v8**
- Category: capability-security
- Confidence: high
- Description: Agent creation and runtime fallback could translate absent or empty tool configuration into the full registry.
- Impact: A minimally configured agent could unexpectedly gain network or write authority.
- Recommendation: Keep an explicit low-risk default allowlist and treat an empty list as no capabilities.
- Acceptance test: Create agents with omitted and empty tool lists; prove only documented tools can execute.
- Evidence: src/lib/engine/tools/index.ts, src/app/api/agents/route.ts, src/lib/engine/start.ts

### F-011: Catch-all policy allowed medium-risk actions automatically

- Severity: **high**
- Status: **fixed_in_v8**
- Category: human-oversight
- Confidence: high
- Description: The default policy set included a broad catch-all automatic path that weakened the documented fallback behavior.
- Impact: Risky actions could bypass human review despite the UI implying otherwise.
- Recommendation: Keep fail-closed fallback policy and require explicit, narrow auto-approval rules.
- Acceptance test: Unknown and medium/high-risk actions resolve to human review or denial in policy tests.
- Evidence: src/lib/engine/policy.ts, tests/policy.test.ts

### F-012: Runs and approvals have no complete wall-clock deadline model

- Severity: **high**
- Status: **partially_mitigated**
- Category: reliability
- Confidence: high
- Description: Runs now accept explicit wall-clock deadlines and output/context budgets; approvals persist an expiry timestamp and are expired by local timers and boot recovery. A durable timer service and restart-safe continuation are still absent.
- Impact: A run can occupy resources indefinitely or remain pending forever after user abandonment.
- Recommendation: Add persisted deadlines, timeout ownership, cancellation propagation, and deterministic terminal states.
- Acceptance test: Advance a fake clock across model, tool, approval, and run deadlines and prove exact terminal events and released leases.
- Evidence: src/lib/engine/runner.ts, src/app/api/approvals/[approvalId]/route.ts, src/lib/db/schema.ts, src/app/api/runs/route.ts, src/lib/db/index.ts, drizzle/0001_v10_hardening.sql

### F-013: Run event sequence allocation is race-prone

- Severity: **high**
- Status: **partially_mitigated**
- Category: integrity
- Confidence: high
- Description: Run event sequence allocation and insertion now execute under BEGIN IMMEDIATE with a unique run/sequence constraint and an atomic outbox record. Native multi-process contention tests remain blocked in this environment.
- Impact: Concurrent writers can duplicate or reorder sequence numbers and break replay evidence.
- Recommendation: Use a transactionally allocated sequence or append-only event table with a unique run/sequence constraint and retry.
- Acceptance test: Run concurrent appenders and prove contiguous unique ordering under load and injected transaction retries.
- Evidence: src/lib/engine/events.ts, src/lib/db/schema.ts, drizzle/0001_v10_hardening.sql, scripts/validate-migrations.mjs

### F-014: Audit hash-chain append is race-prone and not externally anchored

- Severity: **high**
- Status: **partially_mitigated**
- Category: audit-integrity
- Confidence: high
- Description: Audit hash-chain read, hash calculation, append, and outbox insertion now run in one immediate transaction. External anchoring and native concurrent-writer tests remain.
- Impact: Concurrent events can fork the chain; a database administrator can rewrite the entire chain and recompute hashes.
- Recommendation: Serialize append, add uniqueness, sign periodic roots, and optionally export roots to independent storage.
- Acceptance test: Generate concurrent audit writes, verify one linear chain, then mutate history and prove signed-root verification fails.
- Evidence: src/lib/engine/audit.ts, scripts/verify-audit.ts, src/lib/db/schema.ts, drizzle/0001_v10_hardening.sql

### F-015: Disabled provider configurations were still eligible

- Severity: **high**
- Status: **fixed_in_v8**
- Category: provider-routing
- Confidence: high
- Description: Provider activation status was not consistently enforced during dispatch or provider tests.
- Impact: An operator could believe a provider was disabled while the system still sent data to it.
- Recommendation: Retain enabled checks at every provider resolution boundary.
- Acceptance test: Disable each provider and prove dispatch, health test, and fallback routing never contact it.
- Evidence: src/lib/engine/gateway.ts, src/lib/engine/runner.ts, src/app/api/providers/test/route.ts

### F-016: Database migration failure was tolerated

- Severity: **high**
- Status: **fixed_in_v8**
- Category: startup-integrity
- Confidence: high
- Description: Migration errors were logged but startup could continue against an unknown schema.
- Impact: The application could write incompatible data or fail later in less diagnosable ways.
- Recommendation: Keep startup fail-closed for required schema migrations.
- Acceptance test: Force a migration failure and prove the process refuses readiness without serving mutation routes.
- Evidence: src/lib/db/index.ts

### F-017: Fetched content remains a prompt-injection channel

- Severity: **high**
- Status: **partially_mitigated**
- Category: agent-security
- Confidence: high
- Description: Fetched data is now labeled untrusted and egress-limited, but untrusted text still enters model context without a fully enforced authority separation or content transformation policy.
- Impact: A malicious page can attempt to override instructions, induce tool use, or exfiltrate context.
- Recommendation: Separate data from instructions, apply trust labels in the internal protocol, and require policy authorization independent of model text.
- Acceptance test: Use adversarial fetched pages that request secrets and destructive tools; prove zero authority escalation and no protected-context leakage.
- Evidence: src/lib/engine/tools/httpFetch.ts, src/lib/engine/runner.ts, docs/canonical/07_SECURITY_TRUST_SAFETY.md

### F-018: Native database integration tests cannot run in the constrained environment

- Severity: **high**
- Status: **environment_blocked**
- Category: verification
- Confidence: high
- Description: The safe install deliberately skips native post-install scripts, leaving better-sqlite3 unavailable for three database-backed suites.
- Impact: Critical approval expiry, audit, and runner integration behavior is not independently executed in this environment.
- Recommendation: Run the blocked suites on an approved clean Linux CI image with pinned Node headers and a trusted prebuilt/native toolchain.
- Acceptance test: All database suites pass from a clean lockfile install and publish logs, environment digest, and database reset evidence.
- Evidence: docs/roast/evidence/v8-full-tests.txt, docs/canonical/24_HONEST_LIMITATIONS.md

### F-019: Production build did not complete end-to-end in the audit environment

- Severity: **high**
- Status: **environment_blocked**
- Category: release-verification
- Confidence: high
- Description: The production build compiles and completes type validation, but page-data collection cannot load the absent better-sqlite3 native binding in the constrained environment.
- Impact: A source-level and compile-level green result does not prove deployable application startup or route data collection.
- Recommendation: Run the build with the verified native binding on a trusted CI or development host, then execute startup and browser E2E gates.
- Acceptance test: A clean install completes the production build, starts the server, and passes Playwright without hidden network or native-binding errors.
- Evidence: docs/canonical/evidence/v10-build.txt, scripts/build-production.mjs

### F-020: User data export, correction, and deletion are not implemented end-to-end

- Severity: **high**
- Status: **partially_mitigated**
- Category: data-governance
- Confidence: high
- Description: User export, password-confirmed deletion, owned-data cascade, governed-memory correction/deletion, and logical audit redaction overlays are implemented. Native end-to-end deletion, backup propagation, and legal retention validation remain.
- Impact: Users cannot exercise data rights reliably and deleted data may survive in logs, artifacts, or backups.
- Recommendation: Implement data inventory-backed export and deletion workflows with tombstone/backup semantics and audit evidence.
- Acceptance test: Create a user with all data classes, export it, delete it, search every primary/derived store, restore an older backup, and prove policy-compliant handling.
- Evidence: docs/canonical/20_DATA_LIFECYCLE_CONTRACT.md, src/lib/db/schema.ts, src/app/api/account/export/route.ts, src/app/api/account/delete/route.ts, src/app/api/memory/route.ts, src/lib/engine/audit.ts, docs/canonical/data/DATA_INVENTORY.json

### F-021: Custom templates are globally visible and mutable

- Severity: **high**
- Status: **fixed_in_v10**
- Category: identity-tenancy
- Confidence: high
- Description: Custom templates now carry an owner identifier; listing and creation expose only built-in templates plus the authenticated user's templates.
- Impact: Private workflows or proprietary prompts can be exposed or changed across users.
- Recommendation: Separate immutable built-ins from tenant-owned custom templates and scope every query.
- Acceptance test: Two-user route tests prove private templates cannot be listed, read, updated, or referenced cross-tenant.
- Evidence: src/lib/db/schema.ts, src/app/api/templates/route.ts, drizzle/0001_v10_hardening.sql

### F-022: Audit access is restricted but audit data remains globally modeled

- Severity: **high**
- Status: **partially_mitigated**
- Category: identity-tenancy
- Confidence: high
- Description: The route now restricts entries to administrators, but audit rows lack a complete tenant/workspace ownership model and delegated audit roles.
- Impact: A global administrator becomes a high-value data aggregation point and tenant-level audit cannot be safely delegated.
- Recommendation: Add tenant/workspace dimensions and explicit audit-reader roles while preserving system-level security audit separation.
- Acceptance test: Tenant auditors see only their workspace; system auditors see redacted cross-tenant metadata under separate authorization.
- Evidence: src/app/api/audit/verify/route.ts, src/lib/db/schema.ts

### F-023: Registration remains open with weak abuse controls

- Severity: **high**
- Status: **fixed_in_v10**
- Category: authentication
- Confidence: high
- Description: Registration now bootstraps only the first administrator by default, remains closed afterward unless explicitly enabled, supports an invite token, enforces a twelve-character minimum, and uses rate limiting without trusting proxy headers by default.
- Impact: An exposed installation can be populated by unauthorized users and amplified against local or paid model resources.
- Recommendation: Add explicit registration mode, invitation/first-owner bootstrap, stronger password checks, throttling, and non-enumerating responses.
- Acceptance test: Unauthenticated registration is denied in closed mode; invite reuse, enumeration, weak passwords, and burst attempts fail safely.
- Evidence: src/app/api/register/route.ts, src/lib/auth/password.ts, src/lib/rate-limit.ts, .env.example

### F-024: Secret encryption lacks documented rotation and context binding

- Severity: **high**
- Status: **partially_mitigated**
- Category: cryptography
- Confidence: medium
- Description: Provider secrets now use versioned AES-GCM records, HKDF purpose separation, and user/provider context binding with legacy decryption compatibility. Automated rotation, revocation, and custody recovery are not complete.
- Impact: A leaked master key or ciphertext relocation can expose all provider credentials with limited recovery options.
- Recommendation: Introduce key IDs, rotation, AEAD associated data, scoped decrypt authority, secure backup handling, and revocation drills.
- Acceptance test: Rotate from key A to B without downtime, prove old ciphertext migration, reject swapped record context, and restore credentials securely.
- Evidence: src/lib/crypto.ts, docs/canonical/07_SECURITY_TRUST_SAFETY.md, src/app/api/providers/route.ts, src/lib/engine/runner.ts, tests/crypto.test.ts

### F-025: Run creation has no client idempotency contract

- Severity: **high**
- Status: **partially_mitigated**
- Category: api-reliability
- Confidence: high
- Description: Run creation accepts a user-scoped Idempotency-Key, serializes create-or-reuse under BEGIN IMMEDIATE, rejects key reuse with a different request, and has a unique database constraint. Native concurrent API tests remain blocked.
- Impact: Network retries or double clicks can duplicate expensive or destructive work.
- Recommendation: Accept scoped idempotency keys, persist request/result hashes, and return the original run for safe retries.
- Acceptance test: Send the same request concurrently and repeatedly; prove exactly one run and a deterministic replay response.
- Evidence: src/app/api/runs/route.ts, src/lib/db/schema.ts, src/lib/engine/runner.ts, drizzle/0001_v10_hardening.sql

### F-026: Approval expiry is not owned by a durable timer

- Severity: **high**
- Status: **partially_mitigated**
- Category: human-oversight
- Confidence: high
- Description: Approval expiry is persisted and enforced by local wait timers and startup sweeping, but no independent durable timer worker owns expiry while the application is offline.
- Impact: Expired approvals can remain pending or resume ambiguously, blocking work and weakening policy guarantees.
- Recommendation: Persist approval deadlines and let a durable worker own expiry, cancellation, and notification.
- Acceptance test: Restart before and after expiry and prove one deterministic expired transition and no later execution.
- Evidence: src/lib/engine/runner.ts, src/app/api/approvals/[approvalId]/route.ts, tests/approval-expiry.test.ts, src/lib/db/index.ts, src/lib/db/schema.ts

### F-027: Restart semantics for pending approvals are incomplete

- Severity: **high**
- Status: **partially_mitigated**
- Category: recovery
- Confidence: high
- Description: A serializable revision-checked approval wait contract now proves one-decision and expiry semantics, but the active runner still cannot resume it after restart.
- Impact: An approved action may never resume or may be reissued incorrectly after restart.
- Recommendation: Persist the wait contract, durable timer, continuation pointer, and requeue behavior in the active runner.
- Acceptance test: Restart with a pending approval, decide it from another process, and prove the exact continuation resumes once.
- Evidence: src/lib/engine/runner.ts, src/lib/db/schema.ts, src/lib/durable/approval-continuation.ts, tests/approval-continuation.test.ts

### F-028: Configured maximum plan size was not enforced

- Severity: **high**
- Status: **fixed_in_v8**
- Category: resource-governance
- Confidence: high
- Description: The planner schema previously accepted plans beyond the configured step limit.
- Impact: A model could create runaway work graphs and consume disproportionate resources.
- Recommendation: Keep max-step enforcement at parse/validation time.
- Acceptance test: Generate plans at limit, limit+1, and extreme sizes; prove bounded parse time and clear rejection.
- Evidence: src/lib/engine/plan.ts, tests/plan.test.ts

### F-029: Tool iteration exhaustion could be treated as success

- Severity: **high**
- Status: **fixed_in_v8**
- Category: runtime-correctness
- Confidence: high
- Description: A step could leave the model still requesting tools after the loop budget but continue toward completion.
- Impact: Incomplete or looping work could be presented as successful.
- Recommendation: Fail the step and run with explicit budget-exhausted evidence.
- Acceptance test: Use a model fixture that always requests another tool and prove deterministic failure at the configured limit.
- Evidence: src/lib/engine/runner.ts

### F-030: Usage accounting could double-count tokens

- Severity: **medium**
- Status: **fixed_in_v8**
- Category: economics
- Confidence: high
- Description: Token usage could be recorded both through provider events and response usage aggregation.
- Impact: Cost, capacity, and model-routing decisions could be based on inflated telemetry.
- Recommendation: Use one authoritative accounting path with reconciliation fields.
- Acceptance test: Replay a response with provider usage events and summary usage; prove totals equal the provider bill once.
- Evidence: src/lib/engine/runner.ts, src/lib/engine/event-types.ts

### F-031: Rejected approval did not close the tool evidence chain

- Severity: **medium**
- Status: **fixed_in_v8**
- Category: evidence-integrity
- Confidence: high
- Description: A rejected action produced a model-facing result but no matching tool.result event.
- Impact: Evidence reconstruction reported an unmatched call and could not explain the human decision path.
- Recommendation: Emit a terminal tool result representing rejection without executing the tool.
- Acceptance test: Reject an approval and prove call/result pairing, no side effect, and visible human-decision evidence.
- Evidence: src/lib/engine/runner.ts, src/lib/engine/evidence-summary.ts

### F-032: Prompts and objectives are duplicated into persistent evidence without minimization

- Severity: **medium**
- Status: **partially_mitigated**
- Category: privacy
- Confidence: high
- Description: Full system prompts and run objectives are no longer duplicated into run-start events or audit payloads; hashes and character counts are stored instead. The objective remains once in the run record because it is operational input, and broader retention controls remain.
- Impact: Sensitive business data can persist longer and in more stores than users expect.
- Recommendation: Store references/hashes and redacted summaries by default; define an explicit secure evidence retention mode for full content.
- Acceptance test: Insert known sensitive markers and prove default logs/events/audit omit them while authorized artifact storage remains traceable.
- Evidence: src/lib/engine/runner.ts, src/lib/engine/audit.ts, src/lib/engine/events.ts, src/app/api/account/export/route.ts

### F-033: Artifact writes had no practical size ceiling

- Severity: **medium**
- Status: **fixed_in_v8**
- Category: resource-governance
- Confidence: high
- Description: The write-artifact tool accepted unbounded content.
- Impact: A model could exhaust memory, disk, database capacity, or UI rendering.
- Recommendation: Keep a documented byte cap and later add streaming/object storage where justified.
- Acceptance test: Attempt boundary, boundary+1, and multibyte payloads and prove exact size enforcement.
- Evidence: src/lib/engine/tools/writeArtifact.ts

### F-034: Policy regular expressions can create denial of service

- Severity: **medium**
- Status: **fixed_in_v10**
- Category: policy-engine
- Confidence: medium
- Description: Policy patterns pass a bounded safe-regex compiler that rejects oversized expressions, backreferences, lookarounds, nested quantifiers, repeated wildcards, and malformed patterns before evaluation.
- Impact: Catastrophic backtracking can block the Node.js event loop during authorization.
- Recommendation: Use constrained glob/pattern semantics or safe-regex validation and bounded evaluation.
- Acceptance test: Submit known pathological expressions and long inputs; prove bounded latency or rejection.
- Evidence: src/lib/engine/policy.ts, src/app/api/policies/route.ts, src/lib/security/safe-regex.ts, tests/safe-regex.test.ts

### F-035: Rate limiting is process-local and trusts client forwarding headers

- Severity: **medium**
- Status: **partially_mitigated**
- Category: abuse-control
- Confidence: high
- Description: Forwarding headers are ignored unless proxy trust is explicitly enabled. Rate-limit state remains process-local and therefore is not a distributed production control.
- Impact: Attackers can bypass limits across workers/restarts or by rotating forged header values.
- Recommendation: Use authenticated principal/workspace keys and a shared limiter or documented single-process boundary; configure trusted proxies explicitly.
- Acceptance test: Exercise multiple workers, restarts, spoofed headers, users, and IPs; prove the intended global and per-user budget.
- Evidence: src/lib/rate-limit.ts, src/app/api/runs/route.ts, src/app/api/providers/test/route.ts, tests/rate-limit.test.ts

### F-036: Security headers improved but CSP remains absent

- Severity: **medium**
- Status: **partially_mitigated**
- Category: browser-security
- Confidence: high
- Description: The application now sends a Content Security Policy and baseline headers. The compatibility policy still permits inline scripts and styles, and browser-level enforcement tests remain.
- Impact: A future injection bug has fewer browser-side containment barriers.
- Recommendation: Add nonce/hash-based CSP, report-only rollout, and route tests without breaking Next.js runtime behavior.
- Acceptance test: Production responses include the approved CSP and Playwright confirms no required script/style violations.
- Evidence: next.config.ts

### F-037: Source lint is intentionally shallow and build ignores ESLint

- Severity: **medium**
- Status: **partially_mitigated**
- Category: code-quality
- Confidence: high
- Description: Build no longer suppresses ESLint and the non-interactive source lint checks merge markers, dangerous directives, dynamic code execution, malformed JSON, and client/server boundaries. A full semantic ESLint ruleset remains absent.
- Impact: Common correctness, React, security, and accessibility defects can pass CI.
- Recommendation: Adopt a pinned non-interactive ESLint configuration plus targeted security/accessibility rules and keep the fast scanner as an additional gate.
- Acceptance test: A clean install runs lint non-interactively; seeded violations fail with stable diagnostics.
- Evidence: scripts/lint-source.mjs, next.config.ts, package.json

### F-038: No generated SBOM, model inventory, or build provenance

- Severity: **high**
- Status: **fixed_in_v10**
- Category: supply-chain
- Confidence: high
- Description: The release pipeline generates a CycloneDX SBOM, license inventory, model inventory, and source-tree build provenance with hashes.
- Impact: Operators cannot reliably identify vulnerable components, licenses, models, plugins, or reproduce the artifact.
- Recommendation: Generate CycloneDX/SPDX, license inventory, model/plugin hashes, and build provenance during release.
- Acceptance test: The extracted ZIP contains validated inventories matching the lockfile and shipped artifacts, signed or hashed in the release manifest.
- Evidence: package.json, docs/canonical/14_ACCEPTANCE_GATES.md, scripts/generate-release-evidence.mjs, docs/canonical/evidence/release/SBOM.cyclonedx.json, docs/canonical/evidence/release/LICENSE_INVENTORY.json, docs/canonical/evidence/release/MODEL_INVENTORY.json, docs/canonical/evidence/release/BUILD_PROVENANCE.json

### F-039: Observability lacks traces, SLOs, and capacity evidence

- Severity: **high**
- Status: **partially_mitigated**
- Category: observability
- Confidence: high
- Description: A local metrics endpoint now reports status counts, latency percentiles, token usage, approval expiry, outbox backlog, durable-job state, and SLO evaluations. Cross-boundary traces, energy measurement, historical capacity series, and telemetry retention remain.
- Impact: Operators cannot answer why work is slow, expensive, failing, or saturating resources.
- Recommendation: Add redacted trace correlation, metrics, usage reconciliation, queue measures, SLOs, and local dashboards.
- Acceptance test: A benchmark run yields traceable p50/p95/p99 latency, queue depth, failure classes, token/cost totals, and an SLO verdict.
- Evidence: src/lib/engine/event-types.ts, docs/canonical/09_EVALUATION_OBSERVABILITY.md, src/lib/observability/metrics.ts, src/app/api/metrics/route.ts, tests/metrics.test.ts

### F-040: Governed memory architecture is documentation-only

- Severity: **high**
- Status: **fixed_in_v11**
- Category: memory
- Confidence: high
- Description: Governed memory is implemented and integrated into prompt assembly with owner filtering, expiry, token budgets, quarantine, provenance labeling, corrections, and deletion.
- Impact: Long-running agents either forget important context or accumulate untrusted, stale, contradictory, or cross-user material.
- Recommendation: Maintain ablation and poisoning evaluations before expanding automatic memory creation.
- Acceptance test: Create contradictory, expired, private, corrected, and deleted memories; prove scoring, provenance, isolation, and removal behavior.
- Evidence: docs/canonical/06_DATA_MEMORY_KNOWLEDGE.md, src/lib/db/schema.ts, src/lib/memory/governed-memory.ts, src/app/api/memory/route.ts, src/components/memory/memory-ledger.tsx, tests/governed-memory.test.ts, docs/canonical/decisions/ADR-0022-governed-local-memory-baseline.md, src/lib/memory/prompt-context.ts, tests/memory-prompt-context.test.ts

### F-041: Provider selection is not a measured capability router

- Severity: **high**
- Status: **fixed_in_v11**
- Category: model-routing
- Confidence: high
- Description: Model capability profiles, hard eligibility constraints, deterministic utility scoring, explicit fallback, no-eligible failure, persistence, API control, and run-level rationale are implemented.
- Impact: Critical work can be dispatched by static configuration rather than demonstrated fitness.
- Recommendation: Populate profiles through repeatable benchmark runs and invalidate stale evaluations.
- Acceptance test: Given constrained tasks and unavailable models, route to the Pareto-eligible candidate or return no-eligible-model without silent downgrade.
- Evidence: src/lib/engine/gateway.ts, src/lib/engine/providers, docs/canonical/05_REASONING_AND_INTELLIGENCE.md, src/lib/models/router.ts, src/lib/models/db-routing.ts, tests/model-router.test.ts

### F-042: Test portfolio is too narrow for the threat and failure model

- Severity: **high**
- Status: **partially_mitigated**
- Category: evaluation
- Confidence: high
- Description: The safe portfolio now includes lifecycle, evidence, egress, durable execution, backup/restore, memory, regex, tool-schema, metrics, context-budget, graph, crypto, and policy tests. Native database, browser, accessibility, load, and broad fault-injection suites remain incomplete.
- Impact: The system can pass 47 safe tests while remaining unsafe under realistic operation.
- Recommendation: Build layered adversarial and fault-injection suites tied to every high/critical finding.
- Acceptance test: Each high/critical finding has a failing regression before repair and a passing independent verification after repair.
- Evidence: tests, e2e, docs/canonical/14_ACCEPTANCE_GATES.md, tests/application-backup.test.ts, tests/governed-memory.test.ts, tests/metrics.test.ts, tests/context-budget.test.ts

### F-043: End-to-end tests are brittle smoke checks

- Severity: **medium**
- Status: **partially_mitigated**
- Category: evaluation
- Confidence: high
- Description: The Playwright suite now uses operator-supplied credentials, semantic readiness conditions, and coverage for run evidence, agent evaluation, and governed-memory lifecycle. Isolated database fixtures, repeated parallel/serial execution, accessibility assertions, and measured flake-rate evidence remain.
- Impact: The suite is materially less brittle, but shared-state and unexecuted browser coverage can still conceal authorization, recovery, accessibility, or concurrency regressions.
- Recommendation: Add per-run isolated databases and users, deterministic fixture teardown, accessibility checks, authorization negatives, restart recovery, and repeated serial/parallel flake measurement.
- Acceptance test: Run the E2E suite repeatedly in serial and parallel modes against isolated state, including accessibility, authorization, offline, and recovery cases, with a bounded measured flake rate.
- Evidence: e2e/smoke.spec.ts, playwright.config.ts, .github/workflows/ci.yml

### F-044: Seed workflow is destructive and includes known demo credentials

- Severity: **medium**
- Status: **fixed_in_v10**
- Category: operations
- Confidence: high
- Description: The seed refuses to run unless a destructive-seed flag is set, requires an operator-supplied twelve-character demo password, and no longer contains fallback application secrets or prints credentials.
- Impact: Running it in the wrong environment can destroy data or create an easily guessed account.
- Recommendation: Require explicit development/test environment, random ephemeral credentials, targeted fixture cleanup, and destructive confirmation guards.
- Acceptance test: Attempt seed in production mode and against a non-empty protected database; prove hard refusal and no mutation.
- Evidence: scripts/seed.ts, playwright.config.ts, .env.example

### F-045: Evidence percentage measures structure, not truth

- Severity: **medium**
- Status: **partially_mitigated**
- Category: evidence-quality
- Confidence: high
- Description: The UI originally risked presenting event-shape completeness as overall evidence quality. It is now labeled structural coverage, but semantic correctness and verifier independence remain separate unfinished controls.
- Impact: Users can over-trust a complete-looking ledger even when outputs are wrong or self-verified.
- Recommendation: Keep structural labeling and add claim-level evidence, verifier identity, reproducibility, contradiction, and semantic evaluation.
- Acceptance test: Show a structurally complete but deliberately false run and prove the UI does not label it verified.
- Evidence: src/components/runs/evidence-ledger.tsx, src/lib/engine/evidence-summary.ts

### F-046: Most canonical capabilities remain blocked or unimplemented

- Severity: **high**
- Status: **partially_mitigated**
- Category: program-execution
- Confidence: high
- Description: v9 and v10 implement durable contracts, SQLite persistence primitives, transactional outbox, governed memory, encrypted restore, lifecycle controls, observability, data export/deletion, budgets, and release provenance. Production worker cutover, measured routing, delegated identity, and full native/browser verification remain.
- Impact: Documentation volume can be mistaken for platform maturity, obscuring the implementation gap.
- Recommendation: Expose implemented-versus-designed status prominently and execute dependency-unblocking vertical slices rather than adding parallel documents.
- Acceptance test: A release dashboard derives status from code/test evidence and cannot count designed-only tasks as delivered capability.
- Evidence: docs/canonical/tasks/TASKS.json, docs/canonical/16_TRACEABILITY_MATRIX.md, docs/canonical/26_V9_DURABLE_ENGINEERING_REPORT.md, src/lib/durable/sqlite-store.ts, src/lib/backup/application-backup.ts, src/lib/memory/governed-memory.ts

### F-047: SQLite and web-process topology limit safe scale and failover

- Severity: **high**
- Status: **partially_mitigated**
- Category: infrastructure
- Confidence: high
- Description: SQLite now has immediate-transaction serialization, persisted durable schemas, a repository-owned adapter, outbox leases, and migration checks. The web process still launches the production runner and there is no tested worker fleet or failover topology.
- Impact: Multi-process deployment, failover, concurrent writers, and horizontal scaling can corrupt assumptions or lose work.
- Recommendation: Define supported single-node limits, separate durable worker execution, and introduce a tested persistence profile before scaling out.
- Acceptance test: Run load and failover tests at documented limits; unsupported topologies must fail configuration validation.
- Evidence: src/lib/db/index.ts, src/lib/engine/start.ts, docs/canonical/08_INFRASTRUCTURE_SOVEREIGNTY.md, src/lib/durable/sqlite-store.ts, src/lib/durable/outbox.ts, src/lib/engine/runner.ts, scripts/validate-migrations.mjs

### F-048: No tested Content Security Policy

- Severity: **high**
- Status: **partially_mitigated**
- Category: browser-security
- Confidence: high
- Description: A CSP is configured and scanned, but it retains unsafe-inline compatibility directives and has not passed browser-level nonce, third-party, or violation-report testing.
- Impact: Cross-site scripting impact is not meaningfully contained at the browser policy layer.
- Recommendation: Design and roll out report-only then enforced CSP with route-level automated checks.
- Acceptance test: All production pages load under enforced CSP with no unauthorized script, style, frame, connect, image, or font source.
- Evidence: next.config.ts, scripts/roast-project.mjs

### F-049: Tool arguments are not uniformly governed by explicit versioned schemas

- Severity: **high**
- Status: **fixed_in_v11**
- Category: capability-security
- Confidence: high
- Description: Tools declare versioned schemas and capabilities; arguments are validated, allowlists enforced, and execution is bounded by timeout and output size.
- Impact: Malformed, oversized, ambiguous, or injected arguments can reach tool implementations inconsistently.
- Recommendation: Add OS-level isolation for high-risk tools and maintain mutation tests for schema bypass.
- Acceptance test: Fuzz every tool with invalid types, extra fields, oversized values, Unicode edge cases, and schema-version mismatch.
- Evidence: src/lib/engine/tools/index.ts, src/lib/engine/types.ts, src/lib/engine/tools/validate.ts, src/lib/engine/runner.ts, tests/tool-arguments.test.ts, src/lib/engine/tool-runtime.ts, tests/tool-runtime.test.ts

### F-050: Context and output budgets are incomplete

- Severity: **high**
- Status: **partially_mitigated**
- Category: context-engineering
- Confidence: high
- Description: Run requests now bound context and output tokens; context assembly deterministically preserves mandatory messages and recent complete segments under budget. Adaptive stopping, cache isolation, and omission-quality benchmarks remain.
- Impact: Long histories or retrieved content can crowd out policy/current facts, increase cost, and degrade correctness.
- Recommendation: Implement mandatory-context reservation, measured selection, output ceilings, and bounded planner/critic/verifier stopping.
- Acceptance test: Run adversarial long-context cases and prove mandatory policy/current code facts survive while cost and latency remain within budget.
- Evidence: src/lib/engine/runner.ts, docs/canonical/05_REASONING_AND_INTELLIGENCE.md, src/app/api/runs/route.ts, src/lib/engine/context-budget.ts, tests/context-budget.test.ts

### F-051: Stale workers could commit after lease takeover when identity was reused

- Severity: **critical**
- Status: **fixed_in_v12**
- Category: recovery failure
- Confidence: high
- Description: Durable mutations previously checked worker identity and lease time but did not bind commits to a monotonically increasing fencing token. A restarted worker using the same identity could race a newer lease holder.
- Impact: Split-brain workers could overwrite checkpoints or complete a job after losing authority, invalidating exactly-once and recovery claims.
- Recommendation: Require a fencing token on every lease-bound mutation and reject stale tokens in memory and SQLite adapters.
- Acceptance test: Acquire a lease twice with the same worker identity after expiry; token 1 must be rejected and token 2 must commit.
- Evidence: src/lib/durable/types.ts, src/lib/durable/memory-store.ts, src/lib/durable/sqlite-store.ts, tests/durable-fencing.test.ts, tests/v12-property-race.test.ts

### F-052: Approval resolution lacked a cross-process compare-and-set revision

- Severity: **high**
- Status: **fixed_in_v12**
- Category: agent-control failure
- Confidence: high
- Description: The active approval row had a status but no revision. Competing processes could both observe pending before one committed a terminal decision.
- Impact: A stale operator action or concurrent process could overwrite or contradict the authoritative human decision.
- Recommendation: Persist an approval revision and update terminal status only when id, prior status, and revision all match. Return a conflict to stale clients.
- Acceptance test: Two resolutions using the same expected revision must yield one successful transition and one approval_revision_conflict.
- Evidence: src/lib/db/schema.ts, src/lib/engine/runner.ts, src/app/api/approvals/[approvalId]/route.ts, drizzle/0006_v12_fencing_and_verification.sql

### F-053: Verification decisions were not immutably bound to tested source and release artifacts

- Severity: **high**
- Status: **fixed_in_v12**
- Category: verification failure
- Confidence: high
- Description: Run evidence and human review existed, but there was no immutable attestation binding requirement revision, source tree, test output, artifact, builder, verifier, and release candidate.
- Impact: A verification label could outlive or refer to different code and test evidence, creating false release confidence.
- Recommendation: Create hash-bound verification attestations, reject builder/verifier identity collisions, and expose absent verification in the interface.
- Acceptance test: Changing any bound field must invalidate the evidence hash; self-verification must be rejected.
- Evidence: src/lib/verification/attestation.ts, src/app/api/runs/[runId]/verify/route.ts, src/components/runs/verification-panel.tsx, tests/verification-attestation.test.ts

### F-054: Runtime calm could be mistaken for release or pilot readiness

- Severity: **high**
- Status: **fixed_in_v12**
- Category: design deception
- Confidence: high
- Description: Operational metrics showed local state but did not explicitly gate build, native tests, browser E2E, accessibility, restart recovery, tenant isolation, or extracted-package evidence.
- Impact: An operator could interpret zero failures in an empty or lightly used system as evidence that the release was pilot-ready.
- Recommendation: Add a conservative evidence gate that treats unknown release evidence as blocking and separates runtime health from release classification.
- Acceptance test: Healthy empty metrics with unknown release facts must remain DEVELOPMENT ONLY; controlled pilot requires every hard fact.
- Evidence: src/lib/release/pilot-readiness.ts, src/components/operations/control-room.tsx, tests/pilot-readiness.test.ts

### F-055: Model routing did not distinguish verification quality or unhealthy candidates

- Severity: **high**
- Status: **fixed_in_v12**
- Category: agent-control failure
- Confidence: high
- Description: The measured router scored planning and coding capabilities but lacked an explicit verifier-quality signal and health state.
- Impact: Verification tasks could select a strong builder but weak reviewer, or choose an unavailable model if other metrics were attractive.
- Recommendation: Record verification quality and health, apply task-class weighting, and reject unavailable candidates as a hard constraint.
- Acceptance test: A verification task must select the eligible high-verification model and reject an unavailable higher-scoring model.
- Evidence: src/lib/models/router.ts, src/lib/models/db-routing.ts, src/app/api/models/route.ts, tests/model-router.test.ts

### F-056: Active approval waits were process-local and could not resume after restart

- Severity: **critical**
- Status: **partially_mitigated**
- Category: recovery failure
- Confidence: high
- Description: The approval row survived, but the active model/tool continuation originally lived in process memory. v13 adds deterministic continuation keys, durable pause/requeue, revision compare-and-set, expiry, and checkpoint metadata for the bounded pilot path.
- Impact: A restart during a risky action could leave the run permanently waiting or tempt an operator to repeat a side effect.
- Recommendation: Execute native restart integration in the isolated lane and prove the exact approved step resumes once after process replacement.
- Acceptance test: Persist a pending approval, terminate the process, restart, resolve the expected revision, and prove one side effect and one terminal durable state.
- Evidence: src/lib/engine/runner.ts, src/app/api/approvals/[approvalId]/route.ts, tests/durable-approval-restart.test.ts

### F-057: Pilot resources lacked a complete tenant and workspace boundary

- Severity: **critical**
- Status: **partially_mitigated**
- Category: tenant isolation failure
- Confidence: high
- Description: v13 persists tenant, workspace, owner, and visibility across pilot resources and centralizes personal-scope resolution, but full multi-process and browser authorization testing is pending.
- Impact: Resource identifiers could cross user or workspace boundaries even when individual routes appeared owner-filtered.
- Recommendation: Run native cross-tenant API, search, artifact, approval, verification, export, backup, and restore tests, including mutations that remove predicates.
- Acceptance test: Every cross-tenant read and write must fail, and removing one tenant predicate must make the suite fail.
- Evidence: src/lib/db/schema.ts, src/lib/auth/pilot-scope.ts, tests/tenant-isolation-property.test.ts, drizzle/0007_v13_pilot_scope.sql

### F-058: Pilot readiness could be implied by static or missing evidence

- Severity: **high**
- Status: **fixed_in_v13**
- Category: misleading success
- Confidence: high
- Description: v13 derives pilot readiness from run, durable job, receipt, approval, model, memory, capability, artifact, reconciliation, verification, and release evidence. Unknown evidence is blocking.
- Impact: Operators could interpret an incomplete checklist or completed run as proof that the release was safe for pilot use.
- Recommendation: Keep fail-closed evidence semantics and regression tests for every unknown gate.
- Acceptance test: Removing any mandatory evidence item must change the run to blocked and identify the missing evidence.
- Evidence: src/lib/release/pilot-run-gates.ts, src/lib/release/pilot-run-evidence.ts, tests/pilot-run-gates.test.ts

### F-059: Database initialization during module import broke production build discovery

- Severity: **high**
- Status: **fixed_in_v13**
- Category: build reproducibility
- Confidence: high
- Description: The database was opened eagerly when API modules were imported during Next.js page-data collection. v13 opens SQLite lazily on first real database operation and forces authenticated application rendering to remain dynamic.
- Impact: A clean source build required a native runtime binding even when no database query was executed, preventing reproducible packaging and hiding build/runtime boundaries.
- Recommendation: Retain lazy initialization and verify the complete build in both source-safe and native CI lanes.
- Acceptance test: Import the database module without a native binding and complete `next build` without opening SQLite.
- Evidence: src/lib/db/index.ts, src/app/[locale]/(app)/layout.tsx, tests/db-lazy-initialization.test.ts, docs/canonical/evidence/v13/build/production-build-after-lazy-db.log

### F-060: Native persistence validation is unavailable on the protected host

- Severity: **high**
- Status: **partially_mitigated**
- Category: release verification
- Confidence: high
- Description: v14 runs the complete persistence suite through Node 22 built-in SQLite without downloading or building a new binary. The better-sqlite3 native lane remains available in pinned CI but is not locally proven.
- Impact: SQLite transactions, multi-process races, migrations, durable approval restart, and production runtime behavior are not locally proven.
- Recommendation: Run the pinned isolated validation workflow and attach dependency provenance, native results, migrations, build, and resource metrics.
- Acceptance test: The isolated lane must install from lockfile, run all native suites, and publish machine-readable evidence with exact package and binary provenance.
- Evidence: src/lib/db/sqlite-client.ts, tests/sqlite-driver-fallback.test.ts, tests/canonical-migrations.test.ts, docs/canonical/evidence/v14/test-full.log

### F-061: Browser, accessibility, and visual regression gates are not executed locally

- Severity: **high**
- Status: **environment_blocked**
- Category: accessibility blocker
- Confidence: high
- Description: Chromium is installed, but organization-managed policy sets URLBlocklist to ["*"], blocking localhost before application navigation. The managed policy was not modified or bypassed.
- Impact: Keyboard, focus, responsive, accessibility, restart, reconciliation, and operator-truth behavior are not browser-verified.
- Recommendation: Execute Chromium, Firefox, mobile, accessibility, and visual regression in the pinned disposable CI lane.
- Acceptance test: All pilot browser scenarios must pass with screenshots, traces, accessibility results, and responsive evidence.
- Evidence: playwright.config.ts, e2e/smoke.spec.ts, docs/canonical/evidence/v14/browser-policy-block.json, .github/workflows/pilot-validation.yml

### F-062: Final verification is not yet independently bound to the released ZIP hash

- Severity: **critical**
- Status: **open**
- Category: verification failure
- Confidence: high
- Description: v13 includes a hash-bound verifier that rejects incomplete evidence, but no operationally separate verifier has accepted a final archive after native and browser gates.
- Impact: The builder could package source that differs from tested evidence or overstate readiness.
- Recommendation: Freeze the release, execute all isolated gates, bind evidence to the archive hash, and run a distinct verifier invocation that attempts rejection.
- Acceptance test: A distinct verifier identity must accept the exact final ZIP SHA-256 with all required evidence hashes and no hidden critical limitation.
- Evidence: scripts/verify-pilot-candidate.mjs, docs/canonical/evidence/v13/pilot-evidence-bundle.json

### F-063: Live remote model conversations remain outside restart-safe pilot execution

- Severity: **critical**
- Status: **accepted_risk**
- Category: agent-control failure
- Confidence: high
- Description: The bounded pilot supports simulation and local artifact generation. Remote provider dialogue state is not serialized as durable model intents and immutable response references.
- Impact: A restart during a live remote model interaction can require re-execution, consume additional cost, or produce a non-equivalent response.
- Recommendation: Deny live-provider pilot execution until model request intents, response references, replay policy, cost accounting, and privacy scope are durable.
- Acceptance test: Terminate before and after a remote response and prove deterministic continuation or explicit reconciliation without silent re-request.
- Evidence: docs/canonical/41_V13_PILOT_SCOPE.md, docs/canonical/42_V13_ARCHITECTURE_DELTA.md

### F-064: Runtime migration discovery applied only the first declared schema change

- Severity: **critical**
- Status: **fixed_in_v14**
- Category: data-loss risk
- Confidence: high
- Description: The legacy migration journal listed only 0000 even though later SQL migrations existed. Runtime startup therefore could create an outdated schema while source validation merely counted files.
- Impact: Production startup could omit durable, memory, tenancy, verification, and approval columns, creating runtime failures and misleading release evidence.
- Recommendation: Keep ordered SQL files canonical, persist each filename and SHA-256, and reject migration drift.
- Acceptance test: Apply all migrations to a clean database, rerun idempotently, and fail after modifying a historical migration.
- Evidence: src/lib/db/migrations.ts, tests/canonical-migrations.test.ts, drizzle/0008_v14_runtime_alignment.sql

### F-065: Static generation inherited an unbounded host CPU count

- Severity: **high**
- Status: **fixed_in_v14**
- Category: performance collapse
- Confidence: high
- Description: Next.js inferred a very large CPU count in the container and spawned excessive static-generation workers.
- Impact: Builds could stall, exhaust memory, or interfere with other workloads on high-core-count hosts.
- Recommendation: Keep explicit bounded build concurrency and record build duration and route metrics.
- Acceptance test: Complete the production build with two workers and a successful exit.
- Evidence: next.config.ts, docs/canonical/evidence/v14/build-production.json, docs/canonical/evidence/v14/build-production.log

### F-066: Demo seed referenced tenant and workspace identifiers without creating the scope rows

- Severity: **high**
- Status: **fixed_in_v14**
- Category: tenant isolation failure
- Confidence: high
- Description: The seeded runs carried personal tenant and workspace identifiers while the tenants, workspaces, and memberships tables remained empty.
- Impact: Demo and E2E state could appear scoped while lacking the membership records used by backend authorization.
- Recommendation: Create the personal pilot scope before seeding scoped agents or runs.
- Acceptance test: Seed a clean database and verify tenant, workspace, membership, run, approval, and artifact scope survive backup and restore.
- Evidence: scripts/seed.ts, src/lib/auth/pilot-scope.ts, docs/canonical/evidence/v14/clean-restore-proof.json

### F-067: The local browser executable is governed by a deny-all URL policy

- Severity: **high**
- Status: **environment_blocked**
- Category: accessibility blocker
- Confidence: high
- Description: The installed Chromium returns ERR_BLOCKED_BY_ADMINISTRATOR for localhost because its managed URLBlocklist contains a wildcard deny rule.
- Impact: Browser E2E, keyboard, responsive, offline, accessibility, and visual-regression claims cannot be made from this host.
- Recommendation: Execute the pinned browser lane in a disposable CI worker and retain the local block as a release blocker.
- Acceptance test: The same frozen candidate passes Chromium browser, accessibility, offline, and responsive tests in the disposable lane.
- Evidence: docs/canonical/evidence/v14/browser-policy-block.json, .github/workflows/pilot-validation.yml

### F-068: Restore interruption after target displacement lacked a rollback proof

- Severity: **high**
- Status: **fixed_in_v14**
- Category: recovery failure
- Confidence: high
- Description: The restore implementation had rollback code, but no deterministic kill-point proved that the original target is restored after displacement and before commit.
- Impact: An interrupted restore could have been claimed atomic without evidence at the most dangerous boundary.
- Recommendation: Retain explicit fault injection and regression coverage around target displacement.
- Acceptance test: Inject failure immediately after displacement and verify the original target bytes remain available.
- Evidence: src/lib/backup/application-backup.ts, tests/application-backup.test.ts

### F-069: Full-process outbound network behavior is not independently audited

- Severity: **high**
- Status: **open**
- Category: security-egress
- Confidence: high
- Description: The sovereign network guard proves declared adapter policy, but no packet- or syscall-level audit has observed the complete application during startup, build, workflow execution, and shutdown with outbound traffic denied.
- Impact: An undeclared dependency or library call could escape the application-level guard and invalidate air-gap claims.
- Recommendation: Run the extracted release in an isolated network namespace with deny-by-default egress and capture all connection attempts.
- Acceptance test: Complete startup and the zero-key workflow with egress denied, zero unexpected attempts, and machine-readable capture bound to the release hash.
- Evidence: src/lib/sovereignty/network-policy.ts, docs/canonical/evidence/v15/sovereign-network-evidence.json

### F-070: No real local generative model artifact has been benchmarked

- Severity: **critical**
- Status: **open**
- Category: model-routing
- Confidence: high
- Description: The deterministic local runtime proves contracts and zero-key orchestration, while the medium local model is only a hardware profile and was not downloaded or executed.
- Impact: Model sovereignty, task quality, tool reliability, memory behavior, latency, and hardware feasibility remain unproven for a useful generative workload.
- Recommendation: Benchmark at least one license-reviewed local model artifact in a disposable environment and bind its hash, runtime, quality, memory, latency, and energy evidence to the registry.
- Acceptance test: A real local model completes the sovereign golden workflow and adversarial structured-output tasks without commercial keys.
- Evidence: src/lib/sovereignty/model-runtime.ts, docs/canonical/evidence/v15/sovereign-model-registry.json

### F-071: Energy-aware scheduling uses estimates rather than measured hardware data

- Severity: **high**
- Status: **open**
- Category: economics
- Confidence: high
- Description: The placement and energy policy contracts are implemented, but power, thermal, load, and task-energy values are synthetic estimates.
- Impact: Energy-saving, thermal-protection, and local-versus-remote break-even decisions may be materially wrong on target hardware.
- Recommendation: Collect repeated wall-power or trusted telemetry measurements for idle, model load, inference, retrieval, backup, and restore.
- Acceptance test: Measured profiles include confidence intervals and alter routing only within validated bounds.
- Evidence: src/lib/sovereignty/node-placement.ts, docs/canonical/evidence/v15/sovereign-hardware-energy.json

### F-072: Clean offline installation still depends on an unbuilt dependency bundle

- Severity: **high**
- Status: **open**
- Category: supply-chain
- Confidence: high
- Description: The source release and signed update are self-contained, but a new machine still requires JavaScript packages, system prerequisites, browser artifacts, and any real model artifact from external sources.
- Impact: Loss of public registries or model hubs prevents clean installation and disaster recovery onto replacement hardware.
- Recommendation: Create a license-compliant signed installation bundle with package, system, browser, and model manifests plus integrity verification.
- Acceptance test: Install and validate the extracted release on a clean disconnected machine with public registries unavailable.
- Evidence: docs/sovereignty/SOVEREIGN_OPPORTUNITY_PORTFOLIO.json, docs/canonical/tasks/TASKS.json

### F-073: Signed air-gap bundles were replayable and ignored local key revocation

- Severity: **high**
- Status: **fixed_in_v15**
- Category: capability-security
- Confidence: high
- Description: Signature validation alone accepted a copied task or result repeatedly and could not reject a compromised node key.
- Impact: An attacker or operator error could repeat bounded work, duplicate local writes, or accept evidence from a revoked offline node.
- Recommendation: Retain purpose-scoped trust checks and a durable replay ledger at the acceptance boundary.
- Acceptance test: A new process instance rejects a consumed bundle, and a revoked key is rejected before payload acceptance.
- Evidence: src/lib/sovereignty/replay-ledger.ts, src/lib/sovereignty/trust-store.ts, src/lib/sovereignty/airgap-handoff.ts, tests/sovereign-replay-trust.test.ts

### F-074: Offline update migration execution is declared but not automatically rehearsed

- Severity: **high**
- Status: **partially_mitigated**
- Category: supply-chain
- Confidence: high
- Description: The signed update format lists migration files and validation commands, and file apply/rollback is proven, but the update engine does not execute migrations or capture a reversible database rehearsal.
- Impact: A source update may apply successfully while its schema change fails or cannot be rolled back.
- Recommendation: Add a staged database-copy rehearsal, migration ledger verification, application validation, and explicit schema rollback policy before committing the update.
- Acceptance test: An update with a real migration passes dry run, apply, validation, rollback, and previous-version revalidation offline.
- Evidence: src/lib/sovereignty/offline-update.ts, tests/sovereign-offline-update.test.ts, docs/canonical/evidence/v15/signed-offline-update-evidence.json

### F-075: Root and signing keys lack protected hardware custody and rotation proof

- Severity: **medium**
- Status: **partially_mitigated**
- Category: cryptography
- Confidence: high
- Description: Context-separated keys, signing identities, validity, purpose and revocation are implemented, but root keys and private signing keys remain process memory or PEM material in the proof harness.
- Impact: Host compromise could expose all software-protected sovereign identities and backup keys.
- Recommendation: Implement optional OS keychain or TPM-backed adapters, rotation ceremonies, recovery-key separation, and secret-access audit.
- Acceptance test: Rotate installation, tenant, backup, and signing keys without losing authorized data; revoked versions cannot sign or decrypt new material.
- Evidence: src/lib/sovereignty/key-hierarchy.ts, src/lib/sovereignty/trust-store.ts, tests/sovereign-key-hierarchy.test.ts

### F-076: Monolithic test orchestration retains an open handle after all suites report

- Severity: **medium**
- Status: **partially_mitigated**
- Category: reliability
- Confidence: high
- Description: The complete Vitest run reports every suite as passing but does not terminate within the bounded window; split deterministic runs terminate and prove all tests.
- Impact: CI can hang after successful tests, wasting capacity and obscuring real timeouts.
- Recommendation: Identify the leaked timer, database handle, worker, or server and add an open-handle regression gate.
- Acceptance test: The single monolithic test command exits zero within its bounded budget after running the same 180 tests.
- Evidence: docs/canonical/evidence/v15-final/full-tests.log, docs/canonical/evidence/v15-final/v15-regression-summary.json

## Appendix B - Evidence hashes

- verticalSlices: `18295152d9af3ab27e5fd32df1a6692149fdec4114f2ce5a00ce22ac1f643056`
- dependencyLedger: `f528c384475faa0685810bf5a7f59aea2f960b6f21984961328845973f34464e`
- networkEvidence: `65a08a2991b7667d6674a368c5d3e46b9e2e3c9760efb3b652d863a1e54d13e3`
- modelRegistry: `4bb90bfe353565673408331ae90bdab7108fe5a464c082f9f61b356c6e927dd4`
- hardwareEnergy: `82010d88d50ef9eb7d7532fcab67e353994be6e8b71b24f29c408a8fc66bc6d1`
- controlPlane: `d71227d409437ee89a83312c5049e3c1cd06b5b34691c2df1c1d37c3dce53880`
- signedAirGapHandoff: `f433c75e25da663f476d1e5ed7212e55379898e9b7497b2c86afc95b175049d5`
- signedOfflineUpdate: `f6d1fb8ef4c3064f65a43d605835e0a7984fb0627249416b75706eda176ade5a`
- sovereigntyLedger: `5c64594088bfbd317384223f82182da02c45a1161f592bc4f6a18a1b53aa84b5`

## Appendix C - Final blockers

- `hardware_energy_measurement_missing`
- `outbound_network_audit_incomplete`
- `real_local_model_quality_not_benchmarked`
- `offline_clean_installation_bundle_missing`
- `offline_update_database_migration_rehearsal_missing`
- `protected_hardware_key_custody_unproven`
