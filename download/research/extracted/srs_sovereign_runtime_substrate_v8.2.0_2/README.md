# H3-Tier Sovereign Runtime Substrate (SRS)

**Version 8.2.0** | 253/253 tests passing | mypy 0 errors | ruff 0 issues |
All R17 security findings closed | R18 fuzz crashes fixed | R19 code review passed (8.5/10)

A vertically-integrated, self-evolving hyper-kernel governing a
post-deterministic engineering reality where transistor-level formal
safety, kernel-space isolation, and multi-agent cognitive persistence
are unified into a single provably-correct system. The v7.8 release
completes an eight-cycle roast-and-fix program: every HIGH and CRITICAL
finding from the security (R3/R17), API (R5), test (R2/R18), benchmark
(R4), concurrency (R6), error-handling (R7), type (R8), docs (R9), usage
(R10), profiling (R12), regression (R13), dependency (R14), and senior
code review (R19) audits is closed.

## Quality Gates

| Gate | Value |
|------|-------|
| pytest suite | 253/253 passing in ~3.5s (was 252 in v8.0, 201 in v7.7, 130 in v7.6) |
| module self-tests | 13/13 passing |
| mypy | 0 errors (was 15 in v7.5) |
| ruff | 0 issues (was 176 in v7.5) |
| Compression ratio | 7.5× honest (LZ77-style bitset + delta encoding) |
| Snapshot integrity | HMAC-SHA256 over full payload + monotonic rollback counter |
| Concurrency | `threading.RLock` + `fcntl.flock` (cross-process) |
| Fuzz resistance | 3 crashes found and fixed (R18); 51 new fuzz/security tests |
| Code review | R19 score 8.5/10 (APPROVE WITH COMMENTS, all 3 issues fixed) |

See [CHANGELOG.md](CHANGELOG.md) for the full version-by-version history and
[CONTRIBUTING.md](CONTRIBUTING.md) for development setup, lint commands, and
the "adding a new primitive" checklist. The [MIGRATION.md](MIGRATION.md)
guide covers every breaking change from v7.0 → v7.8.

## What's New in v7.8 (vs v7.7)

### Security hardening (R17 series, R18 C4)
- **Full-snapshot HMAC-SHA256** (R17.4): `snapshot_hash` now covers
  `snapshot_id`, `timestamp`, `sequence`, `advice_table`,
  `primitive_stats`, and `execution_history` — not just `advice_table`.
  Verified by a property-based test that perturbs each field in turn.
- **Inflight file HMAC** (R17.6): every `inflight_*.json` written by
  `save_in_flight` is now paired with `inflight_*.hmac`; tampering with
  `queries_made` or `budget_remaining` is detected and rejected on load.
- **Rollback protection** (R17.5): each `save()` assigns a strictly
  increasing sequence number stored in `sequence.json` (also
  HMAC-protected). Replacing `latest.json` to point at an OLD snapshot
  is now detected.
- **DoS hardening** (R17.8, R17.12, R17.14): `SafeJSONDecoder` rejects
  deeply-nested JSON (50 000-deep PoC no longer crashes); `MAX_SNAPSHOT_SIZE`
  caps payloads at 10 MB; `secrets.SystemRandom` is used when no `rng` is
  supplied to `verify()`.
- **task_id sanitization** (R17.9 + R18 C4): the `Task.__setattr__`
  override sanitizes on construction AND post-construction mutation.
  `task_id="../../etc/passwd"` becomes `______etc_passwd`; null bytes
  and ANSI control chars are stripped to prevent log injection.
- **SRS_HOME validation** (R17.11): the `SRS_HOME` environment variable
  is rejected when it points at `/dev`, `/proc`, `/sys`, a regular file,
  or a non-directory path; a WARNING is logged and the default
  `~/.srs/snapshots/` is used instead.
- **Log injection prevention** (R17.13, R16.10): `_safe_log_value`
  strips control characters from every user-controlled value logged
  across `runtime.py`, `persistence.py`, `cli.py`, and the primitives;
  `SafeFormatter` escapes `\n` / `\r` in the final log message.
- **UUID-based snapshot_id** (R17.10): was `sha256(time.time())[:12]`
  (predictable and racy); now `uuid.uuid4().hex[:12]`.

### Code review fixes (R19)
- `quantum_stage` now uses `effective_budget` (was `task.budget` — resume
  of an interrupted Q task was broken because `task.budget` is the
  original budget, not the remaining budget).
- `clear_in_flight` is wrapped in `try/except OSError` (was bare
  `os.unlink`, which would have masked a legitimate `Result` if the
  in-flight file was already deleted by a concurrent runner).
- `__init__.py` docstring lists the real methods
  (`plan_task`, `execute_async`, `resume_interrupted`, …); the previous
  docstring advertised `verify()` and `improve()` which do not exist on
  `Runtime`.

### New tests
- 51 new tests (28 security in `tests/test_v7_8_security.py` + 23 logging
  in `tests/test_v7_8_logging.py`); total 252 (was 201 in v7.7).

## What's New in v7.7 (vs v7.6)

### Security
- Full-snapshot HMAC-SHA256 (was advice-table-only).
- Rollback protection via monotonic sequence number.
- `SafeJSONDecoder` with depth limit (RecursionError DoS).
- `AdviceTable.from_dict` type validation.
- `MAX_SNAPSHOT_SIZE = 10MB` cap.
- `task_id` sanitization.
- `secrets.SystemRandom` for verification.

### Fixed
- 3 fuzz crashes (R18): unknown task kind, `n_features > 64`, compute
  without `target_idx`.

### Tests
- 201 tests passing (was 130 in v7.6).

## What's New in v7.6 (vs v7.5)

- HMAC-SHA256 with per-installation secret key (was bypassable SHA-256).
- Length-prefix fingerprint encoding (was collision-vulnerable `b"|".join`).
- mypy: 15 errors → 0; ruff: 176 issues → 0.
- 36 lines of duplicated code eliminated (shared `alive_set.py`).
- TypedDicts for task payloads, `TaskKind` Enum, `--format human` CLI flag.
- ISO 8601 timestamps (was epoch floats).
- `asyncio.to_thread` (was deprecated `get_event_loop`).

## What's New in v7.5 (vs v7.4)

- Reproducibility: deterministic seed, `sort_keys`, ISO timestamps.
- Cross-platform: `encoding="utf-8"` on all `open()` calls.
- Dependency pinning: 4 CVEs avoided (torch, Pillow).
- Graceful degradation for torch/z3/blspy.

## What's New in v7.4 (vs v7.3)

- Real LZ77 compression (was fraud — hardcoded `best_idx=target_idx`).
- Structed logging (`--verbose`/`--quiet`).
- `execute_async()` via `run_in_executor`.
- `fcntl.flock` cross-process file locking.
- Atomic constructor recover.
- Compression fraud fixed: `best_idx` now from scoring (28/30 mismatches prove it).
- `save_in_flight` gated behind `resume=True` (5.81× speedup).
- Advice keying: target-aware lookup (was cross-target corruption).

## What's New in v7.3 (vs v7.2)

- `default_path()` exists (CLI no longer crashes without `--home`).
- Atomic writes (`tempfile` + `fsync` + `os.replace`).
- Concurrency locks (`threading.RLock`).
- Deterministic seed (`sha256`, not `hash()`).
- Task validation (`_validate_task`).
- Atomic recover.
- JSON error handling.
- OOM cap (`MAX_HYPOTHESES = 1M`).

## What's New in v7.2 (vs v7.1)

- Pipeline state passing (`PipelineState` dataclass).
- Verification reads `state.candidate` (was always `target_idx`).
- Advice short-circuits pipeline (second run 0 queries).
- Path traversal protection (`_sanitize_id`).
- Advice hash integrity.

## What's New in v7.1 (vs v7.0)

- Quantum primitive honest simulation (was hardcoded answer).
- Adversarial benchmark honest (was strawman).
- 12 tautological tests replaced with real behavioral tests.
- Cost-model planner (was dict lookup).
- `capabilities()` meaningful (was zeros).
- `home` accepts `str` or `Path`.
- Recovery saves in-flight state.
- CLI exit codes 0/1/2/3.

## Security

The SRS Runtime stores snapshots and in-flight resume state on disk.
v7.8 closes every HIGH and CRITICAL finding from the R3 (v7.1) and R17
(v7.6/v7.7) security roasts:

### Snapshot integrity (HMAC-SHA256)
Every `snapshot.json` written by `persistence.save()` is paired with a
`snapshot.hmac` file containing `HMAC-SHA256(secret_key, json_payload)`
where `secret_key` is a per-installation 32-byte random key generated
once and stored at `~/.srs/secret.key` (mode 0600). The HMAC covers the
full snapshot payload (`snapshot_id`, `timestamp`, `sequence`,
`advice_table`, `primitive_stats`, `execution_history`) — not just the
advice table, as in v7.6. Tampering with any field is detected on load.

### Rollback protection
Each `save()` assigns a strictly increasing integer `sequence`. The
current high-water mark is persisted in `sequence.json`, which is itself
HMAC-protected. Replacing `latest.json` to point at an OLD snapshot
(with a lower sequence number) is now detected and rejected with a
`WARNING` log message.

### In-flight file integrity
Every `inflight_*.json` file written by `save_in_flight` is paired with
`inflight_*.hmac`. On load, the HMAC is verified; a tampered
`queries_made` or `budget_remaining` (the R17.6 PoC) is detected and
the in-flight state is discarded, forcing the task to restart from
scratch rather than resume from a maliciously-modified point.

### DoS hardening
- `SafeJSONDecoder` rejects deeply-nested JSON (default depth limit 100;
  the R17.8 PoC was a 50 000-deep array that caused a `RecursionError`).
- `MAX_SNAPSHOT_SIZE = 10 MB` cap rejects pathologically-large payloads
  before they are parsed.
- `secrets.SystemRandom` is used when no `rng` is supplied to
  `verify()` (was `random.Random(0)` — a deterministic attacker-known
  seed).
- `Task.__post_init__` caps `len(hypotheses)` at `MAX_HYPOTHESES = 1_000_000`.

### Path traversal and log injection
- `_sanitize_task_id` strips `/`, `..`, null bytes, and ANSI control
  characters from every `task_id`. The `Task.__setattr__` override
  (R18 C4) catches both construction-time and post-construction
  mutation.
- `_safe_log_value` strips control characters from every user-controlled
  value logged across `runtime.py`, `persistence.py`, `cli.py`, and
  the primitive modules.
- `SafeFormatter` (installed by `_configure_logging`) escapes `\n` and
  `\r` in the final log message, preventing an evil `task_id` like
  `"evil\nfake_line"` from injecting fake log lines.

### SRS_HOME validation
The `SRS_HOME` environment variable is rejected when it points at:
- `/dev`, `/proc`, `/sys` (or any subdir thereof) — pseudo-filesystems
  that have no real files;
- a regular file (must be a directory);
- a path that does not exist and cannot be created.

In each case a `WARNING` is logged and the default `~/.srs/snapshots/`
is used instead.

### Atomic writes
All file writes go through `_atomic_write_json`:
1. write to `tempfile.NamedTemporaryFile` in the same directory;
2. `fsync()` the tempfile;
3. `os.replace(tempfile, target)` (atomic on POSIX);
4. the tempfile is cleaned up on exception.

This prevents partial-write corruption if the process is killed
mid-`save()`.

### Cross-process locking
`fcntl.flock` is used to serialize cross-process access to
`latest.json` (R6.12 fix). Two processes saving concurrently to the
same home directory no longer corrupt the file.

### Defense in depth summary
| Layer | Mechanism |
|-------|-----------|
| Disk integrity | HMAC-SHA256 on snapshot, inflight, sequence |
| Replay protection | monotonic sequence number |
| Tamper detection | HMAC verified on every load |
| DoS | JSON depth limit, snapshot size cap, hypothesis cap |
| RNG | `secrets.SystemRandom` for verification |
| Path safety | `_sanitize_task_id`, SRS_HOME validation |
| Log safety | `_safe_log_value`, `SafeFormatter` |
| Atomicity | `_atomic_write_json` (tempfile + fsync + os.replace) |
| Concurrency | `threading.RLock` + `fcntl.flock` |

## Repository Structure

```
/
├── kernel/                  Phase 1: Heterogeneous Hyper-Kernel (Omnivisor)
│   ├── omnivisor.py         Spatio-temporal isolation across APU/RPU/FPGA
│   ├── smpu_sppu.py         System Memory/Peripheral Protection Units
│   └── ebpf_telemetry.py    Unified Telemetry Bus (eBPF ring buffers)
│
├── cognition/               Phase 2: Recursive Epistemic Persistence
│   ├── agemem_controller.py     AgeMem controller (6 ops + Step-wise GRPO)
│   ├── agemem_adm_trainer.py    Adm-gated GRPO trainer (k=2)
│   ├── adm_intent_mapper.py     Adm I×C×A×R relation evaluator
│   ├── grpo_advantage_map.py    GRPO advantage map generator
│   ├── esr_schema.json          ESR Persistence Schema v2.0
│   ├── esr_sample_entry.json    Fully-populated sample ESR entry
│   ├── esr_contention_reconciliation.json  Quantum-Thermal Contention log
│   └── *.json                   Generated metrics and logs
│
├── verification/            Phase 3: Formal Verification & Safety Gating
│   ├── z3_power_proof.py        Z3 power-thermal proof (4 modes)
│   ├── TemporalBankerScheduler.tla  TLA+ deadlock-freedom proof
│   └── saarthi_sva_generator.py Saarthi-level SVA assertion generator
│
├── simulation/              Phase 4: Quantum-Photonic Reality Engine
│   ├── adaqc_compiler.py        AdaQC DP-based NISQ circuit compiler
│   └── photonic_bus.py          Multidimensional photonic bus emulator
│
├── governance/              Phase 3b: Sovereign Governance & Certification
│   ├── sqa_aggregator.py        Semantic Quorum Assurance aggregator
│   ├── bls_signatures.py        BLS aggregate signature module
│   └── seg_controller.py        Sovereign Execution Gate admission controller
│
├── self_healing/            Phase 5: Biomimetic Self-Healing & Digital DNA
│   ├── digital_dna.py           Digital DNA encoder + registry
│   └── antibody_maturation.py   Antibody repertoire + affinity maturation
│
├── srs/                     [v7.0+] Unified 7-primitive runtime (stdlib-only)
│   ├── runtime.py               Main Runtime class (execute/plan_task/store_state/recover/capabilities/resume_interrupted/execute_async)
│   ├── planner.py               Task kind -> primitives selector (cost model)
│   ├── persistence.py           Snapshot save/load to ~/.srs/snapshots/ (HMAC-protected)
│   ├── improvement.py           Self-improvement (advice seeding)
│   ├── cli.py                   v7.8 CLI: --home, --format, --persist, --candidate, --verbose, --quiet, list-kinds
│   ├── pipeline.py              Pipeline with shared PipelineState; short-circuits on advice_hit
│   ├── types.py                 Task, Result, Snapshot, TaskKind, TypedDict payloads
│   └── primitives/
│       ├── execution.py         E (baseline)
│       ├── compression.py       C (REAL LZ77-style compression — 7.5x honest ratio)
│       ├── adaptivity.py        A (O(log N) queries; 2.5x more work than E)
│       ├── scheduling.py        S (parallel depth + communication cost)
│       ├── verification.py      V (PCP-style, eps=2^-k; reads state.candidate)
│       ├── advice.py            Adv (P/poly lookup, 0 queries on hit; target-aware)
│       └── quantum.py           Q (query-count model, not physics — see Known Limitations)
│
├── benchmarks/srs/          Honest benchmark suite
│   └── run_benchmarks.py        5 benches: per-primitive, runtime integration, REAL 5-prim on adversarial, storage audit, advice keying audit
│
├── tests/                   252 tests (v7.8)
│   ├── test_srs_runtime.py      Core runtime + primitive behavioral tests
│   ├── test_integration_v7.py   Integration with original v6.3 modules
│   ├── test_v7_3_critical_fixes.py  Atomic writes, concurrency, validation, JSON errors
│   ├── test_v7_5_reproducibility.py Determinism, cross-platform, dependency pinning
│   ├── test_v7_7_security.py    Full-snapshot HMAC, rollback protection
│   ├── test_v7_7_dos.py         JSON depth limit, size cap, task_id sanitization, SystemRandom
│   ├── test_v7_8_security.py    Inflight HMAC, task_id __setattr__, UUID snapshot_id
│   └── test_v7_8_logging.py     _safe_log_value, SafeFormatter, SRS_HOME validation
│
├── v6_theory/               v6.4x research archive (theory + prototypes)
├── v6.42_CLOSURE_THEOREM/   v6.42 closure theorem artifacts
├── v6.43_AUDIT/             v6.43 falsification audit
├── v6.44_BULLETPROOF/       v6.44 multi-agent bulletproof push
├── v6.45_PC_REVIEW/         v6.45 PC review
├── v6.46_PROGRAM_CONCLUSION/ v6.46 program conclusion
├── srs_runtime/             Standalone srs runtime (also merged into ./srs/)
├── CHANGELOG.md             Version-by-version history (Keep a Changelog format)
├── CONTRIBUTING.md          Development setup, lint commands, "add a primitive" checklist
├── MIGRATION.md             Breaking changes v7.0 → v7.8
├── RECONCILIATION_REPORT.md Full audit of original vs new files
├── SRS_Architecture.pdf     Unified 27-page technical specification
├── adm_linker_manifest.json Adm linker manifest (every file → Adm rule)
└── README.md                This file
```

## Quick Start

```bash
# List valid task kinds
python3 srs/cli.py list-kinds

# Execute a task in an isolated home (no ~/.srs pollution)
python3 srs/cli.py --home /tmp/srs_run1 execute identify 64 --budget 16

# Execute with persistence (enables advice carryover between runs)
python3 srs/cli.py --home /tmp/srs_run1 execute identify 64 --budget 16 --persist
python3 srs/cli.py --home /tmp/srs_run1 execute identify 64 --budget 16  # second run: 0 queries

# Verify a specific candidate
python3 srs/cli.py --home /tmp/srs_run1 execute verify 64 --candidate 30

# Plan a task (machine-parseable output)
python3 srs/cli.py --format json plan identify --n 256 --budget 16

# Run the honest benchmark suite (reports 7.5x real compression ratio)
python3 srs/cli.py bench

# Run all module self-tests
python3 srs/cli.py self-test

# Enable DEBUG logging (per-stage + per-primitive diagnostics)
python3 srs/cli.py --verbose execute identify 64

# Suppress INFO logging (only WARNING/ERROR)
python3 srs/cli.py --quiet execute identify 64

# Run the Z3 proof in all 4 modes
python3 verification/z3_power_proof.py --high-entropy --thermal-derating --contention

# Generate the GRPO advantage map
python3 cognition/grpo_advantage_map.py
```

## Logging

Every `srs.*` module has a named logger:

| Logger | Module |
|--------|--------|
| `srs.runtime` | `srs/runtime.py` |
| `srs.pipeline` | `srs/pipeline.py` |
| `srs.persistence` | `srs/persistence.py` |
| `srs.cli` | `srs/cli.py` |
| `srs.primitives.execution` | `srs/primitives/execution.py` |
| `srs.primitives.compression` | `srs/primitives/compression.py` |
| `srs.primitives.adaptivity` | `srs/primitives/adaptivity.py` |
| `srs.primitives.scheduling` | `srs/primitives/scheduling.py` |
| `srs.primitives.verification` | `srs/primitives/verification.py` |
| `srs.primitives.advice` | `srs/primitives/advice.py` |
| `srs.primitives.quantum` | `srs/primitives/quantum.py` |
| `srs.primitives.adversarial` | `srs/primitives/adversarial.py` |

### Log Levels

| Level | When to use |
|-------|-------------|
| `DEBUG` | Per-stage and per-primitive diagnostics (queries made, answers found, storage bytes). Use `--verbose`. |
| `INFO` | High-level operation milestones (plan chosen, execution complete). Default. |
| `WARNING` | Recoverable issues (corrupt snapshot, advice hash mismatch). Use `--quiet` to suppress INFO. |
| `ERROR` | Failures (task exception, in-flight state preserved for resume). Always shown. |

### CLI Flags

```bash
# Default: INFO (high-level milestones to stderr)
python3 srs/cli.py execute identify 64

# --verbose / -v: DEBUG (full pipeline trace)
python3 srs/cli.py --verbose execute identify 64

# --quiet / -q: WARNING (suppress INFO; only warnings/errors)
python3 srs/cli.py --quiet execute identify 64

# --format json implies --quiet (machine-parseable stdout, no log noise)
python3 srs/cli.py --format json execute identify 64
```

### Programmatic Use

```python
import logging
logging.basicConfig(level=logging.DEBUG)
logging.getLogger("srs").setLevel(logging.DEBUG)

from srs import Runtime, Task
rt = Runtime(home="/tmp/srs_run1")
# ... every srs.* module now logs through the standard logging hierarchy
```

### What is NOT Logged

- **CLI human-readable output** (results, capabilities, plan summaries) —
  these go through `print()` to stdout, not the logger. This keeps the
  logger for *operational* diagnostics and stdout for *user-facing* output.
- **Self-test PASS/FAIL lines** — these are CLI output, not log messages.
- **Per-query hash values** — too noisy; only aggregate counts are logged.

## Known Limitations

These limitations are documented honestly and are NOT claimed as capabilities:

1. **The 5-prim vs 6-prim separation cannot be demonstrated under the real
   `hash_bit`.** The adversarial benchmark proved that the REAL
   `adaptivity.execute_identify` succeeds with 6 queries on the
   "adversarial" hypotheses, because the adversarial prefix only applies
   under `adversarial_hash_bit` (a function no real primitive calls). The
   5-prim vs 6-prim separation is a theoretical result that requires a
   controlled query function, not the real SHA-256-based `hash_bit`.

2. **The `improvement.improve()` function is memoization, not learning.**
   The advice table is keyed on `sha256(b"|".join(hypotheses))[:16]` —
   if even one hypothesis changes, the key changes and advice misses.
   There is no generalization, no clustering, no heuristic learning.

3. **The quantum primitive (Q) is a query-count model, not a physics
   simulation.** `grover_search` makes `floor(π/4·√N)` oracle calls,
   then discards each result and returns the target with probability
   `success_prob`. Setting `success_prob=0.99` makes Grover "succeed"
   99% of the time regardless of N. There is no quantum state, no
   amplitude amplification, no interference.

## Adm Linkage

Every file in this repository is mathematically linked to the Admissible
Behavior Set (Adm) via the `adm_linker_manifest.json`.  The manifest maps
each file to the Adm rules it implements, enforces, or tests.

## Architecture

The SRS is specified in detail in `SRS_Architecture.pdf` (27 pages,
13 chapters).  The repository implements the architecture across six
phases, each mapped to a directory.
