# ADR-0018: Enforced Runtime Lifecycle Guards

- Status: Accepted for implementation evidence; independent verification pending
- Date: 2026-07-10
- Owners: Systems Architect, Builder
- Review role: Independent Verifier

## Problem

Run, step, and approval states were stored as text and updated directly in the runner. The type system restricted known labels but did not prevent an illegal transition such as `queued -> completed`, reopening a completed step, or changing an already resolved approval.

## Constraints

- The guard must be usable without the database or a provider key.
- It must be deterministic and unit-testable.
- It must not require a schema migration.
- Existing valid runtime paths must remain valid.

## Alternatives

1. **Documentation only.** Lowest cost, but no runtime enforcement.
2. **Database triggers.** Strong persistence boundary, but SQLite-specific and harder to reuse in simulation, recovery tools, and future storage adapters.
3. **Pure transition machine plus guarded persistence helpers.** Reusable, testable, storage-neutral, and incrementally enforceable.

## Decision

Adopt a pure transition machine in `src/lib/canonical/lifecycle.ts` and route runtime status changes in the runner through guarded helper functions. Keep database constraints as a future defense-in-depth task rather than the only control.

## Consequences

- Illegal transitions fail explicitly before persistence.
- Terminal states cannot be reopened by normal runtime code.
- The same rules can be reused by evaluators, recovery tooling, and alternate storage adapters.
- A future resumable execution model must introduce explicit resume states or a new ADR rather than bypassing the guard.

## Revisit when

- Durable workers introduce leased or retrying states.
- Interrupted runs become resumable.
- Multiple writers can update the same run concurrently.
