# v10 Evidence Index

This index maps implemented work to requirements, changed code, tests, and current verification status. A listed test proves only its stated invariant.

| Work item | Requirement and ADR | Main implementation | Evidence | Status |
|---|---|---|---|---|
| DUR-002 | Durable persistence; ADR-0020, ADR-0021 | `src/lib/durable/sqlite-store.ts`, `src/lib/durable/outbox.ts`, `src/lib/db/schema.ts`, `drizzle/0001_v10_hardening.sql` | `tests/durable-*.test.ts`, `docs/canonical/evidence/durable-vertical-slice.json`, migration gate | Partially implemented; runner cutover and native integration pending |
| Run idempotency | F-002, DUR-002 | `src/app/api/runs/route.ts`, `src/lib/engine/start.ts`, `src/lib/engine/runner.ts` | Typecheck, source review, native integration pending | Implemented, native verification pending |
| Transactional event/audit outbox | F-013, OBS-001 | `src/lib/engine/events.ts`, `src/lib/engine/audit.ts`, `src/lib/durable/outbox.ts` | Migration validation, typecheck, native audit tests blocked | Implemented, native verification pending |
| Approval expiry and deadlines | DUR-003, ADR-0015 | `src/lib/engine/runner.ts`, `src/lib/db/index.ts`, schema migration | Lifecycle tests; `approval-expiry.test.ts` blocked by native binding | Partially implemented |
| Tool argument boundary | SEC/CAP controls | `src/lib/engine/tools/validate.ts`, tool schemas, runner validation | `tests/tool-arguments.test.ts`, safe suite | Implemented; independent review pending |
| Policy regex safety | THR-001, SEC-001 | `src/lib/security/safe-regex.ts`, policy API and engine | `tests/safe-regex.test.ts`, policy tests | Implemented; independent review pending |
| Registration hardening | F-030 | `src/app/api/register/route.ts`, `.env.example` | Typecheck, source lint, static roast R-024 | Implemented; browser negative tests pending |
| Secret context binding | SEC-002 | `src/lib/crypto.ts`, provider API and runner | `tests/crypto.test.ts`, security suite | Implemented; rotation drill pending |
| Owner-scoped policies/templates | F-003, F-004 | schema and policy/template APIs | Typecheck, static roast R-017/R-018 | Implemented; native tenant tests pending |
| Governed memory | MEM-001, MEM-002; ADR-0022 | `src/lib/memory/governed-memory.ts`, memory API, Memory Ledger UI, `drizzle/0002_v10_governed_memory.sql` | `tests/governed-memory.test.ts`, migration validation | Implemented baseline; agent injection disabled |
| Context/output budgets | CTX-001, ADR-0013 | `src/lib/engine/context-budget.ts`, run API and runner | `tests/context-budget.test.ts`, safe suite | Implemented baseline |
| Local SLO metrics | OBS-001, ADR-0009 | `src/lib/observability/metrics.ts`, metrics API | `tests/metrics.test.ts` | Implemented baseline; distributed tracing pending |
| User export/deletion | DAT-001, ADR-0007 | account export/delete APIs, audit redactions | Typecheck, data inventory | Implemented baseline; propagation drill pending |
| Encrypted application backup | OPS-001, ADR-0023 | `src/lib/backup/application-backup.ts`, backup/restore scripts | `tests/application-backup.test.ts` | Implemented and tested locally; clean-machine RTO/RPO pending |
| SBOM and provenance | SUP-001, ADR-0010 | `scripts/generate-release-evidence.mjs` | generated release evidence files | Implemented; signatures and promotion policy pending |
| Release integrity | Release gates | `scripts/generate-release-manifest.mjs`, language/release validators | extracted-archive validation and SHA-256 | Implemented for source release |
| E2E stability | F-043, EVAL-002 | `e2e/smoke.spec.ts`, CI environment | Source inspection only | Partially mitigated; browser execution pending |

## Gate evidence

- `docs/canonical/evidence/v10-validation.json`
- `docs/canonical/evidence/v10-gates/`
- `docs/canonical/evidence/v10-native-tests.txt`
- `docs/canonical/evidence/v10-build.txt`
- `docs/canonical/evidence/release/`
- `docs/roast/evidence/roast-static-results.json`
- `docs/roast/ROAST_FINDINGS.json`

## Independent-verification boundary

The implementation and test execution were performed in one engineering session. Canonical tasks remain `in_progress` or `implemented`, not independently `verified`, unless their existing verifier contract explicitly proves a narrow portable-core property. A separate reviewer should inspect migrations, transaction boundaries, authentication behavior, backup key custody, memory abuse cases, and the eventual runner cutover.
