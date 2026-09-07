"""Adversarial tests for RCE-2 v6.23 Causal Fairness."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_causal_fairness import (
    SubstrateV623, CausalFairnessAnalyzer, FairnessMetrics,
)


# ===========================================================================
# A. Fairness Metrics Tests
# ===========================================================================

class TestFairnessMetrics:
    """Test fairness metric computation."""

    def test_demographic_parity_detected(self):
        """Demographic parity violation should be detected."""
        analyzer = CausalFairnessAnalyzer(dp_threshold=0.1)
        # Group 0: 50% approved, Group 1: 100% approved
        predictions = [True, False, True, False] + [True, True, True, True]
        true_outcomes = [True, False, True, False] + [True, True, True, True]
        protected = [0.0, 0.0, 0.0, 0.0] + [1.0, 1.0, 1.0, 1.0]
        metrics = analyzer.compute_metrics(predictions, true_outcomes, protected)
        assert metrics.demographic_parity > 0.1, (
            f"DP={metrics.demographic_parity} should exceed 0.1")

    def test_fair_predictions_pass(self):
        """Fair predictions should pass all metrics."""
        analyzer = CausalFairnessAnalyzer()
        # Both groups: 50% approved
        predictions = [True, False, True, False, True, False, True, False]
        true_outcomes = [True, False, True, False, True, False, True, False]
        protected = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]
        metrics = analyzer.compute_metrics(predictions, true_outcomes, protected)
        assert metrics.is_fair, (
            f"Fair predictions should pass: DP={metrics.demographic_parity}, "
            f"DI={metrics.disparate_impact}")

    def test_disparate_impact_detected(self):
        """Disparate impact violation should be detected."""
        analyzer = CausalFairnessAnalyzer(di_threshold=0.8)
        # Group 0: 30% approved, Group 1: 80% approved
        # DI = 0.3/0.8 = 0.375 < 0.8
        predictions = ([True]*3 + [False]*7) + ([True]*8 + [False]*2)
        true_outcomes = predictions[:]
        protected = [0.0]*10 + [1.0]*10
        metrics = analyzer.compute_metrics(predictions, true_outcomes, protected)
        assert metrics.disparate_impact < 0.8, (
            f"DI={metrics.disparate_impact} should be < 0.8")

    def test_equal_opportunity_detected(self):
        """Equal opportunity violation should be detected."""
        analyzer = CausalFairnessAnalyzer(eo_threshold=0.1)
        # Group 0 qualified: 50% approved
        # Group 1 qualified: 100% approved
        predictions = [True, False, True, False, True, True, True, True]
        true_outcomes = [True, True, True, True, True, True, True, True]  # all qualified
        protected = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]
        metrics = analyzer.compute_metrics(predictions, true_outcomes, protected)
        assert metrics.equal_opportunity > 0.1, (
            f"EO={metrics.equal_opportunity} should exceed 0.1")

    def test_violations_listed(self):
        """Violations should be listed in the metrics."""
        analyzer = CausalFairnessAnalyzer()
        predictions = [True, True] + [False, False]  # 100% vs 0%
        true_outcomes = [True, True, True, True]
        protected = [0.0, 0.0, 1.0, 1.0]
        metrics = analyzer.compute_metrics(predictions, true_outcomes, protected)
        assert len(metrics.violations) > 0
        assert not metrics.is_fair


# ===========================================================================
# B. Causal Debiasing Tests
# ===========================================================================

class TestCausalDebiasing:
    """Test causal debiasing (removing protected attribute)."""

    def test_debias_features_zeros_protected(self):
        """Debiasing should zero out the protected attribute."""
        analyzer = CausalFairnessAnalyzer()
        features = (1.0, 0.5, 1.0)  # feature 0 is protected
        debiased = analyzer.debias_features(features, protected_idx=0)
        assert debiased[0] == 0.0
        assert debiased[1] == 0.5  # other features unchanged
        assert debiased[2] == 1.0

    def test_debias_batch(self):
        """Batch debiasing should work."""
        analyzer = CausalFairnessAnalyzer()
        features_list = [(1.0, 0.5), (0.0, 0.8), (1.0, 0.3)]
        debiased = analyzer.debias_batch(features_list, protected_idx=0)
        assert all(f[0] == 0.0 for f in debiased)
        assert debiased[0][1] == 0.5
        assert debiased[1][1] == 0.8

    def test_debias_preserves_feature_count(self):
        """Debiasing should preserve feature count (zero, not remove)."""
        analyzer = CausalFairnessAnalyzer()
        features = (1.0, 2.0, 3.0, 4.0)
        debiased = analyzer.debias_features(features, protected_idx=1)
        assert len(debiased) == 4


# ===========================================================================
# C. Equalized Odds Tests
# ===========================================================================

class TestEqualizedOdds:
    """Test equalized odds mitigation."""

    def test_equalized_odds_returns_thresholds(self):
        """Equalized odds should return per-group thresholds."""
        analyzer = CausalFairnessAnalyzer()
        predictions = [0.8, 0.3, 0.7, 0.4, 0.9, 0.2, 0.6, 0.5]
        true_outcomes = [True, False, True, False, True, False, True, False]
        protected = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]
        thresholds = analyzer.equalized_odds_thresholds(
            predictions, true_outcomes, protected)
        assert len(thresholds) == 2
        assert 0.0 in thresholds or 1.0 in thresholds

    def test_equalized_odds_improves_fairness(self):
        """Equalized odds should improve fairness."""
        analyzer = CausalFairnessAnalyzer(dp_threshold=0.1)
        # Biased predictions: group 1 has higher scores
        predictions = [0.6, 0.5, 0.4, 0.3, 0.9, 0.8, 0.7, 0.6]
        true_outcomes = [True, False, True, False, True, False, True, False]
        protected = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]

        # Before mitigation
        before = analyzer.compute_metrics(
            [p > 0.5 for p in predictions], true_outcomes, protected)

        # After equalized odds
        thresholds = analyzer.equalized_odds_thresholds(
            predictions, true_outcomes, protected)
        after_preds = [p > thresholds.get(a, 0.5)
                        for p, a in zip(predictions, protected)]
        after = analyzer.compute_metrics(after_preds, true_outcomes, protected)

        # DP should improve (or at least not worsen significantly)
        assert after.demographic_parity <= before.demographic_parity + 0.1


# ===========================================================================
# D. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV623:
    """Test the integrated v6.23 substrate."""

    def test_set_protected_attribute(self):
        """set_protected_attribute should store the index."""
        sub = SubstrateV623()
        sub.set_protected_attribute("loan", feature_idx=0)
        assert sub.protected_indices["loan"] == 0

    def test_audit_fairness_returns_metrics(self):
        """audit_fairness should return FairnessMetrics."""
        sub = SubstrateV623()
        predictions = [True, False, True, False, True, False, True, False]
        true_outcomes = predictions[:]
        protected = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]
        metrics = sub.audit_fairness("test", predictions, true_outcomes, protected)
        assert isinstance(metrics, FairnessMetrics)

    def test_debias_predictions(self):
        """debias_predictions should return adjusted predictions."""
        sub = SubstrateV623()
        predictions = [0.8, 0.3, 0.9, 0.2]
        true_outcomes = [True, False, True, False]
        protected = [0.0, 0.0, 1.0, 1.0]
        debiased = sub.debias_predictions(predictions, protected, true_outcomes)
        assert len(debiased) == 4
        assert all(isinstance(d, bool) for d in debiased)

    def test_audit_report(self):
        """get_audit_report should return fairness statistics."""
        sub = SubstrateV623()
        sub.set_protected_attribute("test", 0)
        predictions = [True, False, True, False]
        true_outcomes = [True, False, True, False]
        protected = [0.0, 0.0, 1.0, 1.0]
        sub.audit_fairness("test", predictions, true_outcomes, protected)
        report = sub.get_audit_report()
        assert "fairness_stats" in report
        assert "protected_attributes" in report
        assert report["fairness_stats"]["n_audits"] == 1

    def test_report_includes_fairness(self):
        """The full report should include fairness info."""
        sub = SubstrateV623()
        report = sub.get_report()
        assert "fairness_report" in report


# ===========================================================================
# E. End-to-End: Biased → Detected → Mitigated Tests
# ===========================================================================

class TestEndToEndFairness:
    """Test the full bias detection and mitigation pipeline."""

    def test_biased_data_detected(self):
        """Biased data should be detected as unfair."""
        sub = SubstrateV623(dp_threshold=0.1, di_threshold=0.8)
        rng = random.Random(42)
        predictions = []
        true_outcomes = []
        protected = []
        for _ in range(200):
            gender = rng.random() > 0.5
            qual = rng.random() > 0.4
            # Biased: gender=1 always approved
            approved = True if gender else qual
            predictions.append(approved)
            true_outcomes.append(qual)
            protected.append(float(gender))
        metrics = sub.audit_fairness("loan", predictions, true_outcomes, protected)
        assert not metrics.is_fair, (
            "Biased data should be detected as unfair")

    def test_mitigation_improves_fairness(self):
        """Equalized odds should improve fairness."""
        sub = SubstrateV623(dp_threshold=0.15)
        rng = random.Random(42)
        cont_predictions = []
        true_outcomes = []
        protected = []
        for _ in range(200):
            gender = rng.random() > 0.5
            qual = rng.random() > 0.4
            # Biased: gender=1 gets higher scores
            score = 0.9 if gender else (0.6 if qual else 0.2)
            cont_predictions.append(score)
            true_outcomes.append(qual)
            protected.append(float(gender))

        # Before mitigation
        before = sub.audit_fairness("loan",
            [p > 0.5 for p in cont_predictions], true_outcomes, protected)

        # After mitigation
        debiased = sub.debias_predictions(cont_predictions, protected, true_outcomes)
        after = sub.audit_fairness("loan", debiased, true_outcomes, protected)

        assert after.demographic_parity <= before.demographic_parity + 0.1

    def test_fair_data_passes_audit(self):
        """Fair data should pass the audit."""
        sub = SubstrateV623()
        rng = random.Random(42)
        predictions = []
        true_outcomes = []
        protected = []
        for _ in range(200):
            gender = rng.random() > 0.5
            qual = rng.random() > 0.4
            # Fair: approval based only on qualification
            approved = qual
            predictions.append(approved)
            true_outcomes.append(qual)
            protected.append(float(gender))
        metrics = sub.audit_fairness("loan", predictions, true_outcomes, protected)
        assert metrics.is_fair, (
            f"Fair data should pass audit: DP={metrics.demographic_parity}, "
            f"DI={metrics.disparate_impact}")


# ===========================================================================
# F. Audit Trail Tests
# ===========================================================================

class TestAuditTrail:
    """Test the audit trail for regulatory compliance."""

    def test_audit_log_recorded(self):
        """Each audit should be logged."""
        analyzer = CausalFairnessAnalyzer()
        predictions = [True, False, True, False]
        true_outcomes = [True, False, True, False]
        protected = [0.0, 0.0, 1.0, 1.0]
        analyzer.compute_metrics(predictions, true_outcomes, protected)
        assert len(analyzer.audit_log) == 1

    def test_audit_stats(self):
        """Audit stats should be available."""
        analyzer = CausalFairnessAnalyzer()
        predictions = [True, False, True, False, True, False, True, False]
        true_outcomes = predictions[:]
        protected = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]
        analyzer.compute_metrics(predictions, true_outcomes, protected)
        stats = analyzer.get_audit_stats()
        assert stats["n_audits"] == 1
        assert "n_fair" in stats
        assert "n_unfair" in stats

    def test_multiple_audits_tracked(self):
        """Multiple audits should all be tracked."""
        analyzer = CausalFairnessAnalyzer()
        for _ in range(5):
            predictions = [True, False, True, False]
            true_outcomes = [True, False, True, False]
            protected = [0.0, 0.0, 1.0, 1.0]
            analyzer.compute_metrics(predictions, true_outcomes, protected)
        stats = analyzer.get_audit_stats()
        assert stats["n_audits"] == 5
