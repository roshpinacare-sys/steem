# Claude Handoff — V33.22

## Canonical status

V33.22 adds PostgreSQL external evidence import and HA/PITR qualification. It does not create a new authority root and does not execute database operations.

## Implemented

- `src/app/postgres-ha-pitr-evidence-v33_22.ts`
- `tests/postgres-ha-pitr-evidence-v33_22.test.ts`
- signed HA/PITR challenge, evidence bundles, byte-verifying importer and append-only ledger
- replay, bundle-ID conflict, artifact tampering, path traversal and store-tampering rejection
- independent verifier with cross-bundle timeline, fence, cluster and role checks
- secret-free external operator kit

## Truth boundary

The local proof uses `SYNTHETIC_CONTRACT_TEST` bundles only. They are imported but remain ineligible and the verdict stays `EXTERNAL_HA_PITR_QUALIFICATION_REQUIRED`. Live PostgreSQL HA/PITR evidence count is zero, external effects are zero and production promotion remains blocked.
