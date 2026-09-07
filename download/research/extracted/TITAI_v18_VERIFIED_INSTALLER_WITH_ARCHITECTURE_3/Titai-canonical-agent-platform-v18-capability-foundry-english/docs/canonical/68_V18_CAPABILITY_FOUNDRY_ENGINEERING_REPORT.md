# TITAI v18 Capability Foundry Engineering Report

v18 converts TITAI extensibility into a controlled, evidence-first capability lifecycle.

## Implemented system

Capability packages contain signed manifests, file hashes, permissions, resource ceilings, side-effect policy, tests, evaluations, evidence, rollback and uninstall instructions. Packages enter quarantine and cannot become active solely because files were imported. The local registry enforces publisher trust, scoped activation, independent approval, revocation and rollback.

The Mission Compiler turns operator intent into typed steps, capability requirements, approvals, retry and reconciliation policies, an evidence plan, a semantic diff and a deterministic mission hash. It detects unavailable or cross-scope capabilities and treats offline prohibitions as constraints rather than requests for external authority.

The Foundry prefers reuse, extension and composition before creation. It produces bounded candidates, generated tests, adversarial checks and minimized permission manifests. Candidates and missions persist in SQLite with tenant, workspace and owner scope.

## Proof

All five required vertical slices passed:

1. Capability creation, signing, quarantine, qualification, activation, revocation and rollback.
2. Mission compilation, gap detection, operator review and durable evidence binding.
3. Controlled self-improvement proposal, test, verifier, canary and rollback lifecycle.
4. Signed role-separated builder and verifier handoff.
5. Malicious-package detection and quarantine without side effects.

The final isolated regression suite contains 81 files and 262 tests, with zero failures and zero timeouts. Baseline evaluation passed 8 of 8 cases. Durable crash proof completed in two attempts with exactly one side effect. Eighteen targeted mutation probes were killed. Dynamic Roast passed 6 of 6 and static Roast passed 44 of 44.

## Classification boundary

The Capability Foundry subsystem is eligible for `CONTROLLED CAPABILITY PILOT` only after final archive extraction, manifest verification and hash-bound verifier acceptance. Complete TITAI remains `SOVEREIGN DEVELOPMENT MODE` and `DEVELOPMENT ONLY` because physical browser, hardware, model, two-host and external-verifier gates remain blocked.
