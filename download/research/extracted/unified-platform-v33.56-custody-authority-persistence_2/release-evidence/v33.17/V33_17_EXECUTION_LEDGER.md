# V33.17 Execution Ledger

## Scope

V33.17 adds a continuous adaptive control service above the V33.16 persistent adaptive policy controller. It remains local, shadow-only and effect-free.

## Implemented

- Signed adaptive-control schedule.
- Durable signed service store.
- One active controller lease per service and tenant.
- Monotonic fencing across takeover and restart.
- Idempotent schedule-slot and cycle handling.
- Signed cycle and crash-recovery receipts.
- Clock rollback and store tamper rejection.
- Drift-triggered shortcut revocation and full-workflow fallback.
- 90-cycle accelerated local soak.
- Resumable one-process-per-test-file authoritative regression runner.

## Adversarial findings fixed

1. A shared Node test process could be contaminated by a file that retained a lifecycle handle. The authoritative full regression now isolates every test file in a separate Node process.
2. Tool execution limits could terminate the aggregate runner after partial progress. Per-file signed exit artifacts are retained and the runner resumes only previously successful, unchanged files.
3. Stale controllers, duplicate schedule slots, clock rollback, disk tampering, untrusted schedules and recovery without a signed receipt are rejected.

## Evidence

- 90/90 local accelerated control cycles.
- 90/90 signed cycle receipts verified.
- One injected crash and one signed recovery.
- One stale-fence rejection and one second-controller rejection.
- Three monotonic fence transitions.
- One restart, eight renewals and one drift revocation.
- 202 test files, 1,455/1,455 tests, exit 0.
- 17 V33 test files, 288/288 tests.
- 204 source modules, 202 test files, zero truth-map findings.
- 129/129 capability paths, zero source cycles and zero untested source modules.

## Truth boundary

This is a single-host, signed-file-store, accelerated local shadow qualification. It is not a real-time deployed daemon, distributed lease authority, external monotonic witness, multi-host soak, customer proof or production authorization.
