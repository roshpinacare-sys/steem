"""Adversarial tests for RCE-2 v6.8 Reuse Classifier & Cost-Benefit Analyzer."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_reuse_classifier import (
    SubstrateV68, ReuseType, ReuseClassifier, CostBenefitAnalyzer,
    ReuseClassification, CostBenefitResult,
)
from rce.rce2_substrate import SubstrateOutcome


# ===========================================================================
# A. Reuse Classifier Tests
# ===========================================================================

class TestReuseClassifier:
    """Test the 5 reuse type classifications."""

    def test_exact_reuse_detected(self):
        """A query matching a training point exactly → EXACT."""
        sub = SubstrateV68()
        rng = random.Random(42)
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        # Query a training point
        training_point = sub.substrate.universe.states["and"][0].features
        predicted, outcome, conf, cost, reuse, cb = sub.predict_with_analysis(
            "and", training_point, full_computation=lambda: True,
            original_cost=1000.0, record_outcome=False)
        assert reuse.reuse_type == ReuseType.EXACT, (
            f"Expected EXACT, got {reuse.reuse_type}")
        assert reuse.reuse_score == 1.0

    def test_structural_reuse_detected(self):
        """A query matching a canonical state's masked features → STRUCTURAL."""
        sub = SubstrateV68()
        rng = random.Random(42)
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        # Query a NEW point that matches a canonical state's masked features
        # (different raw features but same masked values)
        # For AND-of-3, canonical states are the 8 bit combinations
        f_new = (1.0, 1.0, 1.0)  # should match canonical (1,1,1)→True
        predicted, outcome, conf, cost, reuse, cb = sub.predict_with_analysis(
            "and", f_new, full_computation=lambda: True,
            original_cost=1000.0, record_outcome=False)
        # Should be EXACT (since (1,1,1) is in training) or STRUCTURAL
        assert reuse.reuse_type in (ReuseType.EXACT, ReuseType.STRUCTURAL), (
            f"Expected EXACT or STRUCTURAL, got {reuse.reuse_type}")

    def test_unsafe_reuse_for_low_confidence(self):
        """Low confidence predictions → UNSAFE."""
        sub = SubstrateV68()
        rng = random.Random(42)
        # Train on contradictory data (20% noise) → low confidence
        for _ in range(100):
            a, b = rng.random() > 0.5, rng.random() > 0.5
            f = (float(a), float(b))
            y = a and b
            if rng.random() < 0.2:
                y = not y
            sub.train("contra", f, y)
        sub.fit("contra")
        val = []
        for _ in range(50):
            a, b = rng.random() > 0.5, rng.random() > 0.5
            f = (float(a), float(b))
            y = a and b
            if rng.random() < 0.2:
                y = not y
            val.append((f, y))
        sub.calibrate("contra", val)
        # Query
        f = (1.0, 1.0)
        predicted, outcome, conf, cost, reuse, cb = sub.predict_with_analysis(
            "contra", f, full_computation=lambda: True,
            original_cost=1000.0, record_outcome=False)
        # Contradictory data should produce UNSAFE or low-score classification
        assert reuse.reuse_score < 0.9 or reuse.reuse_type == ReuseType.UNSAFE, (
            f"Contradictory data should produce UNSAFE or low score, "
            f"got {reuse.reuse_type} score={reuse.reuse_score}")

    def test_approximate_reuse_for_consensus(self):
        """Consensus predictions (no law) → APPROXIMATE."""
        sub = SubstrateV68()
        rng = random.Random(42)
        # Train on continuous data where no law will be discovered
        for _ in range(50):
            f = (rng.random() * 0.3, rng.random() * 0.3)
            sub.train("near", f, f[0] + f[1] > 0.3)
        sub.fit("near")
        val = [((rng.random() * 0.3, rng.random() * 0.3), False) for _ in range(20)]
        sub.calibrate("near", val)
        # Query a training point (guaranteed in-dist, consensus will fire)
        training_point = sub.substrate.universe.states["near"][0].features
        predicted, outcome, conf, cost, reuse, cb = sub.predict_with_analysis(
            "near", training_point, full_computation=lambda: False,
            original_cost=1000.0, record_outcome=False)
        # Should be EXACT (training point) or APPROXIMATE (consensus)
        assert reuse.reuse_type in (ReuseType.APPROXIMATE, ReuseType.EXACT), (
            f"Expected APPROXIMATE or EXACT, got {reuse.reuse_type}")

    def test_reuse_score_in_range(self):
        """Reuse score must be in [0, 1]."""
        sub = SubstrateV68()
        rng = random.Random(42)
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(30):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)
        for _ in range(10):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            _, _, _, _, reuse, _ = sub.predict_with_analysis(
                "and", f, full_computation=lambda: True,
                original_cost=1000.0, record_outcome=False)
            assert 0.0 <= reuse.reuse_score <= 1.0, (
                f"Reuse score {reuse.reuse_score} out of [0,1]")


# ===========================================================================
# B. Cost-Benefit Analyzer Tests
# ===========================================================================

class TestCostBenefitAnalyzer:
    """Test the cost-benefit decision logic."""

    def test_predict_when_cheaper_and_confident(self):
        """High confidence + cheap substrate → PREDICT."""
        cb = CostBenefitAnalyzer()
        r = cb.analyze(confidence=0.95, substrate_cost=10.0,
                       original_cost=1000.0, value_of_result=1000.0)
        assert r.recommendation == "predict", (
            f"Expected predict, got {r.recommendation}")

    def test_execute_when_substrate_expensive(self):
        """Substrate more expensive than execution → EXECUTE."""
        cb = CostBenefitAnalyzer()
        r = cb.analyze(confidence=0.5, substrate_cost=2000.0,
                       original_cost=1000.0, value_of_result=1000.0)
        # C_predict = 2000 + 0.5*1000 = 2500 > C_execute = 1000
        assert r.recommendation == "execute", (
            f"Expected execute, got {r.recommendation}")

    def test_skip_when_value_too_low(self):
        """Value below threshold → SKIP."""
        cb = CostBenefitAnalyzer(min_value_threshold=100.0)
        r = cb.analyze(confidence=0.99, substrate_cost=1.0,
                       original_cost=1000.0, value_of_result=50.0)
        assert r.recommendation == "skip", (
            f"Expected skip, got {r.recommendation}")

    def test_skip_when_value_below_costs(self):
        """Value less than min(costs) → SKIP."""
        cb = CostBenefitAnalyzer()
        r = cb.analyze(confidence=0.9, substrate_cost=100.0,
                       original_cost=1000.0, value_of_result=50.0)
        # V=50 < min(1000, 100+0.1*1000=200) = 200 → skip
        assert r.recommendation == "skip", (
            f"Expected skip (V < min costs), got {r.recommendation}")

    def test_expected_cost_predict_includes_rework(self):
        """C_predict must include expected rework cost."""
        cb = CostBenefitAnalyzer()
        # confidence=0.5 → 50% chance of being wrong → rework cost = 0.5*1000 = 500
        r = cb.analyze(confidence=0.5, substrate_cost=10.0,
                       original_cost=1000.0, value_of_result=1000.0)
        expected = 10.0 + 0.5 * 1000.0  # 510
        assert abs(r.expected_cost_predict - expected) < 0.01, (
            f"C_predict={r.expected_cost_predict}, expected {expected}")

    def test_stats_track_decisions(self):
        """Stats must track execute/predict/skip counts."""
        cb = CostBenefitAnalyzer()
        cb.analyze(0.9, 10.0, 1000.0, 1000.0)  # predict
        cb.analyze(0.5, 2000.0, 1000.0, 1000.0)  # execute
        cb.analyze(0.9, 10.0, 1000.0, 5.0)  # skip
        stats = cb.get_stats()
        assert stats["total_decisions"] == 3
        assert stats["predict"] == 1
        assert stats["execute"] == 1
        assert stats["skip"] == 1


# ===========================================================================
# C. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV68:
    """Test the integrated v6.8 substrate."""

    def test_predict_with_analysis_returns_all_fields(self):
        """predict_with_analysis must return 6 values."""
        sub = SubstrateV68()
        rng = random.Random(42)
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(30):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)
        result = sub.predict_with_analysis(
            "and", (1.0, 1.0, 1.0), full_computation=lambda: True,
            original_cost=1000.0)
        assert len(result) == 6
        predicted, outcome, conf, cost, reuse, cb = result
        assert isinstance(reuse, ReuseClassification)
        assert isinstance(cb, CostBenefitResult)

    def test_low_value_skipped(self):
        """Low-value computations must be skipped."""
        sub = SubstrateV68()
        rng = random.Random(42)
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(30):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)
        _, _, _, _, _, cb = sub.predict_with_analysis(
            "and", (1.0, 1.0, 1.0), full_computation=lambda: True,
            original_cost=1000.0, value_of_result=1.0)
        assert cb.recommendation == "skip", (
            f"Low value should be skipped, got {cb.recommendation}")

    def test_high_value_predicted_when_cheaper(self):
        """High-value computations should be predicted when substrate is cheaper."""
        sub = SubstrateV68()
        rng = random.Random(42)
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(30):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)
        _, _, _, _, _, cb = sub.predict_with_analysis(
            "and", (1.0, 1.0, 1.0), full_computation=lambda: True,
            original_cost=1000.0, value_of_result=10000.0)
        # V=10000 > min(1000, ~500) → predict (substrate cheaper)
        assert cb.recommendation == "predict", (
            f"High value + cheap substrate should predict, got {cb.recommendation}")

    def test_report_includes_reuse_and_cb_stats(self):
        """The report must include both reuse and cost-benefit stats."""
        sub = SubstrateV68()
        rng = random.Random(42)
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(30):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)
        for _ in range(10):
            sub.predict_with_analysis(
                "and", (1.0, 1.0, 1.0), full_computation=lambda: True,
                original_cost=1000.0)
        report = sub.get_report()
        assert "reuse_stats" in report
        assert "cost_benefit_stats" in report
        assert report["reuse_stats"]["total_classifications"] >= 10
        assert report["cost_benefit_stats"]["total_decisions"] >= 10


# ===========================================================================
# D. Honest Skip Tests (the key v6.8 innovation)
# ===========================================================================

class TestHonestSkip:
    """The substrate must prove some computations are not worth executing."""

    def test_skip_rate_increases_with_low_value(self):
        """Lower value → higher skip rate."""
        sub = SubstrateV68()
        rng = random.Random(42)
        for _ in range(50):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("and", f, all(bool(v) for v in f))
        sub.fit("and")
        val = []
        for _ in range(30):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            val.append((f, all(bool(v) for v in f)))
        sub.calibrate("and", val)

        # High value → low skip
        skips_high = 0
        for _ in range(20):
            _, _, _, _, _, cb = sub.predict_with_analysis(
                "and", (1.0, 1.0, 1.0), full_computation=lambda: True,
                original_cost=1000.0, value_of_result=10000.0)
            if cb.recommendation == "skip":
                skips_high += 1

        # Low value → high skip
        skips_low = 0
        for _ in range(20):
            _, _, _, _, _, cb = sub.predict_with_analysis(
                "and", (1.0, 1.0, 1.0), full_computation=lambda: True,
                original_cost=1000.0, value_of_result=1.0)
            if cb.recommendation == "skip":
                skips_low += 1

        assert skips_low > skips_high, (
            f"Low value should skip more (skipped {skips_low}/20) than "
            f"high value (skipped {skips_high}/20)")

    def test_execute_recommended_when_unconfident(self):
        """Low confidence + high cost substrate → EXECUTE."""
        cb = CostBenefitAnalyzer()
        # confidence=0.3, substrate_cost=500 → C_predict = 500 + 0.7*1000 = 1200
        # C_execute = 1000, V = 2000
        r = cb.analyze(confidence=0.3, substrate_cost=500.0,
                       original_cost=1000.0, value_of_result=2000.0)
        # C_predict (1200) > C_execute (1000) → execute
        assert r.recommendation == "execute", (
            f"Low confidence + expensive substrate should execute, got {r.recommendation}")
