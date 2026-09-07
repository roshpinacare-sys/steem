# ADR-0038: Durable replay ledger and revocable trust store

## Status
Accepted for sovereign development mode.

## Problem
A valid detached signature proves integrity and possession of a private key, but it does not prove that the bundle is fresh, has not already been consumed, or was signed by a key that remains trusted. Air-gap transfers can be replayed after restart unless consumption state is durable.

## Alternatives
1. Trust signatures alone. Lowest implementation cost, but old tasks and results remain replayable and revoked nodes remain accepted.
2. Put a nonce only in process memory. Rejects duplicates during one process lifetime but fails after restart and cannot support disconnected import stations.
3. Persist namespace-scoped bundle identifiers and payload hashes in an atomic local ledger, and require key purpose, tenant, workspace, validity, and revocation checks in a local trust store.

## Decision
Adopt option 3. Verification remains a pure cryptographic operation; acceptance is a separate state-changing operation that checks the trust store and consumes a durable replay identifier. Identifier reuse with a different payload is treated as a collision and fails closed.

## Failure behavior
Unknown, expired, not-yet-valid, revoked, wrong-purpose, cross-tenant, or cross-workspace keys are rejected. Previously consumed tasks or results are rejected after process restart. Corrupt replay-ledger files fail closed.

## Security impact
This closes replay and key-revocation gaps while preserving offline operation. The JSON ledger is intended for one local acceptance authority; multi-process use requires a transactional SQLite adapter before concurrent import stations are supported.

## Reversibility
The acceptance layer is additive. Pure signature verification remains available for inspection and dry runs.

## Acceptance evidence
- `src/lib/sovereignty/replay-ledger.ts`
- `src/lib/sovereignty/trust-store.ts`
- `src/lib/sovereignty/airgap-handoff.ts`
- `tests/sovereign-replay-trust.test.ts`
- `docs/canonical/evidence/v15/signed-airgap-handoff-evidence.json`
