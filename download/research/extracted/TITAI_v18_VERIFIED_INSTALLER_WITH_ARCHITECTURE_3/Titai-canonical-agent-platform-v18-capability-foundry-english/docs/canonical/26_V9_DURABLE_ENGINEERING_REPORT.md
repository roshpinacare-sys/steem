# v9 Durable Engineering Report

## Verdict

The repository now contains a working, backend-replaceable durable execution
core and a reproducible crash-recovery proof. It is a meaningful implementation
step, not a claim that the current Next.js application runner has already become
durable.

The proof succeeded under the constrained-workstation profile without
PowerShell, endpoint-protection changes, a network service, an API key, or a
native database binding.

## Starting condition

The v8 runner launched work as a detached promise in one Node process. Its active
map, abort controller, approval continuation, and execution cursor were volatile.
On restart, current behavior marked active work interrupted. Tool effects had no
repository-owned durable receipt contract, and backup/restore existed only as a
requirement.

## Implemented architecture

### Durable job contract

A job persists:

- Workflow identity and immutable payload.
- Status and availability time.
- Attempt count and maximum attempts.
- Time-bounded lease owner, acquisition, heartbeat, and expiry.
- Revisioned checkpoint with next step, outputs, and completed step IDs.
- Result or structured error.

### Side-effect contract

A side-effect operation derives a deterministic key from:

```text
workflow + job + step + operation + canonical input hash
```

Receipt states are:

- `started`
- `completed`
- `failed`
- `unknown`

A completed receipt is replayed without re-executing the operation. A `started`
or `unknown` receipt is not retried; the job becomes `needs_reconciliation`.

### Worker contract

The worker:

- Inspects only due and non-terminal work.
- Uses a bounded maximum per pass.
- Dispatches only registered workflows.
- Cannot steal a live lease owned by another worker.
- Permits recovery after lease expiry.

### Backup contract

The portable snapshot is:

- Versioned.
- Encrypted with AES-256-GCM.
- Protected by authenticated encryption.
- Keyed through scrypt from an operator passphrase.
- Checked against a SHA-256 hash of canonical plaintext after decryption.
- Restorable into an empty store.

### Verification contract

The proof verifier checks:

- Builder and verifier identities differ.
- The job reached `completed`.
- All expected steps are checkpointed.
- The side effect occurred exactly once.
- A completed receipt exists.
- No lease remains on the terminal job.

## Fault-injection result

Injected point:

```text
after external side effect
and after completed receipt
but before workflow checkpoint
```

Observed behavior:

| Measure | Result |
|---|---:|
| Injected crash observed | Yes |
| Worker identities | 2 |
| Job attempts | 2 |
| External side-effect executions | 1 |
| Completed steps | 3/3 |
| Completed receipts | 1 |
| Restored job status | completed |
| Independent verification | verified |

Evidence hash:

`eb3afc33e0029e7c06bcc611155c08ac91e67a6522320aa06e64fb68b358e941`

## Test results

### Safe deterministic suite

- 18 test files passed.
- 69 tests passed.
- Durable subset: 5 files and 12 tests passed.
- Baseline evaluation: 8/8 passed.
- TypeScript typecheck passed.
- Canonical validation passed.
- English-only validation passed.
- Source lint passed.
- Release audit passed before packaging.
- Roast registry validation passed.

### Full suite

The same 18 non-native test files and 69 tests passed. Three database suites
could not begin because `better-sqlite3` was intentionally installed without its
native post-install binary:

- `approval-expiry.test.ts`
- `audit.test.ts`
- `runner.integration.test.ts`

This is recorded as an environment block, not a code pass or a logical failure.

### Production build

Next.js entered optimized production compilation and produced approximately
200 MB of intermediate `.next` output, but did not finish within the execution
limit. The output is excluded from the release archive. Production build and E2E
remain unverified.

## Security analysis

Positive properties:

- No blind retry of ambiguous side effects.
- No commercial or remote dependency in the proof path.
- Authenticated encryption for backup.
- Restore rejects wrong passphrases and ciphertext tampering.
- Atomic temporary-file replacement for the JSON adapter.
- Owner-only file mode requested where supported.
- Self-verification rejected.

Remaining risks:

- JSON-file storage has no cross-process lock and is not a distributed store.
- The proof passphrase is a local test fixture, not a key-custody design.
- Application secrets and complete SQLite state are not yet in the backup scope.
- The current runner does not yet use the receipts.
- No transactional outbox binds job state, event append, audit append, and effect
  receipt in one database transaction.

## Canonical changes

- DUR-001 moved from blocked to implemented.
- DUR-002 remains blocked on the production persistence migration and native
  integration suite.
- DUR-003 remains blocked on serialized continuations and durable timers.
- F-002 moved from open to partially mitigated.
- F-006 moved from open to partially mitigated.
- ADR-0020 records the selected portable-core strategy.

## Next implementation gate

The next task is DUR-002:

```text
portable durable contract
-> SQLite schema and migration
-> compare-and-set lease
-> transactional side-effect receipt
-> event/audit outbox
-> existing runner compatibility adapter
-> native integration tests
-> feature-flagged migration
```

The current detached runner must remain available as a rollback path until this
gate passes.
