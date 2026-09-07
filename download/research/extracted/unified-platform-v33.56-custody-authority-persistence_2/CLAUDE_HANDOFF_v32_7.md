# Claude Handoff — v32.7

## Classification

Validated Integrated Pilot candidate for **Proof Diversity, Integration Stress and Release Decision Closure**. Production promotion remains blocked.

## Read first

1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `PROGRAM_CHARTER.md`
4. `governance-state/PROGRAM_STATE.json`
5. `governance-state/NEXT_ACTION.json`
6. `governance-state/OPEN_DECISIONS.json`
7. `docs/V32_7_PROOF_INTEGRATION_CLOSURE.md`
8. `docs/V32_6_TEST_OPERATIONS_AND_SCALE.md`

## Invariants

- External mutation remains unauthorized.
- Production promotion remains blocked.
- Original archives remain immutable.
- Test count never substitutes for proof diversity or independent oracles.
- Integration success tests never substitute for rejection, replay, timeout, tamper, concurrency and recovery paths.
- Automated evaluation never grants production authority.

## Reproduce

```bash
npm ci --ignore-scripts
npm run validate:v32.7
```

## Next authorized work

Execute the six external qualification gates with observed independently reviewed evidence for the exact source and artifact digests. Additional repository-local work may improve proof depth but must not be represented as external qualification.
