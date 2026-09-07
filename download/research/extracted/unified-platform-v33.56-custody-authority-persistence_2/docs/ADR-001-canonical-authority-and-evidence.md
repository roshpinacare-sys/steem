# ADR-001: One canonical authority and evidence contract

**Status:** Accepted for internal proof v0.1 only

The kernel owns the final authorization decision. TITAI and TFA are adapter sources, not competing policy authorities.

- TITAI contributes principal, role, resource, tenant and workspace context.
- TFA contributes signed capability and action-passport attestations.
- Evidence classes remain explicit: simulated, computed, measured, observed and attested.
- An attestation proves signer and integrity, not underlying truth.
- Production promotion is forbidden in this proof.
