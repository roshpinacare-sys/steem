"""Adversarial tests for RCE-2 v6.14 Observational Causal Estimation."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_observational_causal import (
    SubstrateV614, ObservationalCausalEstimator, CausalEstimate,
    estimate_propensity_scores,
)


# ===========================================================================
# A. Propensity Score Tests
# ===========================================================================

class TestPropensityScores:
    """Test propensity score estimation."""

    def test_propensity_scores_in_range(self):
        """Propensity scores must be in (0, 1)."""
        rng = random.Random(42)
        features = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        treatments = [f[0] for f in features]
        scores = estimate_propensity_scores(features, treatments, 0)
        assert all(0 < s < 1 for s in scores), (
            "Propensity scores must be in (0, 1)")

    def test_propensity_scores_length_matches(self):
        """Number of propensity scores must match input length."""
        features = [(1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
        treatments = [1.0, 0.0, 1.0]
        scores = estimate_propensity_scores(features, treatments, 0)
        assert len(scores) == 3


# ===========================================================================
# B. ACE Estimation Tests
# ===========================================================================

class TestACEEstimation:
    """Test ACE estimation methods."""

    def test_psm_identifies_causal_feature(self):
        """PSM should identify a true causal feature."""
        rng = random.Random(42)
        # f0 causes outcome, f1 is noise
        features = []
        outcomes = []
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            features.append((f0, f1))
            outcomes.append(bool(f0))
        estimator = ObservationalCausalEstimator(ace_threshold=0.1)
        result = estimator.estimate_ace_psm(features, outcomes, 0)
        assert result.is_causal, "f0 should be identified as causal"
        assert result.ace_estimate > 0.5

    def test_psm_identifies_non_causal_feature(self):
        """PSM should identify a non-causal feature."""
        rng = random.Random(42)
        features = []
        outcomes = []
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            features.append((f0, f1))
            outcomes.append(bool(f0))  # outcome depends only on f0
        estimator = ObservationalCausalEstimator(ace_threshold=0.1)
        result = estimator.estimate_ace_psm(features, outcomes, 1)
        assert not result.is_causal, "f1 should not be identified as causal"

    def test_ipw_identifies_causal_feature(self):
        """IPW should identify a true causal feature."""
        rng = random.Random(42)
        features = []
        outcomes = []
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            features.append((f0, f1))
            outcomes.append(bool(f0))
        estimator = ObservationalCausalEstimator(ace_threshold=0.1)
        result = estimator.estimate_ace_ipw(features, outcomes, 0)
        assert result.is_causal, "f0 should be identified as causal"

    def test_doubly_robust_identifies_causal_feature(self):
        """DR should identify a true causal feature."""
        rng = random.Random(42)
        features = []
        outcomes = []
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            features.append((f0, f1))
            outcomes.append(bool(f0))
        estimator = ObservationalCausalEstimator(ace_threshold=0.1)
        result = estimator.estimate_ace_dr(features, outcomes, 0)
        assert result.is_causal, "f0 should be identified as causal"

    def test_methods_cross_check(self):
        """All three methods should agree on causal features."""
        rng = random.Random(42)
        features = []
        outcomes = []
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            features.append((f0, f1))
            outcomes.append(bool(f0))
        estimator = ObservationalCausalEstimator(ace_threshold=0.1)
        estimates = estimator.estimate_all("test", features, outcomes)
        for e in estimates:
            if e.is_causal:
                # Methods should agree on causal features
                assert e.method_specific.get("methods_agree", False), (
                    f"Methods should agree on causal feature {e.feature_index}")


# ===========================================================================
# C. Confounder Handling Tests
# ===========================================================================

class TestConfounderHandling:
    """Test observational estimation with confounders."""

    def test_confounder_correlates_with_outcome(self):
        """A confounder correlates with outcome but doesn't cause it.

        Observational methods cannot distinguish confounders from causes
        when perfectly correlated. This test documents that limitation.
        """
        rng = random.Random(42)
        # f0 causes both f1 and outcome → f1 is confounder
        features = []
        outcomes = []
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = f0  # perfectly confounded
            features.append((f0, f1))
            outcomes.append(bool(f0))
        estimator = ObservationalCausalEstimator(ace_threshold=0.1)
        estimates = estimator.estimate_all("confounded", features, outcomes)
        # Both f0 and f1 will be identified as "causal" because they're
        # perfectly correlated. This is the known limitation.
        # The test verifies the estimator runs without error and produces
        # estimates for both features.
        assert len(estimates) == 2

    def test_irrelevant_feature_correctly_identified(self):
        """Irrelevant features should be correctly identified as non-causal."""
        rng = random.Random(42)
        features = []
        outcomes = []
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)  # irrelevant
            features.append((f0, f1))
            outcomes.append(bool(f0))
        estimator = ObservationalCausalEstimator(ace_threshold=0.1)
        estimates = estimator.estimate_all("test", features, outcomes)
        # f1 should not be causal
        f1_estimate = [e for e in estimates if e.feature_index == 1][0]
        assert not f1_estimate.is_causal, (
            "Irrelevant feature f1 should not be identified as causal")


# ===========================================================================
# D. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV614:
    """Test the integrated v6.14 substrate."""

    def test_estimate_causal_effects_from_observations(self):
        """The substrate should estimate causal effects from training data."""
        sub = SubstrateV614()
        rng = random.Random(42)
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            sub.train("test", (f0, f1), bool(f0))
        sub.fit("test")
        result = sub.estimate_causal_effects("test")
        assert "n_features" in result
        assert "n_causal" in result
        assert "causal_features" in result

    def test_get_causal_features(self):
        """get_causal_features should return the estimated causal features."""
        sub = SubstrateV614()
        rng = random.Random(42)
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            sub.train("test", (f0, f1), bool(f0))
        sub.fit("test")
        sub.estimate_causal_effects("test")
        causal = sub.get_causal_features("test")
        assert 0 in causal, "f0 should be causal"
        assert 1 not in causal, "f1 should not be causal"

    def test_no_compute_fn_required(self):
        """Estimation should work without the ground truth compute_fn."""
        sub = SubstrateV614()
        rng = random.Random(42)
        # Only training data — no compute_fn
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            sub.train("test", (f0, f1), bool(f0))
        sub.fit("test")
        # estimate_causal_effects does NOT take a compute_fn
        result = sub.estimate_causal_effects("test")
        assert "error" not in result

    def test_report_includes_observational_stats(self):
        """The report must include observational estimation statistics."""
        sub = SubstrateV614()
        rng = random.Random(42)
        for _ in range(50):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            sub.train("test", (f0, f1), bool(f0))
        sub.fit("test")
        sub.estimate_causal_effects("test")
        report = sub.get_report()
        assert "observational_stats" in report
        assert "test" in report["observational_stats"]


# ===========================================================================
# E. Method Comparison Tests
# ===========================================================================

class TestMethodComparison:
    """Test that the three methods produce comparable estimates."""

    def test_three_methods_produce_estimates(self):
        """All three methods should produce estimates for each feature."""
        rng = random.Random(42)
        features = []
        outcomes = []
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            features.append((f0, f1))
            outcomes.append(bool(f0))
        estimator = ObservationalCausalEstimator(ace_threshold=0.1)
        psm = estimator.estimate_ace_psm(features, outcomes, 0)
        ipw = estimator.estimate_ace_ipw(features, outcomes, 0)
        dr = estimator.estimate_ace_dr(features, outcomes, 0)
        assert psm.method == "psm"
        assert ipw.method == "ipw"
        assert dr.method == "doubly_robust"
        # All should identify f0 as causal
        assert psm.is_causal
        assert ipw.is_causal
        assert dr.is_causal

    def test_confidence_intervals_computed(self):
        """Each estimate should have a confidence interval."""
        rng = random.Random(42)
        features = []
        outcomes = []
        for _ in range(100):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            features.append((f0, f1))
            outcomes.append(bool(f0))
        estimator = ObservationalCausalEstimator(ace_threshold=0.1)
        result = estimator.estimate_ace_dr(features, outcomes, 0)
        assert len(result.confidence_interval) == 2
        assert result.confidence_interval[0] <= result.confidence_interval[1]
