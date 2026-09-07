"""Tests for Adversarial Audit."""
from __future__ import annotations
import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_adversarial_audit import (
    HIDDEN_ASSUMPTIONS, COUNTEREXAMPLES, IMPOSSIBILITY_RESULTS,
    COMPARISON, FINAL_VERDICT,
    gen_divergence_trap, gen_verification_dominance,
    gen_economic_negativity, gen_misleading_valid_compression,
)


class TestAssumptions:
    def test_all_assumptions_documented(self):
        assert len(HIDDEN_ASSUMPTIONS) >= 5
        for key, val in HIDDEN_ASSUMPTIONS.items():
            assert "assumption" in val
            assert "if_false" in val
            assert "status" in val

    def test_assumptions_are_tagged(self):
        for val in HIDDEN_ASSUMPTIONS.values():
            assert any(tag in val["status"] for tag in
                       ["[DERIVED]", "[MEASURED]", "[PROVEN]", "[HYPOTHESIZED]", "[UNKNOWN]"])


class TestCounterexamples:
    def test_counterexamples_exist(self):
        assert len(COUNTEREXAMPLES) >= 5
        for key, val in COUNTEREXAMPLES.items():
            assert "implication" in val
            assert "status" in val

    def test_counterexamples_are_tagged(self):
        for val in COUNTEREXAMPLES.values():
            assert any(tag in val["status"] for tag in
                       ["[PROVEN]", "[DERIVED]", "[MEASURED]", "[HYPOTHESIZED]"])


class TestImpossibilityResults:
    def test_results_exist(self):
        assert len(IMPOSSIBILITY_RESULTS) >= 5
        for key, val in IMPOSSIBILITY_RESULTS.items():
            assert "theorem" in val
            assert "implication" in val
            assert "binding" in val

    def test_all_are_fundamental(self):
        for val in IMPOSSIBILITY_RESULTS.values():
            assert "FUNDAMENTAL" in val["binding"]


class TestComparison:
    def test_all_techniques_compared(self):
        assert len(COMPARISON) >= 10
        for key, val in COMPARISON.items():
            assert "technique" in val
            assert "relationship" in val
            assert "verdict" in val


class TestFinalVerdict:
    def test_verdict_exists(self):
        assert "hypothesis" in FINAL_VERDICT
        assert "assessment" in FINAL_VERDICT
        assert "B" in FINAL_VERDICT["assessment"]  # True under narrow assumptions

    def test_proven_list_exists(self):
        assert len(FINAL_VERDICT["what_is_proven"]) >= 3

    def test_disproven_list_exists(self):
        assert len(FINAL_VERDICT["what_is_disproven"]) >= 3

    def test_unknown_list_exists(self):
        assert len(FINAL_VERDICT["what_remains_unknown"]) >= 1


class TestAdversarialWorlds:
    def test_divergence_trap(self):
        fn, meta = gen_divergence_trap(8, 100, seed=42)
        assert meta["type"] == "divergence_trap"
        assert isinstance(fn(0), bool)

    def test_verification_dominance(self):
        fn, meta = gen_verification_dominance(20, seed=42)
        assert meta["type"] == "verification_dominance"
        assert isinstance(fn(0), bool)

    def test_economic_negativity(self):
        fn, meta = gen_economic_negativity(8, 100, seed=42)
        assert meta["type"] == "economic_negativity"
        assert isinstance(fn(0), bool)

    def test_misleading_compression(self):
        fn, meta = gen_misleading_valid_compression(8, 0.01, seed=42)
        assert meta["type"] == "misleading_compression"
        assert isinstance(fn(0), bool)
