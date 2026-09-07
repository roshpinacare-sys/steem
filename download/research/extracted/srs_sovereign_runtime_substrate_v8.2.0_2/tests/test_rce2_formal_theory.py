"""Tests for Formal Mathematical Theory of Computational Substrates."""
from __future__ import annotations
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_formal_theory import (
    FORMAL_DEFINITION, AXIOMS, THEOREMS, INSTANCES,
    FIELD_COMPARISON, FINAL_ASSESSMENT,
)


class TestFormalDefinition:
    def test_definition_exists(self):
        assert len(FORMAL_DEFINITION) > 100
        assert "𝒳" in FORMAL_DEFINITION  # state space
        assert "𝒴" in FORMAL_DEFINITION  # observation space
        assert "ℛ" in FORMAL_DEFINITION  # representation space
        assert "D" in FORMAL_DEFINITION   # discovery
        assert "V" in FORMAL_DEFINITION   # verification
        assert "E" in FORMAL_DEFINITION   # execution
        assert "Φ" in FORMAL_DEFINITION   # economic cost


class TestAxioms:
    def test_5_axioms_exist(self):
        assert len(AXIOMS) == 5
        for name in ["A1_Consistency", "A2_Generalization", "A3_Compactness",
                      "A4_Escalation", "A5_Amortizability"]:
            assert name in AXIOMS

    def test_axioms_have_required_fields(self):
        for name, ax in AXIOMS.items():
            assert "statement" in ax
            assert "necessary" in ax
            assert "sufficient" in ax
            assert "independent" in ax
            assert "tag" in ax

    def test_a1_a4_are_necessary(self):
        for name in ["A1_Consistency", "A2_Generalization", "A3_Compactness", "A4_Escalation"]:
            assert AXIOMS[name]["necessary"] is True

    def test_a5_is_not_necessary(self):
        assert AXIOMS["A5_Amortizability"]["necessary"] is False

    def test_axioms_are_independent(self):
        for name, ax in AXIOMS.items():
            assert ax["independent"] is True


class TestTheorems:
    def test_5_theorems_exist(self):
        assert len(THEOREMS) == 5

    def test_theorems_have_proofs(self):
        for name, th in THEOREMS.items():
            assert "statement" in th
            assert "proof" in th
            assert "tag" in th
            assert "counterexample_attempt" in th

    def test_theorems_are_proven(self):
        for name, th in THEOREMS.items():
            assert "[PROVEN]" in th["tag"]

    def test_t1_correctness(self):
        assert "T1_Correctness" in THEOREMS
        assert "QED" in THEOREMS["T1_Correctness"]["proof"]

    def test_t2_kolmogorov_bound(self):
        assert "T2_CompressionBounded" in THEOREMS
        assert "K(f)" in THEOREMS["T2_CompressionBounded"]["proof"]

    def test_t3_no_free_lunch(self):
        assert "T3_NoUniversalAdvantage" in THEOREMS
        assert "No Free Lunch" in THEOREMS["T3_NoUniversalAdvantage"]["tag"]


class TestInstances:
    def test_4_instances_exist(self):
        assert len(INSTANCES) == 4
        for name in ["GF2", "Walsh", "DFA", "ProgramSynthesis"]:
            assert name in INSTANCES
            assert INSTANCES[name]["is_instance"] is True

    def test_instances_have_all_components(self):
        for name, inst in INSTANCES.items():
            for component in ["𝒳", "𝒴", "ℛ", "D", "V", "E", "Φ"]:
                assert component in inst


class TestFieldComparison:
    def test_15_fields_compared(self):
        assert len(FIELD_COMPARISON) == 15

    def test_equivalent_fields(self):
        equivalent = [k for k, v in FIELD_COMPARISON.items() if v["equivalent"]]
        assert "PAC_learning" in equivalent
        assert "MDL" in equivalent
        assert "program_synthesis" in equivalent
        assert "symbolic_regression" in equivalent

    def test_non_equivalent_fields(self):
        non_equiv = [k for k, v in FIELD_COMPARISON.items() if not v["equivalent"]]
        assert "abstract_interpretation" in non_equiv
        assert "SAT_SMT" in non_equiv
        assert "compiler_optimization" in non_equiv


class TestFinalAssessment:
    def test_relationship_is_equivalent(self):
        assert "B" in FINAL_ASSESSMENT["relationship"]
        assert "equivalent" in FINAL_ASSESSMENT["relationship"].lower()

    def test_evidence_exists(self):
        assert len(FINAL_ASSESSMENT["evidence"]) >= 5
        for e in FINAL_ASSESSMENT["evidence"]:
            assert any(tag in e for tag in ["[PROVEN]", "[DERIVED]", "[MEASURED]"])

    def test_novelty_claim(self):
        assert "novel" in FINAL_ASSESSMENT["what_is_novel"].lower()
        assert "engineering" in FINAL_ASSESSMENT["what_is_novel"].lower()
