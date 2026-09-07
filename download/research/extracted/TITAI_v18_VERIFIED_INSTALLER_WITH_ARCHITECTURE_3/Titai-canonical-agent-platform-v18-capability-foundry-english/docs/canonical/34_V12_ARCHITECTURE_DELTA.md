# TITAI v12 Architecture Delta

## Release posture

**DEVELOPMENT ONLY.** v12 materially strengthens the execution and evidence model, but does not claim a live-provider production cutover.

## Verified starting architecture

The active platform is a Next.js/TypeScript application with SQLite/Drizzle persistence, API routes, agent and provider abstractions, policy-gated tools, human approvals, governed memory, event/audit streams, a portable durable core, and evidence-oriented operator surfaces.

## v12 structural changes

### Step-level durable execution

The durable subsystem now supports revisioned step workflows, explicit dependencies, attempts, leases, fencing tokens, checkpoints, receipts, reconciliation, and terminal finalization. A stale worker cannot commit after lease ownership changes, even when the same worker identity is reused.

### Active runner cutover boundary

The active runner can create and recover step-level durable workflows for simulation and dry-run operation. Live-provider execution remains guarded because provider conversation continuation and arbitrary external side-effect reconciliation are not yet serializable end to end.

### Approval concurrency

Approval resolution now uses a persisted revision and compare-and-set update. A stale client receives an explicit conflict instead of silently overwriting another decision.

### Identity and verification

A centralized authorization primitive protects user-owned resources. Verification attestations bind requirement and task revisions, source and artifact hashes, builder and verifier identities, limitations, and release candidate identity. The implementation prevents obvious self-verification but does not yet provide a separately operated external verifier.

### Model and memory controls

Routing includes health state and verification quality. Governed memory normalizes hostile text, detects instruction-like content, applies ownership/sensitivity/expiry/authority constraints, resolves contradictions, and produces provenance labels. Memory is evidence and cannot grant authority.

### Tool authority

The capability broker combines authenticated identity, resource scope, tool contract, policy decision, approval state, side-effect class, timeout, output ceiling, and idempotency requirements. Task risk determines autonomy; model confidence alone does not.

### Operator truth surfaces

The selected interface thesis is an Evidence Control Plane combined with Recovery-First Operations and a visible Human-Authority boundary. Run completion, verification, and pilot promotion are represented as separate claims.

## Remaining architecture blockers

- Live-provider step continuation is not restart-safe.
- Approval rows survive restart, but model conversation continuation does not.
- Ownership exists; complete tenant/workspace semantics do not.
- SQLite multi-process race behavior is not verified in this environment.
- Tool execution is bounded but remains in-process rather than strongly sandboxed.
- Audit integrity is local and is not anchored to an independent trust domain.
