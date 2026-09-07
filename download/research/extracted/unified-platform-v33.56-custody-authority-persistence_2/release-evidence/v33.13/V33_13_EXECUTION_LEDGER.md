# V33.13 Execution Ledger

## Executed

- Extracted V33.12 into a separate V33.13 working directory.
- Probed the current host for namespaces, openat2 preconditions, seccomp loaders, cgroup v2, second runtime implementations and external witness availability.
- Added a signed host capability attestation with a validity window.
- Added a provider-neutral isolation runtime adapter contract.
- Added descriptor-pinned repository manifests using `O_NOFOLLOW` and double `fstat` checks.
- Added a repository orchestrator binding source manifests, runtime receipt and adapter evidence.
- Added a separately signed independent verifier verdict.
- Enforced five distinct roles: admission, capability attestation, runtime, orchestration and verification.
- Ran 12 V33.13 adversarial tests.
- Ran 222/222 direct V33 tests.
- Corrected a historical parallel-test assumption in V33.12 so concurrent cleanup cannot create a false failure.
- Ran 1,389/1,389 full repository tests with a detached exit receipt.
- Regenerated the truth map and architecture map from source.

## Observed host boundary

- Local namespace runtime: verified available.
- openat2: not executed and not qualified.
- seccomp: not executed and not qualified.
- delegated cgroup v2: unavailable in the accessible host boundary.
- second runtime: unavailable.
- multi-host: not executed.
- external witness: not executed.

## Promotion decision

- G4: in progress, not passed.
- G5: in progress, not passed.
- Promotion ceiling: research.
- Production: blocked.
