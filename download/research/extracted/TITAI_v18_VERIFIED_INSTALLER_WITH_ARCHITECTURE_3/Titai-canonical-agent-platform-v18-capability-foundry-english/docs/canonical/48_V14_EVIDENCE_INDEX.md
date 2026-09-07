# v14 Evidence Index

| Capability | Implementation | Primary test or proof | Evidence |
|---|---|---|---|
| Canonical migrations | `src/lib/db/migrations.ts` | `tests/canonical-migrations.test.ts` | `evidence/v14/gates/migrations.log` |
| SQLite fallback | `src/lib/db/sqlite-client.ts` | `tests/sqlite-driver-fallback.test.ts` | `evidence/v14/test-full.log` |
| Runtime schema alignment | `drizzle/0008_v14_runtime_alignment.sql` | migration validator | `evidence/v14/gates/migrations.log` |
| Lease race and fencing | `src/lib/durable/sqlite-store.ts` | `scripts/prove-v14-multiprocess.ts` | `evidence/v14/multiprocess-lease-proof.json` |
| Approval restart and CAS | `src/lib/engine/runner.ts` | `scripts/prove-v14-approval-restart.ts` | `evidence/v14/approval-restart-process-proof.json` |
| Outbox ownership | `src/lib/durable/outbox.ts` | `scripts/prove-v14-outbox.ts` | `evidence/v14/multiprocess-outbox-proof.json` |
| Database lock behavior | SQLite busy timeout | `scripts/prove-v14-db-lock.ts` | `evidence/v14/database-lock-proof.json` |
| Disk-full rollback | SQLite transaction | `scripts/prove-v14-disk-full.ts` | `evidence/v14/disk-full-proof.json` |
| Clean restore | `src/lib/backup/application-backup.ts` | `scripts/prove-v14-clean-restore.ts` | `evidence/v14/clean-restore-proof.json` |
| Restore interruption | restore fault injector | `tests/application-backup.test.ts` | `evidence/v14/test-full.log` |
| Scoped seed | `scripts/seed.ts` | clean-restore proof | `evidence/v14/clean-restore-proof.json` |
| Bounded production build | `next.config.ts` | `npm run build` | `evidence/v14/build-production.json` |
| Failure matrix | multiple runtime layers | `scripts/prove-v14-pilot.ts` | `evidence/v14/pilot-failure-matrix.json` |
| Managed browser blocker | `playwright.config.ts` | attempted Chromium E2E | `evidence/v14/browser-policy-block.json` |
| Full regression suite | repository | `npm run test:safe` | `evidence/v14/test-full.log` |
| Pilot classification | release gates | evidence generator | `evidence/v14/pilot-evidence-bundle.json` |
