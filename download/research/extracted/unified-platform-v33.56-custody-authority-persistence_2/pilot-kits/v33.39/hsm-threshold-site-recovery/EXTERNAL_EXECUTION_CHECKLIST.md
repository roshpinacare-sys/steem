# V33.39 external execution checklist

- [ ] Eleven role keys generated in independent HSM/KMS or hardware-backed devices
- [ ] No private key material entered the application process
- [ ] Five custodians separated by key, organization, host and administrator
- [ ] Three-of-five threshold approvals captured for every protected operation
- [ ] Public DNS and TLS endpoint outside platform administration
- [ ] Three independent retrieval monitors with durable fsync receipts
- [ ] Revocation propagated to all three monitors and resurrection denied
- [ ] Recovery site controlled separately from the primary site
- [ ] Backup inventory and restored bytes independently hashed
- [ ] Sequence and predecessor continuity verified without fork or reset
- [ ] Offline independent verifier passes
- [ ] G3 and production promotion remain blocked unless separately qualified
