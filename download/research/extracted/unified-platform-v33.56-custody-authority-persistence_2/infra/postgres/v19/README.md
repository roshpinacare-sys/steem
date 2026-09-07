# PostgreSQL Runtime Qualification Target v19

Status: **implemented but not exercised against a PostgreSQL server**.

The migration and `PostgresRuntimeStore` define the intended database semantics:

- serializable transactions;
- tenant context through `set_config('app.tenant_id', ...)`;
- row-level security policies;
- revision compare-and-set;
- worker leases and fencing tokens;
- transactional outbox;
- `FOR UPDATE SKIP LOCKED` for queue consumers;
- idempotent effect receipts;
- append-only event, evidence and revocation tables;
- approval, idempotency and recovery-checkpoint tables.

## Required next-environment tests

1. Apply migration as a non-superuser owner and verify RLS under separate tenant roles.
2. Run 8, 32 and 128 worker contention tests.
3. Inject serialization failures and verify bounded retries.
4. Crash after external effect but before outbox acknowledgement.
5. Restart PostgreSQL during approval wait and outbox backlog.
6. Exercise deadlocks, connection loss, clock skew and lease expiry.
7. Run backup/restore and point-in-time recovery.
8. Apply forward and rollback migrations with queued missions.
9. Compare against a Temporal event-history implementation under the same workload.

## Deployment input

No floating or unpinned container image is provided. A future runner must supply an explicitly approved immutable image digest or a controlled package installation.
