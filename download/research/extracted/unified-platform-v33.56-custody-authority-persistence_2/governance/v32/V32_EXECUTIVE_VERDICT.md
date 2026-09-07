# v32 Executive Verdict

## Verdict

**Provisionally accept continued Integrated Pilot work. Reject Production promotion.**

v32 materially improves the credibility of the credential and trust model by replacing implicit key-based authority with explicit root-issued grants, credential rotation, targeted revocation, portable offline trust state, distinct-custodian thresholds, crash-safe publication and time-effective key revocation.

## Material advances

- A registered public key no longer implies credential issuance authority.
- Reviewer and provider credentials are bound to an exact issuer grant, tenant, scope, validity interval and sovereign acceptance time.
- Multiple credentials per identity support rotation without collapsing identity-level trust.
- Revoking an old credential does not disable a valid rotated credential.
- Threshold policy requires distinct pinned custodians rather than multiple keys controlled by one custodian.
- Trust state can be exported and independently imported with public keys, grants, credentials, revocations and acceptance receipts.
- A predecessor chain, independent local anchor and pending journal exercise fork detection, single-store rollback detection and interrupted publication recovery.
- Effective-time key revocation preserves valid historical verification while blocking later trust and backdated submissions.

## Falsified or downgraded claims

- Registered key equals credential authority: **Rejected**.
- Two key IDs equal two independent authorities: **Rejected**.
- Predecessor chain alone provides offline anti-rollback: **Downgraded**.
- Local file anchor protects joint rollback of bundle and anchor storage: **Rejected**.
- Threshold signatures establish truth or legal independence: **Rejected**.

## Evidence state

- 584/584 tests passed.
- 16/16 targeted credential-sovereignty mutations were authentically killed.
- 14/14 integration edges and 14/14 capability paths are closed.
- Zero source cycles and zero untested source modules.
- Three consecutive full-suite runs passed with no observed flake.
- Coverage remains above release floors.

## Remaining blockers

Production remains blocked until external qualification establishes:

- HSM/KMS-backed roots and effective-time revocation;
- independently governed custodians and a transparency/monotonic witness;
- distributed credential and revocation propagation bounds;
- PostgreSQL primary/standby, failover and PITR;
- independently assessed isolation and penetration resistance;
- licensing resolution;
- measured human and commercial value;
- multi-host SLO and disaster-recovery evidence.

The first product remains **Governed Engineering and Change Assurance**. The universal kernel should remain minimal.
