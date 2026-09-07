# V33.31 External Human Pilot Evidence Import

## Objective

V33.31 prevents a local evidence label from being mistaken for proof that a UX pilot was independently executed with real external humans. It adds a signed, byte-bound and replay-protected import path while retaining a shadow-only production ceiling.

## Closed failure mode

V33.30 accepted structurally valid evidence carrying `HUMAN_OBSERVED_EXTERNAL`, but its local keys and unsigned role-binding array could not establish external provenance. V33.30 now always requires the V33.31 provenance path and cannot authoritatively pass G3 by label alone.

## Required chain

1. A trusted registrar issues a signed role challenge containing study, protocol, role, organization, host, key fingerprint, evidence class and nonce.
2. The subject proves possession of the enrolled private key by signing the challenge.
3. The registrar signs a bounded role enrollment.
4. The importer issues a one-package export challenge with exporter fingerprint, nonce, expiry and artifact limits.
5. The exporter signs a manifest binding every role proof, consent, withdrawal, evidence envelope and exact artifact record.
6. The importer verifies canonical artifact bytes, role and organization separation, thresholds, challenge freshness and monotonic replay state.
7. An independently enrolled verifier signs a qualification verdict. A valid result is still shadow-only and never self-promotes to production.

## Evidence classes

- `SYNTHETIC_REFERENCE`: exercises the contract and attack surface. It can never pass the human gate.
- `LIVE_EXTERNAL`: may qualify only after every provenance, artifact, separation, replay and UX threshold check succeeds.

## Local result

The included reference campaign has five synthetic identities, ten canonical observation artifacts and zero external human participants. It reaches the synthetic UX metrics but remains `HUMAN_UX_PILOT_REQUIRED`. Four proof attacks and 31 targeted tests demonstrate rejection of replay, unsigned role alteration, artifact tampering and synthetic relabeling.

## Authority boundary

All V33.31 artifacts declare `productionAuthority: NONE` and `externalEffectsExecuted: 0`. G3 remains in progress until a real independently governed pilot is executed and imported.
