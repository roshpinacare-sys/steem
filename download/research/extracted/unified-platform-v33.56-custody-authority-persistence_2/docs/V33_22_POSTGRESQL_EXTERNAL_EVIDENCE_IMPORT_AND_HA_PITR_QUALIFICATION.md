# V33.22 — PostgreSQL External Evidence Import and HA/PITR Qualification

## Result

V33.22 adds a byte-verifying external evidence importer, a signed append-only import ledger, anti-replay controls, role-separated HA and PITR bundles, and an independent qualification verdict. The implementation accepts portable evidence packages but does not perform failover, backup, restore or PITR itself.

## Evidence model

Each operator bundle is signed and contains a manifest of relative artifact paths, media types, byte sizes, SHA-256 digests and collection times. Import requires the exact artifact bytes. Missing, extra, changed, oversized, duplicate or path-traversing artifacts are rejected. Import receipts are signed by an importer key that cannot also be an operator, challenge issuer or verifier.

The HA role must prove timeline and fence advancement, one writer, old-primary rejection, outbox continuity, TLS verify-full and bounded RTO/RPO. The PITR role must prove backup integrity, isolated restore, recovery target attainment, new recovery timeline, witness rollback rejection, fence continuity, outbox continuity and bounded RTO/RPO.

## Qualification boundary

A verdict requires one HA bundle and one PITR bundle from distinct signer keys, organizations and operator hosts. Both must describe the same source cluster and PostgreSQL system identifier. The PITR fence must cover the post-failover fence. Synthetic bundles can be imported for contract testing but are marked ineligible and cannot qualify.

The release proof imports two synthetic bundles, verifies their bytes, demonstrates idempotent replay and tamper rejection, then issues `EXTERNAL_HA_PITR_QUALIFICATION_REQUIRED`. No live PostgreSQL, failover, backup, restore or PITR was executed by this release.
