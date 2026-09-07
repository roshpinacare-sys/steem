# CLAUDE HANDOFF — V33.24

Canonical base: V33.23.

Implemented:
- `src/app/external-malware-airgap-v33_24.ts`
- separate scanner worker `scripts/external-malware-scan-worker-v33_24.mjs`
- adversarial tests `tests/external-malware-airgap-v33_24.test.ts`
- signed proof, verifier, operator kit, release validator and isolated regression receipts.

Truth boundary:
- local scanner is a deterministic reference scanner, not ClamAV/YARA qualification;
- local directory media is not removable hardware and not an air gap;
- no public ingress, live external evidence, or production authority;
- external qualification requires independently signed live observations and still cannot promote production.
