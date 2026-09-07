# V33.3 — Device-Bound Push and User-Flow Measurement

## Objective

Advance the chat-native operator plane from a local approval inbox to a device-bound, replay-resistant simulated push path while preserving the canonical authority boundary and executing no external effect.

## Implemented

- Registrar-signed device enrollment bound to tenant, user, device ID and Ed25519 public key.
- Fixed receive/decide capabilities; no wildcard device authority.
- Signed device revocation with effective-time semantics.
- Prevention of key reuse across users or devices, enrollment nonce replay and revocation replay.
- Gateway-signed push challenge bound to an already-enqueued approval card.
- Device-signed delivery acknowledgement.
- Device-signed approval command producing a gateway-signed decision receipt.
- Exact idempotency for accepted retries, including retries after later expiry or revocation.
- Rejection of delayed, newly accepted messages after device revocation.
- Signed gateway snapshots with relationship checks across delivery, acknowledgement, command, canonical inbox decision and receipt.
- Local file-backed approval inbox with file lease, atomic replacement, fsync and tamper detection.
- Structural user-flow evaluator that keeps simulated and human-observed evidence distinct.

## Local proof

The V33.3 proof establishes a complete local path:

`approval card → signed simulated push → device ACK → device decision → canonical decision → signed receipt → signed snapshot restore`

The structural scenarios produced:

- baseline user steps: 30
- prototype user steps: 7
- step reduction: 76.67%
- median approvals: 1

This is simulated structural evidence. It is not human-factor proof and does not pass G3.

## Security invariants

1. A device cannot be enrolled by an untrusted registrar.
2. A device key cannot be rebound to another user or device.
3. A push cannot be issued for a card absent from the canonical inbox.
4. A command is bound to tenant, user, device, card, delivery and nonce.
5. An accepted retry is idempotent; changed content with a reused identifier or nonce is rejected.
6. Revocation blocks newly accepted actions at or after its effective time.
7. Historical evidence created before revocation remains verifiable.
8. Device approval cannot expand scopes or execute an external effect.
9. A simulated or local proof cannot promote production.

## Remaining G3 evidence

- APNs and FCM adapters behind the same contract.
- Secure-enclave or hardware-backed device attestation.
- KMS/HSM-backed registrar and gateway keys.
- Real device identity lifecycle and recovery.
- Push delivery SLOs under disconnect, duplicate and out-of-order conditions.
- Human task-flow study.
- Approval comprehension below ten seconds.
- Accessibility validation.
- Proof that ordinary missions require at most one approval in representative use.

## Classification

`LOCAL DEVICE-BOUND SIMULATED PUSH PROTOTYPE — G3 IN PROGRESS — PRODUCTION BLOCKED`
