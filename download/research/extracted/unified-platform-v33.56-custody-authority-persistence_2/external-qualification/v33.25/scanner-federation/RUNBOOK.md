# Runbook

1. Assign two independent operator organizations and a separate verifier.
2. Deploy ClamAV and YARA on distinct hosts and preferably distinct administrative domains.
3. Record exact engine versions and implementation artifact digests.
4. Import an externally signed feed chain with at least three monotonic updates.
5. Prove freshness, authenticated transport, rollback protection, and publisher separation.
6. Scan the same immutable evidence package with both engines.
7. Apply fail-closed disagreement policy; never use majority voting.
8. Collect signed receipts, feed-chain evidence, witness evidence, and federation verdict.
9. Submit observations to the independent verifier.
10. Do not claim production qualification from synthetic or same-host evidence.
