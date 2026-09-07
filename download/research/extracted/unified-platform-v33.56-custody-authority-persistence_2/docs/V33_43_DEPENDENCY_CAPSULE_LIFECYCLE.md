# V33.43 Dependency Capsule Lifecycle

V33.43 extends the V33.42 hermetic dependency capsule with a fail-closed local lifecycle for provenance change, vulnerability response, revocation, rollback and replacement.

## Implemented controls

- Every exact tarball is bound to a signed, sequenced provenance statement.
- A signed vulnerability feed is monotonic and targets exact provenance statement digests.
- Revocation requires three independent local security votes and a separate revocation authority.
- A revoked candidate rolls back only to the independently verified V33.42 base manifest.
- Replacement provenance must come from a different organization and signer.
- The replacement capsule preserves the exact package set and local-only lockfile.
- A second empty-cache `npm ci --offline` installation proves the replacement remains reproducible.
- The independent verifier reconstructs the V33.42 base verdict before evaluating V33.43.

## Truth boundary

The vulnerability advisory and provenance authorities are local reference identities. No external vulnerability intelligence feed, public registry provenance, external human participant, external effect or production authority was observed. G3 and production promotion remain blocked.
