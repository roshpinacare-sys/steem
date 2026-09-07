# Durable Vertical Slice Evidence

- Result: **verified**
- Injected crash observed: **true**
- Recovery worker completed the job: **true**
- External side effect executions: **1**
- Durable attempts: **2**
- Completed steps: validate_objective -> write_artifact -> inspect_artifact
- Backup cipher: aes-256-gcm
- Backup KDF: scrypt
- Restored job status: completed
- Evidence hash: `ce53954ab779c7f4476f3ce6313158759d4dc9d4ed8c809319cbe30eb09fa978`

## Verification Checks

- PASS — independent_verifier: Verifier identity must differ from builder identity.
- PASS — job_completed: Observed job status: completed.
- PASS — all_steps_checkpointed: Completed steps: validate_objective, write_artifact, inspect_artifact.
- PASS — exactly_once_side_effect: Observed side-effect count: 1.
- PASS — completed_receipt_present: At least one completed idempotency receipt must exist.
- PASS — no_active_lease_after_completion: No active lease remained.

## Honest Boundary

- This proves the portable durable core with a JSON file adapter, not yet the production SQLite runner adapter.
- A crash after receipt creation but before side-effect completion intentionally requires manual reconciliation.
- The proof uses a local temporary directory and no network or commercial API.
