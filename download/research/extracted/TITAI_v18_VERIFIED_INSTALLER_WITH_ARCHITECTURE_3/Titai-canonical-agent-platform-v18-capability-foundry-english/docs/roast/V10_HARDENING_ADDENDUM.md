# v10 Roast Addendum: Transactional Hardening, Governed Memory, and Recovery

**Date:** 2026-07-10  
**Baseline:** `ROAST_REPORT.md` remains the complete v8 adversarial audit.  
**Scope:** repository changes implemented after the v9 durable-core proof.

## Result

The repeatable static roast improved from 20 of 27 controls during early v10 work to **26 of 27**. The remaining static failure is the Drizzle ORM advisory gate. No dependency version was fabricated because the package registry was unavailable for a safe upgrade and regression run.

The 50-finding registry now records:

- 13 fixed in v8.
- 6 fixed in v10.
- 25 partially mitigated.
- 4 open.
- 2 environment blocked.

These labels are intentionally conservative. A partially mitigated finding still blocks an unconditional production-readiness claim.

## Material improvements

### Transactional persistence

- Added SQLite schema and migrations for durable jobs, side-effect receipts, and an outbox.
- Added compare-and-set lease and checkpoint behavior in a SQLite adapter.
- Made run creation idempotent per user inside a SQLite immediate transaction.
- Appended run events and audit records with their outbox entries in the same database transaction.
- Added persistent deadlines, output budgets, context budgets, and approval expiry timestamps.

### Security and ownership

- Added fail-closed tool argument validation against explicit schemas.
- Added bounded regex validation for policy conditions.
- Added context-bound versioned provider-secret encryption.
- Closed registration after first-user bootstrap unless explicitly enabled or invite-gated.
- Scoped custom policies and templates to owners while retaining explicit built-ins.
- Added a baseline Content Security Policy and retained the existing egress protections.

### Governed memory

- Added user-owned memory with provenance, type, confidence, authority, contradiction risk, sensitivity, expiry, correction chains, deletion, and retrieval budgets.
- Added create, search, correct, and delete API paths and a Memory Ledger interface.
- Kept automatic memory injection disabled until poisoning, omission, and cross-scope evaluations exist.

### Recovery and supply chain

- Added encrypted full-SQLite backup and atomic restore with integrity, schema, foreign-key, wrong-passphrase, tamper, and overwrite checks.
- Added SBOM, license inventory, model inventory, and source provenance generation.
- Added a no-native migration validator using the Node SQLite implementation.

### Evaluation and UI

- Safe deterministic tests increased to 24 files and 85 tests.
- The Playwright flow no longer contains a hard-coded demo password or fixed waits and now covers evidence, agent evaluation, and memory lifecycle. Browser execution remains environment blocked.

## Remaining project killers

1. The production runner still uses the detached process-local path; the durable SQLite path is not yet the active runtime.
2. Pending approvals cannot yet reconstruct and resume a serialized continuation after restart.
3. Provider selection is still configuration-driven rather than a measured capability router.
4. Drizzle ORM remains on the advisory-flagged version until a safe dependency upgrade can be downloaded and tested.
5. Native database integration and successful production page-data collection/E2E evidence remain unavailable in this constrained environment.

## Interpretation

v10 materially reduces data-integrity, ownership, secret-handling, memory-governance, and recovery risk. It does not make the system production durable by documentation. Promotion still requires a feature-flagged runner cutover, native integration tests, completed build and E2E execution, and independent verification.
