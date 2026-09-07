# ADR-0040: Isolated per-file test authority

## Status
Accepted.

## Problem
The monolithic Vitest command could finish all assertions while retaining an open handle. A suite that does not terminate cannot be a reliable release authority.

## Alternatives
1. Continue using the monolithic command and ignore the leaked handle.
2. Maintain a manually curated set of test groups.
3. Discover every test file, execute each in a fresh bounded process, require process exit, and aggregate signed machine-readable summaries.

## Decision
Adopt option 3 as the authoritative test gate. The monolithic command remains diagnostic only. Bounded batches may invoke the same isolated runner when an orchestration environment has a short command window.

## Reliability impact
A leaked timer, server, database, worker, or child process fails only its bounded test file and cannot hold the whole release indefinitely.

## Acceptance evidence
- `scripts/run-complete-tests.mjs`
- `scripts/run-safe-tests.mjs`
- `docs/canonical/evidence/v16/full-tests-final/summary.json`
