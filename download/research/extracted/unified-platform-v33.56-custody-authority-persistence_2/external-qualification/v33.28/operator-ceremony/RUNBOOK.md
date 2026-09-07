# Runbook

1. Generate each participant key on its own host. Never export private keys.
2. Record public-key fingerprint, organization, host and role.
3. Receive a signed challenge and prove possession by signing the nonce digest.
4. Obtain two independent custodian approvals.
5. Registrar signs enrollment. Verifier must not hold any participant, custodian, registrar, policy or security key.
6. Witnesses observe the same checkpoint and exchange signed gossip in both directions.
7. Any missing, stale, revoked or conflicting witness fails closed. Majority voting is forbidden.
8. Package public records and exact artifacts for offline verification.
