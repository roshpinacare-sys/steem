# v32.6 Test Operations, Throughput and Scale

## Purpose

v32.6 changes the test operating model rather than weakening the test standard. The goal is to support substantially more tests while keeping developer feedback fast, release evidence authoritative, and heavy environment-bound checks explicit.

## Measured baseline

The v32.5 workspace contained 736 tests in 134 files. On the local qualification host:

- clean TypeScript build: about 5.82 seconds;
- authoritative full test suite at concurrency four: about 21.47 seconds;
- nine historically heavy files represented roughly 39 percent of serial test cost;
- concurrency four was faster than concurrency two, six or eight;
- repeated clean builds and four full stability runs were larger avoidable costs than the test count itself.

The measurements showed that indiscriminate parallelism is not the answer. Higher concurrency increased CPU contention and wall time.

## Four test authorities

### Quick

Impact-selected tests plus mandatory governance sentinels. This is developer feedback only. Unknown changes, global configuration changes or missing history fail closed to the core lane.

Command:

```bash
npm run test:quick:v32.6
```

### Core

All historically sub-1.5-second non-qualification files, plus mandatory sentinels. This is the required pre-merge lane and retains hundreds of tests without live isolation and other expensive boundaries.

```bash
npm run test:core:v32.6
```

### Full

The entire test inventory. This remains authoritative for merge/release evidence.

```bash
npm run test:full:v32.6
```

### Qualification

Live isolation, PostgreSQL and external-qualification boundary tests. These do not disappear; they are separated so they can be scheduled deliberately and diagnosed independently.

```bash
npm run test:qualification:v32.6
```

## Deep gates

Coverage, mutation, stability, browser, DR, supply-chain and external qualification are deep gates. They run on release, nightly schedules, or high-risk changes rather than after every small edit.

## Build policy

Developer lanes use TypeScript incremental compilation. Release validation still begins with a clean build. The incremental path does not make a previous compiled artifact authoritative; it only shortens feedback while the full clean-build gate remains intact.

## Impact selection safety

The selector hashes all source and test inputs, constructs a conservative import graph and adds mandatory sentinels. It escalates to core when:

- there is no prior baseline;
- package, lockfile, TypeScript configuration or test-operation policy changes;
- a changed file is unknown to the graph;
- inventory and compiled outputs do not match.

## Sharding

Shards use longest-processing-time-first balancing based on historical file duration. Resource conflicts such as Linux isolation, loopback web servers and multiprocess SQLite are represented explicitly. Sharding is intended for independent CI workers. Four shards on the same already saturated host are not represented as a speedup.

## Stability

The authoritative full run may count as measured stability sample one only when source digest, Node version, test inventory and runner configuration match exactly. Two additional complete runs are then required. This saves one duplicated full run without reducing the three-sample stability rule.

## Known truth boundary

The new workflow improves local and CI test throughput. It does not qualify PostgreSQL HA, HSM/KMS, independent witness, human value, independent security review or multi-host production SLOs.

## Distributed CI execution

The pull-request workflow builds once, preserves the compiled output as a short-lived workflow artifact, and executes four full-suite shards on independent runners. Each shard report includes its source digest, shard index, shard count, exact selected file list and TAP outcome.

`aggregate-test-shards-v32_6.mjs` rejects the distributed result unless:

- all expected shard indexes are present exactly once;
- all shards declare the same source digest and shard count;
- every expected test file occurs exactly once;
- there are no unknown or duplicate test files;
- every shard passed without timeout or failure.

The aggregate's critical-path time is meaningful only when shards run on independent workers. Sequential shards on one saturated host are useful for correctness validation but are not presented as a performance improvement.

## CI and cache policy

The normal CI lane separates core feedback, distributed full authority and qualification. A second scheduled workflow runs deep assurance. npm dependency caching and TypeScript build-info caching reduce repeat work; caches are optimization inputs only and never substitute for a passing build or test report.


## Automatic shard scaling

`plan-ci-shards-v32_6.py` computes the CI matrix from the current historical serial estimate. The policy targets 25 seconds of estimated serial work per independent shard, clamps the result between two and sixteen workers, and then applies resource-aware LPT balancing. The current profile recommends four shards with planning efficiency above 99 percent. As the test inventory grows, the matrix expands without editing workflow YAML; it contracts again when the profile becomes smaller.


## Deep-lane deduplication

The scheduled workflow does not run the legacy complete validator before the v32.6 validator. v32.6 already proves build, full inventory, coverage, quality, architecture, mutation and three-sample stability. The scheduled workflow adds only non-overlapping credential, supply-chain, DR, browser, isolation, PostgreSQL-honesty, operations and qualification gates. This prevents duplicate full suites and duplicate stability runs.
