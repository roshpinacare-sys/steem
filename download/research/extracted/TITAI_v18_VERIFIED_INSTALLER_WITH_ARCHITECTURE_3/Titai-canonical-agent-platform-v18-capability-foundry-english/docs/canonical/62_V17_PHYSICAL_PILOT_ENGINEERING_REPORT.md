# TITAI v17 Physical Sovereign Pilot Engineering Report

## Executive decision
v17 materially strengthens release truth and closes the stale Drizzle dependency blocker, but the correct classifications remain `SOVEREIGN DEVELOPMENT MODE` and `DEVELOPMENT ONLY`. Physical pilot promotion is rejected because real local-model, complete trusted installer, OS or hardware custody, unrestricted browser, two-machine, target-energy, and external-machine verifier evidence remain unavailable.

## Starting state
v16 already proved durable execution, restart-safe approval, SQLite migrations, local lexical retrieval, purpose-separated portable custody, process-attributed network evidence, signed offline handoff and update, clean restore, separate-process work, 195 tests, production build, and signed hash-bound rejection.

## Highest-risk gap
The release had no typed distinction between physical execution and a simulated or same-host proof. A future agent could have set a readiness boolean to true without changing the real environment.

## Implemented corrections
1. Added mandatory physical pilot gates and allowed execution kinds.
2. Required evidence hashes, environment identity, collector version, timestamp, and final release hash.
3. Required two distinct machine fingerprints for multi-node proof.
4. Required verifier machine separation from the builder.
5. Added a 30-case real local-model qualification lane with explicit safety and structured-output thresholds.
6. Added a signed offline-installer manifest, path controls, loopback startup constraint, and model-weight exclusion.
7. Added a hash-pinned, purpose-limited OS custody helper contract with no shell execution.
8. Added signed privacy-preserving node profile and two-node comparison tools.
9. Corrected the control-plane default that previously treated same-host isolated execution as multi-node evidence.
10. Upgraded and validated Drizzle packages through real package acquisition and lockfile changes.

## Validation
- Canonical baseline gates pass.
- Drizzle upgrade typecheck passes.
- Ten canonical migration files and eighteen required tables validate.
- Five SQLite persistence files and eleven tests pass after the upgrade.
- Three new v17 test files and seven tests pass.
- Final isolated authority covers 67 files and 202 tests with no failures or timeouts.
- The production build exits zero and generates 31 pages.

## Physical observations
### Local model
The qualifier reports blocked because model artifact path, expected hash, license, and loopback endpoint are missing. No deterministic fallback is accepted as model-quality proof.

### Browser
Playwright discovers twelve configured tests across Chromium, Firefox, and mobile Chromium. Managed Chromium policy contains `URLBlocklist: ["*"]`, so real navigation cannot occur. The policy was not modified or bypassed.

### Key custody
The current Linux environment exposes neither a TPM device nor Secret Service. The helper contract is tested with a generated fixture, but no OS or hardware backend is claimed.

### Nodes and energy
One signed node profile was collected. It does not establish two-node independence. CPU and memory can be observed, but target Mini-PC power and thermal data cannot be inferred.

### Installer
A platform-specific staging tree containing Node, the production build, dependencies, migrations, and installer scripts reached approximately 1.1 GB and 24,218 files. Compression did not complete inside the bounded execution window. The incomplete archive was deleted and is not delivered. Trusted signing, a browser bundle, a model bundle, and clean external target proof remain absent.

## Supply-chain closure
The release records registry version and integrity metadata for drizzle-orm 0.45.2 and drizzle-kit 0.31.10, updates package.json and package-lock.json, and passes typecheck, migrations, SQLite persistence tests, v17 tests, and production build. Previous package files were retained outside the release as rollback material.

## Final release rule
A final verifier may accept only when every mandatory physical gate is passed by its permitted execution kind, all evidence is bound to the final source ZIP hash, two machine fingerprints are distinct, and the verifier does not share the builder fingerprint.

## Final classification
- Sovereignty: `SOVEREIGN DEVELOPMENT MODE`.
- Standard release: `DEVELOPMENT ONLY`.
