# ADR-0021: SQLite Transactional Hardening and Local Outbox

Status: Accepted for incremental implementation; native integration verification pending.

## Problem

The application used process-local execution while event sequence allocation, audit-chain append, run idempotency, and future durable work needed cross-process serialization. A wholesale runner rewrite would combine too many unverified changes.

## Decision

Keep the current runner compatible while introducing repository-owned SQLite primitives behind explicit contracts:

- `BEGIN IMMEDIATE` for user-scoped run-idempotency creation, event sequence allocation, and audit-chain append.
- Unique user/idempotency and outbox idempotency constraints.
- Durable job, receipt, lease, checkpoint, and outbox tables.
- A `SqliteDurableStore` implementing compare-and-set lease and checkpoint semantics.
- Atomic event/audit plus outbox insertion.
- A migration-only validator using Node's built-in SQLite runtime so SQL syntax can be checked without building `better-sqlite3`.

The current detached runner is not declared durable. Production cutover remains feature-gated until native migration, crash, approval-continuation, and rollback tests pass.

## Alternatives

1. Rewrite the complete runner immediately. Rejected because failure surface and rollback cost are too high.
2. Adopt a mandatory external workflow service. Rejected because it violates the local-first and no-required-key goals.
3. Keep process-local execution and document the risk. Rejected because it does not reduce data-integrity risk.

## Consequences

The repository now contains a migration path and durable persistence contract, but two execution paths temporarily coexist. Native SQLite integration and production worker cutover remain explicit incomplete work.
