# V33.14 Execution Ledger

## Executed locally

- Built the repository with TypeScript.
- Ran 12 focused V33.14 adversarial tests.
- Executed compiled `openat2` and seccomp probes against the current kernel.
- Executed cgroup-v2 mount/delegation inspection.
- Executed the portable WASM challenge in the Node WebAssembly worker.
- Generated a signed two-host/two-organization/two-runtime external qualification challenge.
- Proved that two complete synthetic observations do not qualify the external gate.
- Ran the complete authoritative regression with a detached exit receipt.
- Regenerated repository truth and architecture evidence from source.

## Observed results

- `openat2`: `VERIFIED_UNAVAILABLE` on the current kernel.
- seccomp strict: `VERIFIED_UNAVAILABLE` on the current host.
- delegated cgroup v2: `VERIFIED_UNAVAILABLE`.
- portable WASM second runtime: `SPECIALIZED_REFERENCE_QUALIFIED` for portable challenges only.
- general second repository runtime: not qualified.
- external observed host evidence: 0.
- production promotion: blocked.

## Not executed

- A second independently operated host.
- A second general hostile-repository runtime.
- An external independent witness.
- microVM or hardware isolation.
- live production effects.
