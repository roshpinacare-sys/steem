# External Provider Qualification Runbook — V33.7

## APNs

Use the APNs sandbox endpoint, HTTP/2, TLS 1.2 or later, an ES256 provider token, a real test device and a KMS/HSM/workload identity reference. Exercise valid delivery, invalid token, token rotation, retry after response loss, deduplication and credential revocation. Capture the TLS peer fingerprint and transcript digest.

## FCM

Use a dedicated isolated Firebase project, the HTTP v1 send endpoint, a short-lived OAuth 2.0 access token or workload identity, and a real test device. Exercise valid delivery, invalid registration token, token rotation, retry after response loss, deduplication and identity revocation. Capture the TLS peer fingerprint and transcript digest.

## Separation of duties

The operator signs the run. A witness from a different organization independently observes and signs the run digest, TLS fingerprint and transcript digest. Same-organization evidence cannot qualify the run.
