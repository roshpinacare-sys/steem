# V33.44 Update Planner Runbook

1. Import a signed candidate inventory and the active V33.43 lifecycle verdict.
2. Apply the signed policy without manual candidate override.
3. Produce graph-impact evidence and an empty-cache offline rehearsal receipt.
4. Collect independent SECURITY, RELEASE and OPERATIONS approvals.
5. Run a bounded canary with three independent monitors.
6. Trigger automatic rollback when either policy threshold is exceeded.
7. Preserve at least three generations: active, rollback-ready and quarantined.
8. Do not promote to production from this runbook.
