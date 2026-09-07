# V33.21 — PostgreSQL Durable Authority Adapter and External Operator Kit

## Result

V33.21 adds a provider-neutral PostgreSQL adapter contract, a digest-linked migration chain, bounded serialization/deadlock retry, a transactional lease-command function, durable decision/outbox tables, a witness contract, least-privilege controls, and a signed external qualification challenge.

## Transaction design

Each command is expected to run inside `BEGIN ISOLATION LEVEL SERIALIZABLE`, with statement and lock timeouts set locally. The adapter obtains `pg_try_advisory_xact_lock(hashtextextended(lease_key, 0))`, invokes the parameterized command function, and commits the decision and outbox atomically. Row state is locked with `FOR UPDATE`. Command IDs are idempotent; a reused ID with a different digest is rejected. Only serialization failures (`40001`) and deadlocks (`40P01`) may be retried, with a fresh connection and a bounded attempt count.

## Migration chain

Three deterministic migrations create:

1. authority, lease, decision, outbox, schema-migration and witness tables;
2. the transactional command function with monotonic fencing;
3. indexes, integrity views and public-access revocation.

The chain is SHA-256 linked. Passwords, private keys and PostgreSQL connection strings are forbidden from migration content and the operator kit.

## Qualification boundary

The release host has no live `psql`/PostgreSQL connection, so the proof is classified:

`LOCAL_POSTGRESQL_CONTRACT_AND_EXTERNAL_OPERATOR_KIT`

Two synthetic observations with all controls marked true and artifact digests present are deliberately rejected. Every live control must carry a 64-hex digest binding it to supporting evidence. A pilot verdict requires two independent operator organizations, two hosts and two PostgreSQL system identifiers, TLS, SERIALIZABLE transactions, transaction-scoped advisory locking, `FOR UPDATE`, atomic decision/outbox insertion, a single-winner race, restart-safe fencing, independently administered witness rollback rejection, least privilege, and zero embedded secrets.

A passing external verdict permits only an external pilot. It grants no production authority and does not qualify HA, PITR, KMS/HSM, cross-region failover, red-team testing or production promotion.
