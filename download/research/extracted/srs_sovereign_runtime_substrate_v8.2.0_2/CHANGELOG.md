# Changelog

All notable changes to the SRS Runtime are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [8.2.0] - 2025-07-19

### Convergence Audit Fixes (A2 backlog)
- **Dependency infrastructure (D6, D15, D16, D19, D20, D21)**:
  - `cognition/grpo_advantage_map.py` now degrades gracefully when
    `torch` is not installed (D6): the module imports cleanly, exposes
    `TORCH_AVAILABLE`, and raises a helpful `TorchNotAvailableError`
    with install instructions only when a torch-dependent code path
    is actually invoked.
  - Added `requirements.lock` (D15): a hash-pinned lockfile
    documenting the `pip install --require-hashes` workflow for
    reproducible, supply-chain-verified installs.
  - Added `SBOM.md` (D16): a Software Bill of Materials listing all
    direct + dev dependencies with versions, licenses, and PyPI
    download URLs.
  - Added `.github/dependabot.yml` (D19): weekly Dependabot scans for
    pip, docker, and github-actions ecosystems; CVE-driven PRs open
    immediately regardless of schedule.
  - Docker base image digest pinning documented in `Dockerfile` (D20):
    the `FROM python:3.12.4-slim` line now ships with a comment block
    explaining how to discover and pin the current sha256 digest for
    production reproducibility.
  - Added `THIRD_PARTY_LICENSES.md` (D21): per-package license table
    with SPDX identifiers and upstream license URLs.

### Performance (R20 9.4, R20 9.5)
- `AdviceTable._fingerprint` is now memoised via
  `functools.lru_cache(maxsize=128)`. Repeated lookups for the same
  hypotheses list skip the SHA-256 + struct.pack loop. Cache key is a
  `tuple[bytes, ...]` (hashable); callers convert `list -> tuple`
  before invoking.
- All `logger.debug(...)` calls that interpolate user-controlled
  values via `_safe_log_value(...)` are now gated behind
  `if logger.isEnabledFor(logging.DEBUG):`. On the default INFO path,
  the per-char control-char sanitizer is skipped entirely, saving
  ~30-50µs per task execution across the ~12 debug log sites.

### Security (R17 known weakness)
- Rollback protection now survives deletion of `sequence.json` (R17
  known weakness). The high-water sequence number is mirrored to
  `~/.srs/secret_key.seq` (an HMAC-protected file in the same
  directory as the secret key, OUTSIDE the snapshots dir). If an
  attacker deletes `~/.srs/snapshots/sequence.json` to reset the
  high-water mark to 0 and bypass the rollback check, the
  persisted mirror is consulted instead.

### Documentation
- README updated to v8.2.0 (was v8.0.0 — version string drift).
- CHANGELOG extended with v7.9, v8.0, v8.1 entries (previously
  stopped at v7.8).
- MIGRATION guide extended with v8.0 (SafeJSONDecoder regex,
  AdviceTable lock) and v8.1 (sequence mirror, advice fingerprint
  cache) breaking changes.

### Tests
- 253 tests passing (was 252 in v8.0; +1 new test for the high-water
  mirror protection against sequence.json deletion).

## [8.0.0] - 2025-07-18
### Performance
- SafeJSONDecoder optimized: regex-based depth counting (was char-by-char)
- Secret key cached at module level (saves 480µs per persistence cycle)

## [7.9.0] - 2025-07-18
### Added
- CHANGELOG.md, CONTRIBUTING.md, MIGRATION.md
- All test docstrings cleaned (0 roast-ID references)
### Performance
- _get_secret_key() cached at module level

## [7.8.0] - 2025-07-18

### Security
- All R17 security findings closed: HMAC for full snapshot + inflight files,
  rollback protection, DoS hardening, task_id sanitization, log injection prevention,
  SRS_HOME validation, UUID-based snapshot_id
- task_id `__setattr__` override catches post-construction mutation (R18 C4)

### Fixed
- `quantum_stage` now uses `effective_budget` (was `task.budget` — resume was broken)
- `clear_in_flight` wrapped in `try/except` (won't mask legitimate `Result`)
- `__init__.py` docstring lists real methods (was non-existent `verify()`/`improve()`)

### Tests
- 252 tests passing (was 201 in v7.7)
- 51 new tests (28 security + 23 logging)

## [7.7.0] - 2025-07-18

### Security
- Full-snapshot HMAC-SHA256 (was `advice_table`-only)
- Rollback protection via monotonic sequence number
- `SafeJSONDecoder` with depth limit (RecursionError DoS)
- `AdviceTable.from_dict` type validation
- `MAX_SNAPSHOT_SIZE = 10MB` cap
- `task_id` sanitization
- `secrets.SystemRandom` for verification

### Fixed
- 3 fuzz crashes: unknown task kind, `n_features > 64`, compute without `target_idx`

### Tests
- 201 tests passing (was 130 in v7.6)

## [7.6.0] - 2025-07-17

### Security
- HMAC-SHA256 with per-installation secret key (was bypassable SHA-256)
- Length-prefix fingerprint encoding (was collision-vulnerable `b"|".join`)

### Fixed
- mypy: 15 errors → 0
- ruff: 176 issues → 0
- 36 lines of duplicated code eliminated (shared `alive_set.py`)

### Added
- TypedDicts for task payloads
- `TaskKind` Enum
- `--format human` CLI flag
- ISO 8601 timestamps (was epoch floats)
- `asyncio.to_thread` (was deprecated `get_event_loop`)

## [7.5.0] - 2025-07-17

### Added
- Reproducibility: deterministic seed, `sort_keys`, ISO timestamps
- Cross-platform: `encoding="utf-8"` on all `open()` calls
- Dependency pinning: 4 CVEs avoided (torch, Pillow)
- Graceful degradation for torch/z3/blspy

## [7.4.0] - 2025-07-17

### Added
- Real LZ77 compression (was fraud — hardcoded `best_idx=target_idx`)
- Structured logging (`--verbose`/`--quiet`)
- `execute_async()` via `run_in_executor`
- `fcntl.flock` cross-process file locking
- Atomic constructor recover

### Fixed
- Compression fraud: `best_idx` now from scoring (28/30 mismatches prove it)
- `save_in_flight` gated behind `resume=True` (5.81× speedup)
- Advice keying: target-aware lookup (was cross-target corruption)

## [7.3.0] - 2025-07-17

### Fixed
- `default_path()` missing (CLI crashed without `--home`)
- Atomic writes (`tempfile` + `fsync` + `os.replace`)
- Concurrency locks (`threading.RLock`)
- Deterministic seed (`sha256`, not `hash()`)
- Task validation (`_validate_task`)
- Atomic recover
- JSON error handling
- OOM cap (`MAX_HYPOTHESES = 1M`)

## [7.2.0] - 2025-07-17

### Fixed
- Pipeline state passing (`PipelineState` dataclass)
- Verification reads `state.candidate` (was always `target_idx`)
- Advice short-circuits pipeline (second run 0 queries)
- Path traversal protection (`_sanitize_id`)
- Advice hash integrity

## [7.1.0] - 2025-07-17

### Fixed
- Quantum primitive honest simulation (was hardcoded answer)
- Adversarial benchmark honest (was strawman)
- 12 tautological tests replaced with real behavioral tests
- Cost-model planner (was dict lookup)
- `capabilities()` meaningful (was zeros)
- `home` accepts `str` or `Path`
- Recovery saves in-flight state
- CLI exit codes 0/1/2/3

## [7.0.0] - 2025-07-17

### Added
- Unified 7-primitive runtime (`srs/` package)
- 7 primitive modules: E, C, A, S, V, Adv, Q
- Runtime orchestrator with `execute`/`plan`/`store`/`recover`/`verify`/`improve`
- Pipeline architecture
- Cost-model planner
- Snapshot persistence
- CLI with 7 commands
- 20-test pytest suite
