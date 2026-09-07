# Acceptance Gates

## Every task

- Canonical and language validation pass.
- Typecheck, relevant tests, and build pass when dependencies are available.
- Acceptance criteria have explicit evidence.
- Security, privacy, data, migration, rollback, and operational effects are addressed.
- Documentation matches behavior and no new hidden remote dependency appears.

## Durable execution

Kill or restart at every checkpoint. Verify one terminal state, preserved cancellation,
no duplicate side effect, valid audit sequence, and clear operator recovery.

## Data, memory, and knowledge

Test ownership, permissions, provenance, correction, supersession, retention, deletion,
export, rebuild, freshness, and cross-tenant denial. Derived indexes must obey deletion.

## Models and reasoning

Pin model artifacts and configurations. Compare against baseline under equal budgets.
Report quality, omissions, latency, resources, and failure classes. Do not approve a
quality gain that violates safety or privacy thresholds.

## Tools and protocols

Test schema, identity, policy, consent, timeout, cancellation, idempotency, redaction,
structured errors, malicious descriptions, injection, and server version mismatch.

## Supply chain

Generate inventories and provenance, review licenses, verify signatures or hashes, and
block unknown or failed verification from promotion.

## Operations and sovereignty

Test network loss, remote-adapter disablement, export, clean restore, upgrade, rollback,
disk pressure, backup corruption, and recovery objectives.

## Performance, cost, and energy

Name workload, versions, hardware, configuration, and quality floor. Report distributions,
not only averages. Distinguish measured values, estimates, and proxies.

## Human oversight

The user must understand actor, objective, data, action, side effects, uncertainty,
expiration, alternatives, and rollback. Accessibility and approval fatigue are tested.
