# ADR-0024 — Step-Durable Fencing and Approval Compare-and-Set

Status: Accepted for the portable and simulation/dry-run execution path; production cutover remains gated.

## Problem

Identity-only leases and status-only approvals are insufficient under restart or multiple processes. A stale worker may reuse an identity after lease takeover, and two approval resolvers may both observe `pending` before either commits.

## Constraints

- Preserve the legacy runner as rollback.
- Add no new native dependency.
- Keep migration forward-compatible with SQLite.
- Fail closed on ambiguous ownership or stale revisions.

## Alternatives

1. **Process-local mutexes.** Low implementation cost, but no protection across restarts or processes.
2. **Database status checks without revisions.** Better persistence, but read-then-write races remain.
3. **Monotonic fencing tokens and compare-and-set revisions.** Slightly more schema and call-site complexity, but authority becomes explicit and stale commits are rejected.

## Decision

Use monotonically increasing lease fencing tokens for every lease-bound durable mutation. Add an approval revision and update terminal approval state only when identifier, prior status, and prior revision match. Represent agent-plan progress through idempotent durable step slots.

## Quantitative and experimental evidence

- Twenty concurrent in-memory lease claimants produced one winner.
- A reused worker identity with token 1 was rejected after token 2 acquired the lease.
- An injected crash after a completed idempotent step resumed without re-executing that step.
- Three hundred generated DAGs passed and their injected cycles failed.

## Security and operational impact

Stale workers and stale human actions fail closed. Recovery claims remain limited to the tested step workflow and simulation/dry-run runner integration until native multi-process SQLite tests pass.

## Rollback

Keep legacy and shadow runner modes. The new columns are additive and may remain unused if the v12 execution path is disabled.

## Revisit conditions

Revisit when moving to a multi-node store, when approval continuation serializes full model conversation state, or when a database with native compare-and-swap primitives replaces SQLite.
