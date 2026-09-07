# v24 External Qualification Runbook

## Boundary

Local v24 evidence authorizes continued Integrated Pilot work only. Production promotion remains blocked.

## PostgreSQL primary/standby

Provide disposable PostgreSQL 16 endpoints through `V24_POSTGRES_URL` and `V24_POSTGRES_SECONDARY_URL`. Exercise migration, FORCE RLS, tenant-scoped foreign keys, outbox idempotency, claim expiry/reclaim, connection-pool tenant reset, failover during commit, PITR and measured RTO/RPO. A single-database pass is not failover qualification.

## KMS/HSM

Provide an authorized key URI through `V24_KMS_KEY_URI`. The private key must never enter the application process. Verify provider, key ID, algorithm, request digest, nonce, timestamp, policy, rotation, revocation, audit evidence and denied unauthorized signing.

## Untrusted-code isolation

Use a dedicated modern kernel or microVM/container boundary with cgroup v2 and independent review. Attempt filesystem, network, process, ptrace, namespace, syscall, resource and side-channel escapes. The current Linux/WASM result is a single-host research proof only.

## Human pilot

Follow `docs/V24_HUMAN_PILOT_RUNBOOK.md`. No usability or time-saving claim is allowed before consented observations satisfy the minimum sample and stop conditions.

## Exit evidence

Production consideration requires all of: primary/standby and PITR evidence, authorized KMS/HSM evidence, independent isolation and penetration verdicts, licensing resolution, consented pilot evidence, measured multi-host SLOs, disaster-recovery rehearsal and governance authority.
