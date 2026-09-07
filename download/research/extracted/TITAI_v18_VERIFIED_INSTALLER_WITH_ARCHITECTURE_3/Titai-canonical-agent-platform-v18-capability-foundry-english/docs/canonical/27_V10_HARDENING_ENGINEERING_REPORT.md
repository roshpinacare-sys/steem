# v10 Hardening Engineering Report

## Verdict

v10 closes a substantial portion of the gap between the canonical architecture and the executable repository. The release adds transactional SQLite building blocks, durable-work persistence contracts, run idempotency, an event/audit outbox, governed memory, user-scoped policy and template ownership, context and output budgets, local SLO metrics, encrypted application-database backup and restore, and repeatable supply-chain evidence.

This is a major risk reduction, not a production-readiness declaration. The active runner is still the process-local compatibility path. Native database integration, successful page-data collection in the production build, Playwright execution, restart-safe approval continuation, and an evidence-based model router remain promotion blockers.

## Starting condition

The v9 release proved a portable durable core with crash injection and exactly-once observed side-effect behavior, but it did not connect that core to the application database or main runner. Custom policies and templates were not consistently owner-scoped, run creation had no persisted idempotency contract, event and audit sequence allocation were vulnerable to concurrent writers, application backup covered only the durable proof store, and memory remained a canonical design rather than an operational subsystem.

## Implemented in v10

### Transactional SQLite foundations

- Added three validated SQL migrations.
- Added durable jobs, receipts, and outbox tables.
- Added a SQLite durable-store adapter with lease, heartbeat, checkpoint, terminal-state, snapshot, and restore behavior.
- Added outbox claiming, retry, publication, and failure handling.
- Added event sequence allocation, event append, and outbox append inside one immediate transaction.
- Added audit hash-chain allocation, audit append, and outbox append inside one immediate transaction.
- Added a no-native migration validator using the Node SQLite implementation.

### Run integrity and bounded execution

- Added per-user persisted idempotency keys for run creation.
- Reuse of an idempotency key with a materially different request is rejected.
- Added run deadlines, maximum output tokens, and maximum context tokens.
- Added persisted approval expiry.
- Added active-run admission limits.
- Removed full objectives and system prompts from run-start audit/event payloads; hashes and lengths are recorded instead.

### Security and identity hardening

- Added explicit, fail-closed tool argument validation.
- Added bounded regular-expression validation for policy conditions.
- Added versioned provider-secret encryption with context binding and legacy-read compatibility.
- Added first-user administrator bootstrap and closed registration by default thereafter.
- Added optional invite-gated or explicitly public registration.
- Scoped custom policies and templates to their owners while preserving explicit built-ins.
- Added a baseline Content Security Policy and retained SSRF/egress protections.
- Added logical audit redaction overlays that preserve raw chain verification while hiding deleted-user content in normal reads.

### Governed local memory

The repository now includes a user-owned memory lifecycle with:

- Eight explicit memory kinds.
- Mandatory provenance.
- Confidence, authority, contradiction risk, and sensitivity.
- Expiry and active/superseded/deleted state.
- Correction chains and contradiction groups.
- Owner isolation.
- Explainable lexical retrieval under a token budget.
- Create, retrieve, correct, delete, export, and UI inspection paths.

Automatic agent injection remains disabled. Memory is treated as evidence, not authority, until poisoning, omission, and cross-scope evaluation gates exist.

### Backup, restore, and data lifecycle

- Added a full SQLite snapshot through WAL checkpoint and `VACUUM INTO`.
- Added AES-256-GCM encryption, scrypt key derivation, authenticated metadata, and SHA-256 integrity.
- Added quick-check, foreign-key, and required-table validation before restore.
- Added atomic restore, overwrite protection, and displaced-database retention.
- Added user export and controlled account deletion.
- Added backup and restore command-line entry points.

The backup tests cover clean restore, wrong passphrase, tampering, and overwrite refusal. A complete clean-machine deployment drill and measured RTO/RPO remain outstanding.

### Observability, context, and supply chain

- Added local metrics and SLO evaluation endpoints.
- Added deterministic context and output budget enforcement.
- Added CycloneDX SBOM generation.
- Added package license inventory, model inventory, and source-tree provenance.
- Added a repeatable release manifest generator.
- Added a cross-platform production-build wrapper with Next.js telemetry disabled.

### UI and E2E improvements

- Added a Memory Ledger interface for search, creation, correction, provenance inspection, sensitivity, and deletion.
- Removed hard-coded E2E passwords and fixed waits.
- Expanded the E2E flow to cover run evidence, agent evaluation, and governed-memory lifecycle.

Browser execution was not completed in this environment, so E2E remains partially mitigated rather than verified.

## Quantitative validation

| Gate | Result |
|---|---:|
| Canonical tasks | 52 |
| Typed claims | 58 |
| Official source records | 28 |
| ADRs | 23 |
| Coverage domains | 28 |
| Experiments | 15 |
| Safe test files | 24 passed |
| Safe tests | 85 passed |
| Durable test files | 5 passed |
| Durable tests | 12 passed |
| Baseline evaluation | 8/8 passed |
| Migration files validated | 3 |
| Required tables checked | 10 |
| Static roast controls | 26/27 passed |
| Roast findings | 50 validated |
| Project killers | 20 validated |

The durable crash proof still observes one side effect across two attempts after an injected crash. The latest proof hash is recorded in `docs/canonical/evidence/durable-vertical-slice.json`.

## Roast status

The finding registry now records:

- 13 fixed in v8.
- 6 fixed in v10.
- 25 partially mitigated.
- 4 open.
- 2 environment blocked.

The remaining open or environment-blocked high-impact areas are:

1. Production runner cutover to the durable SQLite path.
2. Restart-safe serialized approval continuation.
3. Measured capability-based model routing.
4. Safe Drizzle ORM upgrade and regression evidence.
5. Native database integration-test execution.
6. Completed production page-data collection and browser E2E evidence.

## Security interpretation

v10 materially improves least privilege, ownership, data minimization, secret separation, request replay safety, database writer serialization, memory provenance, backup integrity, and release traceability. It does not yet provide a complete tenant/delegation model, sandboxed tools, key rotation drill, signed provenance, distributed traces, or multi-process worker proof.

## Rollback posture

The current detached runner remains the compatibility and rollback path. The new durable adapter is not silently activated. Production cutover must occur behind an explicit feature flag after native migration and crash/restart tests pass. Existing encrypted-secret records remain readable through the legacy version path while new records use context-bound encryption.

## Promotion decision

**Status: implemented, independent verification pending.**

Suitable for continued controlled development and agent execution. Not yet approved for autonomous multi-user production operation or irreversible external side effects without human supervision.
