# SRS Runtime 7.0 — Architecture

## Module Dependency Map

```
                    ┌─────────────────┐
                    │   srs.cli       │  (CLI entry point)
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  srs.runtime    │  (orchestrator)
                    │  Runtime class  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
      ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
      │ srs.planner │ │srs.persis-  │ │srs.improve- │
      │   (plan)    │ │  tence      │ │   ment      │
      └─────────────┘ └─────────────┘ └─────────────┘
              │              │              │
              │              ▼              │
              │      ~/.srs/snapshots/      │
              │      (JSON files)           │
              │                            │
              ▼                            ▼
      ┌─────────────────────────────────────────┐
      │          srs.primitives                  │
      │  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌─┐│
      │  │ E │ │ C │ │ A │ │ S │ │ V │ │Adv│ │Q││
      │  └─┬─┘ └─┬─┘ └─┬─┘ └─┬─┘ └─┬─┘ └─┬─┘ └┬┘│
      │    │     │     │     │     │     │    │ │
      │    └─────┴─────┼─────┼─────┼─────┼────┘ │
      │                │     │     │     │      │
      │                ▼     ▼     ▼     ▼      │
      │           hash_bit (shared utility)     │
      └─────────────────────────────────────────┘
```

## Data Flow

1. **User invokes CLI**: `python3 srs/cli.py execute identify 64`
2. **CLI dispatches** to `Runtime.execute(Task(...))`
3. **Runtime calls planner** to get `primitives = ["E", "C", "A", "V", "Adv"]`
4. **Runtime checks advice** first (if "Adv" in primitives). If hit, return in O(1).
5. **Otherwise Runtime calls** the most advanced primitive available (V → S → A → C → E)
6. **Primitive executes** and returns a result dict
7. **Runtime wraps** result as a `Result` dataclass
8. **Runtime calls improvement** to seed advice (if correct)
9. **Runtime returns** Result to CLI
10. **CLI prints** JSON to stdout

## State Persistence Flow

1. **Runtime.store_state()** creates a `Snapshot` (advice table + primitive stats)
2. **persistence.save()** writes JSON to `~/.srs/snapshots/snap_<id>.json`
3. **persistence.save()** updates `~/.srs/snapshots/latest.json` pointer
4. **On next Runtime() init**, `persistence.load_latest()` is called
5. **If snapshot exists**, advice table and stats are restored

## Self-Improvement Flow

1. Task executes successfully (correct=True)
2. `improvement.improve(advice, hypotheses, target_idx, was_correct=True)` called
3. Advice table seeded: `advice._table[hash(hypotheses)] = target_idx`
4. Next call to `Runtime.execute()` with same hypotheses hits advice → 0 queries

## The 7 Primitives in Detail

### E — Execution (`primitives/execution.py`)

- **Algorithm**: Non-adaptive random queries + majority-vote scoring
- **Source**: v6.42 algorithm_baseline
- **Self-test**: ✓ passing
- **Complexity**: O(budget × N) work, O(budget × 16B) storage

### C — Compression (`primitives/compression.py`)

- **Algorithm**: Pack response bits into bytes (1 bit/query vs 16B/query naive)
- **Source**: v6.42 algorithm_with_compression
- **Self-test**: ✓ passing
- **Measured advantage**: 14.2× storage reduction (256B → 18B at budget=16)

### A — Adaptivity (`primitives/adaptivity.py`)

- **Algorithm**: Information-gain greedy query selection (maximize split of alive set)
- **Source**: v6.42 algorithm_with_adaptivity
- **Self-test**: ✓ passing
- **Measured advantage**: 2× query reduction (16 → 8 at N=256)

### S — Scheduling (`primitives/scheduling.py`)

- **Algorithm**: Sequential query + parallel hypothesis pruning (Brent-style)
- **Source**: v6.42 algorithm_with_scheduling
- **Self-test**: ✓ passing
- **Measured advantage**: parallel depth accounting; communication cost tracked

### V — Verification (`primitives/verification.py`)

- **Algorithm**: PCP-style probe check; k random queries; soundness ε = 2⁻ᵏ
- **Source**: v6.42 algorithm_full
- **Self-test**: ✓ passing
- **Measured advantage**: correctness guarantee with ε ≤ 2⁻⁵ = 3.125%

### Adv — Advice (`primitives/advice.py`)

- **Algorithm**: P/poly-style non-uniform lookup table (hash(key) → answer)
- **Source**: v6.43 counterexample (P/poly advice)
- **Self-test**: ✓ passing
- **Measured advantage**: O(1) lookup, 0 queries (when advice hits)

### Q — Quantum (`primitives/quantum.py`)

- **Algorithm**: Simulated BQP (Grover for search; no advantage on identify per BBBV)
- **Source**: v6.44 (simulated BQP)
- **Self-test**: ✓ passing
- **Measured advantage**: O(√N) for search; none for identify (correctly modeled)

## File Manifest

```
srs_runtime/                 # The unified platform (everything below is NEW)
├── srs/
│   ├── __init__.py          # Re-exports
│   ├── runtime.py           # Runtime class (orchestrator)
│   ├── types.py             # Task, Result, Snapshot dataclasses
│   ├── planner.py           # Task kind -> primitives
│   ├── persistence.py       # Snapshot save/load/recover
│   ├── improvement.py       # Self-improvement (advice seeding)
│   ├── cli.py               # 7-command CLI
│   └── primitives/
│       ├── __init__.py
│       ├── execution.py     # E
│       ├── compression.py   # C
│       ├── adaptivity.py    # A
│       ├── scheduling.py    # S
│       ├── verification.py  # V
│       ├── advice.py        # Adv
│       └── quantum.py       # Q
├── tests/
│   ├── __init__.py
│   └── test_runtime.py      # 20 tests
├── benchmarks/
│   ├── __init__.py
│   └── run_benchmarks.py    # 3-part benchmark
├── docs/
│   ├── AUDIT.md             # Zero-trust audit
│   ├── CAPABILITY_GRAPH.md  # What works / partial / missing
│   └── ARCHITECTURE.md      # This file
├── README.md                # Main documentation
├── Makefile                 # make test, make bench, make zip
├── requirements.txt         # Empty (stdlib only)
└── benchmark_results.json   # Latest benchmark output
```

## Theoretical Basis (Archived)

The runtime is the **engineering artifact** that survives the v6.45 PC review (verdict C: publishable synthesis, no new theorem). The 7-primitive taxonomy is the organizing principle; each primitive is bound to a concrete executable module with measured advantages.

The v6.46 negative theorem (restricted closure is PROVABLY FALSE for B ≥ 2-EXPTIME) is accepted as a mathematical result; it does not affect the runtime's executability. The runtime runs; the theorem says no closure theorem is possible. Both are true simultaneously.
