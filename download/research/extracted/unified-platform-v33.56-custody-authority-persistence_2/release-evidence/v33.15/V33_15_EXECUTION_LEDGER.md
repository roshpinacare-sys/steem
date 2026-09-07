# V33.15 Execution Ledger

## Executed locally

- Built the repository with TypeScript.
- Ran 16 focused adversarial tests for proof-carrying adaptive execution.
- Created 8 training observations, 4 disjoint holdout observations and 10 shadow comparisons for one low-risk reversible workflow class.
- Issued an independently signed qualification and a separately signed Shortcut Passport.
- Required explicit limited activation with no scope expansion.
- Routed 12 matching requests to qualified shadow mode with zero external effects.
- Introduced toolchain drift, created a signed revocation and verified fallback to the full governed workflow.
- Verified the signed proof artifact with an exported public key.
- Ran the complete authoritative regression using two deterministic lanes with independent exit receipts and no retry or force-exit.
- Regenerated repository truth and architecture evidence from source.

## Observed results

- Focused V33.15 tests: 16/16.
- Direct V33.1–V33.15 path: 250/250.
- Full repository regression: 1,417/1,417.
- Shadow mismatches: 0.
- Authority expansions: 0.
- External effects: 0.
- Drift reason: `TOOLCHAIN_DRIFT`.
- Post-drift route: `FULL_GOVERNED_WORKFLOW`.
- Structural simulated reduction: 76% cost, 82.7% duration, 90% user steps.

## Test topology finding

Adding the adaptive test file to the global concurrency-4 scheduler perturbed historical Git fixture timing and produced a non-deterministic hang. The prior 1,401-test baseline remains at concurrency 4, while the new 16-test adaptive file runs in a separate concurrency-1 lane. Both lanes pass independently. This is not a retry and does not use force-exit.

## Not executed

- A live drift-monitor service.
- More than one workflow class.
- A customer or human workflow study.
- Any external-system shortcut effect.
- Production promotion.
