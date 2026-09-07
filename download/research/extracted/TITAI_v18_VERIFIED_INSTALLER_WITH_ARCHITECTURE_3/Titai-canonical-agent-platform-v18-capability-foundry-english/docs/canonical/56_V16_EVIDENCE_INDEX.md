# TITAI v16 Evidence Index

| Capability | Implementation | Runtime or test evidence | Result |
|---|---|---|---|
| Local runtime lifecycle | `src/lib/sovereignty/runtime-adapters.ts` | `tests/sovereign-runtime-adapters.test.ts` | Contract passed; real model blocked |
| Local model qualification | `scripts/qualify-v16-local-model.mjs` | `docs/canonical/evidence/v16/model/local-model-qualification.json` | Blocked honestly |
| Governed lexical retrieval | `src/lib/sovereignty/local-retrieval.ts` | `tests/sovereign-local-retrieval.test.ts` | Passed |
| Portable key custody | `src/lib/sovereignty/portable-keystore.ts` | `tests/sovereign-portable-keystore.test.ts` | Passed |
| Real migration rehearsal | `scripts/prove-v16-update-migration.ts` | `docs/canonical/evidence/v16/update-rehearsal/result.json` | Passed |
| Process network evidence | `scripts/process-network-audit.py` | `docs/canonical/evidence/v16/network/process-evidence.json` | Four loopback attempts; zero remote sockets |
| Clean offline dependency install | `scripts/prove-v16-offline-install.mjs` | `docs/canonical/evidence/v16/offline-install-manual/summary.json` | Passed with Node prerequisite |
| Isolated execution identity | `scripts/prove-v16-isolated-node.ts` | `docs/canonical/evidence/v16/multi-node/result.json` | Passed |
| Authoritative test exit | `scripts/run-complete-tests.mjs` | `docs/canonical/evidence/v16/full-tests-final/summary.json` | 64 files, 195 tests, no timeout |
| Production build | `scripts/build-production.mjs` | `docs/canonical/evidence/v16/build/build.log` | Passed |
| Hardware profile | `scripts/measure-v16-hardware.mjs` | `docs/canonical/evidence/v16/hardware/hardware-profile.json` | CPU and RAM measured; energy unavailable |
| Browser E2E | `e2e/smoke.spec.ts` | `docs/canonical/evidence/v16/browser-authenticated/e2e.log` | Environment blocked |
