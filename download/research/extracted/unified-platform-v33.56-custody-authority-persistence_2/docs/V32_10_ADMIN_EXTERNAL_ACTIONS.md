# Administrator Actions Remaining After v32.10

1. Provide an approved PostgreSQL 17 primary/standby environment or an approved Docker/Podman runtime for HA, FORCE RLS, failover and PITR qualification.
2. Select an HSM/KMS provider and independent custodians; provision only through the qualification workflow, never in repository files.
3. Select an external transparency or monotonic witness service and independent reviewer identity.
4. Run vendor tools from their official, checksum-pinned distributions: CodeQL, OpenSSF Scorecard, Cosign/Witness, OPA, TLC and a supported fuzzing service.
5. Commission independent security, isolation, supply-chain and licensing review.
6. Approve and recruit participants for the consented comparative human pilot.
7. Provide at least three independent hosts for multi-host SLO, revocation propagation, split-brain and recovery tests.

No secret, token, private key or account credential should be committed to this repository.
