# v33 External Qualification Runbook

## Preparation

- Freeze and hash the v32 proof archive.
- Provision isolated PostgreSQL primary/standby hosts.
- Provision authorized HSM/KMS keys with audit logging.
- Select at least two independently governed custodians.
- Select a transparency or monotonic witness service.
- Define failure-injection authority and rollback limits.

## Credential qualification scenarios

- Root creation and custodian pinning.
- Grant issuance, narrowing and attempted scope expansion.
- Credential rotation with old-credential revocation.
- Grant revocation and attempted backdated issuance.
- Issuer-key effective-time revocation.
- Multi-host propagation delay and partition recovery.
- Offline trust export/import.
- Bundle rollback, anchor rollback and joint rollback.
- Transparency-log equivocation or stale checkpoint.

## Runtime qualification scenarios

- PostgreSQL primary failure before and after commit.
- Outbox claim expiry, fencing, replay and duplicate delivery.
- Tenant-bound RLS under failover.
- PITR to a selected point followed by evidence reconciliation.
- Backup deletion, tamper and independent restore.

## Evidence required

Every scenario must record command, environment digest, input/output artifact digests, timestamps, exit status, independent reviewer, limitations and rollback result. Environment-blocked results are not passes.

## Promotion rule

Only an independent review board may recommend promotion, and only after all critical controls pass without weakening v32 gates. Production authority remains separate from technical test success.
