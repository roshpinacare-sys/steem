# Claude Handoff — V33.31

Read `CLAUDE.md`, `MASTER_DIRECTIVE.md`, `PROGRAM_CHARTER.md`, `governance-state/PROGRAM_STATE.json`, `governance-state/NEXT_ACTION.json`, and `governance-state/OPEN_DECISIONS.json` before acting.

V33.31 closes the V33.30 external-label provenance gap. The authoritative path is `src/app/external-human-pilot-evidence-import-v33_31.ts`; it requires registrar-signed enrollment, subject proof-of-possession, exact artifact bytes, separation of roles, one-time exporter challenge, signed package inventory, and monotonic replay state.

The included five participants are synthetic reference identities. External human participants are zero. G3 is not passed. Production promotion and external mutations remain blocked.

Reproduce with:

```bash
npm run build
npm run test:v33.31
npm run verify:proof:v33.31
npm run test:full:v33.31
npm run test:direct:v33.31
npm run validate:v33.31
```

The next legitimate action is an independently governed real human pilot using `pilot-kits/v33.31/external-human-pilot-import/RUNBOOK.md`.
