# Operator Runbook

1. Pin the signed challenge and trust policy out of band.
2. Run ClamAV and YARA on different scanner hosts operated by different organizations.
3. Capture engine version, signature database version and update time, exact package digest, result, timestamps, engine log, command output, package manifest and signature database metadata.
4. Sign each receipt with the scanner-host identity. Do not reuse keys across engines, operators, importer, transparency log or verifier.
5. Import the exact artifact bytes. A digest-only assertion is insufficient.
6. Submit the feed checkpoint and both receipt digests to the transparency log.
7. Export signed old/new checkpoints, inclusion proofs and the prefix-consistency witness.
8. Run the independent verifier. Any stale database, stale receipt, package/feed mismatch, emergency revocation, missing proof or scanner disagreement fails closed.
9. Preserve raw receipts and logs. A passing verdict permits an external pilot subgate only; production remains blocked.
