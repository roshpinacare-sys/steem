# Claude-Compatible Handoff — v31

## Canonical state

- Version: 31.0
- Readiness: Integrated Pilot
- Production promotion: blocked
- Final validation: `evidence/generated/V31_FINAL_VALIDATION.json`

## Start here

1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `governance-state/PROGRAM_STATE.json`
4. `governance-state/NEXT_ACTION.json`
5. `governance/v31/V31_EXECUTIVE_VERDICT.md`
6. `evidence/generated/V31_CLAIM_FALSIFICATION.json`
7. `evidence/generated/V31_SOVEREIGNTY_VALUE_PROOF.json`
8. `evidence/generated/V31_FINAL_VALIDATION.json`

## Non-negotiable invariants

- Supported claims cite selected trusted evidence.
- External provider proof requires canonical revalidation on first use and replay.
- Current credential revocation blocks persisted receipt reuse.
- Provider interactions are counted; external mutations remain zero.
- Campaign completion requires two credentialed reviewers from distinct organizations.
- Model output remains proposal-only.
- No production promotion without external qualification.

## Next gate

Run v32 against a live external provider and independently governed durable trust/revocation service. Do not substitute another fixture or a self-issued credential for external qualification.
