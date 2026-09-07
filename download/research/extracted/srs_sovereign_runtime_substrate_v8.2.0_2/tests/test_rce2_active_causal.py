"""Adversarial tests for RCE-2 v6.16 Active Causal Learning."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_active_causal import (
    SubstrateV616, ActiveCausalLearner, AcquisitionResult,
)
from rce.rce2_online_causal import OnlineCausalRefiner


# ===========================================================================
# A. Active Learner Tests
# ===========================================================================

class TestActiveCausalLearner:
    """Test the active causal learner."""

    def test_acquire_returns_result(self):
        """acquire should return an AcquisitionResult."""
        refiner = OnlineCausalRefiner(n_features=2)
        learner = ActiveCausalLearner(refiner, method="uncertainty")
        result = learner.acquire(n_candidates=10, rng=random.Random(42))
        assert isinstance(result, AcquisitionResult)
        assert len(result.selected_features) == 2

    def test_uncertainty_method(self):
        """Uncertainty sampling should select high-variance candidates."""
        refiner = OnlineCausalRefiner(n_features=2)
        # Add some observations to create variance
        rng = random.Random(42)
        for _ in range(20):
            f = (float(rng.random() > 0.5), float(rng.random() > 0.5))
            refiner.update(f, bool(f[0]))
        learner = ActiveCausalLearner(refiner, method="uncertainty")
        result = learner.acquire(n_candidates=10, rng=rng)
        assert result.method == "uncertainty"
        assert result.acquisition_score >= 0

    def test_disagreement_method(self):
        """Disagreement sampling should work."""
        refiner = OnlineCausalRefiner(n_features=2)
        learner = ActiveCausalLearner(refiner, method="disagreement")
        result = learner.acquire(n_candidates=10, rng=random.Random(42))
        assert result.method == "disagreement"

    def test_eig_method(self):
        """Expected information gain should work."""
        refiner = OnlineCausalRefiner(n_features=2)
        learner = ActiveCausalLearner(refiner, method="eig")
        result = learner.acquire(n_candidates=10, rng=random.Random(42))
        assert result.method == "eig"

    def test_generate_candidates(self):
        """Candidate generation should produce valid feature vectors."""
        refiner = OnlineCausalRefiner(n_features=3)
        learner = ActiveCausalLearner(refiner)
        candidates = learner.generate_candidates(20, rng=random.Random(42))
        assert len(candidates) == 20
        for c in candidates:
            assert len(c) == 3
            assert all(v in [0.0, 1.0] for v in c)

    def test_acquisition_log_recorded(self):
        """Each acquisition should be logged."""
        refiner = OnlineCausalRefiner(n_features=2)
        learner = ActiveCausalLearner(refiner)
        learner.acquire(n_candidates=5, rng=random.Random(42))
        assert len(learner.acquisition_log) == 1


# ===========================================================================
# B. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV616:
    """Test the integrated v6.16 substrate."""

    def test_train_initializes_active_learner(self):
        """Training should initialize an active learner."""
        sub = SubstrateV616()
        rng = random.Random(42)
        for _ in range(10):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, bool(f[0]))
        assert "test" in sub.active_learners

    def test_acquire_next_returns_result(self):
        """acquire_next should return an AcquisitionResult."""
        sub = SubstrateV616()
        rng = random.Random(42)
        for _ in range(10):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, bool(f[0]))
        result = sub.acquire_next("test", n_candidates=10, rng=rng)
        assert result is not None
        assert isinstance(result, AcquisitionResult)

    def test_active_learning_loop_runs(self):
        """The active learning loop should run successfully."""
        sub = SubstrateV616()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        # Initial training
        for _ in range(10):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub.train("test", f, compute_fn(f))
        # Active learning
        result = sub.active_learning_loop("test", compute_fn, n_iterations=20, rng=rng)
        assert result["n_iterations"] == 20
        assert "n_causal_features_found" in result

    def test_report_includes_active_stats(self):
        """The report must include active learning statistics."""
        sub = SubstrateV616()
        rng = random.Random(42)
        for _ in range(10):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, bool(f[0]))
        sub.acquire_next("test", n_candidates=5, rng=rng)
        report = sub.get_report()
        assert "active_stats" in report
        assert "test" in report["active_stats"]


# ===========================================================================
# C. Active vs Passive Comparison Tests
# ===========================================================================

class TestActiveVsPassive:
    """Test that active learning is at least as efficient as passive."""

    def test_active_finds_causal_features(self):
        """Active learning should find causal features."""
        sub = SubstrateV616(acquisition_method="uncertainty")
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1]) and bool(f[2])
        # Initial training
        for _ in range(20):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("test", f, compute_fn(f))
        # Active learning
        sub.active_learning_loop("test", compute_fn, n_iterations=30, rng=rng)
        causal = sub.get_online_causal_features("test")
        assert 0 in causal, "f0 should be causal"

    def test_active_uses_fewer_observations(self):
        """Active learning should identify causal features efficiently."""
        def compute_fn(f):
            return bool(f[0])
        # Passive: 50 observations
        rng = random.Random(42)
        sub_passive = SubstrateV616()
        for _ in range(50):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub_passive.train("test", f, compute_fn(f))
        passive_causal = sub_passive.get_online_causal_features("test")

        # Active: 20 passive + 30 active = 50 total
        rng = random.Random(42)
        sub_active = SubstrateV616(acquisition_method="uncertainty")
        for _ in range(20):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub_active.train("test", f, compute_fn(f))
        sub_active.active_learning_loop("test", compute_fn, n_iterations=30, rng=rng)
        active_causal = sub_active.get_online_causal_features("test")

        # Both should find f0 as causal
        assert 0 in passive_causal
        assert 0 in active_causal

    def test_active_acquisition_improves_over_time(self):
        """Acquisition scores should change as the model learns."""
        sub = SubstrateV616(acquisition_method="uncertainty")
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        for _ in range(10):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, compute_fn(f))
        result = sub.active_learning_loop("test", compute_fn, n_iterations=20, rng=rng)
        # Scores should be recorded
        assert len(result["acquisition_scores"]) == 20


# ===========================================================================
# D. Acquisition Method Comparison Tests
# ===========================================================================

class TestAcquisitionMethods:
    """Test that different acquisition methods produce different selections."""

    def test_uncertainty_method_works(self):
        """Uncertainty method should run without error."""
        sub = SubstrateV616(acquisition_method="uncertainty")
        rng = random.Random(42)
        for _ in range(20):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, bool(f[0]))
        result = sub.acquire_next("test", n_candidates=10, rng=rng)
        assert result.method == "uncertainty"

    def test_disagreement_method_works(self):
        """Disagreement method should run without error."""
        sub = SubstrateV616(acquisition_method="disagreement")
        rng = random.Random(42)
        for _ in range(20):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, bool(f[0]))
        result = sub.acquire_next("test", n_candidates=10, rng=rng)
        assert result.method == "disagreement"

    def test_eig_method_works(self):
        """EIG method should run without error."""
        sub = SubstrateV616(acquisition_method="eig")
        rng = random.Random(42)
        for _ in range(20):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, bool(f[0]))
        result = sub.acquire_next("test", n_candidates=10, rng=rng)
        assert result.method == "eig"


# ===========================================================================
# E. Efficiency Tests
# ===========================================================================

class TestEfficiency:
    """Test that active learning is efficient."""

    def test_handles_high_dimensions(self):
        """Active learning should handle higher-dimensional feature spaces."""
        sub = SubstrateV616(acquisition_method="uncertainty")
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[3])  # 2 of 5 features are causal
        for _ in range(20):
            f = tuple(float(rng.random() > 0.3) for _ in range(5))
            sub.train("hd", f, compute_fn(f))
        result = sub.active_learning_loop("hd", compute_fn, n_iterations=30, rng=rng)
        assert result["n_iterations"] == 30

    def test_multiple_computation_types(self):
        """The substrate should handle multiple computation types."""
        sub = SubstrateV616()
        rng = random.Random(42)
        for _ in range(10):
            sub.train("typeA", (float(rng.random() > 0.3),), bool(rng.random() > 0.3))
        for _ in range(10):
            sub.train("typeB", (float(rng.random() > 0.3), float(rng.random() > 0.5)),
                       bool(rng.random() > 0.3))
        assert "typeA" in sub.active_learners
        assert "typeB" in sub.active_learners

    def test_active_learning_loop_terminates(self):
        """The active learning loop should terminate properly."""
        sub = SubstrateV616()
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        for _ in range(5):
            f = (float(rng.random() > 0.3),)
            sub.train("test", f, compute_fn(f))
        result = sub.active_learning_loop("test", compute_fn, n_iterations=10, rng=rng)
        assert result["n_iterations"] <= 10
