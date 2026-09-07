# Claude Handoff — V33.21

## Canonical status

V33.21 adds the PostgreSQL Durable Authority Adapter and External Operator Kit. The canonical kernel and authority model remain unchanged. PostgreSQL is an adapter target, not a second authority root.

## Implemented

- `src/app/postgres-durable-authority-v33_21.ts`
- `tests/postgres-durable-authority-v33_21.test.ts`
- digest-linked PostgreSQL migrations and secret-free operator kit
- bounded retry for SQLSTATE `40001` and `40P01` only
- signed external challenge, operator observation and independent verdict
- synthetic evidence rejection and duplicate organization/host/system deduplication
- proof, verifier, regression and release validation scripts

## Truth boundary

No live PostgreSQL connection was attempted in the release environment. PostgreSQL remains `UNAVAILABLE_FAIL_CLOSED`. The local proof validates SQL contracts, transaction ordering, migration integrity and the external evidence gate only. Production promotion remains blocked.
