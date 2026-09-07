# TITAI v13 Honest Limitations

## Implemented and Tested in the Source-Safe Environment

- Minimal tenant/workspace scope and ownership filters for the bounded pilot.
- Restart-oriented approval continuation contract with deterministic continuation key, revision compare-and-set, expiry, and durable pause/requeue.
- Lease fencing, checkpoint progression, side-effect receipts, and explicit reconciliation.
- Fail-closed Pilot Readiness derived from real run evidence.
- Lazy SQLite initialization and a complete production source build without a generated native binding.
- Encrypted backup structure and required-table validation in source-safe tests.
- Forty-four safe test files and 147 passing tests.
- Twelve killed semantic mutants and ten portable failure scenarios.
- Commit-pinned, read-only isolated CI definition.

## Environment-Blocked Gates

- The three `better-sqlite3` suites fail before collecting tests because the generated native binding is intentionally absent.
- Chromium E2E discovers twelve tests but cannot launch because browser executables are intentionally not downloaded on the protected host.
- Browser accessibility, visual regression, clean native restore, multi-process races, and process-replacement approval proof await the isolated lane.
- An operationally separate verifier cannot accept the final candidate until those gates pass.

## Unsupported by the Pilot

- Restart-safe live remote-provider conversations.
- Autonomous external or irreversible side effects.
- Enterprise shared tenancy.
- Shell execution and unreviewed plugins.
- Automatic reconciliation of ambiguous external effects.

## Release Classification

`DEVELOPMENT ONLY` with seven blocking pilot gates. The successful source build is a material improvement, but it is not native runtime or browser evidence.
