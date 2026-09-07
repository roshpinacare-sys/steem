# Hermetic dependency capsule runbook

1. Verify the package and lockfile digests.
2. Verify all three tarball SHA-256 and SHA-512 integrity values.
3. Start with an empty npm cache and no `node_modules` directory.
4. Run `npm ci --offline --ignore-scripts --no-audit --no-fund`.
5. Run `npm run build` and the v33.42 proof and independent verifier.
6. Reject registry URLs, extra packages, missing packages, changed tarballs, changed SBOM entries, or reused receipts.
