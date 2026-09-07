# V33.6 Execution Ledger

## Objective

Create an installable local approval PWA, device-bound short-lived pilot sessions, independently verifiable human-observation evidence, session revocation after device loss, digest-chained telemetry, and credential-free APNs/FCM qualification plans without converting browser intent into canonical authority or an external effect.

## Implemented

- Installable local PWA with manifest, service worker, 192px/512px icons, restrictive CSP, same-origin enforcement and CSRF protection.
- Four explicit actions: YES, NO, CHANGE_CONDITIONS and EXPLAIN.
- Device-bound, server-signed, short-lived pilot sessions with exact tenant, user, device, card and CSRF binding.
- Canonical device-loss revocation before bulk session invalidation and registrar-bound replacement-device flow.
- Append-only digest-chained pilot telemetry with idempotency, changed-event rejection and monotonic timestamps.
- Independent human observer signatures binding participant, consent receipt, session digest and telemetry tail.
- G3 evaluator that rejects simulations, unsigned human claims, fewer than five participants, failed accessibility or slow comprehension.
- APNs and FCM qualification plans containing secret references only; no credentials or external network execution.

## Adversarial corrections made during implementation

1. Optional telemetry fields originally reached canonical hashing as undefined; the representation was normalized instead of weakening hashing.
2. A browser could initially claim HUMAN_OBSERVED. The local PWA now rejects this class; only an independent trusted observer can sign qualifying evidence.
3. Device-loss revocation was required to follow canonical device revocation, preventing arbitrary session invalidation from being presented as device compromise response.
4. The proof originally expected exactly one revoked session even though the PWA flow had created another active session. It now proves all relevant sessions are revoked and the explicitly targeted session is unusable.
5. PWA installability audit was strengthened to require both 192x192 and 512x512 PNG icons, and the server tests verify both assets are served.

## Evidence

- Direct V33.1-V33.6 path tests: 106/106.
- New V33.6 tests: 26/26.
- Full repository regression: 1273/1273 across 191 test files, exit 0, no force-exit.
- Architecture: 107/107 capability paths, 0 source cycles, 0 untested source modules.
- Repository truth map: 192 source modules, 191 test files, no findings, production blocked.
- Structural user-flow simulation: 76.67% fewer user steps and median one approval. This is simulation evidence only.
- Human participants observed: 0.
- External APNs/FCM calls: 0.

## Harness observation

Two foreground invocations displayed complete TAP output but the surrounding interactive execution wrapper did not return control. The identical command was then run as an independently detached process and produced an explicit exit receipt of 0. No force-exit was used. This distinction is retained in the evidence rather than silently treating displayed TAP as an exit receipt.

## Explicit non-claims

- G3 has not passed.
- No human comprehension or accessibility study has been performed.
- No APNs, FCM, public TLS ingress or operating-system notification was exercised.
- No hardware-backed key, KMS or HSM was used.
- A browser selection is pilot intent only and does not create a canonical signed device decision.
- No external effect or production promotion occurred.

## Gate state

- G0: passed.
- G1: passed.
- G2: not started.
- G3: in progress, not passed.
- Production: blocked.
