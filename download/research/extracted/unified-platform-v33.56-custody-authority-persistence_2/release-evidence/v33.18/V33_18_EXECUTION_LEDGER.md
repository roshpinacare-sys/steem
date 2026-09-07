# V33.18 Execution Ledger

- Baseline: signed V33.17 package extracted cleanly.
- Added one canonical app-layer distributed lease authority reference.
- Added signed controller commands, authority decisions, monotonic witness receipts, durable outbox records and fail-closed backend probes.
- Ran twenty focused adversarial tests: 20/20 passed.
- Ran two real controller child processes against a loopback authority: exactly one race winner.
- Ran twelve expiry takeovers and twelve stale-fence rejections.
- Stopped and restarted the authority, observed fail-closed transport behavior and preserved fencing.
- Restored an older valid signed snapshot; the separate witness rejected rollback.
- Persisted and acknowledged 37 signed outbox events.
- PostgreSQL, etcd and Consul were not found and remain UNAVAILABLE_FAIL_CLOSED.
- Full repository regression: 203 files, 1475/1475, exit 0.
- Direct V33 evidence: 18 files, 308/308, independently receipted.
- Repository truth map: 205 source modules, 203 test files, zero findings.
- Architecture: 131/131 capability paths, zero cycles, zero untested sources.
- External effects: 0. Production promotion: blocked.
