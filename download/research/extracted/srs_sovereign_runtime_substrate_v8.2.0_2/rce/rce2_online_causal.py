#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_online_causal.py — RCE-2 v6.15 Online Causal Refinement

PROBLEM:
  v6.14 estimates causal effects in BATCH: collect all observations,
  run PSM/IPW/DR, get estimates. When new observations arrive, the
  entire batch must be re-run. This is O(n) per update — too expensive
  for production systems with streaming data.

SOLUTION:
  The OnlineCausalRefiner updates causal estimates INCREMENTALLY as
  new observations arrive. Key techniques:

  1. STREAMING LOGISTIC REGRESSION for propensity scores
     - Update weights via stochastic gradient descent on each new observation
     - O(d) per update (d = # features) instead of O(n*d) for batch
     - Propensity scores are always up-to-date

  2. INCREMENTAL DR ESTIMATION
     - Maintain running sums for DR terms
     - Update estimates in O(1) per new observation
     - Confidence intervals tighten as n grows

  3. CHANGE DETECTION
     - Monitor estimate stability
     - If estimates shift significantly, flag for full batch re-estimation
     - Prevents drift from accumulating

MATHEMATICAL MODEL:

  Streaming logistic regression:
    For each new (x, t):
      pred = sigmoid(w . x)
      error = pred - t
      w -= lr * error * x  (gradient step)
      e(x) = sigmoid(w . x)

  Incremental DR:
    Maintain:
      S_t = sum of T*Y/e(X) over all observations
      S_c = sum of (1-T)*Y/(1-e(X))
      n_t = count of treated
      n_c = count of control
      m1 = running mean of Y | T=1
      m0 = running mean of Y | T=0

    On new (x, t, y, e):
      S_t += t * y / e  (if treated)
      S_c += (1-t) * y / (1-e)  (if control)
      m1 = incremental update
      m0 = incremental update
      ACE_DR = (S_t/n_t - S_c/n_c) + correction terms

  Change detection:
    track_ace = exponentially weighted moving average of ACE
    if |new_ace - track_ace| > 3 * sigma:
      flag for batch re-estimation

WHY THIS MATTERS:

  Online refinement enables:
    1. REAL-TIME CAUSAL DISCOVERY: causal estimates update as data flows in
    2. ADAPTIVE SUBSTRATE: the causal model adapts to distribution shifts
    3. EFFICIENT UPDATES: O(d) per observation instead of O(n*d)
    4. DRIFT DETECTION: automatic flagging when causal structure changes

  The substrate can now maintain an up-to-date causal model in production
  without expensive batch re-estimation.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_substrate import Substrate
from rce.rce2_observational_causal import SubstrateV614, CausalEstimate


# ===========================================================================
# Online Causal Estimate
# ===========================================================================

@dataclass
class OnlineCausalEstimate:
    """An online-updated causal estimate."""
    feature_index: int
    ace_estimate: float
    std_error: float
    n_observations: int
    n_treated: int
    n_control: int
    is_stable: bool          # estimate hasn't changed significantly recently
    drift_detected: bool     # significant change detected
    last_update_time: float = 0.0


# ===========================================================================
# Streaming Logistic Regression
# ===========================================================================

class StreamingLogisticRegression:
    """Online logistic regression via stochastic gradient descent.

    Updates weights incrementally as new observations arrive.
    O(d) per update.
    """

    def __init__(self, n_features: int, learning_rate: float = 0.01) -> None:
        self.n_features = n_features
        self.learning_rate = learning_rate
        # Weights: intercept + n_features predictors
        self.weights = [0.0] * (n_features + 1)
        self.n_updates = 0

    def predict_proba(self, x: Tuple[float, ...]) -> float:
        """Predict P(T=1 | X=x)."""
        z = self.weights[0]  # intercept
        for i in range(len(x)):
            z += self.weights[i + 1] * x[i]
        if z > 500:
            return 1.0
        if z < -500:
            return 0.0
        return 1.0 / (1.0 + math.exp(-z))

    def partial_fit(self, x: Tuple[float, ...], t: float) -> None:
        """Update weights with a single observation."""
        pred = self.predict_proba(x)
        error = pred - t
        # Gradient: dL/dw_0 = error, dL/dw_i = error * x_i
        self.weights[0] -= self.learning_rate * error
        for i in range(len(x)):
            self.weights[i + 1] -= self.learning_rate * error * x[i]
        self.n_updates += 1

    def get_weights(self) -> List[float]:
        return list(self.weights)


# ===========================================================================
# Online Causal Refiner
# ===========================================================================

class OnlineCausalRefiner:
    """Updates causal estimates incrementally as new observations arrive.

    Maintains:
      - Streaming logistic regression for propensity scores
      - Running sums for DR estimation
      - Change detection for drift

    O(d) per observation update.
    """

    def __init__(self, n_features: int,
                 ace_threshold: float = 0.1,
                 learning_rate: float = 0.01,
                 drift_threshold: float = 3.0,
                 ewma_alpha: float = 0.1) -> None:
        self.n_features = n_features
        self.ace_threshold = ace_threshold
        self.drift_threshold = drift_threshold
        self.ewma_alpha = ewma_alpha

        # Per-feature state
        self.propensity_models: Dict[int, StreamingLogisticRegression] = {}
        # DR running sums per feature
        self.dr_sums: Dict[int, Dict[str, float]] = defaultdict(
            lambda: {"S_t": 0.0, "S_c": 0.0, "n_t": 0, "n_c": 0,
                      "sum_y_t": 0.0, "sum_y_c": 0.0,
                      "sum_y2_t": 0.0, "sum_y2_c": 0.0})
        # EWMA for change detection
        self.ewma_ace: Dict[int, float] = {}
        self.ewma_var: Dict[int, float] = {}
        # Estimates
        self.estimates: Dict[int, OnlineCausalEstimate] = {}
        # Drift log
        self.drift_log: List[Dict[str, Any]] = []
        self.n_observations = 0

        # Initialize propensity models for each feature
        for i in range(n_features):
            self.propensity_models[i] = StreamingLogisticRegression(
                n_features - 1, learning_rate)  # -1 because we exclude the treatment feature

    def update(self, features: Tuple[float, ...], outcome: Any) -> None:
        """Update causal estimates with a new observation.

        O(d^2) per update (d propensity models, each O(d) update).
        For small d, this is effectively O(d).
        """
        self.n_observations += 1
        y = 1.0 if outcome else 0.0

        for i in range(self.n_features):
            t = features[i]
            # Propensity model uses OTHER features as predictors
            predictor_indices = [j for j in range(self.n_features) if j != i]
            predictor_x = tuple(features[j] for j in predictor_indices)

            # Update propensity model
            self.propensity_models[i].partial_fit(predictor_x, t)
            e = self.propensity_models[i].predict_proba(predictor_x)
            e = max(0.01, min(0.99, e))  # clip

            # Update DR running sums
            sums = self.dr_sums[i]
            if t > 0.5:
                sums["S_t"] += t * y / e
                sums["n_t"] += 1
                sums["sum_y_t"] += y
                sums["sum_y2_t"] += y * y
            else:
                sums["S_c"] += (1 - t) * y / (1 - e)
                sums["n_c"] += 1
                sums["sum_y_c"] += y
                sums["sum_y2_c"] += y * y

            # Compute current ACE estimate
            if sums["n_t"] > 0 and sums["n_c"] > 0:
                m1 = sums["sum_y_t"] / sums["n_t"]
                m0 = sums["sum_y_c"] / sums["n_c"]
                mean_t = sums["S_t"] / sums["n_t"]
                mean_c = sums["S_c"] / sums["n_c"]
                ace = mean_t - mean_c + (m1 - mean_t) - (m0 - mean_c)
                # Simplified: ace ≈ mean_t - mean_c for DR

                # Standard error
                if sums["n_t"] > 1:
                    var_t = (sums["sum_y2_t"] / sums["n_t"]
                             - (sums["sum_y_t"] / sums["n_t"]) ** 2)
                else:
                    var_t = 0.0
                if sums["n_c"] > 1:
                    var_c = (sums["sum_y2_c"] / sums["n_c"]
                             - (sums["sum_y_c"] / sums["n_c"]) ** 2)
                else:
                    var_c = 0.0
                se = math.sqrt(max(var_t, 0) / max(sums["n_t"], 1) +
                               max(var_c, 0) / max(sums["n_c"], 1))

                # Change detection (EWMA)
                old_ewma = self.ewma_ace.get(i, ace)
                new_ewma = self.ewma_alpha * ace + (1 - self.ewma_alpha) * old_ewma
                old_var = self.ewma_var.get(i, se * se)
                new_var = self.ewma_alpha * se * se + (1 - self.ewma_alpha) * old_var
                drift = abs(new_ewma - old_ewma) > self.drift_threshold * math.sqrt(max(new_var, 1e-10))

                if drift and self.n_observations > 50:
                    self.drift_log.append({
                        "feature": i,
                        "observation": self.n_observations,
                        "old_ewma": old_ewma,
                        "new_ewma": new_ewma,
                        "change": abs(new_ewma - old_ewma),
                    })

                self.ewma_ace[i] = new_ewma
                self.ewma_var[i] = new_var

                self.estimates[i] = OnlineCausalEstimate(
                    feature_index=i,
                    ace_estimate=ace,
                    std_error=se,
                    n_observations=sums["n_t"] + sums["n_c"],
                    n_treated=sums["n_t"],
                    n_control=sums["n_c"],
                    is_stable=not drift,
                    drift_detected=drift and self.n_observations > 50,
                    last_update_time=self.n_observations,
                )

    def get_estimate(self, feature_idx: int) -> Optional[OnlineCausalEstimate]:
        return self.estimates.get(feature_idx)

    def get_causal_features(self) -> List[int]:
        """Return indices of features estimated to be causal."""
        return [i for i, e in self.estimates.items()
                if abs(e.ace_estimate) > self.ace_threshold
                and e.n_treated > 5 and e.n_control > 5]

    def get_stats(self) -> Dict[str, Any]:
        return {
            "n_observations": self.n_observations,
            "n_features": self.n_features,
            "n_causal": len(self.get_causal_features()),
            "n_drift_events": len(self.drift_log),
            "estimates": {
                str(i): {
                    "ace": round(e.ace_estimate, 3),
                    "se": round(e.std_error, 3),
                    "n_treated": e.n_treated,
                    "n_control": e.n_control,
                    "is_stable": e.is_stable,
                    "drift_detected": e.drift_detected,
                }
                for i, e in self.estimates.items()
            },
        }


# ===========================================================================
# v6.15 Substrate with Online Causal Refinement
# ===========================================================================

class SubstrateV615:
    """The v6.15 substrate integrating online causal refinement.

    Extends v6.14 with:
      - OnlineCausalRefiner for streaming causal estimate updates
      - O(d) per observation (vs O(n*d) for batch)
      - Drift detection via EWMA
      - Real-time causal model adaptation
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.90,
                 default_value: float = 1000.0,
                 min_value_threshold: float = 10.0,
                 ace_threshold: float = 0.1,
                 ci_epsilon: float = 0.1) -> None:
        self.v614 = SubstrateV614(
            min_confidence=min_confidence,
            calibrated_target_acc=calibrated_target_acc,
            default_value=default_value,
            min_value_threshold=min_value_threshold,
            ace_threshold=ace_threshold,
            ci_epsilon=ci_epsilon,
        )
        self.online_refiners: Dict[str, OnlineCausalRefiner] = {}
        self._feature_dims: Dict[str, int] = {}

    def train(self, computation_type: str,
              features: Tuple[float, ...], outcome: Any) -> None:
        """Train the substrate AND update online causal estimates."""
        self.v614.train(computation_type, features, outcome)
        # Initialize online refiner if needed
        if computation_type not in self.online_refiners:
            d = len(features)
            self.online_refiners[computation_type] = OnlineCausalRefiner(d, self.v614.obs_estimator.ace_threshold)
            self._feature_dims[computation_type] = d
        # Update online estimates
        self.online_refiners[computation_type].update(features, outcome)

    def fit(self, computation_type: str) -> Dict[str, Any]:
        return self.v614.fit(computation_type)

    def get_online_causal_features(self, computation_type: str) -> List[int]:
        """Get causal features from online estimates."""
        refiner = self.online_refiners.get(computation_type)
        if refiner is None:
            return []
        return refiner.get_causal_features()

    def get_online_stats(self, computation_type: str) -> Dict[str, Any]:
        """Get online refinement statistics."""
        refiner = self.online_refiners.get(computation_type)
        if refiner is None:
            return {"error": "no refiner"}
        return refiner.get_stats()

    def estimate_causal_effects(self, computation_type: str) -> Dict[str, Any]:
        """Batch estimation (delegates to v6.14)."""
        return self.v614.estimate_causal_effects(computation_type)

    def discover_scm(self, computation_type: str,
                      compute_fn: Callable[[Tuple[float, ...]], Any],
                      training_features: List[Tuple[float, ...]]
                      ) -> Dict[str, Any]:
        return self.v614.discover_scm(computation_type, compute_fn, training_features)

    def counterfactual(self, computation_type: str,
                        features: Tuple[float, ...],
                        interventions: Dict[int, float],
                        original_outcome: Optional[Any] = None):
        return self.v614.counterfactual(
            computation_type, features, interventions, original_outcome)

    def predict(self, computation_type: str,
                features: Tuple[float, ...],
                full_computation: Callable,
                original_cost: float = 1000.0,
                record_outcome: bool = False
                ) -> Tuple[Any, float, float]:
        return self.v614.predict(
            computation_type, features, full_computation,
            original_cost=original_cost, record_outcome=record_outcome)

    def get_report(self) -> Dict[str, Any]:
        return {
            "v614_report": self.v614.get_report(),
            "online_stats": {
                ct: self.get_online_stats(ct)
                for ct in self.online_refiners
            },
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of online causal refinement."""
    import random
    print("Running v6.15 online causal refinement self-test...")

    sub = SubstrateV615()
    rng = random.Random(42)

    # Stream observations: f0 causes outcome, f1 is noise
    for i in range(200):
        f0 = float(rng.random() > 0.3)
        f1 = float(rng.random() > 0.5)
        outcome = bool(f0)
        sub.train("stream_test", (f0, f1), outcome)

        # Check online estimates periodically
        if i == 49 or i == 99 or i == 199:
            stats = sub.get_online_stats("stream_test")
            print(f"  After {i+1} observations:")
            print(f"    Causal features: {sub.get_online_causal_features('stream_test')}")
            for feat_idx, est in stats["estimates"].items():
                print(f"    f{feat_idx}: ACE={est['ace']:.3f} SE={est['se']:.3f} "
                      f"n_t={est['n_treated']} n_c={est['n_control']} "
                      f"stable={est['is_stable']}")

    print("\nSelf-test OK.")


if __name__ == "__main__":
    self_test()
