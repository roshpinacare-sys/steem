# V33.0 Test Runner Liveness Finding — Resolved by Reproduction

**Severity at discovery:** High  
**Gate:** G0 Truth Baseline  
**Current status:** Resolved / recurrence watch  
**First observed:** 2026-07-21  
**Closed:** 2026-07-21T03:47:09.180832Z

## Initial observation

An initial controlled run produced a complete TAP summary with 1,167 passing tests but appeared not to return control before the surrounding harness timeout. Because a leaked server, worker, socket, timer or child process could invalidate CI and recovery claims, the program correctly treated the observation as a release blocker rather than using `--test-force-exit`.

## Investigation result

No runtime code change was made to manufacture a green result. A reproduction campaign was executed using the canonical runner:

```bash
python3 scripts/run-tests-v32-parallel.py
```

Three consecutive independent runs produced:

| Run | Tests | Passed | Exit | Timeout | Force exit | Wall time |
|---:|---:|---:|---:|---|---|---:|
| 1 | 1167 | 1167 | 0 | false | false | 43049.706 ms |
| 2 | 1167 | 1167 | 0 | false | false | 43024.347 ms |
| 3 | 1167 | 1167 | 0 | false | false | 43347.754 ms |

The complete 24-step `validate:v32.18` campaign subsequently passed, including full regression, 145 authentic mutation checks, binary fuzzing, coverage, test-quality audit, architecture validation, truth mapping and final release validation.

## Separate defect found and corrected

The first full V33 validation attempt failed for a different reason: `GOVERNANCE_VERSION_DRIFT`. V33 overlay registries had been placed inside the historical `governance-state` directory, whose v32.18 invariant correctly requires every record in that namespace to carry version `32.18`.

The correction was architectural rather than permissive:

- V33 overlay registries were moved to `v33/governance-state`.
- The v32.18 truth-map rule was not weakened.
- The truth map and all 24 authoritative validation steps then passed.

## Closure decision

The evidence does not support a persistent open-handle defect. The initial observation is closed as a non-reproduced harness/control anomaly. It must be reopened immediately if a canonical run again completes TAP but fails to return control.

## Closure evidence

- `release-evidence/v33.0/V33_0_G0_CLOSURE.json`
- `evidence/generated/v33-g0-reruns/run-1-results.json`
- `evidence/generated/v33-g0-reruns/run-2-results.json`
- `evidence/generated/v33-g0-reruns/run-3-results.json`
- `evidence/runs/v33-g0-authoritative-2/V32_18_EXECUTION_COMPLETION.json`
- `evidence/runs/v33-g0-authoritative-2/V32_18_FINAL_VALIDATION.json`

## Residual boundary

G0 proves a reproducible local baseline. It does not qualify production, external identity, KMS/HSM, PostgreSQL HA/PITR, multi-host recovery, untrusted workload isolation or human value.
