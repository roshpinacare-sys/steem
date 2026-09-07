# v32 Next Gate — Live Provider and Distributed Trust Qualification

## Objective

Qualify the v31 sovereignty contracts against a live advanced-model provider and a durable, independently governed credential/revocation service while preserving proposal-only execution and zero external mutation.

## Required evidence

- Live provider credential and attestation over exact request, policy, disclosure and full output.
- Measured egress classes, retention and deletion behavior.
- Multi-host replay and revocation propagation with a defined maximum delay.
- Rejection of persisted receipts after current revocation without a second provider call.
- Independent reviewer organizations verified outside the application’s self-issued registry.
- Fixed adversarial corpus covering prompt injection, output substitution, stale credentials and provider equivocation.
- Human comparative pilot with consent and a non-assisted baseline.
- PostgreSQL failover/PITR, KMS/HSM, independent penetration/isolation and licensing evidence.

## Stop conditions

Stop or downgrade on provider equivocation, hidden disclosure, stale credential acceptance, same-domain self-review, external mutation, unsupported correctness claims, or any requirement to weaken the v31 tests and mutation gates.
