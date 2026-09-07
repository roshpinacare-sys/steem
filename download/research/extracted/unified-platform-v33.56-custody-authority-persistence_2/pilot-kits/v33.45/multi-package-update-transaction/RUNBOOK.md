# V33.45 Multi-Package Update Transaction Runbook

1. Pin the V33.44 base proof and verify it independently.
2. Define an atomic package set and exact provenance/artifact digests.
3. Resolve every dependency conflict; unresolved conflict count must be zero.
4. Run empty-cache `npm ci --offline`, build, tests, partial/full rollback scenarios and interrupted-update recovery.
5. Obtain independent SECURITY, RELEASE and OPERATIONS approvals.
6. Execute three bounded canary stages with a protected holdback and three independent monitors.
7. Issue a local-only promotion eligibility certificate only when all thresholds pass.
8. Rehearse partial rollback for an isolated reversible package and full rollback for coupled or uncertain state.
9. Verify durable recovery to the base manifest with no fork or partial state.
10. Preserve at least four generations. Do not grant production authority.
