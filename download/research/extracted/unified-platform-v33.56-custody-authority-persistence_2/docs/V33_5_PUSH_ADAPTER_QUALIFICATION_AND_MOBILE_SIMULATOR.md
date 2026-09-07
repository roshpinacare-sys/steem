# V33.5 — Push Adapter Qualification and Mobile Approval Simulator

## Status

Local loopback-network qualification, signed provider receipt and webhook, shadow-only. G3 remains in progress. Production remains blocked.

## Objective

Move from a process-local transport simulator to a real HTTP round trip while preserving provider neutrality, authority binding, replay safety and honest evidence classification.

## Implemented

- Provider adapter manifest with exact loopback endpoint and webhook binding.
- Redirect-disabled HTTP client with request timeout and body limits.
- Local reference provider listening on an ephemeral `127.0.0.1` port.
- Gateway-signed webhook challenge bound to request, tenant, adapter and fixed callback digest.
- Provider-signed acceptance receipt.
- Provider-signed webhook received through a second real HTTP endpoint.
- Exactly-once provider acceptance and webhook idempotency after response loss.
- Provider revocation checks.
- Faults for timeout, HTTP 500, redirect, partial JSON, oversized response, response loss and receipt tampering.
- SSRF boundary rejecting DNS names, private-network addresses, credentials, TLS downgrade ambiguity, alternate paths, queries and fragments.
- Mobile approval presentation preserving exact scopes, four decision options, risk, cost and rollback label.
- Qualification evidence explicitly classified as `LOCAL_HTTP_QUALIFICATION` and ineligible to pass G3.

## Security invariants

1. The qualification client can connect only to exact `http://127.0.0.1:<port>` endpoints.
2. Redirects are never followed.
3. Callback location is fixed in the signed challenge by digest; providers cannot choose an arbitrary webhook destination.
4. Request, receipt and webhook are digest-bound and signature-verified.
5. A retry uses the same deterministic webhook challenge lineage.
6. Provider deduplication is bound to adapter, tenant and delivery.
7. Revoked provider keys cannot create accepted webhook evidence.
8. Mobile presentation cannot add scopes or decision options.
9. Local HTTP evidence does not imply APNs, FCM, real-device or human UX qualification.

## Explicit limitations

- No APNs, FCM or external provider credentials.
- No public network, DNS, TLS, certificate pinning or provider SLO evidence.
- No hardware-backed keys or device attestation.
- No real phone notification or operating-system background delivery.
- No human comprehension, accessibility or response-time study.
- No production effects.

## Next target

V33.6 should build a human-pilot-ready local mobile web client, a measurable approval task protocol and an external-provider adapter qualification kit that can be run only in an approved isolated environment.
