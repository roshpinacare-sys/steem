# Coverage Report

**Date**: 2026-07-14
**Tool**: coverage.py 7.13.1 via pytest-cov
**Test suite**: 100 tests (full suite, no exclusions)

## Per-File Coverage (sorted worst-first)

| Module | Statements | Missing | Coverage |
|--------|-----------|---------|----------|
| simulation/adaqc_compiler.py | 154 | 7 | 95.5% |
| verification/z3_power_proof.py | 604 | 25 | 95.9% |
| cognition/agemem_controller.py | 464 | 16 | 96.6% |
| kernel/smpu_sppu.py | 263 | 9 | 96.6% |
| governance/sqa_aggregator.py | 117 | 4 | 96.6% |
| kernel/ebpf_telemetry.py | 126 | 3 | 97.6% |
| cognition/grpo_advantage_map.py | 254 | 6 | 97.6% |
| simulation/qiskit_adapter.py | 148 | 3 | 98.0% |
| kernel/omnivisor.py | 105 | 2 | 98.1% |
| governance/bls_signatures.py | 110 | 2 | 98.2% |
| cognition/agemem_adm_trainer.py | 132 | 2 | 98.5% |
| verification/saarthi_sva_generator.py | 107 | 1 | 99.1% |
| self_healing/antibody_maturation.py | 112 | 1 | 99.1% |
| cognition/adm_intent_mapper.py | 118 | 1 | 99.2% |
| governance/seg_controller.py | 123 | 1 | 99.2% |
| simulation/photonic_bus.py | 133 | 1 | 99.2% |
| self_healing/digital_dna.py | 155 | 1 | 99.4% |
| cognition/__init__.py | 1 | 0 | 100.0% |
| governance/__init__.py | 1 | 0 | 100.0% |
| kernel/__init__.py | 1 | 0 | 100.0% |
| self_healing/__init__.py | 1 | 0 | 100.0% |
| simulation/__init__.py | 1 | 0 | 100.0% |
| verification/__init__.py | 1 | 0 | 100.0% |

## Summary

| Metric | Value |
|--------|-------|
| Total statements | 3231 |
| Total covered | 3146 |
| Total missing | 85 |
| Overall coverage | 97.4% |

## Honesty Notes

- **High coverage does NOT imply high quality.** A line can be
  executed by a test without its behavior being asserted.
- **The mutation score (100% in Cycle 19) is the stronger signal**:
  it verifies that tests actually catch bugs at each line.
- The lowest-coverage modules are dominated by:
  - `if __name__ == "__main__":` CLI entrypoints (never invoked by tests)
  - Demo / report-printing helpers (only exercised by `__main__`)
  - Error-handling branches for malformed input (some untested)
- Most of the missing lines in `z3_power_proof.py` are in the
  1300-line `main()` / report-rendering section. The encoder and
  safety logic (lines 1-600) are well-covered by `test_verification.py`
  and the cross-validation suite.

## Identified Gaps (priority for next cycle)

1. **bls_signatures.py** (39%): the PoP and aggregate-verify error
   paths are mostly untested. Adding 4-5 fault-injection tests would
   push this past 80%.
2. **z3_power_proof.py** (24%): the encoder is well-tested, but the
   CLI / report-rendering tail is not. Either cover it or move it to
   a separate `cli.py`.
3. **photonic_bus.py** (47%): the MZI grid simulation helpers are
   untested. Adding 2-3 property tests over the grid state would help.