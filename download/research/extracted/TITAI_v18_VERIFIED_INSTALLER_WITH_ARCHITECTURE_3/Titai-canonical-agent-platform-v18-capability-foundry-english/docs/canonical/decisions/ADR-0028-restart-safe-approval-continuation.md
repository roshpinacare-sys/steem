# ADR-0028: Restart-Safe Approval Continuation

- Status: Accepted
- Date: 2026-07-11
- Owners: Durable Systems Engineer, Human Oversight Engineer

## Problem

The approval decision was persistent, but the execution loop waiting for that decision lived in process memory. A restart could preserve the approval row while losing the exact continuation behavior.

## Alternatives

1. Keep a process-local promise and mark interrupted runs for manual restart.
2. Serialize the complete model runtime and JavaScript call stack.
3. Persist a stable continuation key and durable checkpoint; after restart, re-enter the bounded step, match the same tool intent, and consume the terminal approval exactly once.

## Decision

Adopt alternative 3 for the Golden Pilot Workflow. The approval stores scope, continuation key, durable job, revision, expiry, and continuation checkpoint. A pending approval pauses and releases the durable job. Approval resolution requeues the job. Re-entry uses the same deterministic continuation key and never grants authority from prompt content.

## Invariants

- One approval revision can resolve once.
- Stale operator decisions fail with a conflict.
- Expiry and rejection prevent side effects.
- Approval state survives restart.
- Completed side effects remain protected by receipts.

## Limitations

Live remote-provider conversations are not serializable in the current pilot. The frozen pilot therefore permits simulation and dry-run/local artifact behavior only.

## Acceptance Evidence

- `src/lib/engine/runner.ts`
- `src/lib/durable/types.ts`
- `tests/durable-approval-restart.test.ts`
- `tests/pilot-run-gates.test.ts`
