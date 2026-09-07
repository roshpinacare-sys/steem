# Independent Review Verdict — v32

## Decision

**Accept the local credential-sovereignty implementation for continued Integrated Pilot work. Reject any claim of production, distributed sovereignty, legal independence or truth certification.**

## What survived adversarial review

- Credential issuance requires an explicit pinned-root grant.
- Grant scope, tenant, credential kind, validity and digest are enforced.
- Rotation and targeted revocation work without disabling the replacement credential.
- Backdating after grant or issuer-key revocation is rejected using sovereign acceptance time.
- Historical signatures valid before an effective revocation remain verifiable at their historical time.
- Threshold approval counts distinct pinned custodians rather than keys alone.
- Offline export/import preserves trust material and acceptance receipts.
- Single-store rollback is detected by an independent local anchor.
- Interrupted bundle publication is recovered through a pending journal.
- Sixteen targeted mutations demonstrate that the new controls are behaviorally observed by tests.

## What did not survive review

- Key registration as authority.
- Key-count thresholds as proof of independent control.
- Predecessor-only anti-rollback.
- Joint-storage rollback protection from a local file anchor.
- Signatures as proof of correctness, truth or legal organizational independence.

## Qualification limits

The review used local test keys, local files and a single host. It did not exercise a real HSM/KMS, independent custodians, a transparency log, Byzantine or distributed failure, a live advanced-model provider, a human pilot, external penetration testing or production infrastructure.

## Required next gate

v33 may proceed only as external qualification. Local proof gates must remain mandatory and may not be weakened to accommodate an external service.
