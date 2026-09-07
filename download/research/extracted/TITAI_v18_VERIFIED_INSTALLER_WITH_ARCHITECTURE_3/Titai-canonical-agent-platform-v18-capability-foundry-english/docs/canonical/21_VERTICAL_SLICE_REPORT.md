# v7 Vertical Slice: Evidence-Governed Run Inspection

## User goal

An operator opens a run and must determine whether the system can reconstruct what happened, whether human authority was respected, and whether “completed” is supported by persisted structural evidence.

## Implemented flow

```text
Persisted run events
-> deterministic evidence reducer
-> sequence and obligation checks
-> Evidence Ledger UI
-> explicit proof gaps
-> baseline evaluation fixtures
```

## Code

- `src/lib/canonical/lifecycle.ts`
- `src/lib/engine/evidence-summary.ts`
- `src/lib/evaluation/baseline.ts`
- `src/components/runs/evidence-ledger.tsx`
- `src/components/runs/run-detail.tsx`
- `src/lib/engine/runner.ts`

## Tests and evidence

- `tests/lifecycle.test.ts`
- `tests/evidence-summary.test.ts`
- `tests/evaluation-baseline.test.ts`
- `docs/canonical/evidence/baseline-evaluation.json`
- `docs/canonical/evidence/baseline-evaluation.md`

## Failure scenario proven

A deterministic fixture emits `run.completed` after a tool call without a matching tool result and without step completion. The evidence reducer identifies both `unresolved-tool-call` and `completed-run-with-incomplete-step`; the run is classified as `evidence_incomplete` rather than complete evidence.

## Honest boundary

This slice detects structural evidence gaps and prevents several illegal in-process state transitions. It does not yet provide durable cross-process resume, globally serialized event append, independent verifier identities, or a cryptographically signed evidence bundle.
