# Canonical Handoff — v32.14

## Status

Frontier Model Execution and Proof-Carrying Binary Intelligence Integrated Pilot. Production promotion and “best in world” claims remain blocked pending independent external comparative and production qualification.

## Read first

1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `PROGRAM_CHARTER.md`
4. `governance-state/PROGRAM_STATE.json`
5. `governance-state/NEXT_ACTION.json`
6. `governance-state/OPEN_DECISIONS.json`
7. `docs/V32_14_FRONTIER_MODEL_AND_BINARY_INTELLIGENCE.md`

## New trusted components

- `src/ai/frontier-execution-kernel-v32_14.ts`
- `src/binary/proof-carrying-binary-v32_14.ts`
- `src/validation/frontier-comparative-assurance-v32_14.ts`
- `verifier-only/v32.14/independent_binary_verifier.py`
- `scripts/frontier-binary-proof-v32_14.mjs`
- `scripts/run-binary-fuzz-v32_14.mjs`
- `scripts/run-frontier-binary-mutation-v32_14.py`
- `scripts/validate-v32_14.py`

## Reproduction

```bash
npm ci --offline
npm run validate:v32.14
```

Use a new `V32_6_RUN_ID`; do not resume across source, toolchain, test, policy or verifier drift. Never execute an inspected binary as part of intake. External production and comparative gates remain `not_executed` until independently observed evidence exists.
