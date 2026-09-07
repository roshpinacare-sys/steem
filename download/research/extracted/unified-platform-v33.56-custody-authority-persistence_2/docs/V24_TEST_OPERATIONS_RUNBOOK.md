# v24 Test Operations Runbook

## Purpose

Operate the complete v24 test system quickly without weakening release evidence.

## Authoritative release path

```bash
npm ci --ignore-scripts
npm run validate:v24
```

The validator quarantines previous generated evidence, removes build and cache state, rebuilds, executes the complete 52-file inventory, checks coverage, E2E, isolation, recovery, mutation authenticity, test quality, local performance, three-run stability, operational blockers and qualification state.

## Fast developer feedback

```bash
npm run test:impact:v24
```

Impact selection is **not** release authority. Unknown files, package/lock/TypeScript configuration changes and missing baselines fail closed to the full suite. Governance, execution-provenance and operations tests are mandatory sentinels.

## Complete correctness suite

```bash
npm run test:v24
```

The resource-aware scheduler serializes exclusive Linux, repository and loopback resources, imposes lane deadlines, counts executed TAP tests, cleans process groups and forbids `--test-force-exit`. The source inventory must match the scheduled and compiled inventory exactly.

## Performance evidence

```bash
npm run benchmark:v24
npm run profile:tests:v24
```

Run latency measurements outside coverage, mutation, browser and isolation load. A contention result is useful as a stress observation but must not replace the isolated baseline.

## Failure handling

1. Stop promotion on any failed or timed-out lane.
2. Preserve the lane log and generated `IN_PROGRESS` marker.
3. Confirm no tagged process survives.
4. Repair the cause; never reduce test count to regain speed.
5. Rerun the complete validator from clean state.
