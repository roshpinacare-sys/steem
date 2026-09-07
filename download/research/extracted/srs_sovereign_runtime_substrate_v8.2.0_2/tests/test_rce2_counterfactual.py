"""Adversarial tests for RCE-2 v6.13 Counterfactual Reasoning."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_counterfactual import (
    SubstrateV613, CounterfactualEngine, CounterfactualResult,
)


# ===========================================================================
# A. Counterfactual Query Tests
# ===========================================================================

class TestCounterfactualQuery:
    """Test basic counterfactual queries."""

    def test_counterfactual_changes_outcome(self):
        """Intervening on a causal feature should change the outcome."""
        def compute_fn(f):
            return bool(f[0])
        engine = CounterfactualEngine(compute_fn)
        result = engine.query((1.0, 0.0), {0: 0.0})
        assert result.original_outcome == True
        assert result.counterfactual_outcome == False

    def test_counterfactual_on_irrelevant_feature_no_change(self):
        """Intervening on an irrelevant feature should NOT change outcome."""
        def compute_fn(f):
            return bool(f[0])
        engine = CounterfactualEngine(compute_fn)
        result = engine.query((1.0, 0.0), {1: 1.0})
        assert result.original_outcome == True
        assert result.counterfactual_outcome == True  # unchanged

    def test_counterfactual_multiple_interventions(self):
        """Multiple feature interventions should all be applied."""
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        engine = CounterfactualEngine(compute_fn)
        result = engine.query((1.0, 1.0), {0: 0.0, 1: 0.0})
        assert result.original_outcome == True
        assert result.counterfactual_outcome == False

    def test_counterfactual_explanation_correct(self):
        """The explanation string should be human-readable."""
        def compute_fn(f):
            return bool(f[0])
        engine = CounterfactualEngine(compute_fn)
        result = engine.query((1.0, 0.0), {0: 0.0})
        assert "outcome" in result.explanation.lower()
        assert "f[0]" in result.explanation

    def test_counterfactual_confidence_is_1_for_deterministic(self):
        """Deterministic computations should have confidence 1.0."""
        def compute_fn(f):
            return bool(f[0])
        engine = CounterfactualEngine(compute_fn)
        result = engine.query((1.0,), {0: 0.0})
        assert result.confidence == 1.0


# ===========================================================================
# B. Minimal Counterfactual Explanation Tests
# ===========================================================================

class TestMinimalExplanation:
    """Test finding minimal counterfactual explanations."""

    def test_explanation_found_for_single_feature(self):
        """Should find a single-feature change that flips the outcome."""
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        engine = CounterfactualEngine(compute_fn)
        # (0, 1) → False. Change f[0] to 1 → True
        result = engine.explain((0.0, 1.0), True)
        assert result is not None
        assert result.counterfactual_outcome == True

    def test_explanation_returns_none_when_already_at_target(self):
        """If outcome is already the target, return None."""
        def compute_fn(f):
            return bool(f[0])
        engine = CounterfactualEngine(compute_fn)
        result = engine.explain((1.0,), True)
        assert result is None

    def test_explanation_minimal(self):
        """The explanation should use the minimum number of feature changes."""
        def compute_fn(f):
            return bool(f[0]) and bool(f[1]) and bool(f[2])
        engine = CounterfactualEngine(compute_fn)
        # (0, 1, 1) → False. Change f[0] to 1 → True (single change)
        result = engine.explain((0.0, 1.0, 1.0), True)
        assert result is not None
        assert len(result.intervened_features) == 1  # minimal


# ===========================================================================
# C. Policy Evaluation Tests
# ===========================================================================

class TestPolicyEvaluation:
    """Test policy evaluation."""

    def test_policy_changes_outcomes(self):
        """Forcing a feature should change some outcomes."""
        def compute_fn(f):
            return bool(f[0])
        engine = CounterfactualEngine(compute_fn)
        features_list = [(0.0,), (1.0,), (0.0,), (1.0,)]
        result = engine.policy_evaluation(features_list, {0: 1.0})
        assert result["n_evaluated"] == 4
        # Original: 2 True (the (1.0,) entries)
        # Policy: all True (force f[0]=1)
        assert result["n_outcome_flips"] == 2  # the (0.0,) entries flip
        assert result["policy_true_rate"] == 1.0

    def test_policy_on_irrelevant_feature_no_flips(self):
        """Forcing an irrelevant feature should cause no flips."""
        def compute_fn(f):
            return bool(f[0])
        engine = CounterfactualEngine(compute_fn)
        features_list = [(0.0, 0.0), (1.0, 1.0)]
        result = engine.policy_evaluation(features_list, {1: 1.0})
        assert result["n_outcome_flips"] == 0

    def test_policy_stats_correct(self):
        """Policy statistics should be correctly computed."""
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        engine = CounterfactualEngine(compute_fn)
        features_list = [(1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)]
        result = engine.policy_evaluation(features_list, {1: 1.0})
        # Original: (1,0)→F, (1,1)→T, (0,1)→F, (0,0)→F → 1 True
        # Policy: (1,1)→T, (1,1)→T, (0,1)→F, (0,1)→F → 2 True
        assert result["original_true_rate"] == 0.25
        assert result["policy_true_rate"] == 0.5


# ===========================================================================
# D. Regret Analysis Tests
# ===========================================================================

class TestRegretAnalysis:
    """Test regret analysis."""

    def test_regret_analysis_returns_outcomes(self):
        """Regret analysis should return outcomes for each feature value."""
        def compute_fn(f):
            return bool(f[0])
        engine = CounterfactualEngine(compute_fn)
        result = engine.regret_analysis((1.0,), {0: [0.0, 1.0]})
        assert "outcomes_by_feature_value" in result
        assert 0 in result["outcomes_by_feature_value"]
        assert result["outcomes_by_feature_value"][0][0.0] == False
        assert result["outcomes_by_feature_value"][0][1.0] == True

    def test_regret_identifies_best_value(self):
        """Regret analysis should help identify the best feature value."""
        def compute_fn(f):
            return bool(f[0])  # True iff f[0]=1
        engine = CounterfactualEngine(compute_fn)
        result = engine.regret_analysis((0.0,), {0: [0.0, 1.0]})
        outcomes = result["outcomes_by_feature_value"][0]
        # Best value is 1.0 (gives True)
        assert outcomes[1.0] == True
        assert outcomes[0.0] == False


# ===========================================================================
# E. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV613:
    """Test the integrated v6.13 substrate."""

    def test_counterfactual_engine_initialized_after_scm(self):
        """Counterfactual engine should be initialized after discover_scm."""
        sub = SubstrateV613()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("test", f, compute_fn(f))
        sub.fit("test")
        sub.discover_scm("test", compute_fn, training)
        assert "test" in sub.counterfactual_engines

    def test_counterfactual_via_substrate(self):
        """Counterfactual query via substrate should work."""
        sub = SubstrateV613()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.3),
                     float(rng.random() > 0.5)) for _ in range(50)]
        for f in training:
            sub.train("and2", f, compute_fn(f))
        sub.fit("and2")
        sub.discover_scm("and2", compute_fn, training)
        result = sub.counterfactual("and2", (1.0, 1.0, 0.0), {0: 0.0})
        assert result.original_outcome == True
        assert result.counterfactual_outcome == False

    def test_explain_via_substrate(self):
        """Minimal explanation via substrate should work."""
        sub = SubstrateV613()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.3),
                     float(rng.random() > 0.5)) for _ in range(50)]
        for f in training:
            sub.train("and2", f, compute_fn(f))
        sub.fit("and2")
        sub.discover_scm("and2", compute_fn, training)
        explanation = sub.explain("and2", (0.0, 1.0, 0.0), True)
        assert explanation is not None
        assert explanation.counterfactual_outcome == True

    def test_report_includes_counterfactual_stats(self):
        """The report must include counterfactual statistics."""
        sub = SubstrateV613()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.5))
                    for _ in range(50)]
        for f in training:
            sub.train("test", f, compute_fn(f))
        sub.fit("test")
        sub.discover_scm("test", compute_fn, training)
        report = sub.get_report()
        assert "counterfactual_stats" in report
        assert "test" in report["counterfactual_stats"]


# ===========================================================================
# F. End-to-End: What-If Analysis Tests
# ===========================================================================

class TestWhatIfAnalysis:
    """Test end-to-end what-if analysis scenarios."""

    def test_what_if_scenario(self):
        """Full what-if scenario: observe, intervene, predict."""
        sub = SubstrateV613()
        rng = random.Random(42)
        # SEG-like computation: admissible iff evidence AND sequenced AND ref
        def compute_fn(f):
            return bool(f[0]) and bool(f[1]) and bool(f[2])
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.3),
                     float(rng.random() > 0.3)) for _ in range(50)]
        for f in training:
            sub.train("seg", f, compute_fn(f))
        sub.fit("seg")
        sub.discover_scm("seg", compute_fn, training)

        # Observe: (1, 1, 0) → False (missing ref)
        f = (1.0, 1.0, 0.0)
        original = compute_fn(f)
        assert original == False

        # What if we had the ref? (f[2] = 1)
        result = sub.counterfactual("seg", f, {2: 1.0})
        assert result.counterfactual_outcome == True, (
            "If we had the ref, the outcome should be True")

    def test_policy_evaluation_full_scenario(self):
        """Full policy evaluation: force a feature, measure impact."""
        sub = SubstrateV613()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) or bool(f[1])  # OR
        training = [(float(rng.random() > 0.3), float(rng.random() > 0.3))
                    for _ in range(100)]
        for f in training:
            sub.train("or2", f, compute_fn(f))
        sub.fit("or2")
        sub.discover_scm("or2", compute_fn, training)

        # Policy: force f[0] = 1 (should make all outcomes True)
        features_list = [(float(rng.random() > 0.3), float(rng.random() > 0.3))
                         for _ in range(50)]
        result = sub.evaluate_policy("or2", features_list, {0: 1.0})
        assert result["policy_true_rate"] == 1.0, (
            "Forcing f[0]=1 in OR should make all outcomes True")
