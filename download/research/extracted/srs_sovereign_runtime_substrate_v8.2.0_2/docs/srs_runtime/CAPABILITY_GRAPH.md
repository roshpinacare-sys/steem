# Capability Graph

## What Already Works (validated)

| Capability | Module | Test |
|-----------|--------|------|
| Execute identify task | `srs.runtime.execute()` | `test_runtime_end_to_end` |
| Plan primitives for task | `srs.runtime.plan_task()` / `srs.planner.plan()` | `test_planner_picks_correct_primitives` |
| Persist state to disk | `srs.runtime.store_state()` / `srs.persistence.save()` | `test_persistence_self_test` |
| Recover state from disk | `srs.runtime.recover()` / `srs.persistence.load_latest()` | `test_runtime_end_to_end` |
| Verify outputs probabilistically | `srs.primitives.verification.verify()` | `test_verification_soundness` |
| Improve via advice seeding | `srs.improvement.improve()` | `test_runtime_self_improvement` |
| Report capabilities | `srs.runtime.capabilities()` | `test_capabilities_report` |
| Compression advantage | `srs.primitives.compression` | `test_compression_reduces_storage` |
| Adaptivity advantage | `srs.primitives.adaptivity` | `test_adaptivity_uses_fewer_queries` |
| Advice advantage (0 queries) | `srs.primitives.advice` | `test_advice_yields_zero_queries` |
| CLI | `srs.cli` | (manual) |
| Benchmark suite | `benchmarks.run_benchmarks` | (manual) |

**20/20 pytest tests pass.**

## What Partially Works

| Capability | Status | Blocker |
|-----------|--------|---------|
| Quantum execution | Simulated only | No `qiskit`; no hardware |
| Adversarial benchmark | 5-prim still passes | Need truly indistinguishable hypotheses |
| Scheduler parallelism | Modeled, not real | No real workers; just depth accounting |

## What Is Missing

| Capability | Why Missing | Impact |
|-----------|-------------|--------|
| Real z3 verification | `z3-solver` not installed | Verification is probe-based, not proof-based |
| Real torch cognition | `torch` not installed | AgeMem/GRPO not available |
| Distributed execution | Not implemented | FLP-aware consensus needed |
| Real kernel scheduling | C/Rust not compiled | Omnivisor not wired |
| Web dashboard | Not implemented | Capabilities only via CLI/JSON |
| Real-time telemetry | eBPF programs not compiled | No kernel-level metrics |

## Dependencies

```
srs.runtime
├── srs.types           (Task, Result, Snapshot)
├── srs.planner         (task kind -> primitives)
├── srs.persistence     (snapshot save/load)
├── srs.improvement     (advice seeding)
└── srs.primitives
    ├── execution       (E)
    ├── compression     (C, imports execution.hash_bit)
    ├── adaptivity      (A, imports execution.hash_bit)
    ├── scheduling      (S, imports execution.hash_bit)
    ├── verification    (V, imports execution.hash_bit, adaptivity)
    ├── advice          (Adv, may fall back to adaptivity)
    └── quantum         (Q, imports adaptivity)
```

## Bottlenecks

1. **No real quantum backend**: `primitives/quantum.py` simulates Grover but doesn't actually run BQP
2. **No real z3**: `primitives/verification.py` uses probabilistic probes (PCP-style) but can't produce formal proofs
3. **No real parallelism**: `primitives/scheduling.py` models parallel depth but runs sequentially
4. **No distributed execution**: single-process only

## Highest-Value Next Steps

1. **Add `pip install -r requirements.txt`** with optional extras → unlocks real verification, cognition, quantum
2. **Wire to real `kernel/omnivisor.py`** → unlocks real parallelism
3. **Build a truly adversarial benchmark** → empirically confirms the v6.44 5-prim vs 6-prim separation
4. **Add a web dashboard** → makes capabilities observable
5. **Implement distributed execution** → unlocks the missing 8th primitive (distributed asynchrony)
