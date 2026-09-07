# V33.21 PostgreSQL Durable Authority External Operator Runbook

## Status

This kit is **not** evidence that PostgreSQL has been qualified. Local contract tests only prove the adapter, migrations, evidence schema, and fail-closed verifier. External qualification requires two independent operators on two independent hosts and two distinct PostgreSQL database-system identifiers.

## Preconditions

- PostgreSQL 15 or newer.
- TLS with hostname verification (`PGSSLMODE=verify-full`).
- `pgcrypto` may be installed by the migration role.
- Separate migration, runtime, delivery, witness, and read-only verifier roles.
- Credentials delivered out-of-band. Do not place passwords, private keys, connection strings, or `.pgpass` files in this repository.
- A separate witness database or independently administered witness service for the rollback-rejection control. The same database schema is only a contract reference and does not satisfy external independence.

## Procedure

1. Copy `operator.env.example` outside the repository and replace placeholders.
2. Confirm `PGPASSWORD` is unset.
3. Run `scripts/apply-migrations.sh` using a migration role.
4. Grant the runtime role only schema usage, function execute, and the specific table privileges required by the operating model. Do not grant ownership or migration rights.
5. Run two independent controller processes against the same lease key and capture the single-winner decisions.
6. Restart the active authority process, wait for expiry, acquire with the second controller, and prove the fence token increased.
7. Restore an older authority backup while retaining the independently administered witness state and prove startup or promotion is rejected.
8. Run `scripts/collect-facts.sh` and capture its output.
9. Have an operator from a different organization repeat the entire procedure on a different host and PostgreSQL system identifier.
10. Sign each observation with the operator key named in the qualification trust registry. Submit both signed observations to the independent verifier.

## Required controls

TLS, SERIALIZABLE transactions, transaction-scoped advisory locking, row locking with `FOR UPDATE`, atomic decision and outbox insertion, single-winner race, restart-safe monotonic fencing, separate-witness rollback rejection, least-privilege roles, and no embedded secrets.

## Explicit boundary

A passing verdict permits only an **external pilot**. It creates no production authority, performs no production effect, and does not qualify HA, PITR, KMS/HSM, cross-region failover, or a penetration test.
