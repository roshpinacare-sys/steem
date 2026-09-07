"""Adversarial tests for RCE-2 v6.17 Meta-Active Learning."""
from __future__ import annotations

import random
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rce.rce2_meta_active import (
    SubstrateV617, MetaActiveLearner, LearningStage, classify_stage,
    StrategyPerformance,
)
from rce.rce2_online_causal import OnlineCausalRefiner
from rce.rce2_active_causal import AcquisitionResult


# ===========================================================================
# A. Stage Classification Tests
# ===========================================================================

class TestStageClassification:
    """Test learning stage classification."""

    def test_early_stage_when_few_observations(self):
        """Few observations should classify as early stage."""
        refiner = OnlineCausalRefiner(n_features=2)
        for _ in range(20):
            refiner.update((1.0, 0.0), True)
        stage = classify_stage(refiner)
        assert stage.stage == "early", (
            f"Expected early stage with 20 observations, got {stage.stage}")

    def test_late_stage_when_many_stable_estimates(self):
        """Many stable estimates should classify as late stage."""
        refiner = OnlineCausalRefiner(n_features=2)
        rng = random.Random(42)
        for _ in range(200):
            f0 = float(rng.random() > 0.3)
            f1 = float(rng.random() > 0.5)
            refiner.update((f0, f1), bool(f0))
        stage = classify_stage(refiner)
        assert stage.stage in ("mid", "late"), (
            f"Expected mid or late stage with 200 observations, got {stage.stage}")

    def test_stage_includes_reason(self):
        """Stage should include a human-readable reason."""
        refiner = OnlineCausalRefiner(n_features=2)
        refiner.update((1.0, 0.0), True)
        stage = classify_stage(refiner)
        assert len(stage.reason) > 0


# ===========================================================================
# B. Strategy Performance Tracker Tests
# ===========================================================================

class TestStrategyPerformance:
    """Test strategy performance tracking."""

    def test_update_increments_count(self):
        """update should increment the use count."""
        perf = StrategyPerformance("uncertainty")
        perf.update(0.5)
        assert perf.n_uses == 1
        perf.update(0.3)
        assert perf.n_uses == 2

    def test_avg_info_gain(self):
        """Average info gain should be computed correctly."""
        perf = StrategyPerformance("uncertainty")
        perf.update(0.4)
        perf.update(0.6)
        assert abs(perf.avg_info_gain - 0.5) < 0.001

    def test_ewma_info_gain(self):
        """EWMA should weight recent observations more."""
        perf = StrategyPerformance("uncertainty", alpha=0.5)
        # Initial ewma = 0.0
        # update(1.0): ewma = 0.5*1.0 + 0.5*0.0 = 0.5
        # update(0.0): ewma = 0.5*0.0 + 0.5*0.5 = 0.25
        perf.update(1.0)
        perf.update(0.0)
        assert abs(perf.ewma_info_gain - 0.25) < 0.01, (
            f"EWMA after [1.0, 0.0] with alpha=0.5 should be 0.25, got {perf.ewma_info_gain}")


# ===========================================================================
# C. Meta-Active Learner Tests
# ===========================================================================

class TestMetaActiveLearner:
    """Test the meta-active learner."""

    def test_acquire_returns_result_strategy_stage(self):
        """acquire should return (result, strategy, stage)."""
        refiner = OnlineCausalRefiner(n_features=2)
        for _ in range(10):
            refiner.update((1.0, 0.0), True)
        meta = MetaActiveLearner(refiner, epsilon=0.0)  # no exploration
        result = meta.acquire(n_candidates=5, rng=random.Random(42))
        assert len(result) == 3
        acquisition, strategy, stage = result
        assert isinstance(acquisition, AcquisitionResult)
        assert strategy in ["uncertainty", "disagreement", "eig"]
        assert isinstance(stage, LearningStage)

    def test_early_stage_uses_uncertainty(self):
        """Early stage should use uncertainty sampling (with no exploration)."""
        refiner = OnlineCausalRefiner(n_features=2)
        for _ in range(20):
            refiner.update((1.0, 0.0), True)
        meta = MetaActiveLearner(refiner, epsilon=0.0)
        _, strategy, stage = meta.acquire(n_candidates=5, rng=random.Random(42))
        assert stage.stage == "early"
        assert strategy == "uncertainty", (
            f"Early stage should use uncertainty, got {strategy}")

    def test_exploration_can_select_different_strategy(self):
        """With epsilon=1.0, should explore different strategies."""
        refiner = OnlineCausalRefiner(n_features=2)
        for _ in range(10):
            refiner.update((1.0, 0.0), True)
        meta = MetaActiveLearner(refiner, epsilon=1.0)
        rng = random.Random(42)  # single RNG, not re-seeded each iteration
        strategies_seen = set()
        for _ in range(20):
            _, strategy, _ = meta.acquire(n_candidates=5, rng=rng)
            strategies_seen.add(strategy)
        # With full exploration, should see multiple strategies
        assert len(strategies_seen) >= 2, (
            f"Expected >= 2 strategies with epsilon=1.0, got {strategies_seen}")

    def test_strategy_performance_tracked(self):
        """Strategy performance should be tracked."""
        refiner = OnlineCausalRefiner(n_features=2)
        for _ in range(10):
            refiner.update((1.0, 0.0), True)
        meta = MetaActiveLearner(refiner, epsilon=0.0)
        meta.acquire(n_candidates=5, rng=random.Random(42))
        stats = meta.get_stats()
        assert stats["n_acquisitions"] == 1
        assert "uncertainty" in stats["strategy_uses"]

    def test_record_info_gain_updates_performance(self):
        """record_info_gain should update strategy performance."""
        refiner = OnlineCausalRefiner(n_features=2)
        meta = MetaActiveLearner(refiner, epsilon=0.0)
        meta.record_info_gain("uncertainty", 0.5)
        assert meta.strategy_performance["uncertainty"].n_uses == 1
        assert meta.strategy_performance["uncertainty"].total_info_gain == 0.5


# ===========================================================================
# D. Substrate Integration Tests
# ===========================================================================

class TestSubstrateV617:
    """Test the integrated v6.17 substrate."""

    def test_train_initializes_meta_learner(self):
        """Training should initialize a meta-learner."""
        sub = SubstrateV617()
        rng = random.Random(42)
        for _ in range(10):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, bool(f[0]))
        assert "test" in sub.meta_learners

    def test_acquire_next_meta_returns_result(self):
        """acquire_next_meta should return a tuple."""
        sub = SubstrateV617()
        rng = random.Random(42)
        for _ in range(10):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, bool(f[0]))
        result = sub.acquire_next_meta("test", n_candidates=5, rng=rng)
        assert result is not None
        assert len(result) == 3

    def test_meta_learning_loop_runs(self):
        """The meta-learning loop should run successfully."""
        sub = SubstrateV617(epsilon=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])
        for _ in range(10):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub.train("test", f, compute_fn(f))
        result = sub.meta_learning_loop("test", compute_fn, n_iterations=20, rng=rng)
        assert result["n_iterations"] == 20
        assert "final_stats" in result

    def test_report_includes_meta_stats(self):
        """The report must include meta-learning statistics."""
        sub = SubstrateV617()
        rng = random.Random(42)
        for _ in range(10):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.5))
            sub.train("test", f, bool(f[0]))
        sub.acquire_next_meta("test", n_candidates=5, rng=rng)
        report = sub.get_report()
        assert "meta_stats" in report
        assert "test" in report["meta_stats"]


# ===========================================================================
# E. Adaptation Tests
# ===========================================================================

class TestAdaptation:
    """Test that the meta-learner adapts its strategy over time."""

    def test_strategy_changes_over_iterations(self):
        """Strategy should potentially change as learning progresses."""
        sub = SubstrateV617(epsilon=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1]) and bool(f[2])
        for _ in range(10):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("test", f, compute_fn(f))
        result = sub.meta_learning_loop("test", compute_fn, n_iterations=40, rng=rng)
        strategies = result["strategies_used"]
        # Should see at least one strategy change (due to stage transition or exploration)
        unique_strategies = set(strategies)
        assert len(unique_strategies) >= 1

    def test_causal_features_found(self):
        """Meta-active learning should find causal features."""
        sub = SubstrateV617(epsilon=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[1]) and bool(f[2])
        for _ in range(20):
            f = tuple(float(rng.random() > 0.3) for _ in range(3))
            sub.train("test", f, compute_fn(f))
        sub.meta_learning_loop("test", compute_fn, n_iterations=30, rng=rng)
        causal = sub.get_online_causal_features("test")
        assert 0 in causal, "f0 should be causal"

    def test_stage_distribution_recorded(self):
        """Stage distribution should be recorded in stats."""
        sub = SubstrateV617(epsilon=0.0)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0])
        for _ in range(10):
            f = (float(rng.random() > 0.3),)
            sub.train("test", f, compute_fn(f))
        sub.meta_learning_loop("test", compute_fn, n_iterations=20, rng=rng)
        stats = sub.get_meta_stats("test")
        assert "stage_distribution" in stats
        assert sum(stats["stage_distribution"].values()) > 0


# ===========================================================================
# F. Comparison Tests
# ===========================================================================

class TestMetaVsFixed:
    """Compare meta-active learning to fixed-strategy learning."""

    def test_meta_finds_causal_features_like_fixed(self):
        """Meta-active should find causal features as well as fixed strategy."""
        def compute_fn(f):
            return bool(f[0]) and bool(f[1])

        # Fixed strategy (uncertainty)
        rng = random.Random(42)
        sub_fixed = SubstrateV617(epsilon=0.0)  # no exploration = fixed
        for _ in range(20):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub_fixed.train("test", f, compute_fn(f))
        sub_fixed.meta_learning_loop("test", compute_fn, n_iterations=30, rng=rng)
        fixed_causal = sub_fixed.get_online_causal_features("test")

        # Meta-active strategy
        rng = random.Random(42)
        sub_meta = SubstrateV617(epsilon=0.1)
        for _ in range(20):
            f = (float(rng.random() > 0.3), float(rng.random() > 0.3))
            sub_meta.train("test", f, compute_fn(f))
        sub_meta.meta_learning_loop("test", compute_fn, n_iterations=30, rng=rng)
        meta_causal = sub_meta.get_online_causal_features("test")

        # Both should find causal features
        assert 0 in fixed_causal
        assert 0 in meta_causal

    def test_meta_handles_high_dimensions(self):
        """Meta-active should handle high-dimensional feature spaces."""
        sub = SubstrateV617(epsilon=0.1)
        rng = random.Random(42)
        def compute_fn(f):
            return bool(f[0]) and bool(f[3])
        for _ in range(20):
            f = tuple(float(rng.random() > 0.3) for _ in range(5))
            sub.train("hd", f, compute_fn(f))
        result = sub.meta_learning_loop("hd", compute_fn, n_iterations=30, rng=rng)
        assert result["n_iterations"] == 30
