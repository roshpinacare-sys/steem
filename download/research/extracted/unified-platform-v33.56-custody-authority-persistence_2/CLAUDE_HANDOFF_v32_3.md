# CLAUDE Handoff — v32.3 External Qualification Readiness

## Canonical status

- Version: `32.3`
- Source digest: `382891ecf60bb7b6ae7e5f2e5fad947a69fc3b3c2a265bb0af4fafa5b303d128`
- Readiness: `Integrated Pilot — ready for external execution`
- External qualification: `NOT_EXECUTED` (`0/6` gates)
- Production promotion: `blocked`
- Final validation: `passed-external-ready-integrated-pilot-production-blocked`

## Required read order

1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `PROGRAM_CHARTER.md`
4. `governance-state/PROGRAM_STATE.json`
5. `governance-state/NEXT_ACTION.json`
6. `governance-state/OPEN_DECISIONS.json`
7. `docs/V32_3_EXTERNAL_QUALIFICATION_EXECUTION_KIT.md`
8. `external-qualification/qualification-manifest.json`
9. `schemas/external-evidence-envelope.schema.json`
10. `release-evidence/V32_3_FINAL_VALIDATION.json`
11. `release-evidence/V32_3_14_AXIS_SCORECARD.json`
12. `release-evidence/V32_3_EXTERNAL_EXECUTION_READINESS.json`

## What is complete

- All 673 local tests pass.
- Coverage and retained proof floors pass.
- 34/34 capability paths are closed.
- Production-source complexity has zero warnings and zero blocks.
- All 13 new external evidence acceptance mutations are killed authentically.
- Six external qualification evaluators and the aggregate gate are implemented and tested.
- Evidence freshness is 19/19 for the exact source digest.

## Do not overclaim

- `READY_FOR_EXTERNAL_EXECUTION` is not external qualification.
- A locally created JSON file is not observed external evidence.
- `signature.verified=true` is acceptable only after independent trust-store verification at ingestion.
- Passing all six gates does not authorize production promotion; it only makes the project eligible for a separate authorized decision.
- Human pilot rows must be consented, non-synthetic and pseudonymous.
- PostgreSQL, HSM/KMS, witness, independent review and multi-host claims remain blocked until real execution.

## Next allowed action

Execute the six qualification work packages in independently governed environments, ingest only exact-digest observed evidence, then record a separate authorized promotion decision if every production floor and gate passes.

## Reproduce

```bash
npm ci --ignore-scripts
npm run validate:v32
npm run mutation:excellence:v32.2
npm run validate:v32.3
```
