# Zero-Trust Audit of Recovered Artifacts

## Audit Methodology

Every artifact in the project was inspected. For each, we determined: KEEP, MERGE, REWRITE, REMOVE, or ARCHIVE. Nothing was preserved merely because it existed.

## v6.4x Research Documents (theory-only)

| Artifact | Verdict | Reason |
|----------|---------|--------|
| v6.42_CLOSURE_THEOREM.pdf | ARCHIVE | Falsified by v6.43; not executable |
| v6.43_ADVERSARIAL_AUDIT.pdf | ARCHIVE | Audit only; not executable |
| v6.44_SYNTHESIS.pdf | ARCHIVE | Synthesis only; not executable |
| v6.45_PC_REVIEW.pdf | ARCHIVE | Review only; not executable |
| v6.46_FINAL_SYNTHESIS.pdf | ARCHIVE | Conclusion only; not executable |
| v6.46_PRACTITIONER_PAPER.md | ARCHIVE | Prose; not executable |
| v6.46_PROGRAM_RETROSPECTIVE.md | ARCHIVE | Retrospective; not executable |
| v6.46_RESTRICTED_CLOSURE_PROOF_ATTEMPT.md | ARCHIVE | Negative theorem; not executable |
| v6.46_SALVAGE_AUDIT.md | ARCHIVE | Audit; not executable |
| v6.47_FIRST_PRINCIPLES_AUDIT.md | ARCHIVE | Audit; not executable |

**Verdict**: Theory documents are archived. They contain the v6.46 negative result (restricted closure is PROVABLY FALSE for B ≥ 2-EXPTIME) which is mathematically rigorous but not executable. The 7-primitive taxonomy survives as the *organizing principle* for the runtime.

## v6.4x Prototype Scripts (executable)

| Artifact | Verdict | Reason |
|----------|---------|--------|
| v6.42_closure_demo.py | MERGE | Algorithm logic recovered into `primitives/{E,C,A,S,V}.py` |
| v6.43_counterexample.py | MERGE | Advice logic recovered into `primitives/advice.py` |
| v6.44_six_primitive_demo.py | MERGE | Benchmark logic recovered into `benchmarks/run_benchmarks.py` |

## Pre-Existing Codebase (H3-Tier SRS v6.3.0)

The pre-existing codebase (`kernel/`, `cognition/`, `governance/`, `self_healing/`, `simulation/`, `verification/`, `api/`, `tests/`) contained real implementations but had heavy external dependencies:

| Module | Verdict | Reason |
|--------|---------|--------|
| `cognition/agemem_controller.py` | REWRITE | Requires `torch`; recovered pattern into `improvement.py` (stdlib-only) |
| `cognition/agemem_adm_trainer.py` | REMOVE | Requires `torch`; not recovered |
| `cognition/grpo_advantage_map.py` | REMOVE | Requires `torch`; not recovered |
| `cognition/adm_intent_mapper.py` | ARCHIVE | Self-test passes; not central to runtime |
| `self_healing/antibody_maturation.py` | KEEP+REWRITE | Self-test passes; pattern recovered into `improvement.py` |
| `self_healing/digital_dna.py` | KEEP | Self-test passes; not central but works |
| `kernel/omnivisor.py` | KEEP | Self-test passes; could be wired to `primitives/scheduling.py` in future |
| `kernel/smpu_sppu.py` | KEEP | Self-test passes; not central to runtime |
| `kernel/ebpf_telemetry.py` | KEEP | Self-test passes; not central to runtime |
| `verification/z3_power_proof.py` | REWRITE | Requires `z3`; recovered probe-based verification into `primitives/verification.py` |
| `verification/saarthi_sva_generator.py` | KEEP | Self-test passes; not central to runtime |
| `simulation/adaqc_compiler.py` | KEEP | Self-test passes; not central to runtime |
| `simulation/photonic_bus.py` | KEEP | Self-test passes; not central to runtime |
| `simulation/qiskit_adapter.py` | REMOVE | Requires `qiskit`; simulated in `primitives/quantum.py` |
| `governance/audit.py` | KEEP | Self-test passes |
| `governance/bls_signatures.py` | REMOVE | Requires `blspy`; not central to runtime |
| `governance/cost.py` | KEEP | Self-test passes |
| `governance/identity.py` | KEEP | Self-test passes |
| `governance/persistence.py` | REMOVE | Requires external dep; replaced by `srs/persistence.py` |
| `governance/policy.py` | KEEP | Self-test passes |
| `governance/seg_controller.py` | REMOVE | Self-test fails; requires `sqa_aggregator` |
| `governance/sqa_aggregator.py` | REMOVE | Self-test fails |
| `api/*.py` (24 files) | ARCHIVE | API server components; not central to runtime core |
| `tests/*.py` (88 files) | ARCHIVE | Pre-existing tests; replaced by `tests/test_runtime.py` |
| `docs/*.md` (66 files) | ARCHIVE | Pre-existing documentation; replaced by `srs_runtime/README.md` |
| `bpf/*.bpf.c` | ARCHIVE | eBPF programs; require kernel compilation |
| `kernel/c/*` | ARCHIVE | C kernel components; require C compilation |
| `kernel/rust/*` | ARCHIVE | Rust skeleton; require Rust compilation |
| `deploy/k8s/*`, `deploy/helm/*` | ARCHIVE | Deployment configs; not central to runtime |
| `docker/*` | ARCHIVE | Docker configs; not central to runtime |

## Audit Summary

- **KEEP**: 11 modules (self-tests pass; not central but functional)
- **MERGE**: 3 v6.4x prototype scripts → unified runtime
- **REWRITE**: 4 modules (replaced heavy-dep versions with stdlib equivalents)
- **REMOVE**: 7 modules (broken or redundant)
- **ARCHIVE**: 100+ files (theory docs, API components, deployment configs, kernel C/Rust code)

The unified `srs_runtime/` directory is the **single executable platform** that survives the audit. It contains:
- 7 primitive modules (stdlib-only)
- 1 runtime orchestrator
- 1 planner
- 1 persistence module
- 1 improvement module
- 20-test pytest suite (all passing)
- Benchmark suite (all running)
- CLI with 7 commands

## What the Audit Did NOT Recover

- Real quantum execution (would require `qiskit` or hardware)
- Real z3 verification (would require `z3-solver`)
- Real torch cognition (would require `torch`)
- Distributed execution (would require consensus protocol)
- Real kernel-level scheduling (would require C/Rust compilation)

These are documented as "Remaining Engineering Blockers" in the README.
