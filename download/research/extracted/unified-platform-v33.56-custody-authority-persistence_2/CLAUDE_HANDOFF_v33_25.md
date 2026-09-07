# CLAUDE HANDOFF — V33.25

Canonical base: V33.24.

Implemented:
- `src/app/signature-supply-scanner-federation-v33_25.ts`
- independent workers `scripts/scanner-engine-alpha-worker-v33_25.mjs` and `scripts/scanner-engine-beta-worker-v33_25.mjs`
- 35 adversarial tests in `tests/signature-supply-scanner-federation-v33_25.test.ts`
- signed proof, independent verifier, external operator kit, isolated regression receipts and release validator.

Truth boundary:
- feed chain, rollback witness and scanner federation are local references;
- reference workers are not ClamAV or YARA;
- process separation is not host or organization independence;
- disagreement always quarantines and never uses majority voting;
- external qualification requires live external observations and still cannot promote production.
