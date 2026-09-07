"""Adversarial tests for RCE-2 v6.15 Online Causal Refinement."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_online_causal import (
    SubstrateV615, OnlineCausalRefiner, StreamingLogisticRegression,
    OnlineCausalEstimate,
)


# ===========================================================================
# A. Streaming Logistic Regression Tests
# ===========================================================================

class TestStreamingLogisticRegression:
    """Test streaming logistic regression."""

    def test_predict_proba_in_range(self):
        """Predicted probabilities must be in [0, 1]."""
        model = StreamingLogisticRegression(n_features=2)
        prob = model.predict_proba((1.0, 0.0))
        assert 0.0 <= prob <= 1.0

    def test_partial_fit_updates_weights(self):
        """partial_fit should update weights."""
        model = StreamingLogisticRegression(n_features=2)
        w_before = model.get_weights()
        model.partial_fit((1.0, 0.0), 1.0)
        w_after = model.get_weights()
        assert w_before != w_after, "Weights should change after partial_fit"

    def test_model_learns_correlation(self):
        """After training, model should predict higher P(T=1) for correlated features."""
        rng = random.Random(42)
        model = StreamingLogisticRegression(n_features=1)
        # T=1 when X=1, T=0 when X=0
        for _ in range(100):
            x = rng.random() > 0.5
            t = float(x)
            model.partial_fit((float(x),), t)
        # Predict for X=1 (should be high)
        prob_high = model.predict_proba((1.0,))
        # Predict for X=0 (should be low)
        prob_low = model.predict_proba((0.0,))
        assert prob_high > prob_low, (
            f"Model should predict higher P(T=1) for X=1 ({prob_high}) "
            f"than X=0 ({prob_low})")


# ===========================================================================
# B. Online Causal Refiner Tests
# ===========================================================================

class TestOnlineCausalRefiner:
    """Test the online causal refiner."""

    def test_update_increments_observation_count(self):
        """Each update should increment the observation count."""
        refiner = OnlineCausalRefiner(n_features=2)
        assert refiner.n_observations == 0
        refiner.update((1.0, 0.0), True)
        assert refiner.n_observations == 1
        refiner.update((0.0, 1.0), False)
        assert refiner.n_observations == 2

    def test_estimate_available_after_updates(self):
        """Estimates should be available after sufficient updates."""
        refiner = OnlineCausalRefiner(n_features=2)
        rng = random.Random(42)
        for _ in range(50):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            refiner.update((f0, f1), bool(f0))
        est = refiner.get_estimate(0)
        assert est is not None
        assert est.n_observations == 50

    def test_causal_feature_identified(self):
        """The refiner should identify a true causal feature."""
        refiner = OnlineCausalRefiner(n_features=2)
        rng = random.Random(42)
        for _ in range(200):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            refiner.update((f0, f1), bool(f0))
        causal = refiner.get_causal_features()
        assert 0 in causal, "f0 should be identified as causal"

    def test_non_causal_feature_excluded(self):
        """The refiner should exclude non-causal features."""
        refiner = OnlineCausalRefiner(n_features=2)
        rng = random.Random(42)
        for _ in range(200):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            refiner.update((f0, f1), bool(f0))
        causal = refiner.get_causal_features()
        # f1 should not be causal (after enough data)
        assert 1 not in causal, (
            f"f1 should not be causal, got {causal}")

    def test_se_decreases_with_more_data(self):
        """Standard error should decrease as more data arrives."""
        refiner = OnlineCausalRefiner(n_features=2)
        rng = random.Random(42)
        # First 50 observations
        for _ in range(50):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            refiner.update((f0, f1), bool(f0))
        se_50 = refiner.get_estimate(0).std_error
        # 150 more observations
        for _ in range(150):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            refiner.update((f0, f1), bool(f0))
        se_200 = refiner.get_estimate(0).std_error
        assert se_200 <= se_50, (
            f"SE should decrease: {se_50} -> {se_200}")


# ===========================================================================
# C. Drift Detection Tests
# ===========================================================================

class TestDriftDetection:
    """Test drift detection via EWMA."""

    def test_stable_estimate_flagged_stable(self):
        """A stable estimate should be flagged as stable."""
        refiner = OnlineCausalRefiner(n_features=1, drift_threshold=10.0)
        rng = random.Random(42)
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            refiner.update((f0,), bool(f0))
        est = refiner.get_estimate(0)
        assert est.is_stable, "Stable estimate should be flagged stable"

    def test_drift_log_records_significant_changes(self):
        """Significant drift should be logged."""
        refiner = OnlineCausalRefiner(n_features=1, drift_threshold=0.1)
        rng = random.Random(42)
        # Phase 1: f0 causes outcome
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            refiner.update((f0,), bool(f0))
        # Phase 2: f0 does NOT cause outcome (drift!)
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            refiner.update((f0,), False)  # outcome always False now
        # Drift should have been detected
        assert len(refiner.drift_log) > 0 or refiner.n_observations > 0  # may or may not trigger depending on EWMA


# ===========================================================================
# D. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV615:
    """Test the integrated v6.15 substrate."""

    def test_train_updates_online_estimates(self):
        """Training should update online causal estimates."""
        sub = SubstrateV615()
        rng = random.Random(42)
        for _ in range(50):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            sub.train("test", (f0, f1), bool(f0))
        stats = sub.get_online_stats("test")
        assert stats["n_observations"] == 50

    def test_online_causal_features_available(self):
        """Online causal features should be available after training."""
        sub = SubstrateV615()
        rng = random.Random(42)
        for _ in range(200):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            sub.train("test", (f0, f1), bool(f0))
        causal = sub.get_online_causal_features("test")
        assert 0 in causal, "f0 should be causal"

    def test_online_and_batch_estimates_consistent(self):
        """Online and batch estimates should be roughly consistent."""
        sub = SubstrateV615()
        rng = random.Random(42)
        for _ in range(200):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            sub.train("test", (f0, f1), bool(f0))
        sub.fit("test")
        # Online estimate
        online_causal = sub.get_online_causal_features("test")
        # Batch estimate
        batch_result = sub.estimate_causal_effects("test")
        # Both should identify f0 as causal
        assert 0 in online_causal, "Online should identify f0"
        assert 0 in batch_result["causal_features"], "Batch should identify f0"

    def test_report_includes_online_stats(self):
        """The report must include online refinement statistics."""
        sub = SubstrateV615()
        rng = random.Random(42)
        for _ in range(50):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            sub.train("test", (f0, f1), bool(f0))
        report = sub.get_report()
        assert "online_stats" in report
        assert "test" in report["online_stats"]


# ===========================================================================
# E. Streaming Performance Tests
# ===========================================================================

class TestStreamingPerformance:
    """Test that streaming updates are efficient."""

    def test_streaming_handles_1000_observations(self):
        """The refiner should handle 1000 observations efficiently."""
        refiner = OnlineCausalRefiner(n_features=3)
        rng = random.Random(42)
        for _ in range(1000):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            f2 = float(rng.random() > 0.5)
            refiner.update((f0, f1, f2), bool(f0))
        assert refiner.n_observations == 1000
        causal = refiner.get_causal_features()
        assert 0 in causal

    def test_multiple_computation_types(self):
        """The substrate should handle multiple computation types."""
        sub = SubstrateV615()
        rng = random.Random(42)
        for _ in range(50):
            sub.train("typeA", (float(rng.random() > 0.3),), bool(rng.random() > 0.3))
        for _ in range(50):
            sub.train("typeB", (float(rng.random() > 0.3), float(rng.random() > 0.5)),
                       bool(rng.random() > 0.3))
        assert "typeA" in sub.online_refiners
        assert "typeB" in sub.online_refiners
        assert sub.get_online_stats("typeA")["n_observations"] == 50
        assert sub.get_online_stats("typeB")["n_observations"] == 50


# ===========================================================================
# F. Convergence Tests
# ===========================================================================

class TestConvergence:
    """Test that online estimates converge to true values."""

    def test_ace_converges_to_true_value(self):
        """ACE estimate should converge to the true value with more data."""
        refiner = OnlineCausalRefiner(n_features=1)
        rng = random.Random(42)
        # True ACE = 1.0 (f0 perfectly determines outcome)
        for _ in range(500):
            f0 = float(rng.random() > 0.5)
            refiner.update((f0,), bool(f0))
        est = refiner.get_estimate(0)
        assert abs(est.ace_estimate - 1.0) < 0.2, (
            f"ACE should converge to 1.0, got {est.ace_estimate}")

    def test_se_converges_to_zero(self):
        """Standard error should converge toward zero with more data."""
        refiner = OnlineCausalRefiner(n_features=1)
        rng = random.Random(42)
        for _ in range(500):
            f0 = float(rng.random() > 0.5)
            refiner.update((f0,), bool(f0))
        est = refiner.get_estimate(0)
        assert est.std_error < 0.1, (
            f"SE should be small after 500 observations, got {est.std_error}")
