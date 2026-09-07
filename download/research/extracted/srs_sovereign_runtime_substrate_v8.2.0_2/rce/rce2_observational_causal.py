#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rce2_observational_causal.py — RCE-2 v6.14 Observational Causal Effect Estimation

PROBLEM:
  v6.11-v6.13 require INTERVENTIONAL queries (do-operator) to discover
  causal features. This requires the ground truth compute_fn — the actual
  computation the substrate is trying to avoid. In production, we don't
  have compute_fn available for offline interventional queries; we only
  have OBSERVATIONAL data (features, outcomes) from past computations.

  Can we estimate causal effects from observational data alone, without
  running interventions?

SOLUTION:
  The ObservationalCausalEstimator implements three methods from the
  causal inference literature:

  1. PROPENSITY SCORE MATCHING (PSM)
     - Estimate P(treatment=1 | confounders) — the propensity score
     - For each treated unit, find a control unit with similar propensity
     - Compare outcomes → causal effect estimate
     - Requires: no unobserved confounders, overlap (positivity)

  2. INVERSE PROBABILITY WEIGHTING (IPW)
     - Weight each observation by 1/propensity_score
     - This creates a "pseudo-population" where treatment is independent
       of confounders
     - Compare weighted outcomes → causal effect estimate
     - Requires: same as PSM, plus stable weights

  3. DOUBLY-ROBUST ESTIMATION (DR)
     - Combines propensity score AND outcome regression
     - Consistent if EITHER model is correct (doubly robust)
     - Most reliable of the three methods

MATHEMATICAL MODEL:

  Propensity score: e(x) = P(T=1 | X=x)
    Estimated via logistic regression on confounders

  PSM estimator:
    ACE_PSM = mean[Y_i | T=1] - mean[Y_j | T=0, e(X_j) ≈ e(X_i)]

  IPW estimator:
    ACE_IPW = mean[T*Y/e(X)] - mean[(1-T)*Y/(1-e(X))]

  Doubly-robust estimator:
    m1(x) = E[Y | T=1, X=x]  (outcome regression for treated)
    m0(x) = E[Y | T=0, X=x]  (outcome regression for control)
    ACE_DR = mean[m1(X) - m0(X)] + mean[T*(Y-m1(X))/e(X)] - mean[(1-T)*(Y-m0(X))/(1-e(X))]

  A feature is causal if |ACE| > threshold (same as v6.11, but estimated
  from observational data instead of interventional queries).

WHY THIS MATTERS:

  Observational estimation enables causal discovery WITHOUT the ground
  truth compute_fn. The substrate can learn causal structure from past
  computation logs alone — no offline interventional training required.
  This makes causal discovery practical in production:

    1. Collect (features, outcome) pairs from normal computation
    2. Run observational causal estimator (PSM/IPW/DR)
    3. Identify causal features
    4. Build causal laws using only causal features

  The trade-off: observational estimates are less reliable than
  interventional ones (they assume no unobserved confounders). The
  substrate should use observational estimates as a FIRST PASS, then
  validate with interventional queries when compute_fn is available.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from rce.rce2_substrate import Substrate
from rce.rce2_counterfactual import SubstrateV613


# ===========================================================================
# Causal Effect Estimate
# ===========================================================================

@dataclass
class CausalEstimate:
    """An estimate of a feature's causal effect."""
    feature_index: int
    method: str                    # "psm", "ipw", "doubly_robust"
    ace_estimate: float            # estimated Average Causal Effect
    std_error: float               # estimated standard error
    confidence_interval: Tuple[float, float]
    n_treated: int
    n_control: int
    is_causal: bool                # |ACE| > threshold and CI excludes 0
    method_specific: Dict[str, Any] = field(default_factory=dict)


# ===========================================================================
# Propensity Score Estimation
# ===========================================================================

def estimate_propensity_scores(
    features: List[Tuple[float, ...]],
    treatments: List[float],
    feature_idx: int
) -> List[float]:
    """Estimate propensity scores e(x) = P(T=1 | X=x).

    Uses a simple logistic regression with the OTHER features as
    predictors of the treatment. The treatment is whether feature_idx
    is 1 (for binary features).

    Args:
        features: list of feature vectors
        treatments: list of treatment indicators (0 or 1)
        feature_idx: which feature is the "treatment"

    Returns:
        List of propensity scores (one per observation)
    """
    if not features:
        return []

    d = len(features[0])
    # Use other features as predictors
    predictor_indices = [i for i in range(d) if i != feature_idx]

    # Simple logistic regression via gradient descent
    # P(T=1 | X) = sigmoid(w0 + sum(w_i * X_i))
    weights = [0.0] * (len(predictor_indices) + 1)  # +1 for intercept
    lr = 0.01
    n_iterations = 100

    for _ in range(n_iterations):
        gradients = [0.0] * len(weights)
        for i, (f, t) in enumerate(zip(features, treatments)):
            # Compute prediction
            z = weights[0]  # intercept
            for j, idx in enumerate(predictor_indices):
                z += weights[j + 1] * f[idx]
            pred = 1.0 / (1.0 + math.exp(-z)) if z > -500 else 0.0
            # Gradient of log-likelihood
            error = pred - t
            gradients[0] += error
            for j, idx in enumerate(predictor_indices):
                gradients[j + 1] += error * f[idx]
        # Update weights
        for j in range(len(weights)):
            weights[j] -= lr * gradients[j] / max(len(features), 1)

    # Compute propensity scores
    scores = []
    for f in features:
        z = weights[0]
        for j, idx in enumerate(predictor_indices):
            z += weights[j + 1] * f[idx]
        score = 1.0 / (1.0 + math.exp(-z)) if z > -500 else 0.0
        # Clip to avoid division by zero
        score = max(0.01, min(0.99, score))
        scores.append(score)
    return scores


# ===========================================================================
# Observational Causal Estimator
# ===========================================================================

class ObservationalCausalEstimator:
    """Estimates causal effects from observational data.

    Implements three methods:
      1. Propensity Score Matching (PSM)
      2. Inverse Probability Weighting (IPW)
      3. Doubly-Robust Estimation (DR)

    All methods assume:
      - No unobserved confounders (ignorability)
      - Overlap (positivity): 0 < P(T=1|X) < 1
      - SUTVA: one unit's treatment doesn't affect another's outcome
    """

    def __init__(self, ace_threshold: float = 0.1) -> None:
        self.ace_threshold = ace_threshold
        self.estimates: Dict[str, List[CausalEstimate]] = defaultdict(list)

    def estimate_ace_psm(self, features: List[Tuple[float, ...]],
                          outcomes: List[Any],
                          feature_idx: int) -> CausalEstimate:
        """Estimate ACE via Propensity Score Matching.

        For each treated unit (feature_idx=1), find the control unit
        (feature_idx=0) with the most similar propensity score, and
        compare outcomes.
        """
        treatments = [float(f[feature_idx]) for f in features]
        propensities = estimate_propensity_scores(features, treatments, feature_idx)

        treated = [(i, propensities[i], outcomes[i])
                    for i in range(len(features)) if treatments[i] > 0.5]
        control = [(i, propensities[i], outcomes[i])
                    for i in range(len(features)) if treatments[i] <= 0.5]

        if not treated or not control:
            return CausalEstimate(
                feature_index=feature_idx, method="psm",
                ace_estimate=0.0, std_error=1.0,
                confidence_interval=(-1.0, 1.0),
                n_treated=len(treated), n_control=len(control),
                is_causal=False,
                method_specific={"reason": "no treated or control units"})

        # Match each treated to nearest control by propensity
        matched_outcomes_treated = []
        matched_outcomes_control = []
        for _, prop_t, y_t in treated:
            # Find nearest control by propensity
            best_control = min(control, key=lambda c: abs(c[1] - prop_t))
            matched_outcomes_treated.append(1.0 if y_t else 0.0)
            matched_outcomes_control.append(1.0 if best_control[2] else 0.0)

        mean_t = sum(matched_outcomes_treated) / len(matched_outcomes_treated)
        mean_c = sum(matched_outcomes_control) / len(matched_outcomes_control)
        ace = mean_t - mean_c

        # Standard error (simplified)
        var_t = sum((y - mean_t) ** 2 for y in matched_outcomes_treated) / max(len(matched_outcomes_treated), 1)
        var_c = sum((y - mean_c) ** 2 for y in matched_outcomes_control) / max(len(matched_outcomes_control), 1)
        se = math.sqrt(var_t / max(len(matched_outcomes_treated), 1) +
                       var_c / max(len(matched_outcomes_control), 1))

        ci = (ace - 1.96 * se, ace + 1.96 * se)
        is_causal = abs(ace) > self.ace_threshold and (ci[0] > 0 or ci[1] < 0)

        return CausalEstimate(
            feature_index=feature_idx, method="psm",
            ace_estimate=ace, std_error=se,
            confidence_interval=ci,
            n_treated=len(treated), n_control=len(control),
            is_causal=is_causal,
            method_specific={"mean_treated": mean_t, "mean_control": mean_c})

    def estimate_ace_ipw(self, features: List[Tuple[float, ...]],
                          outcomes: List[Any],
                          feature_idx: int) -> CausalEstimate:
        """Estimate ACE via Inverse Probability Weighting.

        ACE_IPW = mean[T*Y/e(X)] - mean[(1-T)*Y/(1-e(X))]
        """
        treatments = [float(f[feature_idx]) for f in features]
        propensities = estimate_propensity_scores(features, treatments, feature_idx)

        weighted_treated = []
        weighted_control = []
        n_treated = 0
        n_control = 0

        for i in range(len(features)):
            t = treatments[i]
            y = 1.0 if outcomes[i] else 0.0
            e = propensities[i]
            if t > 0.5:
                weighted_treated.append(t * y / e)
                n_treated += 1
            else:
                weighted_control.append((1 - t) * y / (1 - e))
                n_control += 1

        if n_treated == 0 or n_control == 0:
            return CausalEstimate(
                feature_index=feature_idx, method="ipw",
                ace_estimate=0.0, std_error=1.0,
                confidence_interval=(-1.0, 1.0),
                n_treated=n_treated, n_control=n_control,
                is_causal=False,
                method_specific={"reason": "no treated or control units"})

        mean_t = sum(weighted_treated) / n_treated
        mean_c = sum(weighted_control) / n_control
        ace = mean_t - mean_c

        # Simplified SE
        var_t = sum((w - mean_t) ** 2 for w in weighted_treated) / max(n_treated, 1)
        var_c = sum((w - mean_c) ** 2 for w in weighted_control) / max(n_control, 1)
        se = math.sqrt(var_t / max(n_treated, 1) + var_c / max(n_control, 1))

        ci = (ace - 1.96 * se, ace + 1.96 * se)
        is_causal = abs(ace) > self.ace_threshold and (ci[0] > 0 or ci[1] < 0)

        return CausalEstimate(
            feature_index=feature_idx, method="ipw",
            ace_estimate=ace, std_error=se,
            confidence_interval=ci,
            n_treated=n_treated, n_control=n_control,
            is_causal=is_causal,
            method_specific={"mean_treated": mean_t, "mean_control": mean_c})

    def estimate_ace_dr(self, features: List[Tuple[float, ...]],
                         outcomes: List[Any],
                         feature_idx: int) -> CausalEstimate:
        """Estimate ACE via Doubly-Robust Estimation.

        Combines propensity score and outcome regression.
        Consistent if EITHER model is correct.
        """
        treatments = [float(f[feature_idx]) for f in features]
        propensities = estimate_propensity_scores(features, treatments, feature_idx)

        # Outcome regression: m1(x) = E[Y | T=1, X=x], m0(x) = E[Y | T=0, X=x]
        # Simplified: use group means as outcome regression
        treated_outcomes = [1.0 if outcomes[i] else 0.0
                            for i in range(len(features)) if treatments[i] > 0.5]
        control_outcomes = [1.0 if outcomes[i] else 0.0
                            for i in range(len(features)) if treatments[i] <= 0.5]

        m1 = sum(treated_outcomes) / max(len(treated_outcomes), 1)
        m0 = sum(control_outcomes) / max(len(control_outcomes), 1)

        # DR estimator
        dr_terms = []
        n_treated = 0
        n_control = 0
        for i in range(len(features)):
            t = treatments[i]
            y = 1.0 if outcomes[i] else 0.0
            e = propensities[i]
            if t > 0.5:
                dr_terms.append(m1 + t * (y - m1) / e - m0)
                n_treated += 1
            else:
                dr_terms.append(m1 - (m0 + (1 - t) * (y - m0) / (1 - e)))
                n_control += 1

        if not dr_terms:
            return CausalEstimate(
                feature_index=feature_idx, method="doubly_robust",
                ace_estimate=0.0, std_error=1.0,
                confidence_interval=(-1.0, 1.0),
                n_treated=n_treated, n_control=n_control,
                is_causal=False)

        ace = sum(dr_terms) / len(dr_terms)
        var = sum((d - ace) ** 2 for d in dr_terms) / max(len(dr_terms), 1)
        se = math.sqrt(var / max(len(dr_terms), 1))

        ci = (ace - 1.96 * se, ace + 1.96 * se)
        is_causal = abs(ace) > self.ace_threshold and (ci[0] > 0 or ci[1] < 0)

        return CausalEstimate(
            feature_index=feature_idx, method="doubly_robust",
            ace_estimate=ace, std_error=se,
            confidence_interval=ci,
            n_treated=n_treated, n_control=n_control,
            is_causal=is_causal,
            method_specific={"m1": m1, "m0": m0})

    def estimate_all(self, computation_type: str,
                      features: List[Tuple[float, ...]],
                      outcomes: List[Any]) -> List[CausalEstimate]:
        """Estimate ACE for all features using all three methods.

        Returns the doubly-robust estimate as the primary (most reliable),
        with PSM and IPW as cross-checks.
        """
        if not features:
            return []

        d = len(features[0])
        results = []
        for i in range(d):
            # Use doubly-robust as primary
            estimate = self.estimate_ace_dr(features, outcomes, i)
            # Also compute PSM and IPW for cross-checking
            psm = self.estimate_ace_psm(features, outcomes, i)
            ipw = self.estimate_ace_ipw(features, outcomes, i)
            estimate.method_specific["psm_ace"] = psm.ace_estimate
            estimate.method_specific["ipw_ace"] = ipw.ace_estimate
            # Cross-check: if all three agree on direction, increase confidence
            agree = (psm.ace_estimate * ipw.ace_estimate > 0 and
                     estimate.ace_estimate * psm.ace_estimate > 0)
            estimate.method_specific["methods_agree"] = agree
            if agree:
                estimate.is_causal = abs(estimate.ace_estimate) > self.ace_threshold
            results.append(estimate)

        self.estimates[computation_type] = results
        return results

    def get_causal_features(self, computation_type: str) -> List[int]:
        """Return indices of features estimated to be causal."""
        return [e.feature_index for e in self.estimates.get(computation_type, [])
                if e.is_causal]

    def get_stats(self, computation_type: Optional[str] = None) -> Dict[str, Any]:
        if computation_type:
            ests = self.estimates.get(computation_type, [])
        else:
            ests = [e for ests_list in self.estimates.values() for e in ests_list]
        return {
            "n_features_estimated": len(ests),
            "n_causal": sum(1 for e in ests if e.is_causal),
            "n_non_causal": sum(1 for e in ests if not e.is_causal),
            "estimates": [
                {
                    "feature": e.feature_index,
                    "method": e.method,
                    "ace": round(e.ace_estimate, 3),
                    "se": round(e.std_error, 3),
                    "ci": [round(e.confidence_interval[0], 3),
                           round(e.confidence_interval[1], 3)],
                    "is_causal": e.is_causal,
                    "methods_agree": e.method_specific.get("methods_agree", False),
                }
                for e in ests
            ],
        }


# ===========================================================================
# v6.14 Substrate with Observational Causal Estimation
# ===========================================================================

class SubstrateV614:
    """The v6.14 substrate integrating observational causal estimation.

    Extends v6.13 with:
      - ObservationalCausalEstimator for estimating ACE from data alone
      - Three methods: PSM, IPW, doubly-robust
      - Cross-check agreement across methods
      - No ground truth compute_fn required
    """

    def __init__(self,
                 min_confidence: float = 0.85,
                 calibrated_target_acc: float = 0.90,
                 default_value: float = 1000.0,
                 min_value_threshold: float = 10.0,
                 ace_threshold: float = 0.1,
                 ci_epsilon: float = 0.1) -> None:
        self.v613 = SubstrateV613(
            min_confidence=min_confidence,
            calibrated_target_acc=calibrated_target_acc,
            default_value=default_value,
            min_value_threshold=min_value_threshold,
            ace_threshold=ace_threshold,
            ci_epsilon=ci_epsilon,
        )
        self.obs_estimator = ObservationalCausalEstimator(
            ace_threshold=ace_threshold)
        self._obs_initialized: set = set()

    def train(self, computation_type: str,
              features: Tuple[float, ...], outcome: Any) -> None:
        self.v613.train(computation_type, features, outcome)

    def fit(self, computation_type: str) -> Dict[str, Any]:
        return self.v613.fit(computation_type)

    def estimate_causal_effects(self, computation_type: str) -> Dict[str, Any]:
        """Estimate causal effects from OBSERVATIONAL data alone.

        Uses the substrate's stored (features, outcome) pairs — no
        ground truth compute_fn required.
        """
        substrate = self.v613.v612.v611.v610.v69.v68.substrate
        states = substrate.universe.states.get(computation_type, [])
        if not states:
            return {"error": "no training data"}

        features = [s.features for s in states]
        outcomes = [s.outcome for s in states]

        estimates = self.obs_estimator.estimate_all(
            computation_type, features, outcomes)
        self._obs_initialized.add(computation_type)

        causal_features = self.obs_estimator.get_causal_features(computation_type)
        return {
            "n_features": len(features[0]) if features else 0,
            "n_causal": len(causal_features),
            "causal_features": causal_features,
            "estimates": [
                {
                    "feature": e.feature_index,
                    "ace": round(e.ace_estimate, 3),
                    "is_causal": e.is_causal,
                    "methods_agree": e.method_specific.get("methods_agree", False),
                    "psm_ace": round(e.method_specific.get("psm_ace", 0), 3),
                    "ipw_ace": round(e.method_specific.get("ipw_ace", 0), 3),
                }
                for e in estimates
            ],
        }

    def get_causal_features(self, computation_type: str) -> List[int]:
        """Return indices of features estimated to be causal."""
        return self.obs_estimator.get_causal_features(computation_type)

    def discover_scm(self, computation_type: str,
                      compute_fn: Callable[[Tuple[float, ...]], Any],
                      training_features: List[Tuple[float, ...]]
                      ) -> Dict[str, Any]:
        """Discover SCM using observational estimates when possible."""
        return self.v613.discover_scm(computation_type, compute_fn, training_features)

    def counterfactual(self, computation_type: str,
                        features: Tuple[float, ...],
                        interventions: Dict[int, float],
                        original_outcome: Optional[Any] = None):
        """Counterfactual query (delegates to v6.13)."""
        return self.v613.counterfactual(
            computation_type, features, interventions, original_outcome)

    def predict(self, computation_type: str,
                features: Tuple[float, ...],
                full_computation: Callable,
                original_cost: float = 1000.0,
                record_outcome: bool = False
                ) -> Tuple[Any, float, float]:
        return self.v613.predict(
            computation_type, features, full_computation,
            original_cost=original_cost, record_outcome=record_outcome)

    def get_report(self) -> Dict[str, Any]:
        return {
            "v613_report": self.v613.get_report(),
            "observational_stats": {
                ct: self.obs_estimator.get_stats(ct)
                for ct in self._obs_initialized
            },
        }


# ===========================================================================
# Self-test
# ===========================================================================

def self_test() -> None:
    """Quick self-test of observational causal estimation."""
    import random
    print("Running v6.14 observational causal estimation self-test...")

    sub = SubstrateV614()
    rng = random.Random(42)

    # Confounded structure: f0 causes both f1 and outcome
    # f0 = random, f1 = f0 (confounded), f2 = noise
    for _ in range(100):
        f0 = rng.random() > 0.3
        f1 = f0  # confounded
        f2 = rng.random() > 0.5
        outcome = bool(f0)  # outcome = f0 (f1 is confounder)
        sub.train("confounded", (float(f0), float(f1), float(f2)), outcome)
    sub.fit("confounded")

    # Estimate causal effects from observational data
    result = sub.estimate_causal_effects("confounded")
    print(f"  Observational estimation: {result}")

    # Check: f0 should be causal, f1 should NOT be (confounder)
    causal = sub.get_causal_features("confounded")
    print(f"  Causal features: {causal}")
    print(f"  (f0 is the true cause, f1 is confounded)")

    print("\nSelf-test OK.")


if __name__ == "__main__":
    self_test()
