# TITAI v16 Reality-Gap Engineering Report

## Executive decision
TITAI v16 materially improves operational sovereignty, but it is not a controlled pilot. The correct classifications are `SOVEREIGN DEVELOPMENT MODE` and `DEVELOPMENT ONLY`.

## Starting condition
v15 proved zero-key deterministic workflow execution, signed air-gap handoff, signed offline update and rollback, local memory portability, replay rejection, and a sovereignty control plane. It did not prove a real local generative model, a clean disconnected dependency install, process-level network evidence, migration rehearsal, a reliable all-tests exit, stronger key custody, real browser accessibility, or measured target-hardware energy.

## Implemented corrections
1. Added a vendor-neutral real local-runtime lifecycle with loopback and hash boundaries.
2. Added a fail-closed qualification lane that refused to convert a deterministic runtime into model-quality evidence.
3. Added portable purpose-separated encrypted key custody with scope, rotation, retirement, revocation, and expiry.
4. Added governed lexical BM25 retrieval as a no-embedding sovereign fallback.
5. Applied a signed v16 update to a real v15 SQLite schema, preserved data, and restored the prior schema and data.
6. Installed 334 locked dependencies in npm offline mode on a clean source copy and passed type checking and sovereignty tests.
7. Added process-attributed network evidence; the sovereign workflow produced four loopback attempts and zero observed remote sockets.
8. Executed a tenant-scoped signed lease in a separate worker process with a separate identity and rejected result replay.
9. Replaced the hanging monolithic release authority with one bounded process per test file.
10. Expanded the sovereignty control plane to distinguish implemented evidence from blocked operational proof.

## Validation results
- Canonical: 100 tasks, 107 claims, 34 sources, 44 ADRs.
- Migrations: 10 canonical migrations including v16 operational sovereignty.
- Tests: 64 files and 195 tests passed; no file timed out.
- Build: full Next.js production build passed, 31 generated pages.
- Network proof: zero observed remote sockets for the selected sovereign workflow.
- Offline dependency install: passed from verified cache with lifecycle scripts disabled.
- Update migration and rollback: passed.
- Isolated worker process: passed.

## Blocked proof
The real local-model qualifier returned `blocked` because the environment had neither a model artifact nor a loopback runtime endpoint. The official Qwen 0.5B GGUF profile is recorded only as a candidate. Chromium was invoked with a disposable seeded database and password, but host policy blocked localhost navigation. Energy counters and target OS/hardware key custody were unavailable.

## Security posture
The new controls fail closed. Remote endpoints are rejected by the local adapter, model and binary hashes are required, cross-purpose keys are denied, memory scope is filtered before ranking, update migrations are verified, replay is rejected, and a missing proof remains a release blocker.

## Remaining critical work
- Execute and benchmark a hash-verified local model on the user's target mini-PC.
- Run browser, keyboard, accessibility, responsive, and offline tests in an unrestricted disposable lane.
- Add and test an OS keychain or hardware-backed custody adapter.
- Measure target-hardware power and thermal behavior.
- Verify the frozen release in a separate machine or CI identity against the final ZIP hash.

## Final classification
- Sovereignty: SOVEREIGN DEVELOPMENT MODE.
- Standard release: DEVELOPMENT ONLY.
