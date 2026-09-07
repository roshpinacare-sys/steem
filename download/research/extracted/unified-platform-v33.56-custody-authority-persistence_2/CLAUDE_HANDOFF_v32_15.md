# Canonical Handoff — v32.15

## Status

Blinded Frontier Tournament, Proof-Carrying WASM Components, and Multi-Host Qualification Integrated Pilot. Production promotion, frontier leadership and world-best claims remain blocked pending independently operated external evidence.

## Read first

1. `CLAUDE.md`
2. `MASTER_DIRECTIVE.md`
3. `PROGRAM_CHARTER.md`
4. `governance-state/PROGRAM_STATE.json`
5. `governance-state/NEXT_ACTION.json`
6. `governance-state/OPEN_DECISIONS.json`
7. `docs/V32_15_BLINDED_FRONTIER_TOURNAMENT_WASM_MULTI_HOST.md`

## New trusted components

- `src/benchmark/blinded-frontier-tournament-v32_15.ts`
- `src/isolation/proof-carrying-wasm-component-v32_15.ts`
- `src/qualification/multi-host-challenge-v32_15.ts`
- `verifier-only/v32.15/independent_assurance_verifier.py`
- `scripts/frontier-tournament-wasm-proof-v32_15.mjs`
- `scripts/run-frontier-tournament-wasm-mutation-v32_15.py`
- `scripts/validate-v32_15.py`

## Reproduction

```bash
npm ci --offline
V32_6_RUN_ID=v32.15-authoritative-local npm run validate:v32.15
```

Use a new run ID after any source, test, policy, verifier, lockfile or governance change. Synthetic tournament results, repository-only WASM admission and local process hosts cannot satisfy external or production policies.
