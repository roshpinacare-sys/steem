# SRS Runtime 7.0 — Sovereign Runtime Substrate

**One unified executable platform** integrating the 7-primitive taxonomy from v6.46 with the recovered codebase. Replaces the scattered v6.42-v6.47 documents with a single runnable system.

## What This Is

A small coherent runtime that **executes**, **plans**, **persists state**, **recovers after interruption**, **verifies its own outputs**, **improves through experience**, and **exposes measurable capabilities**.

Each of the 7 primitives (Compression, Adaptivity, Scheduling, Verification, Execution, Advice, Quantum) is bound to a concrete executable Python module.

## Build & Run

```bash
# No external dependencies beyond Python 3.9+ standard library.
cd srs_runtime

# Run all module self-tests (11 modules)
python3 srs/cli.py self-test

# Run pytest suite (20 tests)
python3 -m pytest tests/ -v

# Run benchmark suite
python3 srs/cli.py bench

# Execute a synthetic task
python3 srs/cli.py execute identify 64

# Show capabilities
python3 srs/cli.py capabilities

# Plan a task
python3 srs/cli.py plan identify

# Save state
python3 srs/cli.py snapshot

# Recover state
python3 srs/cli.py recover
```

## Test Results (validated)

```
11/11 modules passed self-test
20/20 pytest tests passed in 0.12s
```

## Benchmark Results (N=256, budget=16)

| Primitive | Correct | Queries | Storage (B) | Work | Time (ms) | Advantage |
|-----------|---------|---------|-------------|------|-----------|-----------|
| E (Execution) | ✓ | 16 | 256 | 4112 | 1.7 | baseline |
| C (Compression) | ✓ | 16 | **18** | 4112 | 1.6 | **14.2× storage reduction** |
| A (Adaptivity) | ✓ | **8** | 161 | 10455 | 4.3 | **2× query reduction** |
| S (Scheduling) | ✓ | 8 | 161 | 10455 | 4.3 | parallel depth |
| V (Verification) | ✓ | 13 | 161 | 10460 | 4.3 | ε ≤ 2⁻⁵ soundness |
| Adv (Advice) | ✓ | **0** | 20 | 1 | 0.01 | **advice hit: 0 queries** |
| Q (Quantum) | ✓ | 8 | 161 | 10455 | 4.3 | no advantage on identify (BBBV) |

**Self-improvement (integration test)**:
- First run: 13 queries (cold start)
- Second run: **0 queries** (advice hit)
- 1 advice entry seeded automatically

## Architecture

```
srs_runtime/
├── srs/
│   ├── __init__.py           # Re-exports Runtime, Task, Result, Snapshot
│   ├── runtime.py            # Main Runtime class (execute/plan/store/recover/verify/improve/capabilities)
│   ├── types.py              # Task, Result, Snapshot dataclasses
│   ├── planner.py            # 7-primitive planner (task kind -> primitives)
│   ├── persistence.py        # Snapshot save/load/recover to ~/.srs/snapshots/
│   ├── improvement.py        # Self-improvement: seed advice from successful runs
│   ├── cli.py                # Command-line interface
│   └── primitives/
│       ├── execution.py      # E: baseline random queries + majority vote
│       ├── compression.py    # C: packed-bit transcript storage
│       ├── adaptivity.py     # A: information-gain greedy query selection
│       ├── scheduling.py     # S: parallel hypothesis pruning across workers
│       ├── verification.py   # V: PCP-style probabilistic probe check
│       ├── advice.py         # Adv: P/poly-style non-uniform lookup table
│       └── quantum.py        # Q: simulated BQP (Grover for search; no advantage on identify)
├── tests/
│   └── test_runtime.py       # 20 tests, all passing
├── benchmarks/
│   └── run_benchmarks.py     # Per-primitive + integration + 5v6v7 comparison
├── docs/
│   ├── AUDIT.md              # Zero-trust audit of recovered artifacts
│   ├── CAPABILITY_GRAPH.md   # What works / partial / missing
│   └── ARCHITECTURE.md       # Module dependency map
├── README.md                 # This file
├── benchmark_results.json    # Latest benchmark output
└── Makefile                  # make test, make bench, make zip
```

> **Note (v7.5):** this standalone distribution has no `requirements.txt` —
> `srs/` is genuinely stdlib-only (Python 3.9+). The full project's
> optional extras (torch, z3-solver, etc.) are declared in the parent
> `../requirements.txt`.

## The 7 Primitives → Module Map

| Primitive | Axis | Module | Source |
|-----------|------|--------|--------|
| E (Execution) | baseline | `srs.primitives.execution` | v6.42 algorithm_baseline |
| C (Compression) | storage, work, amortization | `srs.primitives.compression` | v6.42 algorithm_with_compression |
| A (Adaptivity) | queries | `srs.primitives.adaptivity` | v6.42 algorithm_with_adaptivity |
| S (Scheduling) | time, depth, parallelism, locality, comm | `srs.primitives.scheduling` | v6.42 algorithm_with_scheduling |
| V (Verification) | verification | `srs.primitives.verification` | v6.42 algorithm_full |
| Adv (Advice) | non-uniformity | `srs.primitives.advice` | v6.43 counterexample (P/poly) |
| Q (Quantum) | entanglement | `srs.primitives.quantum` | v6.44 (simulated BQP) |

## Theory → Software Binding

The v6.46 7-primitive taxonomy (C, A, S, V, E, Adv, Q) is **not** a theorem (per v6.45 PC review, verdict C). But each primitive maps to a concrete executable module with measured advantages on its canonical axis. The runtime is the **engineering artifact** that survives the theoretical falsification.

## Capability Graph

| Capability | Status | Module |
|-----------|--------|--------|
| Execute task | ✓ Works | `runtime.execute()` |
| Plan primitives | ✓ Works | `runtime.plan_task()` |
| Persist state | ✓ Works | `runtime.store_state()` |
| Recover after interruption | ✓ Works | `runtime.recover()` |
| Verify outputs | ✓ Works | `primitives.verification` |
| Improve through experience | ✓ Works | `improvement.improve()` + advice seeding |
| Measurable capabilities | ✓ Works | `runtime.capabilities()` |
| Quantum execution | ⚠ Simulated | `primitives.quantum` (no real BQP backend) |
| Distributed execution | ✗ Missing | (would require FLP-aware consensus) |
| Real z3 verification | ✗ Missing | (z3 not in stdlib) |
| Real torch-based cognition | ✗ Missing | (torch not in stdlib) |

## Recovered From Previous Project

The v6.4-v6.47 program produced:
- **v6.42 Closure Theorem** (falsified) — theoretical only, archived
- **v6.43 Counterexample** (P/poly advice) — **recovered** as `primitives/advice.py`
- **v6.44 6→7 primitive push** — **recovered** as 7 primitive modules
- **v6.45 PC review** (verdict C) — accepted; theory is not publishable
- **v6.46 Restricted closure** (PROVABLY FALSE for B ≥ 2-EXPTIME) — accepted as negative result
- **v6.47 First-principles audit** (verdict: fully rigorous negative theorem) — accepted

The pre-existing codebase (`kernel/`, `cognition/`, `governance/`, `self_healing/`, `simulation/`, `verification/`) contained real implementations but required `torch`, `z3`, `blspy` which are not in the standard library. The SRS Runtime 7.0 recovers the **algorithmic content** from those modules (patterns from `antibody_maturation.py`, `digital_dna.py`, `agemem_controller.py`) into stdlib-only executable form.

## What Was Removed

- All `[PROVEN]` tags on closure claims (per v6.45 PC: should be `[HYPOTHESIZED]`)
- The 5×5 mutual irreducibility matrix (per v6.44 F1: was actually a partial order)
- The "no 6th primitive exists" universal negative (per v6.43: falsified by P/poly)
- L11 amortization bound (per v6.46 G1: unsupported, no citation)
- Dependencies on `torch`, `z3`, `blspy`, `qiskit` (replaced with stdlib equivalents or simulated)

## What Now Executes

- **7 primitive modules**, each with self-test
- **Runtime orchestration**: execute → plan → persist → recover → verify → improve
- **20-test pytest suite** (all passing)
- **Benchmark suite** (per-primitive + integration + 5v6v7 comparison)
- **CLI** with 7 commands (self-test, capabilities, execute, plan, snapshot, recover, bench)

## What Remains Experimental

- **Quantum primitive**: simulated only (no real BQP backend)
- **5v6v7 comparison on adversarial benchmark**: 5-prim currently passes; this is because the "adversarial" benchmark in v6.44 was not actually information-theoretically indistinguishable. A truly adversarial benchmark would require hypotheses that are provably indistinguishable within the budget, which is harder to construct.
- **Distributed execution**: not implemented (FLP-aware consensus is future work)

## Build Status

```
Python: 3.9+ (stdlib only, no external deps)
Tests:  20/20 passing
Self-tests: 11/11 modules passing
Benchmarks: all running, results saved
CLI: all 7 commands working
State persistence: working (snapshot + recover)
Self-improvement: working (advice seeding on success)
```

## Remaining Engineering Blockers

1. **Real quantum backend**: would require `qiskit` or hardware access; currently simulated
2. **Real z3 verification**: would require `z3-solver` install; currently using probe-based verification
3. **Real torch cognition**: would require `torch` install; currently using lightweight adaptive algorithms
4. **Truly adversarial benchmark**: needs hypotheses that are information-theoretically indistinguishable within budget
5. **Distributed execution**: would require consensus protocol implementation

## Highest-Impact Future Work

1. **Add `pip install -r requirements.txt`** with optional extras (`z3-solver`, `torch`, `qiskit`) — would unlock real verification, real cognition, real quantum
2. **Build a truly adversarial benchmark** where 5-primitive provably fails — would empirically confirm the v6.44 result
3. **Add a distributed execution mode** with FLP-aware consensus — would unlock the distributed primitive
4. **Wire to real `kernel/omnivisor.py`** for actual scheduling — would unlock real parallelism
5. **Add a web dashboard** for capability monitoring — would make the system observable

## Migration Notes (from v6.46 to v7.0)

| v6.46 artifact | v7.0 status |
|---------------|-------------|
| v6.42_CLOSURE_THEOREM.pdf | ARCHIVED (theory, not executable) |
| v6.43_ADVERSARIAL_AUDIT.pdf | ARCHIVED (theory, not executable) |
| v6.44_SYNTHESIS.pdf | ARCHIVED (theory, not executable) |
| v6.45_PC_REVIEW.pdf | ARCHIVED (theory, not executable) |
| v6.46_FINAL_SYNTHESIS.pdf | ARCHIVED (theory, not executable) |
| v6.46_PRACTITIONER_PAPER.md | ARCHIVED (prose, not executable) |
| v6.42_closure_demo.py | **MERGED** into `primitives/{E,C,A,S,V}.py` |
| v6.43_counterexample.py | **MERGED** into `primitives/advice.py` |
| v6.44_six_primitive_demo.py | **MERGED** into `benchmarks/run_benchmarks.py` |
| Pre-existing `cognition/agemem_controller.py` | REWROTE (stdlib-only, no torch) → `improvement.py` |
| Pre-existing `self_healing/antibody_maturation.py` | REWROTE pattern → `improvement.py` |
| Pre-existing `verification/z3_power_proof.py` | REWROTE (no z3) → `primitives/verification.py` |
| Pre-existing `simulation/qiskit_adapter.py` | REWROTE (no qiskit) → `primitives/quantum.py` |

## License

MIT (see repository root).
