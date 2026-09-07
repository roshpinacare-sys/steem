# v32.10 Local Execution Assurance

This release reduces external blockers where honest local execution is possible without importing untrusted binaries. It generates observed evidence for six lanes while preserving authority boundaries.

- Native SARIF: repository-local scanner, no network, high-confidence rules only.
- Local provenance: ephemeral Ed25519 key, in-toto statement, private key never persisted, no transparency claim.
- Native policy: deterministic JSON policy, deny and undefined fail closed, not represented as OPA execution.
- Bounded model: local state exploration and counterexample search, not represented as TLC execution.
- Local fuzz: deterministic seeded campaign against the SARIF evidence gate, not represented as OSS-Fuzz.
- Local witness: append-only single-host digest chain, not represented as an independent external witness.

Production remains blocked until the external qualification gates pass and a separate authorized decision is recorded.
