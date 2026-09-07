# ADR-0020: Portable Durable Execution Core Before Runner Migration

- **Status:** accepted for the portable core; production runner migration pending
- **Date:** 2026-07-10
- **Decision owners:** Systems Architect, Resilience Engineer, Security Red Team, Operator
- **Related:** ADR-0002, DUR-001, DUR-002, DUR-003, F-002, F-006

## Problem

The current application runner is detached inside one Node process. A restart loses
its continuation, parked approval promise, and in-memory cancellation state. A
crash after an external side effect but before the corresponding checkpoint can
cause duplicate work or leave evidence that disagrees with reality.

The project needs a durable contract before changing the production runner. The
contract must be testable on a security-sensitive workstation without disabling
endpoint protection, compiling native modules, or requiring a cloud workflow
service.

## Constraints

- No mandatory commercial service or API key.
- No PowerShell, unsigned executable, or new native binary in the proof path.
- Backend must remain replaceable.
- Unknown side-effect outcomes must fail closed rather than be retried blindly.
- Builder and verifier identities must be distinct.
- Backup must be encrypted, integrity checked, versioned, and restorable.
- The existing runner remains authoritative until a database migration and
  compatibility suite pass.

## Alternatives

### A. Keep the in-process detached runner

- Lowest implementation cost.
- Fastest normal-path latency.
- Cannot resume safely after process loss.
- Does not solve duplicate side effects or persisted approvals.

### B. Adopt an external workflow engine immediately

Examples include a self-hosted durable workflow service or hosted orchestration
platform.

- Strong scheduling, timer, retry, and multi-worker facilities.
- Adds operational infrastructure, protocol coupling, migration cost, and a new
  failure domain before Titai's internal contract is stable.
- May weaken the zero-key, single-machine development profile.

### C. Build a repository-owned portable contract with adapters

- Define leases, checkpoints, attempts, receipts, reconciliation, backup, and
  verification in pure TypeScript.
- Prove behavior with an atomic JSON-file adapter.
- Add a production SQLite adapter only after the contract and failure semantics
  are accepted.
- Permit future adapters for a workflow engine without changing workflow code.

## Quantitative comparison

Scores are 1 (weak) to 5 (strong). Weight is based on the current product phase.

| Criterion | Weight | A: in-process | B: external engine | C: portable core |
|---|---:|---:|---:|---:|
| Crash recovery | 5 | 1 | 5 | 4 |
| Exactly-once effect evidence | 5 | 1 | 4 | 4 |
| Local sovereignty | 5 | 5 | 2 | 5 |
| Workstation safety | 4 | 5 | 2 | 5 |
| Operational simplicity | 4 | 5 | 1 | 4 |
| Backend replaceability | 4 | 1 | 2 | 5 |
| Immediate implementation cost | 3 | 5 | 1 | 3 |
| Production scale ceiling | 2 | 1 | 5 | 3 |
| **Weighted total / 160** |  | **96** | **93** | **139** |

The scores are decision aids, not production measurements. The decisive
observation is that option C proves the semantics without committing the product
to a workflow vendor or weakening the constrained-workstation profile.

## Decision

Adopt option C.

The portable core is authoritative for durable workflow semantics:

- A job is claimed through a time-bounded lease.
- Every successful step advances a revisioned checkpoint.
- Every side effect receives a deterministic operation key and persisted receipt.
- A completed receipt is replayed as evidence without repeating the effect.
- A receipt left in `started` or `unknown` state moves the job to
  `needs_reconciliation`; automatic replay is prohibited.
- Lease expiry permits a different worker to resume from the last checkpoint.
- Worker passes are bounded and explicit.
- Encrypted backup uses AES-256-GCM with scrypt-derived keys and SHA-256
  plaintext integrity evidence.
- Independent verification rejects self-verification.

## Proven failure scenario

The proof workflow intentionally crashes after an external artifact write and
completed effect receipt but before the workflow checkpoint. A second worker
claims the expired lease, observes the completed receipt, avoids a second write,
checkpoints the step, finishes the workflow, exports an encrypted backup, restores
it into a clean store, and passes the distinct-verifier contract check.

Observed result:

- Crash observed: yes.
- Worker attempts: 2.
- External side-effect executions: 1.
- Completed receipt: present.
- Restored terminal state: completed.
- Independent verifier: different from builder.

## Consequences

### Positive

- Durable semantics can be tested without SQLite native bindings.
- Side-effect ambiguity has an explicit fail-closed state.
- The contract can back a JSON file, SQLite, or an external engine.
- Recovery and backup evidence are reproducible.

### Negative

- The JSON adapter is single-host proof infrastructure, not a distributed lock.
- The application runner has not yet migrated to this engine.
- Pending human approval continuation is not yet serialized.
- Database transactions and event outbox integration remain open.

## Migration gate

The production runner may migrate only when DUR-002 demonstrates:

1. Schema migration and rollback.
2. SQLite lease compare-and-set behavior.
3. Transactional receipt, event, and audit persistence.
4. Compatibility with existing run APIs and UI.
5. Native integration tests in a suitable environment.
6. Crash tests at every checkpoint boundary.

## Rollback

The portable core is additive. Removing `src/lib/durable/`, its scripts, tests,
and evidence returns the repository to the v8 runner without a database change.
