# TITAI v17 Architecture Delta

## Objective
v17 converts physical pilot claims from informal checklist values into typed, hash-bound evidence gates. It does not promote the release when a real model, unrestricted browser, hardware custody, two machines, or target-energy measurement is unavailable.

## Added contracts
- `physical-pilot.ts` defines mandatory physical gates, permitted execution kinds, environment identities, release binding, machine separation, and fail-closed evaluation.
- `offline-installer.ts` defines signed, platform-specific installer manifests and forbids secrets, traversal, non-loopback startup, and model weights in the core installer.
- `os-key-custody.ts` defines a no-shell, hash-pinned helper boundary for future DPAPI, TPM, keyring, smart-card, or hardware-token integrations.
- v17 collectors create signed privacy-preserving node and environment evidence without host names, IP addresses, serial numbers, model weights, or secrets.

## Corrected operator truth
The default sovereignty control plane no longer treats a separate process on the same host as real multi-node execution. The authoritative per-file test harness is now represented as passing, while model, browser, OS custody, physical nodes, and energy remain blocked.

## Dependency closure
The release acquires and lockfile-binds drizzle-orm 0.45.2 and drizzle-kit 0.31.10. Typecheck, canonical migration validation, SQLite persistence tests, v17 evidence tests, and the production build pass after the upgrade.

## Physical boundary
Repository code can validate evidence semantics and produce collectors, but it cannot manufacture physical evidence. The final verifier must reject pilot promotion until all required records come from permitted real execution kinds and are bound to the final source ZIP hash.
