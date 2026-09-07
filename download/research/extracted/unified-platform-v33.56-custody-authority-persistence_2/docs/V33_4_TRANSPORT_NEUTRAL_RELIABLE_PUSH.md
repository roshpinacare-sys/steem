# V33.4 — Transport-Neutral Reliable Push and Device Recovery

## Status

Local, signed, fault-injected, shadow-only prototype. G3 remains in progress. Production promotion is blocked.

## Objective

Move from a process-local simulated push call to a provider-neutral delivery contract that can survive loss, duplication, delay, reordering and worker crashes without widening authority or claiming real mobile-provider qualification.

## Implemented

- Trusted-gateway admission at the durable outbox boundary.
- A transport-neutral request bound to tenant, device, delivery digest, target adapter and provider deduplication key.
- Provider-signed acceptance receipts bound to the same fields.
- Adapter- and tenant-scoped deduplication.
- Durable outbox states: queued, leased, retry wait, accepted, expired, revoked and dead letter.
- Bounded worker leases and crash recovery.
- Retry with maximum attempts and permanent-failure termination.
- Signed persistent outbox state; recomputing local hashes does not forge the state signature.
- Deterministic local fault injection for drop, response loss after acceptance, duplicate delivery, delay, reordering and permanent rejection.
- Device sessions bound to one enrollment digest and invalidated by revocation.
- Registrar-bound device replacement requiring old-device revocation and new-device enrollment for the same tenant and user.
- Reliability evidence explicitly classified as simulated fault injection and ineligible to promote G3.

## Security invariants

1. An unsigned or untrusted gateway delivery never enters the outbox.
2. A provider receipt cannot be used for another adapter, tenant, device, delivery or deduplication key.
3. A provider response lost after acceptance is retried without creating a second unique provider acceptance.
4. A stale worker lease cannot complete an item.
5. Revocation prevents queued delivery and invalidates active sessions.
6. Device replacement cannot cross tenant or user boundaries.
7. Stored outbox state requires a valid trusted state signature.
8. No local transport outcome executes an external effect or promotes production.

## Local proof

The V33.4 direct campaign contains 24 adversarial tests. The proof campaign includes response loss, network duplication, provider drop, delay/reordering, permanent rejection, worker crash recovery, signed-state tampering, session invalidation and device replacement.

## Explicit limitations

- No APNs, FCM or external push provider is connected.
- No real phone receives a notification.
- Keys are software-generated and not hardware-backed.
- No external KMS/HSM, attestation or secure-enclave evidence exists.
- The outbox is a signed local file prototype, not PostgreSQL HA.
- Device replacement is single-process and not externally identity-proofed.
- No human comprehension or accessibility study exists.
- G3 and production remain blocked.

## Next proof target

V33.5 should create a provider adapter contract test kit, local HTTP reference adapter and mobile approval simulator, then prepare a human pilot protocol. External credentials must remain absent until a separately approved qualification environment exists.
