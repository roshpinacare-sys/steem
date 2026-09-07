# External Runbook

1. Obtain the signed V33.22 challenge and verify its issuer key.
2. Assign independent HA and PITR operator organizations and keys.
3. Run the HA exercise on a non-production or explicitly authorized pilot cluster. Capture every required artifact without embedding passwords, private keys, connection strings or tokens.
4. Run the backup/restore/PITR exercise from a second operator host into an isolated restore target.
5. Populate the corresponding observation template. Keep all artifact paths relative and unique.
6. Hash every artifact with SHA-256 and record byte size, media type and collection time.
7. Sign each evidence bundle with the assigned operator key.
8. Transfer the bundle and exact artifact bytes to the independent importer.
9. The importer verifies signatures, paths, byte digests, sizes, role-specific artifacts, timestamps and anti-replay state before issuing a signed import receipt.
10. The independent verifier evaluates only imported live-external bundles. Preserve the resulting verdict and all supporting artifacts.

Never store secrets in this directory. Never run the exercise against production without a separately approved change and rollback plan.
