# v9 Durable Execution Vertical Slice

## Objective

Prove the hardest recovery property before migrating the production runner:

> A worker may crash after an external side effect succeeds but before the
> workflow checkpoint, and a replacement worker must complete the job without
> repeating that side effect.

## Implemented path

```text
Create durable job
-> claim time-bounded lease
-> execute pure preparation step
-> persist checkpoint revision 1
-> create deterministic side-effect receipt
-> perform external artifact write
-> persist completed receipt
-> inject process-style crash before checkpoint
-> allow lease to expire
-> claim with replacement worker
-> replay completed receipt without repeating the write
-> persist remaining checkpoints
-> complete job
-> export encrypted snapshot
-> restore into clean store
-> independently verify evidence
```

## Runtime components

- `src/lib/durable/types.ts`
- `src/lib/durable/canonical-json.ts`
- `src/lib/durable/memory-store.ts`
- `src/lib/durable/json-file-store.ts`
- `src/lib/durable/engine.ts`
- `src/lib/durable/worker.ts`
- `src/lib/durable/backup.ts`
- `src/lib/durable/verification.ts`

## Executable proof

```bash
npm run test:durable
npm run durable:prove
```

The proof requires no network, API key, database native binding, PowerShell, or
endpoint-protection exception.

## Observed evidence

- Five durable test suites passed.
- Twelve durable tests passed.
- The injected crash was observed.
- Recovery used a different worker identity.
- The side-effect counter remained exactly one.
- Three workflow steps were checkpointed.
- A completed operation receipt was retained.
- AES-256-GCM encrypted backup round-tripped successfully.
- Restored job state and checkpoint revision matched.
- Self-verification is rejected by test.

Machine-readable evidence:

- `docs/canonical/evidence/durable-vertical-slice.json`
- `docs/canonical/evidence/durable-vertical-slice.md`

## Failure semantics

| Crash point | Automatic behavior | Reason |
|---|---|---|
| Before side-effect receipt | Retry from last checkpoint | No effect began |
| After receipt started, before known completion | `needs_reconciliation` | Outcome is ambiguous |
| After receipt completed, before checkpoint | Replay receipt, do not repeat effect | Completion evidence exists |
| After checkpoint | Continue from next step | Revisioned state is durable |
| During backup decryption or integrity check | Reject restore | Fail closed on corruption or wrong key |

## Security and sovereignty properties

- The adapter writes an atomic temporary file and renames it into place.
- Store files are created with owner-only mode where supported.
- Backup keys are derived with scrypt.
- Backup payloads are encrypted with authenticated AES-256-GCM.
- Plaintext integrity is verified with SHA-256 after decryption.
- The proof uses no remote service.
- Unknown effects are never retried automatically.

## Honest boundary

This is an implemented portable vertical slice with a distinct verifier identity check. It is
not yet the production application execution path.

Still required:

1. SQLite durable-store adapter and migration.
2. Transactional outbox binding receipts, events, audit, and state.
3. Serialized approval continuation.
4. Production worker ownership and timer model.
5. Multi-process file or database locking.
6. Full application backup including users, agents, policies, runs, artifacts,
   provider configuration, and key-custody procedure.
7. Native database integration and clean-machine application restore drill.

These remain explicit tasks; they are not represented as completed work.
