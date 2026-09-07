# TITAI v13 Evidence Index

| Capability | Implementation | Evidence | State |
|---|---|---|---|
| Pilot scope | `src/lib/release/pilot-scope.ts` | `41_V13_PILOT_SCOPE.md` | Implemented |
| Tenant/workspace persistence | schema and migration 0007 | migration validation; tenant property tests | Implemented and source-tested |
| Restart-safe approval contract | durable continuation, pause/requeue, revision CAS | `tests/durable-approval-restart.test.ts` | Implemented and source-tested |
| Stale worker protection | fencing tokens and receipts | durable proof; failure matrix | Portable proof passed |
| Production source build | lazy database initialization | `production-build-release.json` | Passed in 47.814 seconds |
| Safe regression | 44 test files | `test-safe-final.log` | 147/147 passed |
| Mutation resistance | twelve semantic probes | `mutation-probes.json` | 12/12 killed |
| Failure injection | twenty-five scenarios | `pilot-failure-matrix.json` | 10 passed; 15 blocked |
| Pilot truth surface | live fail-closed readiness | pilot gate tests; browser test defined | Source-tested; browser pending |
| Encrypted application restore | application backup | backup unit tests | Source-tested; clean native restore pending |
| Native/browser lane | pinned least-privilege CI | workflow and pin validator | Implemented; not executed here |
| Final verifier | ZIP hash-bound rejection/acceptance | `verify-pilot-candidate.mjs` | Pending final archive; must reject while gates block |
