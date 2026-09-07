# Runbook

1. Pin the challenge and separately distributed trust policy.
2. Enroll one ClamAV operator and one YARA operator with different organizations, hosts, and signing keys.
3. Enroll two transparency witnesses with different organizations, hosts, and signing keys.
4. Scan the exact same package against the exact same feed and collect the four required artifact byte streams.
5. Submit the scanner receipts to the canonical transparency log.
6. Each witness independently observes the same signed checkpoint.
7. Exchange signed gossip receipts in both directions.
8. Quarantine immediately if equal log coordinates contain different roots or checkpoint digests.
9. Deliver all bytes, enrollments, observations, gossip receipts, and verifier output without any private keys.
10. A passing result permits only a controlled external pilot; production remains blocked.
