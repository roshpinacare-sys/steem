# TITAI v12 Evidence Index

| Capability | Requirement / decision | Implementation | Test or evidence | Status |
|---|---|---|---|---|
| Fenced leases | ADR-0024 / DUR-005 | `src/lib/durable/*`, schema, migration 0006 | `tests/durable-fencing.test.ts`, property/race tests | Implemented and tested |
| Step recovery | ADR-0024 / DUR-006 | `src/lib/durable/step-runner.ts`, active runner guarded integration | step-runner tests, durable crash proof | Implemented for simulation/dry-run; live cutover partial |
| Approval CAS | ADR-0024 | approval revision, expectedRevision API, atomic transition | approval continuation tests; native multi-process test blocked | Implemented and deterministic tests passed |
| Immutable verification | ADR-0025 / VER-002 | authorization + verification attestation API/UI | `tests/verification-attestation.test.ts`, authorization tests | Implemented and tested; independent operator absent |
| Pilot truth gate | ADR-0025 / UX-004 | pilot-readiness model and Operations surface | `tests/pilot-readiness.test.ts`, accessibility source contracts | Implemented and tested; browser validation blocked |
| Verifier-aware routing | ADR-0026 / MOD-003 | model registry/router/API/schema | model router tests, property permutations | Implemented and tested |
| Governed memory | ADR-0026 / MEM-005 | normalization, quarantine, contradiction handling, ablation harness | memory context and ablation tests | Implemented and tested; field benefit unproven |
| Risk-adjusted autonomy | ADR-0026 / CAP-003 | autonomy policy integrated into capability broker | autonomy and capability tests | Implemented and tested |
| Dynamic Roast | TST-003 | six-mode dynamic audit | `roast:dynamic` 6/6 | Implemented and tested |
| Targeted mutation | TST-003 | six semantic mutants | `mutation:v12` 6/6 killed | Implemented; curated, not exhaustive |
| Design evidence | UX-004 | Evidence Control Plane, Verification and Pilot surfaces | design tournament, deterministic render | Implemented in code; browser E2E blocked |
| Release reproducibility | canonical release rules | SBOM/provenance/manifest/audit | extracted archive validation required at packaging | Pending final package |

## Integrity rule

No row marked “implemented and tested” should be read as independently verified. A separate verifier identity and clean environment remain release requirements.
