"""Tests for Assumption Stress-Test Attack."""
from __future__ import annotations
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "scripts"))

from rce2_assumption_attack import (
    ATTACK_A1, ATTACK_A2, ATTACK_A3, ATTACK_A4, ATTACK_KF,
    STRESS_TEST_TABLE, REVISED_THEOREM,
)


class TestAttackA1:
    def test_a1_survives(self):
        assert ATTACK_A1["violates_A1"] is False
        assert ATTACK_A1["survives"] is False  # attack doesn't survive

    def test_has_reduction(self):
        assert "representation" in ATTACK_A1["reduction"].lower()

    def test_tag_proven(self):
        assert "[PROVEN]" in ATTACK_A1["tag"]


class TestAttackA2:
    def test_a2_survives(self):
        assert ATTACK_A2["violates_A2"] is False

    def test_mentions_temporal(self):
        text = (ATTACK_A2["reduction"] + ATTACK_A2["analysis"]).lower()
        assert "temporal" in text or "instant" in text or "time t" in text


class TestAttackA3:
    def test_a3_violated(self):
        assert ATTACK_A3["violates_A3"] is True
        assert ATTACK_A3["survives"] is True  # attack survives!

    def test_mentions_parallelism(self):
        assert "parallel" in ATTACK_A3["analysis"].lower()

    def test_tag_proves_failure(self):
        assert "A3 fails" in ATTACK_A3["tag"] or "FAILS" in ATTACK_A3["tag"]


class TestAttackA4:
    def test_a4_survives(self):
        assert ATTACK_A4["violates_A4"] is False

    def test_mentions_godel(self):
        assert "Gödel" in ATTACK_A4["analysis"] or "Godel" in ATTACK_A4["analysis"]


class TestAttackKF:
    def test_kf_insufficient(self):
        assert ATTACK_KF["violates_K_bound"] is True
        assert ATTACK_KF["survives"] is True

    def test_mentions_circuit_complexity(self):
        assert "circuit" in ATTACK_KF["analysis"].lower()

    def test_mentions_time_bounded(self):
        assert "time-bounded" in ATTACK_KF["analysis"].lower() or \
               "Kt" in ATTACK_KF["analysis"]


class TestStressTestTable:
    def test_5_assumptions_tested(self):
        assert len(STRESS_TEST_TABLE) == 5

    def test_a3_has_counterexample(self):
        assert STRESS_TEST_TABLE["A3_compactness"]["counterexample_found"] is True

    def test_kf_has_counterexample(self):
        assert STRESS_TEST_TABLE["Kf_bound"]["counterexample_found"] is True

    def test_a1_a2_a4_survive(self):
        for name in ["A1_representation", "A2_generalization", "A4_verification"]:
            assert STRESS_TEST_TABLE[name]["counterexample_found"] is False


class TestRevisedTheorem:
    def test_exists(self):
        assert len(REVISED_THEOREM) > 200

    def test_mentions_dual_bound(self):
        assert "K(f)" in REVISED_THEOREM
        assert "C(f)" in REVISED_THEOREM
        assert "circuit complexity" in REVISED_THEOREM.lower()

    def test_mentions_parallelism(self):
        assert "parallel" in REVISED_THEOREM.lower()

    def test_states_a3_not_necessary(self):
        assert "not NECESSARY" in REVISED_THEOREM or "not necessary" in REVISED_THEOREM.lower()

    def test_states_closure_holds(self):
        assert "CLOSURE HOLDS" in REVISED_THEOREM
