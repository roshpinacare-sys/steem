# V33.31 Real External Human UX Pilot Runbook

## Preconditions

- Preregister the protocol, scenarios, metrics and kill criteria.
- Recruit at least five representative consenting humans; do not reuse synthetic fixtures.
- Assign trusted registrar, researcher, instrumentation, observer, verifier, exporter and importer identities.
- Enforce organization, host and key separation required by the V33.31 importer.
- Approve privacy notice, withdrawal, retention and deletion operations.
- Provide protected monotonic checkpoint storage outside exporter control.

## Ceremony

1. Registrar issues one signed high-entropy role challenge per subject and role.
2. Each subject signs the challenge to prove key possession.
3. Registrar validates the response and signs the enrollment.
4. Participant consent is signed before any task session.
5. Baseline and governed sessions use identical scenario pairing and signed instrumentation.
6. Participant attestation and independent observer assessment bind each session.
7. Observation JSON is canonicalized; the exact bytes are retained and hashed.
8. Importer issues a signed one-time export challenge.
9. Exporter builds and signs an exact inventory manifest.
10. Importer verifies bytes, signatures, role topology, withdrawals, thresholds and replay state.
11. Independent verifier signs the shadow-only qualification verdict.

## Abort conditions

Abort and preserve evidence when a nonce is reused, a challenge expires, a signature or fingerprint fails, a role is missing or overlaps improperly, an artifact is absent/extra/noncanonical, a participant withdraws, a checkpoint rolls back, or a threshold fails.

## Prohibited claims

Do not call a fixture, rehearsal, local identity, signed digest without bytes, or `HUMAN_OBSERVED_EXTERNAL` label a completed human pilot. Do not promote to production automatically.
