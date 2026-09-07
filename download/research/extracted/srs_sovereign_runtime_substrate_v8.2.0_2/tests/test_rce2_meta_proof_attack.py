"""Tests for Adversarial Meta-Proof Attack."""
from __future__ import annotations
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_meta_proof_attack import (
    Q1_ANALYSIS, Q2_ANALYSIS, Q3_ANALYSIS, Q4_ANALYSIS, Q5_ANALYSIS,
    RIGOROUS_TABLE, CLOSURE_ARGUMENT,
)


class TestQ1Relational:
    def test_survives_false(self):
        assert Q1_ANALYSIS["survives"] is False

    def test_has_reduction(self):
        text = Q1_ANALYSIS["reduction"].lower()
        assert "reduces" in text or "equivalent" in text or "same substrate" in text

    def test_tag_is_proven(self):
        assert "[PROVEN]" in Q1_ANALYSIS["tag"]


class TestQ2Constraint:
    def test_survives_false(self):
        assert Q2_ANALYSIS["survives"] is False

    def test_has_reduction(self):
        assert "representation" in Q2_ANALYSIS["reduction"].lower()

    def test_tag_is_proven(self):
        assert "[PROVEN]" in Q2_ANALYSIS["tag"]


class TestQ3Oracle:
    def test_is_new_primitive(self):
        assert Q3_ANALYSIS["is_new_primitive"] is True

    def test_does_not_survive_physically(self):
        assert Q3_ANALYSIS["survives"] is False

    def test_tag_mentions_church_turing(self):
        assert "Church-Turing" in Q3_ANALYSIS["tag"] or \
               "church-turing" in Q3_ANALYSIS["tag"].lower()


class TestQ4Entropic:
    def test_survives_false(self):
        assert Q4_ANALYSIS["survives"] is False

    def test_mentions_landauer(self):
        assert "Landauer" in Q4_ANALYSIS["formal_model"] or \
               "landauer" in Q4_ANALYSIS["formal_model"].lower()

    def test_reduces_to_program(self):
        assert "program" in Q4_ANALYSIS["reduction"].lower()


class TestQ5SelfReferential:
    def test_survives_false(self):
        assert Q5_ANALYSIS["survives"] is False

    def test_mentions_fixed_point(self):
        assert "fixed" in Q5_ANALYSIS["formal_model"].lower()

    def test_reduces_to_constraint(self):
        assert "constraint" in Q5_ANALYSIS["reduction"].lower()


class TestRigorousTable:
    def test_5_candidates(self):
        assert len(RIGOROUS_TABLE) == 5

    def test_all_have_required_fields(self):
        for name, row in RIGOROUS_TABLE.items():
            assert "candidate" in row
            assert "new_primitive" in row
            assert "reduction_proof" in row
            assert "survives" in row
            assert "tag" in row

    def test_only_oracle_is_new_primitive(self):
        new_primitives = [k for k, v in RIGOROUS_TABLE.items()
                          if v["new_primitive"] == "Yes" or v["new_primitive"] == "Yes (mathematically)"]
        assert "O3_oracle" in new_primitives
        assert len(new_primitives) == 1  # only oracle

    def test_none_survive(self):
        for name, row in RIGOROUS_TABLE.items():
            assert "No" in str(row["survives"]), \
                f"{name} should not survive: {row['survives']}"


class TestClosureArgument:
    def test_exists(self):
        assert len(CLOSURE_ARGUMENT) > 200

    def test_has_qed(self):
        assert "QED" in CLOSURE_ARGUMENT

    def test_identifies_5_escape_routes(self):
        escape_routes = ["1.", "2.", "3.", "4.", "5."]
        for route in escape_routes:
            assert route in CLOSURE_ARGUMENT

    def test_mentions_kolmogorov(self):
        assert "Kolmogorov" in CLOSURE_ARGUMENT

    def test_mentions_church_turing(self):
        assert "Church-Turing" in CLOSURE_ARGUMENT

    def test_mentions_approximate(self):
        assert "approximate" in CLOSURE_ARGUMENT.lower()
