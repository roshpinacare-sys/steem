# v26 External Qualification Runbook

Version: 26.0
Status: Ready to execute; not executed
Owner role: External Qualification Lead

Required independent gates:

1. PostgreSQL 16 primary/standby, concurrent failover, fencing, PITR and restore verification.
2. Authorized KMS/HSM signing, rotation, revocation and audit export.
3. Independently assessed untrusted-code containment on a supported kernel/runtime.
4. External penetration test and supply-chain review.
5. Licensing/legal resolution for source-derived behavior.
6. Consented human pilot with the published task protocol.
7. Multi-host latency, availability, recovery and evidence-growth SLOs.

No local result in v26 satisfies these external gates.
