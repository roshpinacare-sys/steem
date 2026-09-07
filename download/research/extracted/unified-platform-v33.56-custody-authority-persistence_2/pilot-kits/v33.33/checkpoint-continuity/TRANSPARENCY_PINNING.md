# Transparency Pinning Requirements

- Publish each accepted log head to storage outside the platform owner's administrative domain.
- Require at least two independent monitor signatures for the same log size and head.
- Preserve the previous pin artifact and make it retrievable by digest.
- Verify that the previous pinned head appears at its declared index in every successor log.
- Gossip pins between monitors; quarantine any same-size conflicting head or incompatible prefix.
- A locally signed pin is protocol evidence only, not proof of external anchoring.
