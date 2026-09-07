"""Tests for the self_test() functions of bls_signatures, seg_controller,
and digital_dna.

These self_test() blocks are the main uncovered sections in their respective
modules (each ~50-60% covered, with the self_test accounting for most of the
missing lines). Invoking self_test() directly exercises the full happy path
plus the adversarial checks (tampered messages, tampered signatures, stale
seqs, inadmissible chains, witness hash mismatches, etc.).

Target: push all three modules from ~55% to 80%+ coverage.
"""
from __future__ import annotations

import io
import sys

import pytest


# ---------------------------------------------------------------------------
# governance/bls_signatures.py::self_test()
# ---------------------------------------------------------------------------

def test_bls_self_test_runs_without_error(capsys):
    """BLS self_test() completes without raising and prints a success banner."""
    from governance.bls_signatures import self_test
    self_test()
    captured = capsys.readouterr()
    assert "BLS Signatures" in captured.out
    assert "PASSED" in captured.out
    # The self_test exercises: keypair generation, PoP verification,
    # sign/verify round-trip, tampered message rejection, tampered signature
    # rejection, aggregate + aggregate_verify, evidence binding (sign + verify
    # + tampered witness + tampered assurance), aggregate evidence binding.


def test_bls_self_test_exercises_all_code_paths(capsys):
    """The self_test output should mention all the key BLS operations."""
    from governance.bls_signatures import self_test
    self_test()
    captured = capsys.readouterr()
    # These assertions verify the self_test actually ran the expected paths
    # (not just that it didn't crash).
    assert "PoP" in captured.out  # proof-of-possession
    assert "Signature" in captured.out or "sign" in captured.out.lower()
    assert "Aggregate" in captured.out or "aggregate" in captured.out.lower()
    assert "Evidence binding" in captured.out or "binding" in captured.out.lower()


# ---------------------------------------------------------------------------
# governance/seg_controller.py::self_test()
# ---------------------------------------------------------------------------

def test_seg_self_test_runs_without_error(capsys):
    """SEG self_test() completes without raising and prints a success banner."""
    from governance.seg_controller import self_test
    self_test()
    captured = capsys.readouterr()
    assert "SEG Controller" in captured.out
    assert "PASSED" in captured.out


def test_seg_self_test_exercises_adversarial_checks(capsys):
    """The self_test output should mention the adversarial hardening checks."""
    from governance.seg_controller import self_test
    self_test()
    captured = capsys.readouterr()
    # The self_test exercises:
    # - Valid mutation (admissible)
    # - Stale seq (rejected)
    # - Inadmissible evidence chain (rejected)
    # - Witness hash mismatch (rejected)
    # - Missing witness hash (rejected)
    # - Empty witness hash (rejected)
    # - Missing seq (rejected)
    # - Missing cert ref (rejected)
    assert "Adversarial tests" in captured.out or "adversarial" in captured.out.lower()
    assert "witness" in captured.out.lower()


# ---------------------------------------------------------------------------
# self_healing/digital_dna.py::self_test()
# ---------------------------------------------------------------------------

def test_dna_self_test_runs_without_error(capsys):
    """Digital DNA self_test() completes without raising and prints a success banner."""
    from self_healing.digital_dna import self_test
    self_test()
    captured = capsys.readouterr()
    assert "Digital DNA" in captured.out
    assert "PASSED" in captured.out


def test_dna_self_test_exercises_affinity_and_registry(capsys):
    """The self_test output should mention affinity + registry operations."""
    from self_healing.digital_dna import self_test
    self_test()
    captured = capsys.readouterr()
    # The self_test exercises:
    # - DNA encoding (SHA-256 strand + fingerprint)
    # - Affinity computation (identity, similar, dissimilar, symmetry)
    # - Registry operations (register, lookup, by_kind)
    # - Fitness update
    assert "affinity" in captured.out.lower() or "Affinity" in captured.out
    assert "Registry" in captured.out or "registry" in captured.out.lower()
    assert "fitness" in captured.out.lower() or "Fitness" in captured.out


# ---------------------------------------------------------------------------
# Combined: verify all three self_tests can run in sequence without
# interference (they share no state, but this catches import-time issues).
# ---------------------------------------------------------------------------

def test_all_three_self_tests_in_sequence(capsys):
    """Run all three self_tests in sequence — verifies no shared-state bugs."""
    from governance.bls_signatures import self_test as bls_self_test
    from governance.seg_controller import self_test as seg_self_test
    from self_healing.digital_dna import self_test as dna_self_test

    bls_self_test()
    _ = capsys.readouterr()  # discard

    seg_self_test()
    _ = capsys.readouterr()  # discard

    dna_self_test()
    _ = capsys.readouterr()  # discard

    # If we reached here, all three passed without raising.


# ---------------------------------------------------------------------------
# kernel/ebpf_telemetry.py::self_test()
# ---------------------------------------------------------------------------

def test_ebpf_self_test_runs_without_error(capsys):
    """eBPF telemetry self_test() completes without raising."""
    from kernel.ebpf_telemetry import self_test
    self_test()
    captured = capsys.readouterr()
    assert "Telemetry" in captured.out or "telemetry" in captured.out.lower()
    assert "PASSED" in captured.out


def test_ebpf_self_test_exercises_ring_buffer(capsys):
    """The self_test output should mention telemetry bus + drain operations."""
    from kernel.ebpf_telemetry import self_test
    self_test()
    captured = capsys.readouterr()
    # The self_test exercises: ring buffer push/pop, unified telemetry bus,
    # snapshot, drain_all. The output uses "Telemetry Bus" and "Drained".
    out_lower = captured.out.lower()
    assert "telemetry" in out_lower
    assert "drained" in out_lower or "drain" in out_lower


# ---------------------------------------------------------------------------
# verification/saarthi_sva_generator.py::self_test()
# ---------------------------------------------------------------------------

def test_sva_self_test_runs_without_error(capsys):
    """SVA generator self_test() completes without raising."""
    from verification.saarthi_sva_generator import self_test
    self_test()
    captured = capsys.readouterr()
    assert "SVA" in captured.out or "Saarthi" in captured.out or "saarthi" in captured.out.lower()
    assert "PASSED" in captured.out


def test_sva_self_test_generates_assert_properties(capsys):
    """The self_test output should mention assert property generation."""
    from verification.saarthi_sva_generator import self_test
    self_test()
    captured = capsys.readouterr()
    # The self_test generates SVA assertions (assert property, not cover)
    assert "assert" in captured.out.lower() or "property" in captured.out.lower()


# ---------------------------------------------------------------------------
# kernel/omnivisor.py::self_test()
# ---------------------------------------------------------------------------

def test_omnivisor_self_test_runs_without_error(capsys):
    """Omnivisor self_test() completes without raising."""
    from kernel.omnivisor import self_test
    self_test()
    captured = capsys.readouterr()
    assert "Omnivisor" in captured.out or "omnivisor" in captured.out.lower()
    assert "PASSED" in captured.out


def test_omnivisor_self_test_exercises_isolation(capsys):
    """The self_test output should mention TI/isolation checks."""
    from kernel.omnivisor import self_test
    self_test()
    captured = capsys.readouterr()
    out_lower = captured.out.lower()
    assert "ti" in out_lower or "isolation" in out_lower or "owner" in out_lower


# ---------------------------------------------------------------------------
# governance/sqa_aggregator.py::self_test()
# ---------------------------------------------------------------------------

def test_sqa_self_test_runs_without_error(capsys):
    """SQA aggregator self_test() completes without raising."""
    from governance.sqa_aggregator import self_test
    self_test()
    captured = capsys.readouterr()
    assert "SQA" in captured.out or "Quorum" in captured.out or "quorum" in captured.out.lower()
    assert "PASSED" in captured.out


def test_sqa_self_test_exercises_quorum_assembly(capsys):
    """The self_test output should mention quorum + certificate operations."""
    from governance.sqa_aggregator import self_test
    self_test()
    captured = capsys.readouterr()
    out_lower = captured.out.lower()
    assert "quorum" in out_lower or "threshold" in out_lower
    assert "certificate" in out_lower or "validator" in out_lower or "serialised" in out_lower


# ---------------------------------------------------------------------------
# cognition/adm_intent_mapper.py::main()
# ---------------------------------------------------------------------------

def test_adm_intent_mapper_main_runs_without_error(capsys):
    """adm_intent_mapper main() completes without raising."""
    from cognition.adm_intent_mapper import main
    rc = main()
    assert rc == 0
    captured = capsys.readouterr()
    assert "Adm" in captured.out or "adm" in captured.out.lower() or "Intent" in captured.out


# ---------------------------------------------------------------------------
# kernel/smpu_sppu.py::self_test()
# ---------------------------------------------------------------------------

def test_smpu_self_test_runs_without_error(capsys):
    """SMPU/SPPU self_test() completes without raising."""
    from kernel.smpu_sppu import self_test
    self_test()
    captured = capsys.readouterr()
    assert "SMPU" in captured.out or "SPPU" in captured.out or "smpu" in captured.out.lower()
    assert "PASSED" in captured.out


def test_smpu_self_test_exercises_repartition(capsys):
    """The self_test output should mention repartition/quarantine/shrink."""
    from kernel.smpu_sppu import self_test
    self_test()
    captured = capsys.readouterr()
    out_lower = captured.out.lower()
    # The self_test exercises ECR quarantine, thermal shrink, SC promotion,
    # and restore. Output should mention at least one of these.
    assert any(kw in out_lower for kw in
               ["quarantine", "shrink", "repartition", "promote", "restore",
                "fpga", "thermal", "ecr"])


# ---------------------------------------------------------------------------
# simulation/adaqc_compiler.py::self_test()
# ---------------------------------------------------------------------------

def test_adaqc_self_test_runs_without_error(capsys):
    """AdaQC compiler self_test() completes without raising."""
    from simulation.adaqc_compiler import self_test
    self_test()
    captured = capsys.readouterr()
    assert "AdaQC" in captured.out or "adaqc" in captured.out.lower() or "compiler" in captured.out.lower()
    assert "PASSED" in captured.out


def test_adaqc_self_test_exercises_compilation(capsys):
    """The self_test output should mention compilation/routing/fidelity."""
    from simulation.adaqc_compiler import self_test
    self_test()
    captured = capsys.readouterr()
    out_lower = captured.out.lower()
    assert any(kw in out_lower for kw in
               ["compile", "route", "fidelity", "gate", "depth", "floyd",
                "warshall", "circuit"])


# ---------------------------------------------------------------------------
# simulation/photonic_bus.py::self_test()
# ---------------------------------------------------------------------------

def test_photonic_self_test_runs_without_error(capsys):
    """Photonic bus self_test() completes without raising."""
    from simulation.photonic_bus import self_test
    self_test()
    captured = capsys.readouterr()
    assert "Photonic" in captured.out or "photonic" in captured.out.lower() or "MZI" in captured.out
    assert "PASSED" in captured.out


def test_photonic_self_test_exercises_throughput(capsys):
    """The self_test output should mention throughput/packet/delivery."""
    from simulation.photonic_bus import self_test
    self_test()
    captured = capsys.readouterr()
    out_lower = captured.out.lower()
    assert any(kw in out_lower for kw in
               ["throughput", "packet", "deliver", "mzi", "wavelength",
                "fibre", "bandwidth", "mbps", "tbps"])


# ---------------------------------------------------------------------------
# cognition/agemem_controller.py::self_test()
# ---------------------------------------------------------------------------

def test_agemem_self_test_runs_without_error(capsys):
    """AgeMem controller self_test() completes without raising."""
    from cognition.agemem_controller import self_test
    result = self_test(n_iters=2)  # fewer iterations for speed
    # self_test returns a metrics dict
    assert isinstance(result, dict)
    captured = capsys.readouterr()
    assert "AgeMem" in captured.out or "agemem" in captured.out.lower() or "GRPO" in captured.out


def test_agemem_self_test_returns_metrics(capsys):
    """The self_test returns a metrics dict with training history."""
    from cognition.agemem_controller import self_test
    result = self_test(n_iters=2)
    assert isinstance(result, dict)
    assert len(result) > 0  # non-empty metrics


# ---------------------------------------------------------------------------
# Combined: verify all 9 self_tests can run in sequence
# ---------------------------------------------------------------------------

def test_all_self_tests_in_sequence(capsys):
    """Run all 9 self_tests in sequence — verifies no shared-state bugs."""
    from governance.bls_signatures import self_test as bls_st
    from governance.seg_controller import self_test as seg_st
    from governance.sqa_aggregator import self_test as sqa_st
    from self_healing.digital_dna import self_test as dna_st
    from self_healing.antibody_maturation import self_test as ab_st
    from kernel.omnivisor import self_test as omni_st
    from kernel.smpu_sppu import self_test as smpu_st
    from kernel.ebpf_telemetry import self_test as ebpf_st
    from simulation.adaqc_compiler import self_test as adaqc_st
    from simulation.photonic_bus import self_test as photonic_st

    for name, fn in [
        ("bls", bls_st), ("seg", seg_st), ("sqa", sqa_st),
        ("dna", dna_st), ("antibody", ab_st), ("omnivisor", omni_st),
        ("smpu", smpu_st), ("ebpf", ebpf_st),
        ("adaqc", adaqc_st), ("photonic", photonic_st),
    ]:
        fn()
        _ = capsys.readouterr()  # discard
    # If we reached here, all 10 self_tests passed without raising.
