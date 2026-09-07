"""Tests for Equivalence Analysis."""
from __future__ import annotations
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_equivalence_proof import (
    SYSTEM_DEFINITIONS, REDUCTIONS, SEPARATING_EXAMPLES,
    PROPERTY_COMPARISON, FINAL_VERDICT,
)


class TestSystemDefinitions:
    def test_both_systems_defined(self):
        assert "S_substrate" in SYSTEM_DEFINITIONS
        assert "P_synthesis" in SYSTEM_DEFINITIONS

    def test_definitions_complete(self):
        for sys_name, sys_def in SYSTEM_DEFINITIONS.items():
            assert "input" in sys_def
            assert "output" in sys_def
            assert "search_space" in sys_def
            assert "verification" in sys_def
            assert "failure_conditions" in sys_def
            assert "expressiveness" in sys_def


class TestReductions:
    def test_P_simulates_S_exists(self):
        assert "P_simulates_S" in REDUCTIONS
        assert "[PROVEN]" in REDUCTIONS["P_simulates_S"]["status"]

    def test_S_simulates_P_exists(self):
        assert "S_simulates_P" in REDUCTIONS
        assert "[PROVEN]" in REDUCTIONS["S_simulates_P"]["status"]

    def test_S_simulates_P_fails(self):
        """The S→P reduction must FAIL (S cannot simulate P)."""
        assert "COUNTEREXAMPLE" in REDUCTIONS["S_simulates_P"]["proof"]


class TestSeparatingExamples:
    def test_separating_examples_exist(self):
        assert len(SEPARATING_EXAMPLES) >= 3

    def test_SEP1_AND_exists(self):
        assert "SEP1_AND" in SEPARATING_EXAMPLES
        sep = SEPARATING_EXAMPLES["SEP1_AND"]
        assert "AND" in sep["function"]
        assert "P_result" in sep
        assert "S_result" in sep


class TestPropertyComparison:
    def test_all_7_properties_compared(self):
        expected = {"expressiveness", "completeness", "sample_complexity",
                    "verification_strength", "amortized_compute_cost",
                    "asymptotic_scaling", "false_compression_risk"}
        assert expected == set(PROPERTY_COMPARISON.keys())

    def test_each_property_has_verdict(self):
        for prop, comp in PROPERTY_COMPARISON.items():
            assert "S" in comp
            assert "P" in comp
            assert "verdict" in comp


class TestFinalVerdict:
    def test_verdict_is_strictly_weaker(self):
        assert FINAL_VERDICT["relationship"] == "STRICTLY WEAKER"

    def test_proof_contains_both_directions(self):
        proof = FINAL_VERDICT["proof"]
        assert "S ⊆ P" in proof  # P simulates S
        assert "S ⊉ P" in proof  # S cannot simulate P

    def test_tags_exist(self):
        tags = FINAL_VERDICT["tags"]
        assert "S_subset_P" in tags
        assert "P_not_subset_S" in tags
        assert "S_strictly_weaker" in tags

    def test_nuance_mentions_advantages(self):
        nuance = FINAL_VERDICT["nuance"]
        assert "polynomial" in nuance.lower()  # S is cheaper for linear
        assert "verification" in nuance.lower()  # S has stronger verification
