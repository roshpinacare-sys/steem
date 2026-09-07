# v32.11 Release Lineage and Execution Freshness Assurance

## Problem falsified

v32.10 correctly bound reports to one source, compiled artifact, test manifest, package lock and environment identity. It did not require every report to prove membership in the same current validation attempt. A prior PASS report with unchanged identity could therefore be mistaken for current evidence, especially after an interrupted validation left archived PASS files visible.

## Implemented controls

- A fresh run directory is deleted and recreated before authoritative validation.
- An atomic ledger records each command, sequence, start and finish time, timeout state, exit code and produced artifact hash and size.
- Finalization requires the exact run ID, source digest, required step set and order.
- Timed-out, aborted, failed, nonzero or missing-artifact steps fail closed.
- Every artifact must remain under the exact run directory and reject absolute paths, traversal and backslashes.
- Artifact bytes and SHA-256 must match the ledger; modification time must fall within the producing step window, subject only to bounded clock skew.
- Unledgered observations are rejected.
- Governance status, evidence paths and qualification target are bound to v32.11.
- A dedicated mutation campaign attacks the run ID, status, order, result, path, digest, freshness and unledgered-artifact controls.

## Truth boundary

This is trusted local-runner evidence. It prevents accidental stale-PASS reuse and strengthens reproducibility, but it is not an external transparency log, independent witness, HSM/KMS custody, PostgreSQL HA/PITR qualification, penetration test, human pilot or multi-host qualification. Production promotion remains blocked.

## Bounded resume

Long validation can be split without reusing unverified output. Set `V32_11_MAX_STEPS` to bound one invocation. A later invocation with the same `V32_6_RUN_ID` and `V32_11_RESUME=1` verifies the source digest, every completed step and every recorded artifact hash/size before continuing. Failed steps cannot be resumed as PASS; source drift requires a fresh run.
## Source identity completeness

The source identity manifest discovers every root `CLAUDE_HANDOFF_v*.md` file rather than stopping at a hard-coded prior version. The current handoff, master prompt, and license are bound into the source digest. Regression tests prove that modifying the current handoff changes the digest, and the mutation campaign removes the discovery rule to prove the tests fail closed.

