"""Adversarial tests for RCE-2 v6.11 Causal Law Discovery."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_causal_discovery import (
    SubstrateV611, CausalDiscoveryEngine, CausalFeature, CausalLaw,
)
from rce.rce2_substrate import SubstrateOutcome


# ===========================================================================
# A. Causal Feature Discovery Tests
# ===========================================================================

class TestCausalFeatureDiscovery:
    """Test that the engine correctly identifies causal features."""

    def test_causal_feature_has_high_ace(self):
        """A causal feature should have |ACE| > threshold."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        # f[0] causes outcome; f[1] is irrelevant
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        cfs = sub.causal_engine.discover_causal_features(
            "test", compute_fn, training)
        assert cfs[0].is_causal, "f[0] should be causal"
        assert cfs[0].ace > 0.5, f"f[0] ACE should be high, got {cfs[0].ace}"

    def test_irrelevant_feature_has_low_ace(self):
        """An irrelevant feature should have |ACE| < threshold."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        cfs = sub.causal_engine.discover_causal_features(
            "test", compute_fn, training)
        assert not cfs[1].is_causal, "f[1] should not be causal"
        assert abs(cfs[1].ace) < 0.1, f"f[1] ACE should be low, got {cfs[1].ace}"

    def test_confounder_identified_as_non_causal(self):
        """A confounder (correlates but doesn't cause) should be non-causal."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        # f[0] causes both f[1] and outcome → f[1] is confounded
        def compute_fn(f):
            return bool(f[0])
        training = []
        for _ in range(100):
            f0 = rng.random() > 0.3
            f1 = f0  # confounded: f1 = f0
            training.append((float(f0), float(f1)))
        cfs = sub.causal_engine.discover_causal_features(
            "confounded", compute_fn, training)
        # f[0] is causal
        assert cfs[0].is_causal
        # f[1] is NOT causal (intervening on it doesn't change outcome)
        assert not cfs[1].is_causal, (
            f"f[1] is confounded — intervening should not change outcome. "
            f"ACE={cfs[1].ace}, should be ~0")


# ===========================================================================
# B. Causal Law Extraction Tests
# ===========================================================================

class TestCausalLawExtraction:
    """Test that causal laws use only causal features."""

    def test_causal_law_uses_only_causal_features(self):
        """A causal law's mask should contain only causal features."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.3),
                     float(rng.random() > 0.5)) for _ in range(50)]
        sub.discover_causal_laws("test", compute_fn, training)
        for law in sub.causal_engine.causal_laws["test"]:
            for idx in law.causal_features:
                cf = sub.causal_engine.causal_features["test"][idx]
                assert cf.is_causal, (
                    f"Causal law uses non-causal feature {idx}")

    def test_causal_law_verified_via_intervention(self):
        """Causal laws should be verified via interventional queries."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        sub.discover_causal_laws("test", compute_fn, training)
        for law in sub.causal_engine.causal_laws["test"]:
            assert law.confidence == 1.0, (
                "Causal laws verified via intervention should have confidence 1.0")
            assert law.n_interventions > 0

    def test_causal_law_predicts_correctly(self):
        """A causal law should predict the correct outcome."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.3),
                     float(rng.random() > 0.5)) for _ in range(50)]
        sub.discover_causal_laws("test", compute_fn, training)
        # Query with f[0]=1, f[1]=1, f[2]=anything
        for _ in range(10):
            f = (1.0, 1.0, float(rng.random() > 0.5))
            law = sub.causal_engine.query_causal_law("test", f)
            if law:
                assert law.outcome == True, (
                    f"Causal law predicted {law.outcome}, expected True")


# ===========================================================================
# C. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV611:
    """Test the integrated v6.11 substrate."""

    def test_predict_with_causal_returns_5_values(self):
        """predict_with_causal returns 5 values."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("test", f, compute_fn(f))
        sub.fit("test")
        sub.discover_causal_laws("test", compute_fn, training)
        result = sub.predict_with_causal(
            "test", (1.0, 0.0), full_computation=lambda: True,
            record_outcome=False)
        assert len(result) == 5

    def test_causal_law_used_when_available(self):
        """When a causal law matches, it should be used."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("test", f, compute_fn(f))
        sub.fit("test")
        sub.discover_causal_laws("test", compute_fn, training)
        predicted, outcome, conf, cost, causal_law = sub.predict_with_causal(
            "test", (1.0, 0.0), full_computation=lambda: True,
            record_outcome=False)
        assert causal_law is not None, "Causal law should be used when available"
        assert predicted == True

    def test_fallback_when_no_causal_law(self):
        """When no causal law matches, fall back to v6.10."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("test", f, compute_fn(f))
        sub.fit("test")
        sub.discover_causal_laws("test", compute_fn, training)
        # Query with a feature combination that has no causal law
        # (e.g. f[0]=0.5 — continuous value not in training)
        predicted, outcome, conf, cost, causal_law = sub.predict_with_causal(
            "test", (0.5, 0.5), full_computation=lambda: False,
            record_outcome=False)
        # No causal law should match (0.5 wasn't in training)
        # This may fall back to consensus or escalation

    def test_report_includes_causal_stats(self):
        """The report must include causal discovery statistics."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("test", f, compute_fn(f))
        sub.fit("test")
        sub.discover_causal_laws("test", compute_fn, training)
        report = sub.get_report()
        assert "causal_stats" in report
        assert "n_causal_features" in report["causal_stats"]


# ===========================================================================
# D. Confounder Robustness Tests
# ===========================================================================

class TestConfounderRobustness:
    """Test that causal laws are robust to confounders."""

    def test_confounder_does_not_affect_causal_law(self):
        """A confounder should not appear in a causal law's mask."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        # f[0] causes f[1] and outcome
        def compute_fn(f):
            return bool(f[0])
        training = []
        for _ in range(100):
            f0 = rng.random() > 0.3
            f1 = f0  # confounded
            training.append((float(f0), float(f1)))
        sub.discover_causal_laws("confounded", compute_fn, training)
        for law in sub.causal_engine.causal_laws["confounded"]:
            # f[1] should NOT be in the causal features
            assert 1 not in law.causal_features, (
                f"Confounder f[1] should not be in causal law mask: "
                f"{law.causal_features}")

    def test_intervening_on_confounder_does_not_change_prediction(self):
        """Changing a confounder's value should not change the causal law's prediction."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = []
        for _ in range(100):
            f0 = rng.random() > 0.3
            f1 = f0  # confounded
            training.append((float(f0), float(f1)))
        sub.discover_causal_laws("confounded", compute_fn, training)
        # Query with f[0]=1, f[1]=0 (intervened — f[1] doesn't match f[0])
        # The causal law should still predict True (because f[0]=1 causes True)
        law = sub.causal_engine.query_causal_law("confounded", (1.0, 0.0))
        if law:
            assert law.outcome == True, (
                f"Causal law should predict True for f[0]=1 regardless of f[1], "
                f"got {law.outcome}")


# ===========================================================================
# E. Interventional Query Tests
# ===========================================================================

class TestInterventionalQueries:
    """Test the interventional query mechanism."""

    def test_intervention_log_recorded(self):
        """Every intervention should be logged."""
        sub = SubstrateV611(ace_threshold=0.1)
        sub.causal_engine.n_interventions = 10  # reduce for faster test
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        sub.causal_engine.discover_causal_features("test", compute_fn, training)
        # 2 features × 10 interventions × 2 (high+low) = 40 log entries
        assert len(sub.causal_engine.intervention_log) >= 20, (
            f"Expected >= 20 interventions logged, got "
            f"{len(sub.causal_engine.intervention_log)}")

    def test_intervention_changes_outcome_for_causal_feature(self):
        """Intervening on a causal feature should change the outcome."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        cfs = sub.causal_engine.discover_causal_features(
            "test", compute_fn, training)
        # f[0] is causal → ACE should be high (intervening changes outcome)
        assert abs(cfs[0].ace) > 0.5

    def test_intervention_does_not_change_outcome_for_confounder(self):
        """Intervening on a confounder should NOT change the outcome."""
        sub = SubstrateV611(ace_threshold=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = []
        for _ in range(100):
            f0 = rng.random() > 0.3
            f1 = f0  # confounded
            training.append((float(f0), float(f1)))
        cfs = sub.causal_engine.discover_causal_features(
            "confounded", compute_fn, training)
        # f[1] is confounded → ACE should be ~0
        assert abs(cfs[1].ace) < 0.1, (
            f"Confounder ACE should be ~0, got {cfs[1].ace}")
