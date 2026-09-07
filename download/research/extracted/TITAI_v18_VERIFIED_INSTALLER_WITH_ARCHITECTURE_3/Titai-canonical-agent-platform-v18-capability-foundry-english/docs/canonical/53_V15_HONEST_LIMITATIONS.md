# TITAI v15 Honest Limitations

## Independently verified
No external verifier on separate hardware has verified the final v15 archive. A local hash-bound verifier will be executed after packaging, but it is not organizational independence.

## Implemented and tested
- Three mandatory sovereign vertical slices: zero-key local workflow, signed air-gap handoff, and signed offline update with rollback.
- Local governed-memory filtering, local tools, artifact evidence, local verification, encrypted backup and clean restore.
- Context-separated key derivation and Ed25519 signing.
- Purpose-, tenant-, workspace-, validity- and revocation-aware local trust store.
- Durable JSON replay ledger that rejects consumed handoff tasks and results after restart.
- Portable memory with integrity, duplicate, conflict and scope handling.
- Hardware-feasibility and energy-aware placement contracts.
- Application-level air-gap network guard and operator-facing Sovereignty Control Plane.
- Production build, 180 regression tests, 21 sovereignty-focused tests, durable crash proof, Roast and release audit.

## Implemented but not independently verified
All v15 implementation and tests were produced in the same controlled execution environment. The final local verifier cannot substitute for a separate team, node or trust domain.

## Partially implemented
- Local model runtime: deterministic execution proves architecture but not generative quality.
- Network sovereignty: guarded adapters are proven; complete process-level socket observation is missing.
- Energy-aware routing: estimates exist without target-hardware measurement.
- Offline updates: files, compatibility, signatures, apply and rollback are proven; automatic database migration rehearsal is missing.
- Key custody: software key hierarchy and revocation exist; TPM, OS keychain and hardware-token custody are not implemented.
- Replay ledger: durable for a single local acceptance authority; no multi-process transactional adapter is provided.
- Test orchestration: all tests pass in deterministic split runs, but the monolithic command retains an open handle.

## Designed only
- TPM, smart-card and hardware-security-key adapters.
- Federated offline synchronization with version-vector conflict semantics.
- Local verifier quorum.
- Local speech, OCR, embedding and reranking runtimes.
- A complete offline package, browser and model artifact mirror.

## Environment and hardware blocked
- A useful real local model requires a reviewed model artifact and target runtime.
- Measured energy requires target hardware or external power instrumentation.
- Full process network observation requires a permitted network namespace or tracing environment.
- Browser E2E remains constrained by managed browser policy.

## Not sovereign
- Clean installation still normally acquires dependencies from public registries.
- Real model acquisition would normally use a model hub until an offline artifact bundle is built.
- Optional commercial providers transmit selected context when explicitly enabled.

## Unsafe for sovereign pilot
- Treating the deterministic runtime as evidence of useful model quality.
- Claiming zero outbound traffic without process-level observation.
- Enabling automatic energy decisions from estimates.
- Applying database-changing offline updates without migration rehearsal.
- Using software-only root keys for high-value production identities without an approved custody procedure.

## Classification
- Sovereignty: **SOVEREIGN DEVELOPMENT MODE**
- Standard release: **DEVELOPMENT ONLY**
