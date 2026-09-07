# TITAI v18 Honest Limitations

## Implemented and tested

- Signed capability package standard and file integrity verification.
- Tenant- and workspace-scoped registry lifecycle with quarantine, qualification, installation, activation, revocation and rollback.
- Capability Foundry reuse analysis and bounded candidate generation.
- Mission Compiler with semantic diff, static analysis, gap detection and deterministic mission hashes.
- Policy compiler, low-risk subprocess controls, controlled improvement lifecycle and role-separated signed handoffs.
- Evaluation laboratory, local document tool pack, persistent candidate and mission records, and operator-facing Capability OS routes.
- Five mandatory vertical slices.
- 81 isolated test files and 262 tests with zero failures or timeouts.

## Partially implemented or deliberately bounded

- Restricted Node subprocess execution is suitable only for bounded low-risk packages. It is not a kernel-enforced hostile-code isolation boundary.
- The self-improvement proof validates proposal freezing, independent roles, canary and rollback states. It does not claim unrestricted autonomous repository modification.
- The proof publisher key demonstrates Ed25519 package trust but is not OS- or hardware-backed production custody.
- The monolithic Vitest command may retain an open handle; the isolated per-file runner is the authoritative release gate.

## Environment and hardware blocked

- Real browser E2E, accessibility and responsive testing of Capability OS.
- Real target Mini-PC model benchmark.
- OS or TPM key custody.
- Two physical hosts.
- Target-system energy measurement.
- External-host independent verifier.

Subsystem acceptance must not be used to promote the complete TITAI platform beyond `SOVEREIGN DEVELOPMENT MODE` and `DEVELOPMENT ONLY`.
