# v32.12 External Qualification Execution Readiness and Adversarial Evidence Integrity

## Executive verdict

The inherited v32.12 direction repaired the legacy aggregate that accepted unbound `PASS` objects, but a second-order red-team bypass remained: the verifier accepted actor public keys, policy, evaluation time, filesystem observations and replay claims from the same untrusted document being evaluated. A controlled forged document supplied attacker-generated keys, a one-gate policy, a fabricated observation and a caller-selected time and received `QUALIFIED` from the pre-hardening verifier.

The authoritative path now closes that self-attestation boundary. The verification document may contain only its schema version, document identifier and signed evidence bundles. Exact shape validation extends through every signed envelope, identity, actor, raw-evidence record, policy, authorization and public-key record, so signed but uninterpreted nested fields fail before trust evaluation. Trust, time, raw-byte observation and replay state come from independent verifier inputs.

## Authoritative trust chain

The verifier requires:

1. An out-of-band pinned trust anchor.
2. A root-signed and time-bounded trust bundle that binds the exact policy and authorized collector, reviewer and witness keys.
3. A filesystem evidence root from which the verifier independently reads, hashes and sizes raw evidence.
4. The verifier's own system clock.
5. A verifier-owned replay/checkpoint state protected by exclusive locking, a state digest and atomic replacement.

Root signing keys cannot also act as collector, reviewer or witness keys. Production trust requires three distinct organizations for every gate. Production policy requires exactly all six external gates, `independent-organization` mode and a witness.

## Evidence integrity

Every collector statement binds schema, run, qualification, gate, source, artifact, toolchain, environment, policy, adapter, nonce, execution facts and raw-evidence reference. The reviewer signs the collector digest, raw-evidence digest, verdict and rationale. The witness signs both statement digests and a monotonically advancing checkpoint.

The verifier rejects synthetic or simulated evidence, stale or future timestamps, reused nonces, copied approvals, invalid or revoked credentials, identity drift, missing authorizations, signature failures, evidence substitution, path traversal, symlinks, hard links, empty files, duplicate JSON keys, malformed state and concurrent state mutation.

## Concurrency repair

A red-team test found that the first lock implementation removed a pre-existing lock even when lock acquisition failed. Lock ownership is now explicit: only the process that successfully created the lock may remove it. A concurrent verifier is blocked and the foreign lock remains intact.

## Mutation strength

The external-integrity campaign now specifies 24 targeted mutants. It removes or weakens trust-root signature verification, production gate topology, witness requirements, actor authorization, checkpoint monotonicity, exact document-shape enforcement, filesystem observation, replay state, lock ownership, canonical JSON and source-boundary coverage. Every mutant must be created exactly once and killed by the intended named behavioral test; timeouts and unrelated failures are invalid kills.

## External kits

Six complete kits cover HSM/KMS custody, external monotonic witnessing, PostgreSQL HA/PITR/FORCE RLS, a consented comparative human pilot, independent security/isolation/supply-chain/license review, and multi-host SLO/revocation/recovery. Their manifests and runbooks now carry the full out-of-band trust command, trust bootstrap, replay-state handling, negative controls and cross-host rollback limitation.

## Honest boundary

All six external qualifications remain `not_executed`. Local cryptographic fixtures and dry runs demonstrate verifier behavior only. The local replay-state hash chain detects modification, but rollback to an older valid state on another host still requires an external monotonic witness or equivalently protected monotonic storage. Production promotion remains blocked until all six observed external qualifications pass and a separate authorized human decision is recorded.

## Test-oracle correction

A full-regression run exposed a weakness in the negative signature test itself: replacing only trailing Base64URL characters can preserve decoded bytes because of unused padding bits. The test now flips the leading encoded character deterministically, guaranteeing a changed signature byte sequence. This was a test-oracle defect, not a verifier bypass, and the corrected full suite passes.
