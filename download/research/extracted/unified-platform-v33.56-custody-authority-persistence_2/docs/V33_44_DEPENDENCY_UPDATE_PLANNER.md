# V33.44 Dependency Update Planner

V33.44 adds a fail-closed local dependency-update planning protocol above the V33.43 capsule lifecycle.

## Bound chain

1. Signed update policy.
2. Signed candidate catalog and deterministic policy selection.
3. Exact dependency graph impact and compatibility plan.
4. Empty-cache offline-install, build and test rehearsal.
5. Independent SECURITY, RELEASE and OPERATIONS approvals.
6. Signed canary plan and three independent monitor reports.
7. Automatic rollback when error or regression thresholds are exceeded.
8. A retention ledger preserving active, rollback-ready and quarantined generations.

## Truth boundary

The candidate versions and canary traffic in the reference proof are deterministic local fixtures. No external package version was fetched, no real user traffic was observed, no external vulnerability intelligence was imported and no production promotion occurred.
