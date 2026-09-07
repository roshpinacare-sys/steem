# Honest Limitations

## Environment-blocked validation

- Dependencies were installed with post-install scripts disabled. The `better-sqlite3` native binary is absent by design.
- `approval-expiry.test.ts`, `audit.test.ts`, and `runner.integration.test.ts` fail before test collection because the native binding cannot be loaded. They are not counted as logical test failures or passes.
- A live migration, seed, audit verification, complete application startup, and production runner integration were not executed against `better-sqlite3` in this environment.
- The production build compiled successfully in 30.7 seconds and completed its type-validity phase, but page-data collection failed because the `better-sqlite3` native binding is absent. Production build is not claimed as passed.
- Playwright E2E was improved at source level but not executed because a completed production application path was unavailable.
- Endpoint protection was not disabled. PowerShell and opaque executable downloads were not used.

## Implemented but not production-cut over

- SQLite durable jobs, receipts, leases, checkpoints, and outbox schema exist.
- A SQLite durable-store adapter and outbox dispatcher exist.
- Run idempotency, event sequencing, audit append, and outbox writes use immediate transactions in code.
- The active application runner still uses the process-local detached compatibility path.
- Persisted approval expiry exists, but serialized approval continuation and restart resume do not.
- The durable portable crash proof remains valid, but it is not proof of the active production runner.

## Implemented baselines with remaining depth

### Governed memory

Implemented: ownership, provenance, confidence, authority, contradiction risk, sensitivity, expiry, correction, deletion, retrieval explanation, token budget, API, export, and UI.

Remaining: automatic agent use, poisoning suite, embedding/index synchronization, delegated tenant model, retrieval-quality benchmark, and cross-scope negative tests.

### Backup and restore

Implemented: encrypted SQLite snapshot, authenticated envelope, integrity verification, atomic restore, wrong-passphrase and tamper rejection, overwrite protection.

Remaining: clean-machine application restore, artifact-directory scope, key-custody runbook, rotation, measured RTO/RPO, and scheduled drill evidence.

### Observability and context

Implemented: local SLO metrics and deterministic context/output budgets.

Remaining: distributed traces, durable capacity history, exact provider usage reconciliation, cost/energy measurement, compression, cache isolation, and omission benchmarks.

### Supply chain

Implemented: SBOM, license inventory, model inventory, source provenance, release manifest, and archive hash.

Remaining: signed attestation, transparency log, policy-enforced license allow/deny, model-weight hashes, dataset inventory, and reproducible external build evidence.

## Open promotion blockers

1. Cut the production runner over to the durable path behind a feature flag.
2. Pass native database migration, concurrency, audit, approval-expiry, and runner integration tests.
3. Implement restart-safe approval continuation and durable timer ownership.
4. Complete page-data collection in the production build with the native database binding present, then execute the Playwright E2E suite.
5. Upgrade Drizzle ORM to a non-advisory supported release and rerun migrations and tests.
6. Implement measured capability-based model routing.
7. Obtain independent security, data, recovery, and migration verification.

## Required continuation commands

On a trusted development or CI machine with native build support:

```bash
npm ci
npm run canonical:validate
npm run language:validate
npm run lint
npm run db:migrations:validate
npm run typecheck
npm run test:safe
npm run test:durable
npm run durable:prove
npm run eval:baseline
npm test
npm run db:migrate
npm run seed
npm run verify-audit
npm run build
npm run e2e
npm run roast:static
npm run roast:validate
npm run release:evidence
npm run release:manifest
npm run release:audit
```
