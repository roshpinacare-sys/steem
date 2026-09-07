# ADR-0025 — Hash-Bound Verification and Pilot-Readiness Truth

Status: Accepted.

## Problem

A successful run, a complete event chain, and a human review are different claims. Without binding review to source, tests, artifacts, and release hashes, a verification label can become stale or refer to a different artifact. Runtime calm can also be mistaken for release readiness.

## Alternatives

1. **Free-text reviewer notes.** Easy to create, but mutable and weakly attributable.
2. **A verification boolean on the run.** Convenient, but cannot prove what was reviewed.
3. **Immutable attestation plus conservative readiness gates.** Requires more evidence entry, but makes the claim inspectable and prevents unknown release facts from becoming implicit passes.

## Decision

Persist verification attestations that bind requirement revision, task revision, source-tree hash, test command, test-output hash, optional artifact hash, release-candidate hash, builder identity, verifier identity, decision, limitations, and creation time into an evidence hash. Display verification in a dedicated interface surface. Compute pilot readiness separately from runtime metrics and treat unknown evidence as blocking.

## Evidence

Attestation integrity and identity-separation tests pass. Pilot-readiness tests prove that healthy empty metrics remain `DEVELOPMENT ONLY` until all hard release facts are present.

## Limitations

The repository cannot prove organizational independence between a human owner and an agent beyond stored identities. Browser accessibility and E2E verification remain separate gates.

## Rollback

The verification table and UI may be disabled without changing run execution. Existing attestations remain auditable records.
