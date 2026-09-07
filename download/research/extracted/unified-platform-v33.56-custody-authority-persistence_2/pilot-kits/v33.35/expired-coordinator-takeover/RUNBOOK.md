# Expired Coordinator Takeover Runbook

1. Freeze the expired predecessor lease and record its exact signed bytes.
2. Wait until `expiresAt + expirySafetyDelayMs`; never use operator discretion to bypass time.
3. Collect three distinct expiry votes from enrolled witnesses.
4. Obtain replacement coordinator acceptance and verify key fingerprint, organization and host separation.
5. Finalize one takeover certificate; reject any competing certificate for the same predecessor lease.
6. Install the takeover digest as a fencing token on every coordinator action path.
7. Publish the exact recovery artifact outside the coordinator's process.
8. Retrieve it independently from at least three monitors and exchange complete peer gossip sets.
9. Stop on split-view, missing receipt, topology overlap, signature failure, sequence discontinuity or production-authority mutation.
10. Keep production promotion blocked until external hosts and organizations are independently observed.
