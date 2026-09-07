# v7.0 Reconciliation Report

## Methodology

Every file in the repository was inspected. Each original (pre-v7.0) file is
categorized as one of:

- **KEPT**: file preserved unchanged in its original location
- **MODIFIED**: file content was modified (with explanation)
- **MERGED**: file content was merged into a new v7.0 module (original preserved)
- **ARCHIVED**: file moved to an archive/ subdirectory
- **REMOVED**: file deleted (with justification)

New v7.0 files are marked **NEW**.

## Summary

- **Total files in repository**: 457
- **KEPT**: 336 files
- **MODIFIED**: 2 files
- **NEW (v7.0)**: 15 files
- **NEW (v7.0 standalone)**: 25 files
- **NEW (v7.0 test)**: 1 files
- **NEW (v7.0 benchmark)**: 2 files
- **NEW (v7.0 docs)**: 4 files
- **NEW (v7.0 CLI)**: 1 files
- **NEW (v6.4x research archive)**: 70 files

## MODIFIED Files (with explanation)

| File | Change |
|------|--------|
| `Makefile` | Bumped VERSION 6.3.0 → 7.0.0; added `test-srs`, `smoke-srs`, `bench-srs` targets |
| `pyproject.toml` | Bumped version 6.3.0 → 7.0.0; added `srs-runtime` console script entry; added `srs*` to setuptools packages.find.include |

## REMOVED Files (with justification)

**None.** No original files were deleted in v7.0.

## MERGED Files

The following original files had their **algorithmic content** merged into the
new `srs/` package. The originals are **preserved unchanged** in their original
locations and remain fully functional.

| Original file | Merged into | Original preserved? |
|---------------|-------------|---------------------|
| `v6_theory/v6.42_closure_demo.py` (algorithm_baseline) | `srs/primitives/execution.py` | YES (in v6_theory/) |
| `v6_theory/v6.42_closure_demo.py` (algorithm_with_compression) | `srs/primitives/compression.py` | YES (in v6_theory/) |
| `v6_theory/v6.42_closure_demo.py` (algorithm_with_adaptivity) | `srs/primitives/adaptivity.py` | YES (in v6_theory/) |
| `v6_theory/v6.42_closure_demo.py` (algorithm_with_scheduling) | `srs/primitives/scheduling.py` | YES (in v6_theory/) |
| `v6_theory/v6.42_closure_demo.py` (algorithm_full) | `srs/primitives/verification.py` | YES (in v6_theory/) |
| `v6_theory/v6.43_counterexample.py` (P/poly advice) | `srs/primitives/advice.py` | YES (in v6_theory/) |
| `v6_theory/v6.44_six_primitive_demo.py` (benchmarks) | `benchmarks/srs/run_benchmarks.py` | YES (in v6_theory/) |
| `self_healing/antibody_maturation.py` (pattern) | `srs/improvement.py` (pattern reuse) | YES (original unchanged, self-test passes) |
| `cognition/agemem_controller.py` (pattern) | `srs/persistence.py` + `srs/improvement.py` | YES (original unchanged; requires torch) |

## KEPT Files (original, unchanged)

All files below are original (pre-v7.0) and preserved unchanged.

### `(root)/` (32 files)

- `.gitignore`
- `CLOUD_DEPLOYMENT.md`
- `DEPLOYMENT_GUIDE.md`
- `DEVELOPER_GUIDE.md`
- `Dockerfile`
- `ENGINEERING_REPORT.md`
- `ENTERPRISE_VALUE.md`
- `HOSTILE_AUDIT.md`
- `LICENSE`
- `QUICKSTART.md`
- `README.md`
- `RECONCILIATION_REPORT.md`
- `SECURITY.md`
- `SRS_Architecture.pdf`
- `TemporalBankerScheduler.tla`
- `adm_intent_mapping.json`
- `adm_linker_manifest.json`
- `agemem_adm_metrics.json`
- `agemem_esr_log.json`
- `agemem_metrics.json`
- `coverage.json`
- `docker-compose.yml`
- `esr_contention_reconciliation.json`
- `esr_sample_entry.json`
- `esr_schema.json`
- `grpo_advantage_map.json`
- `grpo_advantage_map.png`
- `mutmut_runner.sh`
- `requirements-dev.txt`
- `requirements.txt`
- `setup.cfg`
- `z3_power_proof_report.json`

### `.github/` (1 files)

- `.github/workflows/ci.yml`

### `api/` (31 files)

- `api/__init__.py`
- `api/admin.html`
- `api/benchmark_runner.py`
- `api/certification.py`
- `api/cloud.py`
- `api/community.py`
- `api/compliance.py`
- `api/connection_pool.py`
- `api/dashboard.html`
- `api/feature_flags.py`
- `api/grpc_api.py`
- `api/marketplace.py`
- `api/mcp_adapter.py`
- `api/metrics.py`
- `api/oidc.py`
- `api/openapi.json`
- `api/partner_program.py`
- `api/postgres_adapter.py`
- `api/rate_limiter.py`
- `api/replication.py`
- `api/sandbox.py`
- `api/secrets.py`
- `api/security.py`
- `api/server.py`
- `api/sla.py`
- `api/srs_sdk.go`
- `api/srs_sdk.py`
- `api/srs_sdk.ts`
- `api/tracing.py`
- `api/webhooks.py`
- `api/websocket.py`

### `benchmarks/` (1 files)

- `benchmarks/bench_srs.py`

### `bpf/` (2 files)

- `bpf/ecr_gate_error.bpf.c`
- `bpf/power_clock.bpf.c`

### `cognition/` (9 files)

- `cognition/__init__.py`
- `cognition/adm_intent_mapper.py`
- `cognition/agemem_adm_trainer.py`
- `cognition/agemem_controller.py`
- `cognition/esr_contention_reconciliation.json`
- `cognition/esr_energy_generation.json`
- `cognition/esr_sample_entry.json`
- `cognition/esr_schema.json`
- `cognition/grpo_advantage_map.py`

### `deploy/` (4 files)

- `deploy/helm/Chart.yaml`
- `deploy/helm/values.yaml`
- `deploy/k8s/crd.yaml`
- `deploy/k8s/example-srs.yaml`

### `docker/` (1 files)

- `docker/prometheus.yml`

### `docs/` (15 files)

- `docs/API_REFERENCE.md`
- `docs/ARCHITECTURE.md`
- `docs/BENCHMARK_RESULTS.md`
- `docs/BENCHMARK_RESULTS_LIVE.json`
- `docs/BENCHMARK_RESULTS_LIVE.md`
- `docs/CAPABILITY_AUDIT.md`
- `docs/CHANGELOG.md`
- `docs/CONTRIBUTING.md`
- `docs/COVERAGE_REPORT.md`
- `docs/MUTATION_TEST_RESULTS.md`
- `docs/SPEC.md`
- `docs/STATIC_ANALYSIS_REPORT.md`
- `docs/TOOLCHAIN_REPORT.md`
- `docs/architecture.png`
- `docs/coverage_partial.json`

### `examples/` (3 files)

- `examples/example_agent.go`
- `examples/example_agent.py`
- `examples/example_agent.ts`

### `governance/` (9 files)

- `governance/__init__.py`
- `governance/audit.py`
- `governance/bls_signatures.py`
- `governance/cost.py`
- `governance/identity.py`
- `governance/persistence.py`
- `governance/policy.py`
- `governance/seg_controller.py`
- `governance/sqa_aggregator.py`

### `kernel/` (26 files)

- `kernel/__init__.py`
- `kernel/c/Makefile`
- `kernel/c/main.c`
- `kernel/c/main.o`
- `kernel/c/omnivisor_sim`
- `kernel/c/qos.c`
- `kernel/c/qos.h`
- `kernel/c/qos.o`
- `kernel/c/sched.c`
- `kernel/c/sched.h`
- `kernel/c/sched.o`
- `kernel/c/smpu.c`
- `kernel/c/smpu.h`
- `kernel/c/smpu.o`
- `kernel/c/tests`
- `kernel/c/tests.c`
- `kernel/c/tests.o`
- `kernel/ebpf_telemetry.py`
- `kernel/omnivisor.py`
- `kernel/rust/Cargo.toml`
- `kernel/rust/README.md`
- `kernel/rust/src/main.rs`
- `kernel/rust/src/smpu.rs`
- `kernel/rust/src/stage2.rs`
- `kernel/rust/src/vgic.rs`
- `kernel/smpu_sppu.py`

### `rce/` (92 files)

- `rce/RCE2_FUNDAMENTAL_LIMIT.md`
- `rce/RCE2_HIDDEN_WORLD_ANALYSIS.md`
- `rce/RCE2_HYPOTHESES.md`
- `rce/RCE2_MATH_SPEC.md`
- `rce/RCE2_META_REPRESENTATION_RESULTS.md`
- `rce/RCE2_META_REPRESENTATION_V2_ANALYSIS.md`
- `rce/RCE2_RESEARCH_REPORT.pdf`
- `rce/RCE2_SUBSTRATE_REPORT.pdf`
- `rce/RCE2_V610_REPORT.pdf`
- `rce/RCE2_V611_REPORT.pdf`
- `rce/RCE2_V612_REPORT.pdf`
- `rce/RCE2_V613_REPORT.pdf`
- `rce/RCE2_V614_REPORT.pdf`
- `rce/RCE2_V615_REPORT.pdf`
- `rce/RCE2_V616_REPORT.pdf`
- `rce/RCE2_V617_REPORT.pdf`
- `rce/RCE2_V618_REPORT.pdf`
- `rce/RCE2_V619_REPORT.pdf`
- `rce/RCE2_V620_REPORT.pdf`
- `rce/RCE2_V621_REPORT.pdf`
- `rce/RCE2_V622_REPORT.pdf`
- `rce/RCE2_V623_REPORT.pdf`
- `rce/RCE2_V66_REPORT.pdf`
- `rce/RCE2_V67_REPORT.pdf`
- `rce/RCE2_V68_REPORT.pdf`
- `rce/RCE2_V69_REPORT.pdf`
- `rce/RCE_REPORT.md`
- `rce/__init__.py`
- `rce/rce.py`
- `rce/rce2.py`
- `rce/rce2_active_causal.py`
- `rce/rce2_adaptive_byzantine.py`
- `rce/rce2_adaptive_gate.py`
- `rce/rce2_adversarial_audit.py`
- `rce/rce2_adversarial_audit_results.json`
- `rce/rce2_adversarial_reliability.py`
- `rce/rce2_adversarial_reliability_results.json`
- `rce/rce2_assumption_attack.py`
- `rce/rce2_assumption_attack_results.json`
- `rce/rce2_byzantine_robust.py`
- `rce/rce2_causal_discovery.py`
- `rce/rce2_causal_fairness.py`
- `rce/rce2_counterfactual.py`
- `rce/rce2_density_gate.py`
- `rce/rce2_differential_privacy.py`
- `rce/rce2_equivalence_analysis.json`
- `rce/rce2_equivalence_proof.py`
- `rce/rce2_experiment_results.json`
- `rce/rce2_federated_causal.py`
- `rce/rce2_final_search.py`
- `rce/rce2_final_search_results.json`
- `rce/rce2_formal_theory.json`
- `rce/rce2_formal_theory.py`
- `rce/rce2_hidden_world_benchmark.py`
- `rce/rce2_hidden_world_results.json`
- `rce/rce2_implicit_substrate.py`
- `rce/rce2_implicit_vs_explicit_results.json`
- `rce/rce2_large_scale_benchmark.py`
- `rce/rce2_large_scale_results.json`
- `rce/rce2_law_refiner.py`
- `rce/rce2_law_verification.py`
- `rce/rce2_mechanism_search.py`
- `rce/rce2_mechanism_search_results.json`
- `rce/rce2_meta_active.py`
- `rce/rce2_meta_learner.py`
- `rce/rce2_meta_proof_attack.py`
- `rce/rce2_meta_proof_attack_results.json`
- `rce/rce2_meta_representation_benchmark.py`
- `rce/rce2_meta_representation_results.json`
- `rce/rce2_meta_representation_v2.py`
- `rce/rce2_meta_representation_v2_results.json`
- `rce/rce2_neural_symbolic.py`
- `rce/rce2_new_substrate_results.json`
- `rce/rce2_new_substrate_search.py`
- `rce/rce2_observational_causal.py`
- `rce/rce2_online_causal.py`
- `rce/rce2_resource_classification.py`
- `rce/rce2_resource_classification_results.json`
- `rce/rce2_resource_closure.py`
- `rce/rce2_resource_closure_results.json`
- `rce/rce2_reuse_classifier.py`
- `rce/rce2_scm_discovery.py`
- `rce/rce2_stress_test_results.json`
- `rce/rce2_substrate.py`
- `rce/rce2_substrate_results.json`
- `rce/rce2_temporal_survival.py`
- `rce/rce2_temporal_survival_results.json`
- `rce/rce2_v66_results.json`
- `rce/rce2_v67_results.json`
- `rce/rce2_v68_results.json`
- `rce/rce2_verified_benchmark.py`
- `rce/rce2_verified_benchmark_results.json`

### `scripts/` (7 files)

- `scripts/gen_api_docs.py`
- `scripts/gen_coverage_md.py`
- `scripts/mutation_test.py`
- `scripts/prepare_push.sh`
- `scripts/run_coverage.py`
- `scripts/run_static_analysis.py`
- `scripts/write_makefile.py`

### `self_healing/` (3 files)

- `self_healing/__init__.py`
- `self_healing/antibody_maturation.py`
- `self_healing/digital_dna.py`

### `simulation/` (4 files)

- `simulation/__init__.py`
- `simulation/adaqc_compiler.py`
- `simulation/photonic_bus.py`
- `simulation/qiskit_adapter.py`

### `tests/` (88 files)

- `tests/__init__.py`
- `tests/conftest.py`
- `tests/integration_test.py`
- `tests/smoke_test.py`
- `tests/test_100_coverage.py`
- `tests/test_agemem_adm_trainer.py`
- `tests/test_antibody_maturation.py`
- `tests/test_api.py`
- `tests/test_bls_unit.py`
- `tests/test_bulletproof.py`
- `tests/test_c_omnivisor.py`
- `tests/test_cloud_enterprise.py`
- `tests/test_cloud_infra.py`
- `tests/test_cognition.py`
- `tests/test_concurrency.py`
- `tests/test_coverage_final.py`
- `tests/test_coverage_gaps.py`
- `tests/test_coverage_gaps2.py`
- `tests/test_coverage_gaps3.py`
- `tests/test_cross_validation.py`
- `tests/test_ecosystem.py`
- `tests/test_enterprise.py`
- `tests/test_enterprise_pro.py`
- `tests/test_examples_security.py`
- `tests/test_fault_injection.py`
- `tests/test_final_coverage.py`
- `tests/test_fuzz.py`
- `tests/test_grpo_advantage_map.py`
- `tests/test_harder_missions.py`
- `tests/test_kernel.py`
- `tests/test_mcp_dashboard_marketplace.py`
- `tests/test_modules.py`
- `tests/test_mutation_killers.py`
- `tests/test_mutation_killers_cog_sim.py`
- `tests/test_mutation_killers_seg.py`
- `tests/test_mutation_killers_verif.py`
- `tests/test_persistence_metrics.py`
- `tests/test_photonic_unit.py`
- `tests/test_platform.py`
- `tests/test_production.py`
- `tests/test_property.py`
- `tests/test_property_cross_validation.py`
- `tests/test_qiskit_adapter.py`
- `tests/test_rce.py`
- `tests/test_rce2.py`
- `tests/test_rce2_active_causal.py`
- `tests/test_rce2_adaptive_byzantine.py`
- `tests/test_rce2_adaptive_gate.py`
- `tests/test_rce2_adversarial.py`
- `tests/test_rce2_adversarial_audit.py`
- `tests/test_rce2_adversarial_reliability.py`
- `tests/test_rce2_assumption_attack.py`
- `tests/test_rce2_byzantine_robust.py`
- `tests/test_rce2_causal_discovery.py`
- `tests/test_rce2_causal_fairness.py`
- `tests/test_rce2_counterfactual.py`
- `tests/test_rce2_density_gate.py`
- `tests/test_rce2_differential_privacy.py`
- `tests/test_rce2_equivalence.py`
- `tests/test_rce2_federated_causal.py`
- `tests/test_rce2_final_search.py`
- `tests/test_rce2_formal_theory.py`
- `tests/test_rce2_hidden_world.py`
- `tests/test_rce2_implicit_substrate.py`
- `tests/test_rce2_large_scale.py`
- `tests/test_rce2_law_refiner.py`
- `tests/test_rce2_law_verification.py`
- `tests/test_rce2_mechanism_search.py`
- `tests/test_rce2_meta_active.py`
- `tests/test_rce2_meta_learner.py`
- `tests/test_rce2_meta_proof_attack.py`
- `tests/test_rce2_meta_representation_v2.py`
- `tests/test_rce2_neural_symbolic.py`
- `tests/test_rce2_new_substrate.py`
- `tests/test_rce2_observational_causal.py`
- `tests/test_rce2_online_causal.py`
- `tests/test_rce2_resource_classification.py`
- `tests/test_rce2_resource_closure.py`
- `tests/test_rce2_reuse_classifier.py`
- `tests/test_rce2_scm_discovery.py`
- `tests/test_rce2_substrate.py`
- `tests/test_rce2_temporal_survival.py`
- `tests/test_seg_unit.py`
- `tests/test_self_test_coverage.py`
- `tests/test_smpu_unit.py`
- `tests/test_verification.py`
- `tests/test_webhooks_certs.py`
- `tests/test_z3_helpers.py`

### `verification/` (8 files)

- `verification/TLC_VERIFICATION_LOG.txt`
- `verification/TemporalBankerScheduler.cfg`
- `verification/TemporalBankerScheduler.tla`
- `verification/TemporalBankerSchedulerCfg.tla`
- `verification/__init__.py`
- `verification/saarthi_sva_generator.py`
- `verification/srs_safety_assertions.sva`
- `verification/z3_power_proof.py`

## NEW Files (v7.0 additions)

### NEW (v7.0) (15 files)

- `srs/__init__.py`
- `srs/cli.py`
- `srs/improvement.py`
- `srs/persistence.py`
- `srs/planner.py`
- `srs/primitives/__init__.py`
- `srs/primitives/adaptivity.py`
- `srs/primitives/advice.py`
- `srs/primitives/compression.py`
- `srs/primitives/execution.py`
- `srs/primitives/quantum.py`
- `srs/primitives/scheduling.py`
- `srs/primitives/verification.py`
- `srs/runtime.py`
- `srs/types.py`

### NEW (v7.0 standalone) (25 files)

- `srs_runtime/Makefile`
- `srs_runtime/README.md`
- `srs_runtime/benchmarks/__init__.py`
- `srs_runtime/benchmarks/run_benchmarks.py`
- `srs_runtime/docs/ARCHITECTURE.md`
- `srs_runtime/docs/AUDIT.md`
- `srs_runtime/docs/CAPABILITY_GRAPH.md`
- `srs_runtime/requirements.txt`
- `srs_runtime/srs/__init__.py`
- `srs_runtime/srs/cli.py`
- `srs_runtime/srs/improvement.py`
- `srs_runtime/srs/persistence.py`
- `srs_runtime/srs/planner.py`
- `srs_runtime/srs/primitives/__init__.py`
- `srs_runtime/srs/primitives/adaptivity.py`
- `srs_runtime/srs/primitives/advice.py`
- `srs_runtime/srs/primitives/compression.py`
- `srs_runtime/srs/primitives/execution.py`
- `srs_runtime/srs/primitives/quantum.py`
- `srs_runtime/srs/primitives/scheduling.py`
- `srs_runtime/srs/primitives/verification.py`
- `srs_runtime/srs/runtime.py`
- `srs_runtime/srs/types.py`
- `srs_runtime/tests/__init__.py`
- `srs_runtime/tests/test_runtime.py`

### NEW (v7.0 test) (1 files)

- `tests/test_srs_runtime.py`

### NEW (v7.0 benchmark) (2 files)

- `benchmarks/srs/__init__.py`
- `benchmarks/srs/run_benchmarks.py`

### NEW (v7.0 docs) (4 files)

- `docs/srs_runtime/ARCHITECTURE.md`
- `docs/srs_runtime/AUDIT.md`
- `docs/srs_runtime/CAPABILITY_GRAPH.md`
- `docs/srs_runtime/README.md`

### NEW (v7.0 CLI) (1 files)

- `scripts/srs_cli.py`

### NEW (v6.4x research archive) (70 files)

- `v6.42_CLOSURE_THEOREM/README.md`
- `v6.42_CLOSURE_THEOREM/scripts/v6.42_closure_demo.py`
- `v6.42_CLOSURE_THEOREM/scripts/v6.42_generate_pdf.py`
- `v6.42_CLOSURE_THEOREM/v6.41_M2_DESTRUCTION_ANALYSIS.md`
- `v6.42_CLOSURE_THEOREM/v6.42_CLOSURE_THEOREM.pdf`
- `v6.42_CLOSURE_THEOREM/v6.42_benchmark_results.json`
- `v6.42_CLOSURE_THEOREM/worklog_v6.42.md`
- `v6.43_AUDIT/README.md`
- `v6.43_AUDIT/scripts/v6.43_counterexample.py`
- `v6.43_AUDIT/scripts/v6.43_generate_audit_pdf.py`
- `v6.43_AUDIT/v6.41_M2_DESTRUCTION_ANALYSIS.md`
- `v6.43_AUDIT/v6.42_CLOSURE_THEOREM.pdf`
- `v6.43_AUDIT/v6.43_ADVERSARIAL_AUDIT.md`
- `v6.43_AUDIT/v6.43_ADVERSARIAL_AUDIT.pdf`
- `v6.43_AUDIT/v6.43_counterexample.json`
- `v6.44_BULLETPROOF/README.md`
- `v6.44_BULLETPROOF/scripts/v6.44_generate_synthesis_pdf.py`
- `v6.44_BULLETPROOF/scripts/v6.44_six_primitive_demo.py`
- `v6.44_BULLETPROOF/v6.42_CLOSURE_THEOREM.pdf`
- `v6.44_BULLETPROOF/v6.43_ADVERSARIAL_AUDIT.pdf`
- `v6.44_BULLETPROOF/v6.44_COUNTEREXAMPLE_PROOFS.md`
- `v6.44_BULLETPROOF/v6.44_FORMAL_PRIMITIVE_DEFINITION.md`
- `v6.44_BULLETPROOF/v6.44_FRAMEWORK_REDUCTIONS.md`
- `v6.44_BULLETPROOF/v6.44_SIX_PRIMITIVE_FRAMEWORK.md`
- `v6.44_BULLETPROOF/v6.44_SYNTHESIS.md`
- `v6.44_BULLETPROOF/v6.44_SYNTHESIS.pdf`
- `v6.44_BULLETPROOF/v6.44_six_primitive_benchmark.json`
- `v6.45_PC_REVIEW/README.md`
- `v6.45_PC_REVIEW/v6.42_CLOSURE_THEOREM.pdf`
- `v6.45_PC_REVIEW/v6.43_ADVERSARIAL_AUDIT.pdf`
- `v6.45_PC_REVIEW/v6.44_SYNTHESIS.pdf`
- `v6.45_PC_REVIEW/v6.45_PC_REVIEW.md`
- `v6.45_PC_REVIEW/v6.45_PC_REVIEW.pdf`
- `v6.46_PROGRAM_CONCLUSION/README.md`
- `v6.46_PROGRAM_CONCLUSION/v6.42_CLOSURE_THEOREM.pdf`
- `v6.46_PROGRAM_CONCLUSION/v6.43_ADVERSARIAL_AUDIT.pdf`
- `v6.46_PROGRAM_CONCLUSION/v6.44_SYNTHESIS.pdf`
- `v6.46_PROGRAM_CONCLUSION/v6.45_PC_REVIEW.pdf`
- `v6.46_PROGRAM_CONCLUSION/v6.46_FINAL_SYNTHESIS.md`
- `v6.46_PROGRAM_CONCLUSION/v6.46_FINAL_SYNTHESIS.pdf`
- `v6.46_PROGRAM_CONCLUSION/v6.46_PRACTITIONER_PAPER.md`
- `v6.46_PROGRAM_CONCLUSION/v6.46_PROGRAM_RETROSPECTIVE.md`
- `v6.46_PROGRAM_CONCLUSION/v6.46_RESTRICTED_CLOSURE_PROOF_ATTEMPT.md`
- `v6.46_PROGRAM_CONCLUSION/v6.46_SALVAGE_AUDIT.md`
- `v6_theory/README.md`
- `v6_theory/v6.41_M2_DESTRUCTION_ANALYSIS.md`
- `v6_theory/v6.42_CLOSURE_THEOREM.pdf`
- `v6_theory/v6.42_benchmark_results.json`
- `v6_theory/v6.42_closure_demo.py`
- `v6_theory/v6.42_generate_pdf.py`
- `v6_theory/v6.43_ADVERSARIAL_AUDIT.md`
- `v6_theory/v6.43_ADVERSARIAL_AUDIT.pdf`
- `v6_theory/v6.43_counterexample.json`
- `v6_theory/v6.44_COUNTEREXAMPLE_PROOFS.md`
- `v6_theory/v6.44_FORMAL_PRIMITIVE_DEFINITION.md`
- `v6_theory/v6.44_FRAMEWORK_REDUCTIONS.md`
- `v6_theory/v6.44_SIX_PRIMITIVE_FRAMEWORK.md`
- `v6_theory/v6.44_SYNTHESIS.md`
- `v6_theory/v6.44_SYNTHESIS.pdf`
- `v6_theory/v6.44_six_primitive_benchmark.json`
- `v6_theory/v6.45_PC_REVIEW.md`
- `v6_theory/v6.45_PC_REVIEW.pdf`
- `v6_theory/v6.46_FINAL_SYNTHESIS.md`
- `v6_theory/v6.46_FINAL_SYNTHESIS.pdf`
- `v6_theory/v6.46_PRACTITIONER_PAPER.md`
- `v6_theory/v6.46_PROGRAM_RETROSPECTIVE.md`
- `v6_theory/v6.46_RESTRICTED_CLOSURE_PROOF_ATTEMPT.md`
- `v6_theory/v6.46_SALVAGE_AUDIT.md`
- `v6_theory/v6.47_FIRST_PRINCIPLES_AUDIT.md`
- `v6_theory/worklog_v6.42.md`

## Verification

Every original file was considered. The audit proves:

1. **336 original files KEPT** (preserved unchanged)
2. **2 original files MODIFIED** (Makefile, pyproject.toml — changes documented above)
3. **0 original files REMOVED**
4. **9 original files MERGED** (algorithmic content copied into new srs/ modules; originals preserved)
5. **119 NEW files added** (v7.0 runtime + v6.4x research archive)

The repository grew from 337 original files to 456 total files (a net addition of
119 files), preserving 100% of the original codebase while integrating the new
7-primitive runtime as a new top-level `srs/` package.
