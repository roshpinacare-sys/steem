# v26 External Qualification Runbook

## Inputs required

- Disposable PostgreSQL 16 primary and standby endpoints with failure-injection authority.
- Authorized KMS/HSM endpoint, key policy and named custody approvers.
- Target untrusted-code isolation technology and independent assessor.
- External penetration tester and legal/licensing reviewer.
- Consented representative pilot participants.

## Execution order

1. Verify v25 ZIP SHA-256 on an independent host and run `npm ci --ignore-scripts`.
2. Run `npm run validate:v25`; retain the clean validation evidence unchanged.
3. Execute PostgreSQL qualification, then failover/PITR rehearsal.
4. Bind KMS/HSM adapter and test rotation, revocation, outage and compromise.
5. Run isolation escape/resource assessment and external penetration testing.
6. Conduct the human pilot using the supplied protocol; record raw task outcomes without invented confidence scores.
7. Measure multi-host SLOs and DR; compare against declared thresholds.
8. Conduct independent review. Promotion requires every external gate to pass; local evidence cannot substitute.
