# v33 Next Gate — External Credential Sovereignty Qualification

## Objective

Replace local assumptions with independently verifiable external evidence while preserving every v32 fail-closed control.

## Required workstreams

1. **HSM/KMS root custody** — root creation, signing, rotation, effective-time revocation and audit export.
2. **Independent custodians** — separately governed organizations or control domains, independently verified.
3. **Transparency or monotonic witness** — externally anchored bundle sequence and rollback detection.
4. **Distributed trust propagation** — measured credential/grant/revocation convergence across multiple hosts.
5. **PostgreSQL qualification** — primary/standby, RLS, outbox, failover, PITR and restore reconciliation.
6. **Security qualification** — external penetration, key-custody, isolation and supply-chain review.
7. **Human value pilot** — consented comparative workflow with at least five representative participants.

## Acceptance criteria

- A revoked grant or credential is rejected on every host within a measured bound.
- Joint rollback of local bundle and local anchor is detected by an external witness.
- Two custodians are independently governed, not merely represented by different keys.
- Historical evidence remains verifiable according to explicit effective-time policy.
- PostgreSQL failover and PITR preserve tenant isolation, outbox idempotency and evidence integrity.
- External model use remains proposal-only and causes zero external mutation.
- No production promotion without independent security and human-pilot evidence.

## Stop conditions

Stop or downgrade if any host accepts revoked authority, if rollback is undetected, if custodian independence is unsubstantiated, if a signature is represented as truth, or if external qualification requires weakening local tests.
