# ADR-0045 — Physical Pilot Evidence Cannot Be Simulated

## Status
Accepted

## Context
TITAI has strong deterministic and same-host evidence, but those proofs cannot establish a real model, unrestricted browser, hardware custody, physical energy measurement, two machines, or an external verifier.

## Decision
Every physical pilot gate declares allowed execution kinds. A passed record using simulation, static analysis, an estimate, one machine fingerprint, or the builder machine as verifier is rejected. Unknown or blocked evidence remains release-blocking.

## Consequences
Repository tests can validate evidence semantics but cannot promote the release. Signed collectors are provided for external machines, and the final verifier binds accepted evidence to the final ZIP hash.
