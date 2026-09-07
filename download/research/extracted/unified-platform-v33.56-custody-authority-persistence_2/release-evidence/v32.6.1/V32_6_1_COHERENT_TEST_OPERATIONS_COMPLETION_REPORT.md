# v32.6.1 — Coherent Scalable Test Operations Closure

## Verdict

The independent audit findings were converted into executable controls and closed. The final isolated run is **passed** and all local evidence is bound to one six-part execution identity. Production promotion remains blocked because PostgreSQL HA/PITR, multi-host SLOs and independent external qualification were not executed.

## Final identity

- Source: `301b48139f7ffcb357c0a27fd57bf2c690c2c5e1a89377d827f5e4f4ca407386`
- Compiled artifact: `4220aa493f6f2fbffd2e76d4a0be3ed93ca667b317dbf94a6cde41ef073a6b4f`
- Test manifest: `44283ef7a1aac6529db8015249f63482a286a637771d73dbc80c58de58664790`
- Test files: `214281a40c3493ddda91b0b3c61f76baa3b8863fc301c3c195523708c74935af`
- Package lock: `48b2f8b2aa143a66055a2cd416e7daf976141752516dd949b5392472835cd755`
- Environment: `b10bbc128c623ce9654a865fd7dcf88ccf2ac5e00fb0ca05869735b6906ac88b`

## Test lanes

| Lane | Tests | Wall time | Authority |
|---|---:|---:|---|
| Quick | 39 | 1.78s | Developer feedback; all mandatory sentinels; cannot advance baseline |
| Core | 641 | 8.55s | Commit/merge feedback |
| Full | 758 | 22.31s | Authoritative correctness and lifecycle |
| Qualification | 36 | 3.89s | Boundary/qualification lane |

- Coverage: 99.44% lines, 96.02% branches, 98.82% functions.
- Test-operations mutation: 13/13 authentic kills, zero survivors and zero invalid kills.
- Stability: three complete Full runs, zero flakes, CV 1.24%.
- Architecture: 57/57 capability paths closed, zero source cycles and zero untested source modules.

## Distributed proof

Four shards covered every one of the 135 test files exactly once. They passed 758/758 tests with a local critical path of 5.92s. The aggregator verified all six identity digests, exact indexes, unique inventory, no gaps and no unexpected files.

## Measured improvement versus v32.5 baseline

- Quick feedback reduction: 87.92%.
- Core feedback reduction: 63.11%.
- Full feedback reduction: 12.71%.

## Independent-audit findings closed

1. **Mixed evidence:** replaced by isolated run directories and one immutable six-part execution identity.
2. **Invalid mutation proof:** replaced by a green baseline sandbox, complete fixtures, authentic failure markers and process-group cleanup.
3. **Subprocess dependencies missing from Quick:** worker/script path dependencies are now included; Quick cannot write the authoritative impact baseline.
4. **Mandatory sentinel omitted by tiering:** mandatory sentinels now override tier classification; Quick includes all four.
5. **Profiler distortion:** queue wait and execution wall time are reported separately; planning uses execution cost.
6. **Shard artifact ambiguity:** every shard and the aggregator bind the compiled-artifact digest in addition to source and inventory.
7. **Volatile source manifest:** evidence run directories and cache outputs no longer change source identity while tests are running.
8. **WASM false timeout under contention:** worker startup and capability execution now have separate timeout budgets.

## Deep assurance

- Credential sovereignty mutation: 16/16 authentic kills.
- Supply chain: passed; 0 known npm vulnerabilities in the report.
- Local DR: passed; tampering rejected. This is a single-host file rehearsal, not PostgreSQL PITR.
- Browser E2E: passed with 15 checks.
- Linux isolation: passed as a single-host research proof with 12 checks; not production-qualified.
- PostgreSQL: **environment-blocked** because `psql` and a disposable PostgreSQL 16 qualification database were unavailable. This is not a PostgreSQL HA/PITR pass.

## Truth boundary

- Classification: **Validated Integrated Pilot**.
- External qualification: **NOT_EXECUTED**.
- Production promotion: **BLOCKED**.
- Multi-host performance and revocation SLOs: **NOT_MEASURED**.
