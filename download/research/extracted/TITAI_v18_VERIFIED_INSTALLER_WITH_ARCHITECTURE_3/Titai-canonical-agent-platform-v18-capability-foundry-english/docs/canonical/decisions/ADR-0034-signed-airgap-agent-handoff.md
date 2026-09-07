# ADR-0034: Signed air-gap agent handoff

## Status
Accepted for sovereign development mode.

## Problem
Disconnected execution requires a portable task and result format that preserves tenant, workspace, capability, expiry, evidence, and identity boundaries.

## Alternatives
1. Copy prompts and files manually. Simple, but unauditable and authority can drift.
2. Export a full database. Preserves state but over-shares data and couples schema versions.
3. Export a bounded canonical bundle signed by the sender and require a separately signed result. Minimal scope, explicit authority, portable, and independently verifiable.

## Decision
Adopt signed Ed25519 canonical handoff and result envelopes. Imported bundles cannot expand tenant, workspace, receiver, capability count, or evidence scope.

## Failure behavior
Invalid signature, expiry, memory hash, scope, receiver, capability, or result binding fails closed.

## Security impact
The private signing key never enters the bundle. The result is bound to the exact task payload hash.

## Reversibility
The bundle is an adapter format and does not replace the internal durable message model.

## Acceptance evidence
- `src/lib/sovereignty/airgap-handoff.ts`
- `tests/sovereign-airgap-handoff.test.ts`
- `docs/canonical/evidence/v15/sovereign-vertical-slices.json`
