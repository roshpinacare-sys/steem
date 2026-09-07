# Runbook

1. Obtain a signed V33.22 HA/PITR challenge and a short-lived V33.23 intake session.
2. Collect evidence as explicit files. Do not wrap it in a self-extracting archive.
3. Hash every file and ensure the signed V33.22 bundle manifest matches the exact bytes.
4. Submit only to the bounded intake endpoint. The reference endpoint binds to `127.0.0.1`.
5. Preserve the signed intake receipt and scan report.
6. Export the encoded offline package.
7. On a disconnected verifier host, copy a separately distributed trust policy with pinned fingerprints.
8. Run `scripts/verify-offline.sh PACKAGE.json TRUST-POLICY.json`.
9. Treat `EXTERNAL_MALWARE_SCAN_REQUIRED` as an open blocker until a qualified scanner supplies separate evidence.
10. Never treat this kit as production approval or as proof that HA/PITR occurred.
