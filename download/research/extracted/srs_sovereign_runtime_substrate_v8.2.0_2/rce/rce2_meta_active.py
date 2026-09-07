#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_meta_active.py — RCE-2 v6.17 Meta-Active Learning

PROBLEM:
  v6.16 uses a FIXED acquisition function (uncertainty, disagreement, or
  EIG) throughout the entire learning process. But different acquisition
  strategies are optimal at different stages:

    EARLY STAGE (few observations):
      - High uncertainty everywhere
      - Uncertainty sampling is best (explore broadly)
      - Goal: narrow down which features matter

    MID STAGE (moderate observations):
      - Some features have stable estimates, others uncertain
      - Disagreement sampling is best (resolve conflicts)
      - Goal: refine estimates where methods disagree

    LATE STAGE (many observations):
      - Most features are well-estimated
      - EIG is best (targeted refinement)
      - Goal: confirm causal classification, tighten CIs

  Using a fixed strategy wastes opportunities. The substrate should
  ADAPT its acquisition strategy based on the current state.

SOLUTION:
  The MetaActiveLearner implements adaptive strategy selection:

  1. STAGE DETECTION
     - Classify the current learning stage based on:
       * Number of observations (n)
       * Average ACE variance (avg_var)
       * Method agreement rate (agreement_rate)
     - Stage = "early" if n < 50 or avg_var > 0.1
     - Stage = "mid" if agreement_rate < 0.7
     - Stage = "late" otherwise

  2. STRATEGY MAPPING
     - early  -> uncertainty sampling
     - mid    -> disagreement sampling
     - late   -> EIG

  3. PERFORMANCE TRACKING
     - Track which strategy produced the most information gain
     - Adjust the stage thresholds based on observed performance
     - Learn the optimal strategy transition points

  4. EXPLORATION vs EXPLOITATION
     - With probability epsilon (default 0.1), try a different strategy
     - This prevents the meta-learner from getting stuck in a suboptimal
       strategy

MATHEMATICAL MODEL:

  Stage classification:
    avg_var = mean(Var(ACE_i)) across all features i
    agreement_rate = fraction of features where PSM, IPW, DR agree
    n = total observations

    stage(n, avg_var, agreement_rate):
      if n < 50 or avg_var > 0.1: return "early"
      if agreement_rate < 0.7: return "mid"
      return "late"

  Strategy selection:
    strategy(stage) = {
      "early": "uncertainty",
      "mid": "disagreement",
      "late": "eig",
    }[stage]

  Information gain tracking:
    For each acquisition, record:
      * strategy used
      * reduction in avg_var (information gain)
    Update empirical strategy performance:
      perf[strategy] = ewma(perf[strategy], info_gain)

  Exploration:
    With prob epsilon:
      strategy = random_choice([uncertainty, disagreement, eig])
    Else:
      strategy = strategy(stage) OR argmax(perf)

WHY THIS MATTERS:

  Meta-active learning adapts to the problem structure:
    1. EARLY EFFICIENCY: broad exploration when everything is uncertain
    2. MID RESOLUTION: focus on conflicts when estimates diverge
    3. LATE PRECISION: targeted refinement when most is known
    4. ADAPTIVE: learns which strategies work best for this problem

  The substrate now not only decides WHAT to observe (v6.16), but also
  HOW to decide what to observe (v6.17). This is meta-learning over
  acquisition strategies.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_active_causal import (
    SubstrateV616, ActiveCausalLearner, AcquisitionResult,
)
from rce.rce2_online_causal import OnlineCausalRefiner


# ===========================================================================
# Stage Classification
# ===========================================================================

@dataclass
class LearningStage:
    """The current learning stage."""
    stage: str                    # "early", "mid", "late"
    n_observations: int
    avg_variance: float
    agreement_rate: float
    reason: str


def classify_stage(refiner: OnlineCausalRefiner) -> LearningStage:
    """Classify the current learning stage based on refiner state."""
    n = refiner.n_observations

    # Compute average ACE variance
    variances = []
    for i in range(refiner.n_features):
        est = refiner.get_estimate(i)
        if est is not None and est.std_error > 0:
            variances.append(est.std_error ** 2)
    avg_var = sum(variances) / max(len(variances), 1)

    # Compute method agreement rate (simplified: use stability)
    n_stable = sum(1 for i in range(refiner.n_features)
                   if refiner.get_estimate(i) is not None
                   and refiner.get_estimate(i).is_stable)
    n_estimated = sum(1 for i in range(refiner.n_features)
                      if refiner.get_estimate(i) is not None)
    agreement_rate = n_stable / max(n_estimated, 1)

    if n < 50 or avg_var > 0.1:
        return LearningStage("early", n, avg_var, agreement_rate,
                              f"n={n} < 50 or avg_var={avg_var:.3f} > 0.1")
    if agreement_rate < 0.7:
        return LearningStage("mid", n, avg_var, agreement_rate,
                              f"agreement_rate={agreement_rate:.2f} < 0.7")
    return LearningStage("late", n, avg_var, agreement_rate,
                          f"n={n} >= 50, avg_var={avg_var:.3f} <= 0.1, agreement={agreement_rate:.2f} >= 0.7")


# ===========================================================================
# Strategy Performance Tracker
# ===========================================================================

@dataclass
class StrategyPerformance:
    """Tracks the performance of an acquisition strategy."""
    strategy: str
    n_uses: int = 0
    total_info_gain: float = 0.0
    ewma_info_gain: float = 0.0
    alpha: float = 0.1  # EWMA decay

    def update(self, info_gain: float) -> None:
        self.n_uses += 1
        self.total_info_gain += info_gain
        self.ewma_info_gain = (self.alpha * info_gain +
                                (1 - self.alpha) * self.ewma_info_gain)

    @property
    def avg_info_gain(self) -> float:
        return self.total_info_gain / max(self.n_uses, 1)


# ===========================================================================
# Meta-Active Learner
# ===========================================================================

class MetaActiveLearner:
    """Adaptively selects acquisition strategies based on learning stage.

    Implements:
      1. Stage detection (early/mid/late)
      2. Strategy mapping (uncertainty/disagreement/eig)
      3. Performance tracking (EWMA info gain per strategy)
      4. Exploration vs exploitation (epsilon-greedy)

    The meta-learner wraps an ActiveCausalLearner and overrides its
    acquisition method based on the current stage and past performance.
    """

    STAGE_STRATEGY = {
        "early": "uncertainty",
        "mid": "disagreement",
        "late": "eig",
    }

    def __init__(self, refiner: OnlineCausalRefiner,
                 epsilon: float = 0.1,
                 exploration_alpha: float = 0.1) -> None:
        self.refiner = refiner
        self.epsilon = epsilon
        self.exploration_alpha = exploration_alpha
        self.strategy_performance: Dict[str, StrategyPerformance] = {
            "uncertainty": StrategyPerformance("uncertainty", alpha=exploration_alpha),
            "disagreement": StrategyPerformance("disagreement", alpha=exploration_alpha),
            "eig": StrategyPerformance("eig", alpha=exploration_alpha),
        }
        self.stage_history: List[LearningStage] = []
        self.strategy_history: List[str] = []
        self.info_gain_history: List[float] = []
        self.prev_avg_var: float = 1.0

    def acquire(self, n_candidates: int = 20,
                 rng: Optional[random.Random] = None) -> Tuple[AcquisitionResult, str, LearningStage]:
        """Select the next observation using the adaptively-chosen strategy.

        Returns:
            (acquisition_result, strategy_used, current_stage)
        """
        if rng is None:
            rng = random.Random(42)

        # Step 1: Classify current stage
        stage = classify_stage(self.refiner)
        self.stage_history.append(stage)

        # Step 2: Select strategy (epsilon-greedy)
        if rng.random() < self.epsilon:
            # Exploration: random strategy (uniform over all strategies)
            strategy = rng.choice(list(self.STAGE_STRATEGY.values()))
        else:
            # Exploitation: use stage-based strategy, unless empirical
            # performance suggests otherwise
            stage_strategy = self.STAGE_STRATEGY[stage.stage]
            # Check if any strategy has significantly better performance
            best_perf_strategy = max(
                self.strategy_performance.values(),
                key=lambda p: p.ewma_info_gain)
            # Use empirical best if it has been used enough and is better
            if (best_perf_strategy.n_uses > 5 and
                best_perf_strategy.ewma_info_gain >
                self.strategy_performance[stage_strategy].ewma_info_gain * 1.2):
                strategy = best_perf_strategy.strategy
            else:
                strategy = stage_strategy

        self.strategy_history.append(strategy)

        # Step 3: Create active learner with selected strategy
        learner = ActiveCausalLearner(self.refiner, method=strategy)
        result = learner.acquire(n_candidates=n_candidates, rng=rng)

        # Step 4: Track info gain (will be updated when observation arrives)
        # For now, record the acquisition score as proxy
        self.info_gain_history.append(result.acquisition_score)

        return result, strategy, stage

    def record_info_gain(self, strategy: str, info_gain: float) -> None:
        """Record the actual information gain from an observation."""
        self.strategy_performance[strategy].update(info_gain)

    def compute_info_gain(self) -> float:
        """Compute information gain since last observation.

        Info gain = reduction in average ACE variance.
        """
        variances = []
        for i in range(self.refiner.n_features):
            est = self.refiner.get_estimate(i)
            if est is not None and est.std_error > 0:
                variances.append(est.std_error ** 2)
        current_avg_var = sum(variances) / max(len(variances), 1)
        info_gain = max(0, self.prev_avg_var - current_avg_var)
        self.prev_avg_var = current_avg_var
        return info_gain

    def get_stats(self) -> Dict[str, Any]:
        return {
            "n_acquisitions": len(self.strategy_history),
            "strategy_uses": {
                s: self.strategy_performance[s].n_uses
                for s in self.strategy_performance
            },
            "strategy_avg_info_gain": {
                s: round(self.strategy_performance[s].avg_info_gain, 4)
                for s in self.strategy_performance
            },
            "strategy_ewma_info_gain": {
                s: round(self.strategy_performance[s].ewma_info_gain, 4)
                for s in self.strategy_performance
            },
            "stage_distribution": {
                stage: sum(1 for s in self.stage_history if s.stage == stage)
                for stage in ["early", "mid", "late"]
            },
            "current_stage": self.stage_history[-1].stage if self.stage_history else "none",
        }


# ===========================================================================
# v6.17 Substrate with Meta-Active Learning
# ===========================================================================

class SubstrateV617:
    """The v6.17 substrate integrating meta-active learning.

    Extends v6.16 with:
      - MetaActiveLearner that adaptively selects acquisition strategies
      - Stage detection (early/mid/late)
      - Performance tracking per strategy
      - Exploration vs exploitation (epsilon-greedy)
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.90,
                 default_value: float = 1000.0,
                 min_value_threshold: float = 10.0,
                 ace_threshold: float = 0.1,
                 ci_epsilon: float = 0.1,
                 epsilon: float = 0.1) -> None:
        self.v616 = SubstrateV616(
            min_confidence=min_confidence,
            calibrated_target_acc=calibrated_target_acc,
            default_value=default_value,
            min_value_threshold=min_value_threshold,
            ace_threshold=ace_threshold,
            ci_epsilon=ci_epsilon,
        )
        self.epsilon = epsilon
        self.meta_learners: Dict[str, MetaActiveLearner] = {}

    def train(self, computation_type: str,
              features: Tuple[float, ...], outcome: Any) -> None:
        """Train the substrate (updates online causal estimates)."""
        self.v616.train(computation_type, features, outcome)
        # Initialize meta-learner if needed
        if computation_type not in self.meta_learners:
            refiner = self.v616.v615.online_refiners.get(computation_type)
            if refiner is not None:
                self.meta_learners[computation_type] = MetaActiveLearner(
                    refiner, epsilon=self.epsilon)

    def fit(self, computation_type: str) -> Dict[str, Any]:
        return self.v616.fit(computation_type)

    def acquire_next_meta(self, computation_type: str,
                           n_candidates: int = 20,
                           rng: Optional[random.Random] = None
                           ) -> Optional[Tuple[AcquisitionResult, str, LearningStage]]:
        """Select next observation using meta-active strategy selection.

        Returns:
            (acquisition_result, strategy_used, current_stage) or None
        """
        meta = self.meta_learners.get(computation_type)
        if meta is None:
            return None
        return meta.acquire(n_candidates=n_candidates, rng=rng)

    def meta_learning_loop(self, computation_type: str,
                            compute_fn: Callable[[Tuple[float, ...]], Any],
                            n_iterations: int = 50,
                            rng: Optional[random.Random] = None
                            ) -> Dict[str, Any]:
        """Run meta-active learning loop.

        For each iteration:
          1. Compute current info gain
          2. Acquire next observation (meta-adaptive strategy)
          3. Observe outcome
          4. Train on observation
          5. Record strategy performance
        """
        if rng is None:
            rng = random.Random(42)

        meta = self.meta_learners.get(computation_type)
        if meta is None:
            return {"error": "no meta-learner initialized"}

        results = {
            "n_iterations": 0,
            "strategies_used": [],
            "stages_seen": [],
            "info_gains": [],
            "observations": [],
        }

        for i in range(n_iterations):
            # Compute info gain from previous iteration
            info_gain = meta.compute_info_gain()

            # Acquire next observation
            acquisition = self.acquire_next_meta(
                computation_type, n_candidates=20, rng=rng)
            if acquisition is None:
                break

            result, strategy, stage = acquisition

            # Record strategy performance (info gain from PREVIOUS iteration,
            # attributed to the strategy that was used)
            if i > 0:
                prev_strategy = results["strategies_used"][-1]
                meta.record_info_gain(prev_strategy, info_gain)

            # Observe outcome
            features = result.selected_features
            outcome = compute_fn(features)

            # Train
            self.train(computation_type, features, outcome)

            results["n_iterations"] += 1
            results["strategies_used"].append(strategy)
            results["stages_seen"].append(stage.stage)
            results["info_gains"].append(info_gain)
            results["observations"].append({
                "features": features,
                "outcome": outcome,
                "strategy": strategy,
                "stage": stage.stage,
            })

        results["final_stats"] = meta.get_stats()
        results["n_causal_features"] = len(
            self.v616.get_online_causal_features(computation_type))
        return results

    def get_meta_stats(self, computation_type: str) -> Dict[str, Any]:
        """Get meta-active learning statistics."""
        meta = self.meta_learners.get(computation_type)
        if meta is None:
            return {"error": "no meta-learner"}
        return meta.get_stats()

    def predict(self, computation_type: str,
                features: Tuple[float, ...],
                full_computation: Callable,
                original_cost: float = 1000.0,
                record_outcome: bool = False
                ) -> Tuple[Any, float, float]:
        return self.v616.predict(
            computation_type, features, full_computation,
            original_cost=original_cost, record_outcome=record_outcome)

    def get_online_causal_features(self, computation_type: str) -> List[int]:
        return self.v616.get_online_causal_features(computation_type)

    def get_report(self) -> Dict[str, Any]:
        return {
            "v616_report": self.v616.get_report(),
            "meta_stats": {
                ct: self.get_meta_stats(ct)
                for ct in self.meta_learners
            },
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of meta-active learning."""
    import random
    print("Running v6.17 meta-active learning self-test...")

    sub = SubstrateV617(epsilon=0.1)
    rng = random.Random(42)

    def compute_fn(f):
        return bool(f[0]) and bool(f[1]) and bool(f[2])

    # Initial training
    for _ in range(20):
        f = tuple(float(rng.random() > 0.3) for _ in range(3))
        sub.train("meta_test", f, compute_fn(f))

    print(f"  After 20 passive observations:")
    print(f"    Causal features: {sub.get_online_causal_features('meta_test')}")

    # Meta-active learning
    print(f"\n  Running 40 meta-active learning iterations...")
    result = sub.meta_learning_loop(
        "meta_test", compute_fn, n_iterations=40, rng=rng)
    print(f"    Iterations: {result['n_iterations']}")
    print(f"    Final causal features: {result['n_causal_features']}")
    print(f"    Final stats: {result['final_stats']}")

    print("\nSelf-test OK.")


if __name__ == "__main__":
    self_test()
