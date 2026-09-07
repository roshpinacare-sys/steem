# Architecture

Titai v10 is a Next.js application with a local-first control plane. Browser
surfaces call Node route handlers; the current agent runner executes in the web
process. Repository-owned durable contracts and SQLite persistence primitives are
present, but production runner cutover remains incomplete.

## Layers

```text
src/app/[locale]/(app)  Product surfaces: missions, runs, agents, skills, memory, settings
src/app/api             Authenticated REST and SSE handlers
src/lib/db              Drizzle schema, migrations, SQLite connection and recovery
src/lib/engine          Planning, policies, tools, providers, events, audit and runner
src/lib/durable         Leases, checkpoints, receipts, workers, stores, outbox and proof
src/lib/memory          Governed scoring and retrieval-budget logic
src/lib/backup          Encrypted consistent application-database snapshot and restore
src/lib/observability   Local operational metrics and SLO calculations
src/lib/security        Egress, regex, and related security boundaries
src/components          Evidence-first UI, canvas, studio, ledger and settings
```

## Current execution path

1. `POST /api/runs` validates user input, budgets, deadline, and optional
   `Idempotency-Key`.
2. Run creation is serialized in an immediate SQLite transaction. A key reused
   with different effective input fails closed.
3. The runner resolves credentials, records minimized start evidence, plans a
   bounded acyclic DAG, and executes dependency-ready steps.
4. Every tool call passes argument-schema validation and policy evaluation.
5. Human approvals have persisted expiry timestamps; the in-memory wait can resume
   only while the same process remains alive.
6. Event sequence allocation and audit-chain append run in immediate transactions.
   Each write creates a transactional outbox record.
7. Completion, failure, cancellation, and evidence are persisted and streamed.

A process restart still interrupts the current run loop. `recoverOnBoot()` reports
that truth instead of pretending a parked promise survived.

## Durable migration path

The portable core proves:

- expiring leases and heartbeats;
- revisioned checkpoints;
- deterministic side-effect receipts;
- fail-closed reconciliation for ambiguous operations;
- bounded attempts and workers;
- crash-after-effect replay without duplicate execution;
- encrypted snapshot restore and independent verification.

The SQLite layer adds `durable_jobs`, `durable_receipts`, and `durable_outbox` plus
a `SqliteDurableStore`. `DUR-002` remains in progress until the production runner
uses that adapter behind a feature flag and native crash/restart tests pass.

## Governed memory

The `memories` table stores owner, type, content hash, tags, provenance,
confidence, authority, contradiction risk, sensitivity, correction linkage,
expiry, and lifecycle status. Retrieval:

- is owner-scoped;
- excludes expired and corrected records;
- excludes restricted records by default;
- returns scoring reasons;
- obeys a token budget;
- never grants permissions.

Automatic injection into agent prompts is intentionally disabled in v10. The
Memory Ledger lets the user inspect, create, correct, and delete records first.

## Backup and data lifecycle

Application backup uses SQLite `VACUUM INTO` for a consistent snapshot, then
quick-check, foreign-key validation, SHA-256, scrypt, and AES-256-GCM. Restore is
atomic and refuses overwrite without an explicit flag.

User export includes owned definitions, runs, evidence, artifacts, policies,
templates, and memories but excludes password hashes and provider secret
ciphertext. Account deletion cascades owned records and adds audit redaction
overlays so public audit reads hide identity/content while raw hash-chain
verification remains possible.

## Security and sovereignty boundaries

- Simulation and Ollama-compatible local paths do not require commercial keys.
- Remote egress rejects private, loopback, link-local, metadata, and unsafe redirect targets.
- Provider secrets are versioned and bound to user/provider context.
- Registration is closed after first-user bootstrap unless explicitly enabled.
- Tool schemas, policy rules, deadlines, output limits, context budgets, and active-run limits fail closed.
- Build wrapper disables anonymous Next.js telemetry.
- Release evidence includes SBOM, licenses, model inventory, and source provenance.

## Remaining architectural gaps

- Production runner remains detached and process-local.
- Approval continuation is not durable.
- Transactional side-effect receipts are not yet connected to real production tools.
- Native SQLite concurrency and migration suites are environment-blocked here.
- No distributed rate limiter, worker fleet, external audit anchor, measured model router, or trace backend.
