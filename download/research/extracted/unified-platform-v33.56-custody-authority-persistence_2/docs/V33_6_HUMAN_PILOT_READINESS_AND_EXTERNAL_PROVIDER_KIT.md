# V33.6 — Human-Pilot Readiness and External Provider Qualification Kit

## Purpose

V33.6 turns the structural mobile approval simulation into an installable local PWA and adds the evidence boundary required before a human study or credentialled APNs/FCM qualification.

## Implemented

- Local PWA approval card with four explicit actions.
- Device-bound, server-signed, short-lived pilot sessions.
- CSRF, same-origin and restrictive CSP controls.
- Session invalidation after canonical device revocation and device replacement.
- Append-only, digest-chained pilot telemetry.
- Structural accessibility and PWA audit.
- Independent observer signatures for any future `HUMAN_OBSERVED` evidence.
- Rejection of unsigned or self-declared human evidence.
- APNs and FCM qualification manifests containing references to secrets, never secret material.
- Explicit separation between browser intent and a canonical signed device decision.

## Non-claims

- No human participant was observed in the repository proof.
- Static accessibility checks are not a human accessibility study.
- No APNs or FCM credential was loaded.
- No external network request or operating-system push was performed.
- No browser action created a production effect.
- G3 remains `in-progress`.

## External provider constraints

The APNs plan requires HTTP/2 over TLS 1.2 or later and token- or certificate-based trust. The FCM plan requires the HTTP v1 API with a short-lived OAuth 2 access token. Credential material must remain outside the repository behind an approved environment, KMS or HSM reference.

## Human qualification gate

G3 may pass only when all of the following are true:

1. At least five distinct consented participants are observed.
2. Each observation is signed by an independent trusted observer.
3. Each observation binds the pilot session, telemetry tail and consent receipt.
4. Median comprehension is below ten seconds.
5. Median approvals are at most one.
6. User steps are reduced by at least 70 percent.
7. Error rate is at most five percent.
8. Accessibility is validated beyond static source inspection.
9. No revoked session contributes evidence.

## Local demonstration

```bash
npm run build
npm run serve:pilot:v33.6
```

The demonstration is shadow-only and records pilot intent without producing a canonical approval decision.
