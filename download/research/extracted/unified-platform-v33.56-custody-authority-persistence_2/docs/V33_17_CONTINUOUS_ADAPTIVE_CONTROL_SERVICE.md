# V33.17 — Continuous Adaptive Control Service

## Purpose

V33.17 converts the persistent adaptive policy controller into a locally durable control service. It does not add production authority. It adds a signed scheduler, a single active controller lease, monotonic fencing, idempotent schedule slots, signed cycle receipts, crash recovery, restart persistence and explicit full-workflow fallback.

## Proven local behavior

- Only one controller owner can hold the active lease.
- Every takeover increments a monotonic fence token.
- A stale controller cannot start or complete a cycle.
- Schedules are signed and bound to service, tenant, cadence, window and observation budget.
- A schedule slot can be claimed once.
- A completed cycle retry returns the same signed receipt.
- A crashed cycle can be resumed only after lease expiry and a signed recovery receipt.
- Drift revocation produces a signed cycle receipt whose fallback is `FULL_GOVERNED_WORKFLOW`.
- The signed file store detects tampering and rejects local clock rollback.
- All artifacts remain shadow-only and record zero external effects.

## Local accelerated soak

The release proof runs 90 durable schedule cycles with:

- one injected crash after cycle start;
- one fenced takeover;
- one service-store restart;
- repeated lease renewals;
- one controlled lease release/reacquisition;
- one toolchain drift and automatic revocation;
- signed receipts for every completed cycle.

This is accelerated local evidence, not a real-time daemon soak or distributed consensus qualification.

## Known limits

- Single host and signed file store.
- Local wall clock with rollback rejection, not an independent monotonic witness.
- No PostgreSQL lease authority, etcd/Consul, Raft or quorum.
- No external scheduler or continuously deployed daemon.
- No multi-process kill/restart campaign against a live service manager.
- Shortcuts remain shadow-only.
- No external effects and no production authority.

## Promotion ceiling

`research / local shadow qualification only`.
