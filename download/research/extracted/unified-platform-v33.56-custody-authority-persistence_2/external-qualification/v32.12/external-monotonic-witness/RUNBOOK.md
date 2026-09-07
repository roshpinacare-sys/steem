# Independent Monotonic Witness Qualification — v32.12 Runbook

## Objective

Prove externally governed monotonic checkpoints with rollback and equivocation rejection.

## Truth boundary

This kit prepares and verifies qualification evidence. It does not claim that the external system was executed. Included examples are synthetic and cannot satisfy production policy. A locally valid replay-state hash chain protects integrity but does not by itself prevent rollback to an older valid state on another host; production qualification therefore also requires the independent monotonic-witness gate or equivalent protected monotonic storage.

## Threat model

- checkpoint rollback
- forked receipts
- witness substitution
- replayed receipt
- same-organization witness

## Prerequisites

- Independent witness service
- Immutable checkpoint namespace
- Independent reviewer identity
- Rollback and equivocation challenge authority
- Out-of-band pinned trust anchor controlled outside the verification document
- Root-signed, time-bounded trust bundle authorizing collector, reviewer and witness keys
- Protected replay/checkpoint state with exclusive writer locking
- Immutable raw-evidence root readable by the verifier

## Trust bootstrap

1. Pin the trust-anchor file outside the verification document and outside any collector-controlled evidence directory.
2. Have an authorized root custodian sign a time-bounded trust bundle containing the exact production policy and the permitted collector, reviewer and witness public keys.
3. Keep root signing keys out of the actor set. Collector, reviewer and witness authorizations must resolve to distinct organizations for production.
4. Provision a verifier-owned replay-state path. The verifier takes an exclusive lock and writes the state atomically only after a `QUALIFIED` result.
5. Treat trust-anchor replacement, trust-bundle expiry, replay-state rollback or lock contention as blocking failures.

## Procedure

1. Record the exact v32.12 source, artifact, toolchain, environment, policy and adapter identities.
2. Assign independently governed collector, reviewer and witness identities and authorize them in the root-signed trust bundle.
3. Generate a unique challenge nonce outside the platform process.
4. Prepare the run directory:

```bash
node scripts/prepare-external-qualification-v32_12.mjs external-qualification/v32.12/external-monotonic-witness/manifest.json <run-directory>
```

5. Execute the authorized external adapter and preserve the raw response under the configured evidence root without transformation.
6. Hash and size the raw evidence for the signed collector statement. The verifier will independently reread and hash the file; caller-supplied observations are forbidden.
7. Sign the collector statement using the authorized collector key.
8. Transfer the exact raw bytes and collector statement to the independent reviewer.
9. The reviewer verifies the raw bytes, policy and identity tuple, records a rationale, and signs the reviewer statement.
10. The independent witness signs the collector and reviewer statement digests and advances the monotonic checkpoint sequence.
11. Assemble a verification document containing only `schemaVersion`, `documentId` and `bundles`.
12. Run the verifier with out-of-band trust and state inputs:

```bash
node scripts/verify-external-qualification-v32_12.mjs <verification-document.json> <trust-anchor.json> <signed-trust-bundle.json> <evidence-root> <replay-state.json> <verdict.json>
```

13. The verifier uses its system clock, resolves evidence under the configured root, rejects links and path escapes, validates the root-signed trust bundle, obtains an exclusive replay-state lock, verifies signatures and identity bindings, and atomically advances replay/checkpoint state only on qualification.
14. A nonzero exit, `BLOCKED`, missing file, timeout, lock conflict, revocation, stale timestamp, trust failure, state rollback signal or identity mismatch is a failure—not a warning.

## Required external data

- checkpoint receipt chain
- rollback challenge result
- equivocation challenge result
- witness key record

## Negative controls

- Use a SIMULATED evidence class
- Set synthetic=true
- Reuse a challenge nonce
- Use collector key as reviewer key
- Change raw evidence after collection
- Change source, artifact, toolchain or policy digest
- Submit expired or revoked reviewer credential
- Copy approval from another qualification
- Embed attacker-controlled keys, policy, timestamps or observations in the verification document
- Use a self-signed or tampered trust bundle
- Rollback or alter replay/checkpoint state
- Hold the replay-state lock from another verifier process

Every negative control must produce `BLOCKED`. Synthetic fixtures may demonstrate verifier behavior but cannot satisfy the real gate.

## Acceptance criteria

- Evidence state is passed
- Evidence class is OBSERVED
- synthetic is false
- Minimum execution mode is independent-organization
- All signatures verify at action time
- All identity tuple fields match policy
- Raw evidence hash and size match observation
- Nonce is unique
- Collector, reviewer and witness are independent by key, process, host and organization
- Trust anchor is supplied out-of-band and the trust bundle signature verifies against an allowed root key
- Verifier uses its own system clock rather than a caller-selected evaluation time
- Verifier reads and hashes the real raw-evidence files under the configured evidence root
- Replay nonces and witness checkpoints advance in verifier-owned state under an exclusive lock
- Production policy requires exactly all six gates, independent-organization mode and a witness

The gate is complete only when the verifier returns `QUALIFIED` for observed evidence under the root-authorized production policy. Production promotion still requires all six gates and a separate authorized human decision.

## Cleanup and rollback

Revoke temporary credentials, remove temporary infrastructure only after immutable evidence capture, preserve failed-run evidence as non-authoritative, retain replay-state and witness receipts according to policy, and never allow model output to mutate external or production systems.
