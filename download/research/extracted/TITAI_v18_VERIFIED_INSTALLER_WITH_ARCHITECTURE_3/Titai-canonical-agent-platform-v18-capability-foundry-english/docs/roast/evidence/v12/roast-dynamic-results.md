# v12 Dynamic Roast Results

Generated: 2026-07-11T18:02:40.813Z

Six-mode repeatable dynamic roast. Passing proves only the commands and properties listed; it is not a production certification.

Result: **6/6 passed, 0 failed, 0 blocked.**

| Mode | Status | Duration ms | Command |
|---|---|---:|---|
| Runtime behavior roast | PASS | 4372 | `npx vitest run tests/durable-step-runner.test.ts tests/durable-fencing.test.ts tests/model-router.test.ts tests/memory-ablation.test.ts tests/risk-adjusted-autonomy.test.ts tests/pilot-readiness.test.ts --maxWorkers=2` |
| Recovery roast | PASS | 1124 | `npm run durable:prove` |
| Security roast | PASS | 4429 | `npx vitest run tests/authorization.test.ts tests/tool-capability.test.ts tests/tool-runtime.test.ts tests/egress.test.ts tests/memory-ablation.test.ts tests/verification-attestation.test.ts --maxWorkers=2` |
| Product and operator-truth roast | PASS | 3613 | `npx vitest run tests/evidence-summary.test.ts tests/pilot-readiness.test.ts tests/accessibility-contract.test.ts --maxWorkers=2` |
| Release integrity roast | PASS | 1433 | `npm run release:audit` |
| Deterministic performance roast | PASS | 2763 | `npx tsx --tsconfig tsconfig.scripts.json scripts/benchmark-v12.ts` |

## Runtime behavior roast

Status: **PASS**

```text

[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90m/mnt/data/titai_v18_work/repo[39m

 [32m✓[39m tests/model-router.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 26[2mms[22m[39m
 [32m✓[39m tests/durable-step-runner.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m tests/memory-ablation.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 10[2mms[22m[39m
 [32m✓[39m tests/pilot-readiness.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 5[2mms[22m[39m
 [32m✓[39m tests/durable-fencing.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m tests/risk-adjusted-autonomy.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 5[2mms[22m[39m

[2m Test Files [22m [1m[32m6 passed[39m[22m[90m (6)[39m
[2m      Tests [22m [1m[32m19 passed[39m[22m[90m (19)[39m
[2m   Start at [22m 18:02:24
[2m   Duration [22m 2.15s[2m (transform 398ms, setup 0ms, collect 746ms, tests 65ms, environment 2ms, prepare 1.00s)[22m


```

## Recovery roast

Status: **PASS**

```text

> titai@2.2.0-canonical-v18-capability-foundry durable:prove
> tsx --tsconfig tsconfig.scripts.json scripts/prove-durable-vertical-slice.ts

{
  "result": "verified",
  "injectedCrashObserved": true,
  "sideEffectCount": 1,
  "attempts": 2,
  "evidenceHash": "ce53954ab779c7f4476f3ce6313158759d4dc9d4ed8c809319cbe30eb09fa978",
  "report": "/mnt/data/titai_v18_work/repo/docs/canonical/evidence/durable-vertical-slice.json"
}

```

## Security roast

Status: **PASS**

```text

[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90m/mnt/data/titai_v18_work/repo[39m

 [32m✓[39m tests/tool-runtime.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 14[2mms[22m[39m
 [32m✓[39m tests/verification-attestation.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m tests/egress.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 30[2mms[22m[39m
 [32m✓[39m tests/memory-ablation.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 9[2mms[22m[39m
 [32m✓[39m tests/authorization.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32m✓[39m tests/tool-capability.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m

[2m Test Files [22m [1m[32m6 passed[39m[22m[90m (6)[39m
[2m      Tests [22m [1m[32m19 passed[39m[22m[90m (19)[39m
[2m   Start at [22m 18:02:30
[2m   Duration [22m 2.18s[2m (transform 332ms, setup 0ms, collect 559ms, tests 82ms, environment 2ms, prepare 1.11s)[22m


```

## Product and operator-truth roast

Status: **PASS**

```text

[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90m/mnt/data/titai_v18_work/repo[39m

 [32m✓[39m tests/evidence-summary.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 8[2mms[22m[39m
 [32m✓[39m tests/pilot-readiness.test.ts [2m([22m[2m3 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32m✓[39m tests/accessibility-contract.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 6[2mms[22m[39m

[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m11 passed[39m[22m[90m (11)[39m
[2m   Start at [22m 18:02:34
[2m   Duration [22m 1.39s[2m (transform 157ms, setup 0ms, collect 230ms, tests 20ms, environment 1ms, prepare 477ms)[22m


```

## Release integrity roast

Status: **PASS**

```text

> titai@2.2.0-canonical-v18-capability-foundry release:audit
> node scripts/audit-release.mjs

Release audit passed: canonical integrity, language policy, exclusions, and credential checks are clean.

```

## Deterministic performance roast

Status: **PASS**

```text
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-11T18:02:40.737Z",
  "environment": {
    "node": "v22.16.0",
    "platform": "linux",
    "arch": "x64"
  },
  "disclaimer": "Deterministic local microbenchmarks. They are not production load tests and do not measure model or network latency.",
  "results": [
    {
      "name": "validate_30_step_dag",
      "iterations": 1000,
      "p50Ms": 0.0672,
      "p95Ms": 0.3139,
      "p99Ms": 0.6236,
      "maxMs": 3.0002,
      "meanMs": 0.104
    },
    {
      "name": "route_24_model_candidates",
      "iterations": 2000,
      "p50Ms": 0.0297,
      "p95Ms": 0.0704,
      "p99Ms": 0.136,
      "maxMs": 1.0274,
      "meanMs": 0.0399
    },
    {
      "name": "govern_200_memory_candidates",
      "iterations": 500,
      "p50Ms": 1.484,
      "p95Ms": 2.37,
      "p99Ms": 2.9584,
      "maxMs": 6.76,
      "meanMs": 1.6399
    }
  ]
}

```
